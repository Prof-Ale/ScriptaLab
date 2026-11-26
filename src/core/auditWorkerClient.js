/**
 * Cliente do worker de auditoria — ScriptaLab (thread principal).
 *
 * ESM puro, zero dependência do núcleo. O mathlabBridge.js não é
 * importado aqui e não muda: continua síncrono no núcleo.
 *
 * Papel do cliente:
 *  - criar o worker por Blob URL (mesmo padrão do worker do pdf.js:
 *    fetch do script + URL.createObjectURL — a CSP tem
 *    `worker-src blob:`), reutilizar entre auditorias e terminar
 *    com terminate();
 *  - despachar os jobs pesados (DOI + DOCX) e devolver o resultado
 *    BRUTO do worker, sem validar semântica nenhuma. A validação
 *    (compareRef, refBlockFor, crossCheck) continua na thread
 *    principal, no audit() — um resultado bruto nunca vira proposta;
 *  - progresso (onProgress) e cancelamento (AbortSignal): abortar
 *    manda 'cancel' ao worker e, sem resposta em 500 ms, termina
 *    o worker à força;
 *  - cache e painel de rede: antes de despachar, filtra os jobs
 *    de DOI já em cache com 200 (isCached/getCached, do index.html);
 *    cada lookup do worker chega como mensagem 'lookup' e o cliente
 *    a registra no painel (onRecordFetch, do networkLog) — o worker
 *    não tem acesso nem ao cache nem ao NETLOG, então é o cliente
 *    quem mantém os dois verdadeiros. Os resultados do worker NÃO
 *    são escritos no cache (formatos diferentes); o cache continua
 *    valendo para o caminho main-thread e para o pré-filtro.
 *  - fallback: sem Worker, com o script indisponível, com erro do
 *    worker ou com timeout, o cliente usa as funções da thread
 *    principal passadas em `fallback` (as mesmas de sempre) e o
 *    resultado é idêntico — só mais lento. Sem fallback, lança.
 *
 * Uso (no index.html):
 *   const client = createAuditWorkerClient({
 *     loadWorkerScript: () => fetch('./workers/auditWorker.js').then(r => r.text()),
 *     isCached: (url) => !!cacheGet(url), getCached: cacheGet,
 *     onRecordFetch: (url, status) => { NETLOG.recordFetch(url, { status }); renderNetLog(); },
 *     fallback: { crossrefDOI, crossrefAuthorYear, openalexAuthorYear, parseDocxMain },
 *   });
 *   const { results } = await client.runDoiAudit(jobs, { cfg, onProgress, signal });
 *   const text = await client.runDocx(arrayBuffer, { signal });
 */
export const AUDIT_WORKER_PROTOCOL = 'scriptalab.audit-worker/1';
export const AUDIT_WORKER_URL = './workers/auditWorker.js';

let nextRequestId = 1;

function buildDoiUrls(job, cfg) {
  // As mesmas URLs que o worker usa — para o cache e o painel.
  // (O worker recalcula as mesmas; o cliente só precisa delas para
  //  consultar/gravar o cache antes e depois.)
  const mail = cfg.email ? '?mailto=' + encodeURIComponent(cfg.email) : '';
  if (job.kind === 'doi') {
    const path = job.doi.split('/').map(encodeURIComponent).join('/');
    return [
      'https://api.crossref.org/works/' + path + mail,
      'https://api.crossref.org/works/' + path + '/agency' + mail,
    ];
  }
  const mailAmp = cfg.email ? '&mailto=' + encodeURIComponent(cfg.email) : '';
  return [
    'https://api.crossref.org/works?query.author=' + encodeURIComponent(job.sur) +
    '&filter=from-pub-date:' + job.year + ',until-pub-date:' + job.year +
    '&rows=30&select=DOI,title,author,issued' + mailAmp,
  ];
}

export function createAuditWorkerClient(options = {}) {
  const {
    WorkerClass = typeof Worker !== 'undefined' ? Worker : null,
    loadWorkerScript = null,
    isCached = null,
    getCached = null,
    onRecordFetch = null,
    fallback = null,
    timeoutMs = 60000,
  } = options;

  let worker = null;
  let workerFailed = false;
  let workerPromise = null;

  async function ensureWorker() {
    if (worker) return worker;
    if (workerFailed || !WorkerClass) throw new Error('worker indisponível');
    if (!workerPromise) {
      workerPromise = (async () => {
        let url = AUDIT_WORKER_URL;
        if (loadWorkerScript) {
          const code = await loadWorkerScript();
          url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
        }
        const w = new WorkerClass(url);
        w.onerror = () => { workerFailed = true; };
        return w;
      })();
    }
    try {
      worker = await workerPromise;
    } catch (e) {
      workerPromise = null;
      throw e;
    }
    return worker;
  }

  function terminate() {
    if (worker) {
      try { worker.terminate(); } catch (e) { /* já terminado */ }
      worker = null;
      workerPromise = null;
    }
    workerFailed = false;
  }

  function runWithWorker(message, { signal, onProgress, transfer } = {}) {
    return new Promise((resolve, reject) => {
      const requestId = nextRequestId++;
      let settled = false;
      let timeout = null;
      const cleanup = () => {
        if (timeout) clearTimeout(timeout);
        if (signal) signal.removeEventListener('abort', onAbort);
        if (worker) worker.removeEventListener('message', onMessage);
      };
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn(value);
      };
      const onAbort = () => {
        if (worker) worker.postMessage({ protocol: AUDIT_WORKER_PROTOCOL, type: 'cancel', requestId });
        setTimeout(() => {
          // Sem resposta do worker: termina à força e devolve cancelado.
          if (!settled) { terminate(); finish(reject, Object.assign(new Error('cancelado'), { cancelled: true })); }
        }, 500);
      };
      const onMessage = (ev) => {
        const msg = ev.data || {};
        if (msg.protocol !== AUDIT_WORKER_PROTOCOL || msg.requestId !== requestId) return;
        if (msg.type === 'progress' && onProgress) {
          onProgress({ done: msg.done, total: msg.total, current: msg.current });
        }
        if (msg.type === 'lookup' && onRecordFetch) {
          onRecordFetch(msg.url, msg.status);
        }
        if (msg.type === 'result' || msg.type === 'docx') {
          finish(resolve, msg);
        }
        if (msg.type === 'cancelled') {
          finish(resolve, msg);
        }
        if (msg.type === 'error') {
          const e = new Error(msg.message || 'erro no worker');
          e.code = msg.code;
          finish(reject, e);
        }
      };
      if (signal) {
        if (signal.aborted) { finish(reject, Object.assign(new Error('cancelado'), { cancelled: true })); return; }
        signal.addEventListener('abort', onAbort);
      }
      timeout = setTimeout(() => {
        terminate();
        finish(reject, Object.assign(new Error('tempo esgotado no worker'), { code: 'WORKER_TIMEOUT' }));
      }, timeoutMs);
      ensureWorker().then((w) => {
        w.addEventListener('message', onMessage);
        w.postMessage({ protocol: AUDIT_WORKER_PROTOCOL, ...message, requestId }, transfer || undefined);
      }).catch((e) => finish(reject, e));
    });
  }

  async function runDoiAudit(jobs, { cfg = {}, onProgress, signal } = {}) {
    const cached = [];
    const todo = [];
    // Pré-filtro de cache (só DOI com 200 em cache — a conversão
    // 404 -> 'missing' exigiria a checagem de agência, então um 404
    // em cache vai ao worker de novo, como o getJSON faria).
    // Autor+Ano não passa pelo pré-filtro: converter o cache
    // ({message:{items}}) em hit exigiria duplicar a lógica de
    // crossrefAuthorYear aqui. O worker refaz a busca com pacing.
    if (isCached && getCached) {
      for (const job of jobs) {
        if (job.kind !== 'doi') { todo.push(job); continue; }
        const urls = buildDoiUrls(job, cfg);
        const hit = urls.map((u) => getCached(u)).find((h) => h && h.status === 200);
        if (hit) {
          const m = (hit.data && hit.data.message) || {};
          const d = (m.issued || m['published-print'] || m['published-online'] || {})['date-parts'];
          cached.push({ job, ok: true, fromCache: true, data: {
            state: 'found',
            meta: { title: (m.title || [])[0] || '', family: ((m.author || [])[0] || {}).family || '', year: (d && d[0] && d[0][0]) || null },
          } });
        } else todo.push(job);
      }
    } else {
      todo.push(...jobs);
    }
    if (!todo.length) return { results: cached, fromWorker: false };

    // Fallback imediato sem Worker: mesmas funções da thread principal.
    if (!WorkerClass || workerFailed) {
      const fb = await runDoiFallback(todo, cached, { cfg, onProgress, signal });
      return { results: sortByJobs(fb.results, jobs), fromWorker: false };
    }

    try {
      const msg = await runWithWorker({ type: 'audit-dois', jobs: todo, cfg }, { signal, onProgress });
      // Os resultados do worker NÃO são escritos no cache (formatos
      // diferentes); o cache continua valendo para o caminho
      // main-thread e para o pré-filtro. A ordem de exibição é a
      // dos jobs originais (o cache vem primeiro na fusão).
      const merged = [...cached, ...(msg.results || [])];
      merged.sort((a, b) => jobs.indexOf(a.job) - jobs.indexOf(b.job));
      return { results: merged, fromWorker: true, cancelled: msg.type === 'cancelled' };
    } catch (e) {
      if (e.cancelled) throw e;
      if (fallback) {
        const fb = await runDoiFallback(todo, cached, { cfg, onProgress, signal });
        return { results: sortByJobs(fb.results, jobs), fromWorker: false };
      }
      throw e;
    }
  }

  async function runDoiFallback(jobs, cached, { cfg, onProgress, signal }) {
    if (!fallback) throw new Error('sem worker e sem fallback');
    const results = [...cached];
    for (let i = 0; i < jobs.length; i++) {
      if (signal && signal.aborted) throw Object.assign(new Error('cancelado'), { cancelled: true });
      const job = jobs[i];
      try {
        let data;
        if (job.kind === 'doi') {
          const r = await fallback.crossrefDOI(job.doi, cfg);
          data = { state: r.state, meta: r.meta, agency: r.agency };
        } else {
          const hit = await fallback.crossrefAuthorYear(job.sur, job.year, cfg);
          if (hit) data = { hit, source: 'CrossRef', oaAnswered: false };
          else {
            const o = await fallback.openalexAuthorYear(job.sur, job.year, cfg);
            data = { hit: (o.ok && o.hit) || null, source: (o.ok && o.hit) ? 'OpenAlex' : null, oaAnswered: o.ok };
          }
        }
        results.push({ job, ok: true, data });
      } catch (e) {
        results.push({ job, ok: false, error: e.message || String(e) });
      }
      if (onProgress) onProgress({ done: cached.length + i + 1, total: cached.length + jobs.length, current: job.kind === 'doi' ? job.doi : job.sur + ', ' + job.year });
    }
    const allJobs = jobs;
    results.sort((a, b) => allJobs.indexOf(a.job) - allJobs.indexOf(b.job));
    return { results, fromWorker: false };
  }

  function sortByJobs(results, allJobs) {
    return [...results].sort((a, b) => allJobs.indexOf(a.job) - allJobs.indexOf(b.job));
  }

  async function runDocx(arrayBuffer, { signal } = {}) {
    if (!WorkerClass || workerFailed) {
      if (!fallback || !fallback.parseDocxMain) throw new Error('sem worker e sem fallback para DOCX');
      return fallback.parseDocxMain(arrayBuffer);
    }
    try {
      const msg = await runWithWorker({ type: 'parse-docx', buffer: arrayBuffer }, { signal });
      if (msg.type === 'docx') return msg.text;
      throw new Error('resposta inesperada do worker');
    } catch (e) {
      if (e.cancelled) throw e;
      if (e.code === 'MAMMOTH_UNAVAILABLE' && fallback && fallback.parseDocxMain) {
        return fallback.parseDocxMain(arrayBuffer);
      }
      if (fallback && fallback.parseDocxMain && e.code !== 'WORKER_TIMEOUT') {
        return fallback.parseDocxMain(arrayBuffer);
      }
      throw e;
    }
  }

  return { runDoiAudit, runDocx, terminate, get workerActive() { return !!worker; } };
}
