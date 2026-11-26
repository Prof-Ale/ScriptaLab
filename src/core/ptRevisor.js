/**
 * Revisor de português do ScriptaLab — regras como dados.
 *
 * O que faz (tudo local, sem API, sem custo):
 *  - aplica as regras de src/core/rules/ptbr.json (pontuação, crase,
 *    regência, concordância, vícios, pleonasmos, coloquialismos);
 *  - mede: gerúndios, períodos longos, repetição de palavra próxima,
 *    voz passiva em série, mistura de 1ª pessoa, aspas e parênteses;
 *  - confere ortografia quando recebe um verificador (src/core/spell.js);
 *  - muda o que vale por REGISTRO (acadêmico, didático, divulgação).
 *
 * O que NÃO faz: reescrever o texto do autor. Cada achado é SINAL.
 * Só os achados com `fix` determinístico viram proposta no diff
 * (item a item, aceite humano), igual ao resto do funil Zero-Tampering.
 * Crase, concordância e regência além das regras locais ficam para a
 * IA, pelo contrato scriptalab.pt-suggestion/1 (src/core/ptAiBridge.js).
 */
import rules from "./rules/ptbr.json" with { type: "json" };
import { splitReferences, mkCit } from "./abnt10520.js";
import { splitSentences, wordsOf, countWords } from "./stylometry.js";
import { findMisspellings } from "./spell.js";

export const PTBR_RULES_VERSION = rules.version;
export const PT_REGISTROS = Object.fromEntries(
  Object.entries(rules.registros).map(([id, r]) => [id, { id, label: r.label, limites: r.limites }])
);
export const PT_REGRAS = rules.regras;
export const PT_SEVERIDADES = rules.severidades;

const WB_L = "(?<![\\p{L}\\p{N}_-])";
const WB_R = "(?![\\p{L}\\p{N}_-])";
const compiled = new Map();
function compile(r) {
  if (compiled.has(r.id)) return compiled.get(r.id);
  const src = r.limites === false ? r.padrao : `${WB_L}(?:${r.padrao})${WB_R}`;
  const re = new RegExp(src, r.flags || "giu");
  compiled.set(r.id, re);
  return re;
}

function expandirModelo(modelo, m) {
  return modelo.replace(/\$(&|\d)/g, (_, k) => (k === "&" ? m[0] : m[Number(k)] ?? ""));
}
function preservarCaixa(original, novo) {
  if (!novo) return novo;
  const o = original.charAt(0);
  if (o !== o.toLowerCase() && o === o.toUpperCase() && novo.charAt(0) === novo.charAt(0).toLowerCase()) {
    return novo.charAt(0).toUpperCase() + novo.slice(1);
  }
  return novo;
}

// ---------- Trechos que NUNCA são revisados ----------
/**
 * Citações do autor (entre aspas), fórmulas, marcadores [F#], URLs, DOIs, e-mails,
 * código e a seção REFERÊNCIAS. Devolve intervalos [início, fim) ordenados e fundidos.
 */
export function trechosProtegidos(text, opts = {}) {
  const s = String(text ?? "");
  const out = [];
  const add = (re) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(s))) {
      if (!m[0]) { re.lastIndex++; continue; }
      out.push([m.index, m.index + m[0].length]);
    }
  };
  const refs = splitReferences(s);
  if (refs.has) out.push([refs.body.length, s.length]);
  add(/\$\$[\s\S]+?\$\$/g);
  add(/(?<!\$)\$(?!\$)[^$\n]+\$(?!\$)/g);
  add(/\\\[[\s\S]+?\\\]/g);
  add(/\\\([\s\S]+?\\\)/g);
  add(/\[(?:F|Fonte\s*)\d+\]/gi);
  add(/https?:\/\/\S+|www\.\S+|\b10\.\d{4,9}\/\S+|[\w.+-]+@[\w-]+\.[\w.-]+/g);
  add(/`[^`\n]+`/g);
  add(mkCit());
  if (opts.protegerCitacoes !== false) {
    add(/“[^”\n]{3,700}”/g);
    add(/«[^»\n]{3,700}»/g);
    add(/"[^"\n]{3,700}"/g);
  }
  out.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged;
}

const dentro = (ranges, a, b) => ranges.some(([x, y]) => a < y && b > x);

function contexto(text, start, end, r = 28) {
  return { contextBefore: text.slice(Math.max(0, start - r), start), contextAfter: text.slice(end, Math.min(text.length, end + r)) };
}

// ---------- Achados por regra ----------
function achadosDeRegras(text, registro, protegidos, maxPorRegra) {
  const out = [];
  for (const r of rules.regras) {
    const sev = r.sev?.[registro] ?? r.sev?.["*"];
    if (!sev) continue; // regra desligada neste registro
    const re = compile(r);
    re.lastIndex = 0;
    let m;
    let n = 0;
    while ((m = re.exec(text))) {
      if (!m[0]) { re.lastIndex++; continue; }
      const start = m.index;
      const end = start + m[0].length;
      if (dentro(protegidos, start, end)) continue;
      let fix = null;
      if (typeof r.fix === "string") {
        fix = preservarCaixa(m[0], expandirModelo(r.fix, m));
        if (fix === m[0]) fix = null;
      }
      out.push({
        kind: "regra", regra: r.id, categoria: r.categoria, severidade: sev, start, end, trecho: m[0],
        msg: r.msg, sugestoes: r.sugestoes || [], fix,
      });
      if (++n >= maxPorRegra) break;
    }
  }
  return out;
}

// ---------- Medidores ----------
const GER_EXC = new Set(rules.gerundio.excecoes);
const GER_RE = new RegExp(`(?<![\\p{L}\\p{N}])\\p{L}{${rules.gerundio.minLetras - 4},}(?:${rules.gerundio.terminacoes.join("|")})(?![\\p{L}\\p{N}])`, "giu");
function gerundiosEm(texto, base = 0) {
  const out = [];
  GER_RE.lastIndex = 0;
  let m;
  while ((m = GER_RE.exec(texto))) {
    const w = m[0].toLowerCase();
    if (w.length < rules.gerundio.minLetras || GER_EXC.has(w)) continue;
    out.push({ start: base + m.index, end: base + m.index + m[0].length, word: m[0] });
  }
  return out;
}

const PASS_AUX = rules.passiva.auxiliares.join("|");
const PASS_IRREG = new Set(rules.passiva.participiosIrregulares);
const NAO_PART = new Set(rules.passiva.naoParticipios);
const PASS_RE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${PASS_AUX})\\s+(?:\\p{L}+mente\\s+)?(\\p{L}+)(?![\\p{L}\\p{N}])`, "giu");
function temPassiva(sentenca) {
  PASS_RE.lastIndex = 0;
  let m;
  while ((m = PASS_RE.exec(sentenca))) {
    const w = m[1].toLowerCase();
    if (NAO_PART.has(w)) continue;
    if (PASS_IRREG.has(w) || /(?:ad|id)[oa]s?$/.test(w)) {
      if (w.length >= 5) return true;
    }
  }
  return false;
}

function locatePositions(text, sentences) {
  // posição de cada período no texto original (os períodos vêm normalizados em espaço)
  const out = [];
  let cursor = 0;
  for (const s of sentences) {
    const head = s.slice(0, Math.min(20, s.length));
    let idx = text.indexOf(head, cursor);
    if (idx < 0) idx = cursor;
    // fim: procura o final literal do período a partir do início
    const tail = s.slice(Math.max(0, s.length - 12));
    let e = text.indexOf(tail, idx);
    e = e < 0 ? Math.min(text.length, idx + s.length) : e + tail.length;
    out.push([idx, e]);
    cursor = e;
  }
  return out;
}

function medidores(text, registro, lim, protegidos, bodyEnd, termosAutor) {
  const body = text.slice(0, bodyEnd);
  const out = [];
  const sentences = splitSentences(body);
  const pos = locatePositions(body, sentences);
  const palavras = countWords(body);

  // períodos longos, gerúndios encadeados, passiva em série
  let seqPassivas = [];
  const fechaSerie = () => {
    if (seqPassivas.length >= lim.passivasEmSerie) {
      const a = seqPassivas[0];
      const b = seqPassivas[seqPassivas.length - 1];
      out.push({
        kind: "medida", regra: "passiva-em-serie", categoria: "estilo", severidade: "estilo", start: pos[a][0], end: pos[b][1],
        trecho: body.slice(pos[a][0], Math.min(pos[b][1], pos[a][0] + 160)),
        msg: `${seqPassivas.length} períodos seguidos na voz passiva. Alterne com a voz ativa para dar ritmo e deixar o agente claro.`,
        sugestoes: [], fix: null,
      });
    }
    seqPassivas = [];
  };
  let totalGer = 0;
  sentences.forEach((sent, i) => {
    const [a, b] = pos[i];
    const nPal = countWords(sent);
    if (nPal > lim.fraseLongaAviso) {
      out.push({ kind: "medida", regra: "periodo-longo", categoria: "estilo", severidade: "aviso", start: a, end: b, trecho: sent.slice(0, 120), msg: `Período com ${nPal} palavras (limite do registro: ${lim.fraseLongaAviso}). Considere dividir.`, sugestoes: [], fix: null });
    } else if (nPal > lim.fraseLongaEstilo) {
      out.push({ kind: "medida", regra: "periodo-longo", categoria: "estilo", severidade: "estilo", start: a, end: b, trecho: sent.slice(0, 120), msg: `Período com ${nPal} palavras (recomendado até ${lim.fraseLongaEstilo} neste registro).`, sugestoes: [], fix: null });
    }
    const gs = gerundiosEm(sent);
    totalGer += gs.length;
    if (gs.length >= lim.gerundiosPorPeriodo) {
      out.push({ kind: "medida", regra: "gerundio-encadeado", categoria: "estilo", severidade: "aviso", start: a, end: b, trecho: sent.slice(0, 120), msg: `${gs.length} gerúndios no mesmo período (${gs.slice(0, 4).map((g) => g.word).join(", ")}). Troque alguns por orações com verbo conjugado ou por substantivos.`, sugestoes: [], fix: null });
    }
    if (temPassiva(sent)) seqPassivas.push(i);
    else fechaSerie();
  });
  fechaSerie();
  const gerPor1000 = palavras ? (totalGer / palavras) * 1000 : 0;
  if (palavras >= 200 && gerPor1000 > lim.gerundiosPor1000) {
    out.push({ kind: "medida", regra: "gerundio-densidade", categoria: "estilo", severidade: "estilo", start: 0, end: 0, trecho: "", msg: `${gerPor1000.toFixed(1)} gerúndios por mil palavras (limite do registro: ${lim.gerundiosPor1000}).`, sugestoes: [], fix: null });
  }

  // repetição de palavra próxima (conteúdo; ignora termos do tema e termos do autor)
  const stop = new Set(rules.repeticao.stopwords);
  for (const t of termosAutor) stop.add(String(t).toLowerCase());
  const toks = [];
  const reTok = /[\p{L}][\p{L}'’-]*/gu;
  let mm;
  while ((mm = reTok.exec(body))) {
    if (dentro(protegidos, mm.index, mm.index + mm[0].length)) continue;
    toks.push({ w: mm[0], i: mm.index });
  }
  const stem = (w) => w.toLowerCase().replace(/(?:mente|ões|oes|ais|eis|s)$/u, "");
  const ultimo = new Map();
  const jaMarcado = new Set();
  toks.forEach((t, k) => {
    if (t.w.length < lim.repeticaoMinLetras) return;
    if (t.w[0] !== t.w[0].toLowerCase()) return; // nome próprio
    const low = t.w.toLowerCase();
    if (stop.has(low)) return;
    const st = stem(t.w);
    if (ultimo.has(st)) {
      const k0 = ultimo.get(st);
      if (k - k0 <= lim.repeticaoJanela && !jaMarcado.has(k0)) {
        out.push({ kind: "medida", regra: "repeticao-proxima", categoria: "estilo", severidade: "estilo", start: t.i, end: t.i + t.w.length, trecho: t.w, msg: `“${low}” repete-se a ${k - k0} palavras de distância. Varie com sinônimo, pronome ou reestruture.`, sugestoes: [], fix: null });
        jaMarcado.add(k0);
        jaMarcado.add(k);
      }
    }
    ultimo.set(st, k);
  });

  // mistura de pessoa verbal (1ª do singular × 1ª do plural)
  if (lim.pessoaMista) {
    const conta = (lista) => {
      const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${lista.join("|")})(?![\\p{L}\\p{N}])`, "giu");
      const found = [];
      let m2;
      while ((m2 = re.exec(body))) if (!dentro(protegidos, m2.index, m2.index + m2[0].length)) found.push({ start: m2.index, end: m2.index + m2[0].length, w: m2[0] });
      return found;
    };
    const sg = conta(rules.pessoa.singular);
    const pl = conta(rules.pessoa.plural);
    if (sg.length && pl.length) {
      const minor = sg.length <= pl.length ? sg : pl;
      const nome = sg.length <= pl.length ? "1ª pessoa do singular (eu, meu...)" : "1ª pessoa do plural (nós, nosso...)";
      for (const f of minor.slice(0, 3)) {
        out.push({ kind: "medida", regra: "pessoa-mista", categoria: "registro", severidade: lim.pessoaMista, start: f.start, end: f.end, trecho: f.w, msg: `O texto mistura ${sg.length} marca(s) de 1ª pessoa do singular e ${pl.length} do plural. Escolha uma voz (ou o sujeito impessoal) e mantenha. Aqui: ${nome}.`, sugestoes: [], fix: null });
      }
    }
  }

  // aspas retas e curvas misturadas
  const retas = (body.match(/"/g) || []).length;
  const curvas = (body.match(/[“”]/g) || []).length;
  if (retas && curvas) {
    const i = body.indexOf('"');
    out.push({ kind: "medida", regra: "aspas-mistas", categoria: "pontuacao", severidade: "estilo", start: i, end: i + 1, trecho: '"', msg: `Aspas retas (${retas}) e curvas (${curvas}) no mesmo texto. Padronize.`, sugestoes: ["“ ”"], fix: null });
  }

  // parênteses desbalanceados por parágrafo
  let off = 0;
  for (const par of body.split(/\n\s*\n/)) {
    const ab = (par.match(/\(/g) || []).length;
    const fe = (par.match(/\)/g) || []).length;
    if (ab !== fe) {
      out.push({ kind: "medida", regra: "parenteses", categoria: "pontuacao", severidade: "aviso", start: body.indexOf(par, off), end: body.indexOf(par, off) + Math.min(par.length, 80), trecho: par.slice(0, 80), msg: `Parágrafo com ${ab} “(” e ${fe} “)”: parênteses desbalanceados.`, sugestoes: [], fix: null });
    }
    off = body.indexOf(par, off) + par.length;
  }
  return { achados: out, metricas: { palavras, periodos: sentences.length, gerundios: totalGer, gerundiosPor1000: Number(gerPor1000.toFixed(2)) } };
}

// ---------- API ----------
/**
 * Analisa o texto. NÃO altera nada.
 * opts: { registro: "academico"|"didatico"|"divulgacao", verificador, ignorar:[], termos:[],
 *         protegerCitacoes: true, maxPorRegra: 60, ortografia: true }
 */
export function analisarPortugues(text, opts = {}) {
  const src = String(text ?? "");
  const registro = rules.registros[opts.registro] ? opts.registro : "academico";
  const lim = { ...rules.registros[registro].limites, ...(opts.limites || {}) };
  const refs = splitReferences(src);
  const bodyEnd = refs.has ? refs.body.length : src.length;
  const protegidos = trechosProtegidos(src, { protegerCitacoes: opts.protegerCitacoes });
  const achados = achadosDeRegras(src, registro, protegidos, opts.maxPorRegra ?? 60);
  const med = medidores(src, registro, lim, protegidos, bodyEnd, opts.termos || []);
  achados.push(...med.achados);
  if (opts.verificador && opts.ortografia !== false) {
    for (const o of findMisspellings(src, opts.verificador, { ignorar: opts.ignorar, protegidos })) {
      achados.push({
        kind: "ortografia", regra: "ortografia", categoria: "ortografia", severidade: "aviso", start: o.start, end: o.end, trecho: o.word,
        msg: `“${o.word}” não está no dicionário${o.suggestions.length ? "; candidatas: " + o.suggestions.join(", ") : ""}. Pode ser erro ou termo técnico/nome próprio.`,
        sugestoes: o.suggestions, fix: null,
      });
    }
  }
  achados.sort((a, b) => a.start - b.start || b.end - a.end);
  const porSeveridade = { erro: 0, aviso: 0, estilo: 0 };
  const porCategoria = {};
  const porRegra = {};
  for (const a of achados) {
    porSeveridade[a.severidade]++;
    porCategoria[a.categoria] = (porCategoria[a.categoria] || 0) + 1;
    porRegra[a.regra] = (porRegra[a.regra] || 0) + 1;
  }
  return {
    versaoRegras: PTBR_RULES_VERSION,
    registro,
    limites: lim,
    achados,
    resumo: { total: achados.length, porSeveridade, porCategoria, porRegra, comCorrecaoSegura: achados.filter((a) => a.fix !== null).length },
    metricas: med.metricas,
  };
}

/**
 * Propostas no formato do diffEngine (status "pending"), só para achados com correção
 * determinística (`fix`). Nunca inclui ortografia nem achados de estilo sem `fix`.
 */
export function propostasPortugues(text, opts = {}) {
  const src = String(text ?? "");
  const r = analisarPortugues(src, { ...opts, verificador: null });
  const out = [];
  let cursor = 0;
  for (const a of r.achados) {
    if (a.fix === null || a.kind !== "regra") continue;
    if (a.start < cursor) continue;
    out.push({
      category: `pt_${a.categoria}`,
      label: `Português (${a.categoria}): ${a.msg}`,
      start: a.start,
      end: a.end,
      before: a.trecho,
      after: a.fix,
      ...contexto(src, a.start, a.end),
    });
    cursor = a.end;
  }
  return out;
}

/** Texto curto para colar em relatório. */
export function resumoPortugues(analise) {
  const s = analise.resumo;
  const reg = PT_REGISTROS[analise.registro]?.label || analise.registro;
  const linhas = [
    `Registro: ${reg}.`,
    `${s.total} achado(s): ${s.porSeveridade.erro} erro(s), ${s.porSeveridade.aviso} aviso(s), ${s.porSeveridade.estilo} de estilo.`,
    `Correções mecânicas disponíveis: ${s.comCorrecaoSegura}.`,
  ];
  return linhas.join(" ");
}
