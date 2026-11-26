import { normStr } from "./textUtils.js";
import { REF_HEAD, splitReferences } from "./abnt10520.js";
import abnt6023Rules from "./rules/abnt6023.json" with { type: "json" };

export const ABNT6023_RULES_VERSION = abnt6023Rules.version;

const REFERENCE_TYPE_RULES = abnt6023Rules.referenceTypes.map((r) => ({
  type: r.type,
  regexes: r.patterns.map((p) => new RegExp(p.pattern, p.flags || "")),
}));

/**
 * Classifica uma entrada bibliográfica segundo padrões da ABNT NBR 6023:2025.
 * Regras como dados: rules/abnt6023.json (ordem = prioridade).
 */
export function classifyReferenceType(entry) {
  const s = String(entry || "").trim();
  for (const rule of REFERENCE_TYPE_RULES) {
    if (rule.regexes.some((re) => re.test(s))) return rule.type;
  }
  return abnt6023Rules.defaultType || "livro";
}

/**
 * Gera chave de ordenação alfabética NBR 6023 (ignora aspas/colchetes iniciais e acentos).
 */
export function referenceSortKey(entry) {
  return normStr(String(entry || "").trim().replace(/^[["“‘'()]+/, "").replace(/\s+/g, " "));
}

/**
 * Audita uma única entrada de referência contra requisitos essenciais da NBR 6023:2025.
 * Nunca inventa dados faltantes (Zero-Tampering): apenas sinaliza o que está ausente.
 */
export function auditReferenceEntry(entry) {
  const text = String(entry || "").trim();
  const type = classifyReferenceType(text);
  const sortKey = referenceSortKey(text);
  const issues = [];

  const hasUpperEntry = /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-ZÁÉÍÓÚÂÊÔÃÕÇ'’ -]{1,}[,.]/.test(text);
  if (!hasUpperEntry) {
    issues.push({
      code: "ENTRY_CASE",
      severity: "warn",
      message: "Entrada inicial sem sobrenome/entidade em CAIXA ALTA seguido de vírgula ou ponto (NBR 6023).",
    });
  }

  const hasYear = /\b(?:18|19|20)\d{2}[a-z]?\b/i.test(text) || /\[?\bs\.\s*d\.?\]?/i.test(text);
  if (!hasYear) {
    issues.push({
      code: "MISSING_YEAR",
      severity: "warn",
      message: "Ano de publicação ausente (ou não indicado como [s. d.]).",
    });
  }

  const hasUrl = /https?:\/\/|Dispon[íi]vel\s+em:/i.test(text);
  const hasDoi = /10\.\d{4,9}\/[^\s"<>\]【]+/.test(text);
  const hasAccess = /\bAcesso\s+em:\s*\d{1,2}\s+[a-zç.]{3,}\s+\d{4}/i.test(text);
  if (hasUrl && !hasAccess && !hasDoi) {
    issues.push({
      code: "MISSING_ACCESS_DATE",
      severity: "warn",
      message: "Referência com URL/Disponível em: sem data de acesso no formato 'Acesso em: dd mmm. aaaa' (NBR 6023).",
    });
  }

  if (type === "livro" || type === "capitulo") {
    const hasPlacePublisher = /:\s*[^:,;]+,\s*(?:18|19|20)\d{2}|\[?\bs\.\s*l\.?\]?|\[?\bs\.\s*n\.?\]?/i.test(text);
    if (!hasPlacePublisher) {
      issues.push({
        code: "MISSING_PUBLISHER_PLACE",
        severity: "info",
        message: "Verifique se local e editora ('Cidade: Editora, ano') estão completos (NBR 6023).",
      });
    }
  }

  if (!/[.>]$/.test(text)) {
    issues.push({
      code: "MISSING_FINAL_PERIOD",
      severity: "info",
      message: "Entrada de referência sem ponto final.",
    });
  }

  return {
    entry: text,
    type,
    sortKey,
    issues,
    ok: issues.length === 0,
  };
}

/**
 * Ordena uma lista de referências em ordem alfabética (PT-BR) sem mutar a entrada.
 */
export function sortReferencesAlphabetically(entries) {
  const list = Array.isArray(entries) ? entries.map((e) => String(e).trim()).filter(Boolean) : [];
  const indexed = list.map((entry, index) => ({ entry, index, key: referenceSortKey(entry) }));
  const sortedObjs = [...indexed].sort((a, b) => a.key.localeCompare(b.key, "pt-BR", { sensitivity: "base" }) || a.index - b.index);
  const sorted = sortedObjs.map((x) => x.entry);
  let movedCount = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] !== sorted[i]) movedCount++;
  }
  return {
    sorted,
    alreadySorted: movedCount === 0,
    movedCount,
  };
}

/**
 * Audita toda a seção REFERÊNCIAS do documento (NBR 6023:2025).
 */
export function auditReferencesSection(text) {
  const split = splitReferences(String(text || ""));
  if (!split.has) {
    return {
      has: false,
      total: 0,
      validCount: 0,
      withIssuesCount: 0,
      alreadySorted: true,
      movedCount: 0,
      duplicates: [],
      entries: [],
      sortedEntries: [],
    };
  }

  const audited = split.entries.map(auditReferenceEntry);
  const sortInfo = sortReferencesAlphabetically(split.entries);

  const seen = new Map();
  const duplicates = [];
  for (const item of audited) {
    const k = item.sortKey;
    if (seen.has(k)) duplicates.push(item.entry);
    else seen.set(k, true);
  }

  const validCount = audited.filter((e) => e.ok).length;
  return {
    has: true,
    total: audited.length,
    validCount,
    withIssuesCount: audited.length - validCount,
    alreadySorted: sortInfo.alreadySorted,
    movedCount: sortInfo.movedCount,
    duplicates,
    entries: audited,
    sortedEntries: sortInfo.sorted,
  };
}

/**
 * Devolve uma nova string com apenas a seção REFERÊNCIAS ordenada alfabeticamente,
 * preservando integralmente o corpo do documento (Zero-Tampering: só usar com aceite do autor).
 */
export function formatReferencesSectionSorted(text) {
  const s = String(text || "");
  let idx = -1;
  let len = 0;
  let m;
  REF_HEAD.lastIndex = 0;
  while ((m = REF_HEAD.exec(s))) {
    idx = m.index;
    len = m[0].length;
  }
  if (idx < 0) return { changed: false, text: s, movedCount: 0 };

  const split = splitReferences(s);
  const { sorted, alreadySorted, movedCount } = sortReferencesAlphabetically(split.entries);
  if (alreadySorted || !sorted.length) {
    return { changed: false, text: s, movedCount: 0 };
  }

  const headerAndBefore = s.slice(0, idx + len).replace(/[ \t\r\n]+$/, "");
  const rebuilt = `${headerAndBefore}\n\n${sorted.join("\n\n")}`;
  return { changed: true, text: rebuilt, movedCount };
}

/**
 * Classifica parágrafos para exportação NBR 14724:2024 (legenda/fonte/nota vs referência vs corpo).
 */
export function isCaptionOrNote(paragraph) {
  return /^(?:Figura|Tabela|Quadro|Gr[áa]fico|Fonte|Nota)\s*\d*\s*[:–—-]/i.test(String(paragraph || "").trim());
}
