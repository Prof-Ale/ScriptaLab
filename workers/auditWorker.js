/**
 * Worker de auditoria — ScriptaLab.
 *
 * Script clássico, sem imports ESM (o worker é carregado por Blob URL,
 * no mesmo padrão do worker do pdf.js — a CSP tem `worker-src blob:`).
 * Zero dependência do núcleo: o mathlabBridge.js continua síncrono
 * na thread principal, sem mudar.
 *
 * O que roda aqui (só a parte pesada):
 *  - consulta de DOI na CrossRef (works + agency) e busca
 *    Autor+Ano na CrossRef e no OpenAlex, com o mesmo pacing e retry
 *    da thread principal (getJSON): 429/503 com Retry-After, 404
 *    como resposta, erro HTTP como exceção por item.
 *  - parser de DOCX via mammoth (importScripts do cdnjs, sob
 *    demanda, só no primeiro DOCX). Se o mammoth não carregar,
 *    o worker avisa e a thread principal faz o fallback.
 *
 * O que NÃO roda aqui (fica na thread principal, como sempre):
 *  - compareRef / refBlockFor (validação do DOI contra a referência),
 *    crossCheckRefs, scrubber, estilometria, ABNT e a ponte MathLab.
 *    O worker devolve o resultado BRUTO; a thread principal valida
 *    antes de virar proposta ou cartão. Um resultado bruto nunca
 *    vira patch direto.
 *
 * Protocolo (scriptalab.audit-worker/1):
 *  main -> worker: {protocol, type:'audit-dois', requestId, jobs, cfg}
 *                  {protocol, type:'parse-docx', requestId, buffer}
 *                  {protocol, type:'cancel', requestId}
 *  worker -> main: {protocol, type:'progress', requestId, done, total, current}
 *                  {protocol, type:'lookup', requestId, url, status}
 *                  {protocol, type:'result', requestId, results:[{job, ok, data?, error?}]}
 *                  {protocol, type:'docx', requestId, text}
 *                  {protocol, type:'error', requestId, code, message}
 *                  {protocol, type:'cancelled', requestId}
 *
 *  jobs: [{kind:'doi', doi} | {kind:'author-year', sur, year}]
 *  cfg:  {email: '' (opcional, polite pool), key: '' (opcional, OpenAlex)}
 *  data: doi -> {state:'found'|'other-agency'|'missing', meta?, agency?}
 *        author-year -> {hit: {doi?, url?, title?} | null, source: 'CrossRef'|'OpenAlex'|null, oaAnswered: bool}
 *
 * Cancelamento: a flag é checada entre um item e outro; o loop para
 * e responde 'cancelled' com os resultados parciais até ali.
 */
'use strict';

const PROTOCOL = 'scriptalab.audit-worker/1';
const MAMMOTH_URL = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js';

const last = { single: 0, list: 0, oa: 0 };
let cancelledRequestId = null;
let mammothLoaded = false;
let mammothLoading = null;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normStr(s) {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

async function paced(type, cfg) {
  const gap = type === 'oa' ? 150 : cfg.email ? (type === 'list' ? 400 : 150) : (type === 'list' ? 1100 : 250);
  const wait = last[type] + gap - Date.now();
  if (wait > 0) await sleep(wait);
  last[type] = Date.now();
}

function mailQ(cfg, first) {
  return cfg.email ? (first ? '?' : '&') + 'mailto=' + encodeURIComponent(cfg.email) : '';
}

async function getJSON(url, type, cfg, requestId, tries) {
  tries = tries || 3;
  for (let attempt = 0; attempt < tries; attempt++) {
    if (cancelledRequestId === requestId) throw Object.assign(new Error('cancelado'), { cancelled: true });
    await paced(type, cfg);
    let r;
    try {
      r = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    } catch (e) {
      if (attempt === tries - 1) throw e;
      await sleep(800 * (attempt + 1));
      continue;
    }
    postMessage({ protocol: PROTOCOL, type: 'lookup', requestId, url, status: r.status });
    if (r.status === 429 || r.status === 503) {
      const ra = parseInt((r.headers.get('Retry-After') || ''), 10);
      await sleep(Math.min(8000, ra > 0 ? ra * 1000 : 1500 * (attempt + 1)));
      continue;
    }
    if (r.status === 404) return { status: 404 };
    if (!r.ok) {
      const e = new Error('HTTP ' + r.status);
      e.status = r.status;
      throw e;
    }
    return { status: 200, data: await r.json() };
  }
  const e = new Error('limite de requisições (HTTP 429/503)');
  e.status = 429;
  throw e;
}

function yearOf(m) {
  const d = (m.issued || m['published-print'] || m['published-online'] || {})['date-parts'];
  return (d && d[0] && d[0][0]) || null;
}

async function crossrefDOI(doi, cfg, requestId) {
  const path = doi.split('/').map(encodeURIComponent).join('/');
  const r = await getJSON('https://api.crossref.org/works/' + path + mailQ(cfg, true), 'single', cfg, requestId);
  if (r.status === 200) {
    const m = r.data.message || {};
    return { state: 'found', meta: { title: (m.title || [])[0] || '', family: ((m.author || [])[0] || {}).family || '', year: yearOf(m) } };
  }
  const a = await getJSON('https://api.crossref.org/works/' + path + '/agency' + mailQ(cfg, true), 'single', cfg, requestId);
  if (a.status === 200) {
    const ag = a.data.message && a.data.message.agency;
    return { state: 'other-agency', agency: (ag && (ag.label || ag.id)) || 'outra agência' };
  }
  return { state: 'missing' };
}

async function crossrefAuthorYear(sur, year, cfg, requestId) {
  const url = 'https://api.crossref.org/works?query.author=' + encodeURIComponent(sur) +
    '&filter=from-pub-date:' + year + ',until-pub-date:' + year +
    '&rows=30&select=DOI,title,author,issued' + mailQ(cfg, false);
  const r = await getJSON(url, 'list', cfg, requestId);
  const items = r.status === 200 ? (((r.data.message || {}).items) || []) : [];
  const w = items.find((it) => (it.author || []).some((a) => {
    const f = normStr(a.family || '');
    return f && (f === normStr(sur) || f.includes(normStr(sur)));
  }));
  return w ? { doi: w.DOI, title: (w.title || [])[0] || '(sem título)' } : null;
}

async function openalexAuthorYear(sur, year, cfg, requestId) {
  const q = encodeURIComponent(sur);
  const k = cfg.key ? '&api_key=' + encodeURIComponent(cfg.key) : '';
  try {
    let r = await getJSON(
      'https://api.openalex.org/works?filter=raw_author_name.search:' + q + ',publication_year:' + year + '&per_page=25' + k,
      'oa', cfg, requestId, 1
    ).catch((e) => { if ([401, 403, 409, 429].includes(e.status)) throw e; return null; });
    if (!r || r.status !== 200) {
      r = await getJSON(
        'https://api.openalex.org/works?search=' + q + '&filter=publication_year:' + year + '&per_page=25' + k,
        'oa', cfg, requestId, 1
      );
    }
    const w = (((r.data && r.data.results) || []).find((x) =>
      (x.authorships || []).some((a) => normStr((a.author && a.author.display_name) || '').includes(normStr(sur)))));
    return { ok: true, hit: w ? { url: w.doi || w.id, title: w.title || '(sem título)' } : null };
  } catch (e) {
    if ([401, 403, 409, 429].includes(e.status)) return { ok: false, oaOff: true };
    return { ok: false };
  }
}

async function runJob(job, cfg, requestId) {
  if (job.kind === 'doi') {
    return crossrefDOI(job.doi, cfg, requestId);
  }
  const hit = await crossrefAuthorYear(job.sur, job.year, cfg, requestId);
  if (hit) return { hit, source: 'CrossRef', oaAnswered: false };
  const o = await openalexAuthorYear(job.sur, job.year, cfg, requestId);
  return { hit: (o.ok && o.hit) || null, source: (o.ok && o.hit) ? 'OpenAlex' : null, oaAnswered: o.ok };
}

async function auditDois(msg) {
  const { requestId, jobs, cfg } = msg;
  const results = [];
  for (let i = 0; i < jobs.length; i++) {
    if (cancelledRequestId === requestId) {
      postMessage({ protocol: PROTOCOL, type: 'cancelled', requestId, results });
      return;
    }
    const job = jobs[i];
    try {
      results.push({ job, ok: true, data: await runJob(job, cfg, requestId) });
    } catch (e) {
      if (e.cancelled || cancelledRequestId === requestId) {
        postMessage({ protocol: PROTOCOL, type: 'cancelled', requestId, results });
        return;
      }
      results.push({ job, ok: false, error: e.message || String(e) });
    }
    postMessage({ protocol: PROTOCOL, type: 'progress', requestId, done: i + 1, total: jobs.length, current: job.kind === 'doi' ? job.doi : (job.sur + ', ' + job.year) });
  }
  postMessage({ protocol: PROTOCOL, type: 'result', requestId, results });
}

function loadMammoth() {
  if (mammothLoaded) return Promise.resolve();
  if (mammothLoading) return mammothLoading;
  mammothLoading = new Promise((resolve, reject) => {
    try {
      importScripts(MAMMOTH_URL);
      if (typeof mammoth === 'undefined' || !mammoth.extractRawText) throw new Error('mammoth não carregou');
      mammothLoaded = true;
      resolve();
    } catch (e) {
      mammothLoading = null;
      reject(e);
    }
  });
  return mammothLoading;
}

async function parseDocx(msg) {
  const { requestId, buffer } = msg;
  try {
    await loadMammoth();
    const out = await mammoth.extractRawText({ arrayBuffer: buffer });
    postMessage({ protocol: PROTOCOL, type: 'docx', requestId, text: out.value || '' });
  } catch (e) {
    postMessage({ protocol: PROTOCOL, type: 'error', requestId, code: 'MAMMOTH_UNAVAILABLE', message: e.message || String(e) });
  }
}

self.onmessage = function (ev) {
  const msg = ev.data || {};
  if (msg.protocol !== PROTOCOL) return;
  if (msg.type === 'cancel') {
    cancelledRequestId = msg.requestId;
    return;
  }
  if (msg.type === 'audit-dois') {
    cancelledRequestId = null;
    auditDois(msg).catch((e) => {
      if (e.cancelled) postMessage({ protocol: PROTOCOL, type: 'cancelled', requestId: msg.requestId, results: [] });
      else postMessage({ protocol: PROTOCOL, type: 'error', requestId: msg.requestId, code: 'AUDIT_FAILED', message: e.message || String(e) });
    });
    return;
  }
  if (msg.type === 'parse-docx') {
    parseDocx(msg);
  }
};
