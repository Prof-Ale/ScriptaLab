import { UP, titleCase, normStr, lastSurname } from "./textUtils.js";
import { isSigla, mkCit, startsRef, splitReferences } from "./abnt10520.js";

export function collectCitations(text) {
  const seen = new Map();
  const add = (rawName, year) => {
    const sur = lastSurname(rawName);
    const y = year.replace(/[a-z]$/, "");
    const key = normStr(sur) + y;
    if (!seen.has(key)) {
      seen.set(key, {
        sur,
        name: rawName === rawName.toUpperCase() && !isSigla(rawName) ? titleCase(rawName) : rawName,
        year: y,
        sigla: isSigla(rawName),
      });
    }
  };
  for (const m of text.matchAll(mkCit())) add(m[1], m[3]);
  const narr = new RegExp(
    `\\b(${UP}[A-Za-zÀ-ÿ'’]+(?:\\s+(?:[Dd][aeo]s?|[Ee])\\s+${UP}[A-Za-zÀ-ÿ'’]+)*)(?:\\s+et\\s+al\\.)?\\s*\\((\\d{4}[a-z]?)`,
    "g"
  );
  for (const m of text.matchAll(narr)) add(m[1], m[2]);
  return [...seen.values()];
}

export function parseEntry(e) {
  const m = e.match(/^([A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-ZÁÉÍÓÚÂÊÔÃÕÇ' -]*),\s/);
  const years = [...e.matchAll(/\b((?:19|20)\d{2})[a-z]?\b/g)].map((x) => x[1]);
  return { text: e, personal: !!m, sur: m ? normStr(lastSurname(m[1])) : "", years };
}

export function crossCheckRefs(text) {
  const r = splitReferences(text);
  if (!r.has) return { has: false, missing: [], uncited: [], skipped: 0, entries: 0 };
  const cites = collectCitations(r.body).filter((c) => !c.sigla);
  const entries = r.entries.map(parseEntry);
  const missing = cites.filter(
    (c) => !entries.some((e) => normStr(e.text).includes(normStr(c.sur)) && e.years.includes(c.year))
  );
  const uncited = entries
    .filter((e) => e.personal && !cites.some((c) => normStr(c.sur) === e.sur && e.years.includes(c.year)))
    .map((e) => (e.text.length > 110 ? e.text.slice(0, 107) + "…" : e.text));
  return {
    has: true,
    missing,
    uncited,
    skipped: entries.filter((e) => !e.personal).length,
    entries: entries.length,
  };
}

export function extractDois(text) {
  const map = new Map();
  for (const d of text.match(/10\.\d{4,9}\/[^\s"<>\]【]+/g) || []) {
    const doi = d.replace(/[.,;:)]+$/, "");
    if (!map.has(doi.toLowerCase())) map.set(doi.toLowerCase(), doi);
  }
  return [...map.values()];
}

export function refBlockFor(text, doi) {
  const lines = text.split(/\r?\n/);
  const i = lines.findIndex((l) => l.toLowerCase().includes(doi.toLowerCase()));
  if (i < 0) return "";
  let s = i;
  while (s > 0 && lines[s - 1].trim() && !startsRef(lines[s])) s--;
  return lines.slice(s, i + 1).join(" ");
}

const STOP = new Set([
  "para", "como", "sobre", "entre", "uma", "dos", "das", "com", "por", "que",
  "the", "and", "of", "for", "from", "nos", "nas"
]);
const tokens = (s) => normStr(s).split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !STOP.has(w));

export function compareRef(block, meta) {
  if (!block || block.length < 25 || !meta) {
    return { verdict: "inconclusivo", detail: "não localizei a referência completa ao lado do DOI" };
  }
  const bt = new Set(tokens(block));
  const tt = tokens(meta.title || "");
  const cov = tt.length ? tt.filter((w) => bt.has(w)).length / tt.length : 0;
  const years = [...block.matchAll(/\b((?:19|20)\d{2})\b/g)].map((x) => +x[1]);
  const yearOk = !meta.year || years.some((y) => Math.abs(y - meta.year) <= 1);
  const surOk = !meta.family || normStr(block).includes(normStr(meta.family));
  const pct = Math.round(cov * 100);
  if (cov >= 0.6 && (yearOk || surOk)) {
    return { verdict: "coerente", detail: `título ${pct}% compatível, ano/autor conferem` };
  }
  if (cov < 0.3 && (!yearOk || !surOk)) {
    return {
      verdict: "divergente",
      detail: `título só ${pct}% compatível${!yearOk ? `, ano ≠ ${meta.year}` : ""}${!surOk ? `, autor “${meta.family}” ausente` : ""}`,
    };
  }
  return {
    verdict: "parcial",
    detail: `título ${pct}% compatível${!yearOk ? `, ano ≠ ${meta.year}` : ""}${!surOk ? `, autor “${meta.family}” ausente` : ""}`,
  };
}
