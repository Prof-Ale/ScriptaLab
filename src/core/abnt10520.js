import { UP, NAME } from "./textUtils.js";

// Siglas de instituições permanecem em maiúsculas na citação (NBR 10520:2023). Lista editável.
export const SIGLAS = new Set([
  "ABNT", "BNCC", "CAPES", "CNE", "CNPQ", "FGV", "FIOCRUZ", "IBGE", "IBICT", "IFSP",
  "INEP", "INSS", "IPEA", "MEC", "OCDE", "OMS", "ONU", "SBPC", "UFSCAR", "UNESCO",
  "UNESP", "UNICAMP", "UNICEF", "UNIVESP", "USP", "UEL", "UFMG", "UFRJ", "UFRGS",
  "UNB", "PUC", "FAPESP", "CEP", "CONEP", "MCTI", "OIT", "OMC", "FMI", "BID",
  "CEPAL", "IFRS", "IFSULDEMINAS"
]);

export const isSigla = (n) => !/\s/.test(n) && SIGLAS.has(String(n).toUpperCase());

export const mkCit = () => new RegExp(`\\b(${NAME})(\\s+et\\s+al\\.)?,\\s*(\\d{4}[a-z]?)`, "g");

// Itálico (NBR 10520:2023): et al., apud, ibid., op. cit., loc. cit., passim, et seq., cf. e Id.
// (Id. só dentro de citação, para não pegar o "id" da psicanálise).
export const LATIN_ITALIC = /(\bet\s+al\.|\bapud\b|\bibid\.|\bop\.\s*cit\.|\bloc\.\s*cit\.|\bpassim\b|\bet\s+seq\.|\b[Cc]f\.|(?<=[(;]\s*)Id\.)/g;

export const REF_HEAD = /^\s*(?:\d+(?:\.\d+)*\s+)?REFER[ÊE]NCIAS(?:\s+BIBLIOGR[ÁA]FICAS)?\s*$/gim;
export const startsRef = (l) => /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-ZÁÉÍÓÚÂÊÔÃÕÇ' -]{1,}[,.]/.test(String(l).trim());

export function splitReferences(text) {
  let idx = -1;
  let len = 0;
  let m;
  REF_HEAD.lastIndex = 0;
  while ((m = REF_HEAD.exec(text))) {
    idx = m.index;
    len = m[0].length;
  }
  if (idx < 0) return { has: false, body: text, entries: [] };
  const lines = text.slice(idx + len).split(/\r?\n/);
  const entries = [];
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue;
    if (startsRef(l) || !entries.length) entries.push(l);
    else entries[entries.length - 1] += " " + l;
  }
  return { has: true, body: text.slice(0, idx), entries };
}

// Verifica uniformidade no uso de et al. vs 4+ coautores listados por extenso na mesma citação (NBR 10520:2023).
export function checkEtAlUniformity(text) {
  const body = splitReferences(text).body;
  const etAlCount = (body.match(/\bet\s+al\./g) || []).length;
  const fourPlusRe = new RegExp(`\\((?:${NAME}\\s*[;,]\\s*){3,}${NAME},\\s*\\d{4}[a-z]?`, "g");
  const fourPlusCount = (body.match(fourPlusRe) || []).length;
  return { etAlCount, fourPlusCount, mixed: etAlCount > 0 && fourPlusCount > 0 };
}

// Ponto final: "deve ser usado para encerrar a frase e não a citação" (NBR 10520:2023). Só sinaliza.
export function checkCitationPeriods(text) {
  const body = splitReferences(text).body;
  const yr = String.raw`\b(?:19|20)\d{2}[a-z]?\b`;
  const before = (body.match(new RegExp(String.raw`[\p{L}\d”"']\.\s+(?=\(${UP}[^()]*?${yr}[^()]*\))`, "gu")) || []).length;
  const inside = (body.match(new RegExp(String.raw`\(${UP}[^()]*?${yr}[^()]*?(?<!\bal)\.\)`, "gu")) || []).length;
  return { before, inside, total: before + inside };
}
