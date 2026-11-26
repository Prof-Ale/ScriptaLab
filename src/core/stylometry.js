import { escapeHtml, paras } from "./textUtils.js";
import stylometryRules from "./rules/stylometry.json" with { type: "json" };

export const STYLOMETRY_RULES_VERSION = stylometryRules.version;

// ---------- Segmentação de períodos (PT-BR) ----------
export const ABBR = new Set(stylometryRules.abbreviations);

export function splitSentences(text) {
  const out = [];
  for (const para of paras(String(text))) {
    const s = para.replace(/\s+/g, " ");
    const re = /([.!?…]+)(["”’')\]]*)\s+(?=["“‘(\[]?[A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9])/g;
    let start = 0;
    let m;
    while ((m = re.exec(s))) {
      const before = s.slice(start, m.index);
      const last = (before.match(/([\p{L}\d]+)$/u) || [])[1] || "";
      if (m[1] === "." && m[2] === "") {
        if (ABBR.has(last.toLowerCase())) continue; // p. 34 · et al. · Dr. · Fig.
        if (/^\p{Lu}$/u.test(last)) continue; // iniciais: J. K. Rowling
      }
      const end = m.index + m[1].length + m[2].length;
      out.push(s.slice(start, end));
      start = re.lastIndex;
    }
    const rest = s.slice(start).trim();
    if (rest) out.push(rest);
  }
  return out.map((x) => x.trim()).filter(Boolean);
}

export const wordsOf = (s) => String(s).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [];
export const countWords = (s) => wordsOf(s).length;

export function sentenceStats(sentences) {
  const w = sentences.map(countWords);
  const n = w.length;
  if (!n) return { n: 0, mean: 0, sd: 0, cv: null, min: 0, max: 0, median: 0, words: [] };
  const sum = w.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const sd = Math.sqrt(w.reduce((a, b) => a + (b - mean) ** 2, 0) / n); // desvio-padrão populacional
  const sorted = [...w].sort((a, b) => a - b);
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  return {
    n,
    mean,
    sd,
    cv: n > 1 && mean > 0 ? (sd / mean) * 100 : null,
    min: sorted[0],
    max: sorted[n - 1],
    median,
    words: w,
    total: sum,
  };
}

// Faixas indicativas definidas pelo ScriptaLab (fonte única: rules/stylometry.json)
export const CV_BANDS = stylometryRules.cvBands.map((b) => [b.max == null ? Infinity : b.max, b.label]);
export const cvBand = (cv) => (cv == null ? "amostra pequena demais" : CV_BANDS.find((b) => cv < b[0])[1]);

// ---------- Radar de clichês (nunca altera o texto; fonte única: rules/stylometry.json) ----------
export const CLICHES_DEFAULT = stylometryRules.cliches;

export const compileCliche = (c) =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${c.pattern})(?![\\p{L}\\p{N}])`, "giu");

export function findCliches(text, list) {
  const found = [];
  for (const c of list || CLICHES_DEFAULT) {
    const re = compileCliche(c);
    let m;
    while ((m = re.exec(text))) {
      if (!m[0]) {
        re.lastIndex++;
        continue;
      }
      found.push({
        start: m.index,
        end: m.index + m[0].length,
        id: c.id,
        label: c.label,
        alt: c.alt || [],
        text: m[0],
      });
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  let cursor = 0;
  for (const f of found) {
    if (f.start >= cursor) {
      out.push(f);
      cursor = f.end;
    }
  }
  return out;
}

export function highlightHtml(text, matches) {
  let html = "";
  let pos = 0;
  for (const m of matches) {
    html += escapeHtml(text.slice(pos, m.start));
    const tip = `${m.label}. Sugestões (revisão manual, nada é trocado automaticamente): ${m.alt.join(" · ")}`;
    html += `<mark class="cl" title="${escapeHtml(tip)}">${escapeHtml(text.slice(m.start, m.end))}</mark>`;
    pos = m.end;
  }
  return html + escapeHtml(text.slice(pos));
}

export function analyzeStyle(text, list) {
  const sentences = splitSentences(text);
  const stats = sentenceStats(sentences);
  const matches = findCliches(text, list);
  const total = countWords(text);
  const byId = new Map();
  for (const m of matches) {
    const e = byId.get(m.id) || { id: m.id, label: m.label, alt: m.alt, count: 0 };
    e.count++;
    byId.set(m.id, e);
  }
  const emDash = (text.match(/—/g) || []).length;
  return {
    sentences,
    stats,
    matches,
    groups: [...byId.values()].sort((a, b) => b.count - a.count),
    totalWords: total,
    clichePer1000: total ? (matches.length / total) * 1000 : 0,
    emDashPer1000: total ? (emDash / total) * 1000 : 0,
    emDash,
  };
}
