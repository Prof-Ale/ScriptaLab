/**
 * Localizador de citações × referências — ScriptaLab (só apresentação).
 *
 * NÃO é motor novo: o verificador continua sendo crossCheckRefs
 * (citationAuditor.js), que já alimenta o abntSummary do review/1.
 * Este módulo só responde "onde": para cada citação sem referência,
 * cada ocorrência no corpo do texto com trecho, parágrafo, linha,
 * posição e página estimada; para cada referência sem citação, a
 * entrada correspondente na lista, com a mesma localização.
 *
 * Sobre a "página": o texto colado não tem paginação real — a página
 * é uma ESTIMATIVA (A4, Times 12, entrelinhas 1,5 ≈ 2.800 caracteres
 * por página; ajuste com `charsPerPage`). Ela é sempre rotulada como
 * estimada na interface. O que é exato é o trecho, o parágrafo, a
 * linha e a posição em caracteres — e o botão "Ir para o trecho"
 * leva o cursor até a ocorrência no editor.
 */
import { crossCheckRefs, collectCitations } from "./citationAuditor.js";
import { splitReferences, mkCit } from "./abnt10520.js";
import { normStr, UP } from "./textUtils.js";

export const DEFAULT_CHARS_PER_PAGE = 2800;
export const DEFAULT_EXCERPT_RADIUS = 70;

function locate(text, index, length, charsPerPage) {
  const before = text.slice(0, index);
  const paragraph = before.split(/\n\s*\n/).length;
  const line = before.split("\n").length;
  return {
    index,
    length,
    paragraph,
    line,
    pageEstimated: Math.floor(index / charsPerPage) + 1,
    excerpt: excerpt(text, index, length),
  };
}

function excerpt(text, index, length, radius = DEFAULT_EXCERPT_RADIUS) {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + length + radius);
  const clean = text.slice(start, end).replace(/\s+/g, " ").trim();
  return (start > 0 ? "… " : "") + clean + (end < text.length ? " …" : "");
}

/** Todas as ocorrências de citações (parentéticas e narrativas) no corpo. */
function findCitationOccurrences(body) {
  const out = [];
  const paren = mkCit();
  let m;
  while ((m = paren.exec(body))) {
    if (!m[0]) { paren.lastIndex++; continue; }
    out.push({ raw: m[0], name: m[1], etAl: m[2] || "", year: m[3], index: m.index, length: m[0].length });
  }
  const narr = new RegExp(
    `\\b(${UP}[A-Za-zÀ-ÿ'’]+(?:\\s+(?:[Dd][aeo]s?|[Ee])\\s+${UP}[A-Za-zÀ-ÿ'’]+)*)(?:\\s+et\\s+al\\.)?\\s*\\((\\d{4}[a-z]?)`,
    "g"
  );
  while ((m = narr.exec(body))) {
    // O padrão narrativo termina no ano; inclui o ")" de fechamento quando presente.
    let len = m[0].length;
    if (body[m.index + len] === ")") len++;
    out.push({ raw: body.slice(m.index, m.index + len), name: m[1], etAl: "", year: m[2], index: m.index, length: len });
  }
  out.sort((a, b) => a.index - b.index);
  return out;
}

/**
 * Localiza o resultado de crossCheckRefs(text).
 * Retorna { has, entries, skipped, missing, uncited } onde:
 *  - missing: [{ name, sur, year, occurrences: [locate(), ...] }]
 *    (occurrences vazio só acontece se a citação foi detectada por
 *    collectCitations mas o padrão de busca não a reencontrou);
 *  - uncited: [{ entry, entryIndex, location: locate() }]
 *    (entryIndex é a posição 1-based na lista de referências).
 */
export function locateCrossCheck(text, options = {}) {
  const charsPerPage = options.charsPerPage || DEFAULT_CHARS_PER_PAGE;
  const full = String(text ?? "");
  const x = crossCheckRefs(full);
  if (!x.has) {
    return { has: false, entries: 0, skipped: x.skipped || 0, missing: [], uncited: [] };
  }
  const refs = splitReferences(full);
  const occurrences = findCitationOccurrences(refs.body);
  const keyOf = (sur, year) => normStr(sur) + year.replace(/[a-z]$/, "");
  const byKey = new Map();
  for (const o of occurrences) {
    const k = keyOf(o.name.split(/\s+/).pop(), o.year);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(o);
  }
  // collectCitations pode agrupar grafias (ex.: SILVA e Silva); a chave
  // usa o último sobrenome normalizado, igual à do crossCheckRefs.
  const missing = x.missing.map((c) => {
    const k = keyOf(c.sur, c.year);
    const occs = byKey.get(k) || [];
    return {
      name: c.name,
      sur: c.sur,
      year: c.year,
      occurrences: occs.map((o) => ({ ...locate(full, o.index, o.length, charsPerPage), raw: o.raw })),
    };
  });
  const uncited = x.uncited.map((entryText) => {
    const entryIndex = refs.entries.findIndex((e) => e === entryText || entryText.startsWith(e.slice(0, 60)) || e.startsWith(entryText.slice(0, 60)));
    const entry = entryIndex >= 0 ? refs.entries[entryIndex] : entryText;
    const head = entry.slice(0, 60);
    let idx = full.indexOf(head);
    if (idx < 0) idx = full.indexOf(entry.slice(0, 30));
    if (idx < 0) idx = 0;
    return {
      entry,
      entryIndex: entryIndex >= 0 ? entryIndex + 1 : null,
      location: locate(full, idx, Math.min(entry.length, 120), charsPerPage),
    };
  });
  return { has: true, entries: x.entries, skipped: x.skipped, missing, uncited };
}

/** Atalho: só as citações sem referência, já localizadas. */
export function locateMissingCitations(text, options) {
  return locateCrossCheck(text, options).missing;
}

/** Atalho: só as referências sem citação, já localizadas. */
export function locateUncitedReferences(text, options) {
  return locateCrossCheck(text, options).uncited;
}

// Reexportado para conveniência da interface (mesma fonte do motor).
export { crossCheckRefs, collectCitations };
