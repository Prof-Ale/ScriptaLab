import { escapeHtml, paras } from "./textUtils.js";

// ---------- Segmentação de períodos (PT-BR) ----------
export const ABBR = new Set([
  "p", "pp", "v", "vol", "n", "nº", "no", "ed", "dr", "dra", "prof", "profa",
  "sr", "sra", "fig", "tab", "cap", "art", "etc", "cf", "ex", "obs", "org",
  "orgs", "trad", "min", "sec", "séc", "apud", "ibid", "op", "cit", "av",
  "ca", "ltda", "al", "vs", "ref", "aprox", "depto", "univ", "inst", "cia", "ph"
]);

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

// Faixas indicativas definidas pelo ScriptaLab (heurística editorial; não são limiares científicos)
export const CV_BANDS = [
  [30, "ritmo muito uniforme"],
  [50, "ritmo moderado"],
  [Infinity, "ritmo bem variado"],
];
export const cvBand = (cv) => (cv == null ? "amostra pequena demais" : CV_BANDS.find((b) => cv < b[0])[1]);

// ---------- Radar de clichês (nunca altera o texto) ----------
export const CLICHES_DEFAULT = [
  { id: "nesse-sentido", label: "Nesse sentido", pattern: "nesse\\s+sentido", alt: ["Assim", "Por isso", "Com base nisso"] },
  { id: "vale-ressaltar", label: "Vale ressaltar / destacar", pattern: "vale\\s+(?:a\\s+pena\\s+)?(?:ressaltar|destacar|salientar|mencionar|lembrar)(?:\\s+que)?", alt: ["Apresente o dado ou o argumento direto", "Use “Note-se que” com parcimônia"] },
  { id: "cabe-ressaltar", label: "Cabe ressaltar / destacar", pattern: "cabe\\s+(?:ressaltar|destacar|salientar|mencionar)(?:\\s+que)?", alt: ["Apresente o dado ou o argumento direto"] },
  { id: "e-importante", label: "É importante / crucial destacar", pattern: "é\\s+(?:importante|crucial|fundamental|essencial|imprescindível|necessário)\\s+(?:ressaltar|destacar|salientar|enfatizar|notar|lembrar|mencionar)(?:\\s+que)?", alt: ["Afirme a ideia sem o prefixo", "Justifique a importância com uma evidência"] },
  { id: "ressalta-se", label: "Ressalta-se / destaca-se que", pattern: "(?:ressalta|destaca|salienta)-se\\s+que", alt: ["Afirme a ideia sem o prefixo"] },
  { id: "cenario-atual", label: "No cenário atual", pattern: "no\\s+cenário\\s+(?:atual|contemporâneo)", alt: ["Situe com ano ou contexto concreto (ex.: “Desde 2018…”)"] },
  { id: "dias-atuais", label: "Nos dias de hoje / atuais", pattern: "nos\\s+dias\\s+(?:de\\s+hoje|atuais)", alt: ["Situe com ano ou contexto concreto"] },
  { id: "mundo-cada-vez", label: "Em um mundo cada vez mais…", pattern: "(?:em|num|no)\\s+(?:um\\s+)?mundo\\s+(?:cada\\s+vez\\s+mais|contemporâneo|moderno|atual|globalizado)", alt: ["Comece pelo problema de pesquisa"] },
  { id: "constante-evolucao", label: "Em constante evolução / transformação", pattern: "em\\s+constante\\s+(?:evolução|transformação|mudança)", alt: ["Cite a mudança específica e quando ocorreu"] },
  { id: "rica-tapecaria", label: "Rica tapeçaria", pattern: "(?:rica\\s+)?tapeçaria\\s+de", alt: ["Use um termo literal (ex.: “conjunto”, “variedade”)"] },
  { id: "papel-fundamental", label: "Desempenha um papel fundamental", pattern: "desempenh(?:a|am|ar|ando)\\s+um\\s+papel\\s+(?:fundamental|crucial|essencial|central|vital|importante|significativo)", alt: ["Diga o que faz, concretamente (ex.: “reduz…”, “permite…”)"] },
  { id: "nao-apenas", label: "Não é apenas X, mas (sim/também) Y", pattern: "não\\s+(?:é|são|foi|foram)\\s+apenas[^.!?]{1,140}?\\bmas\\s+(?:sim|também)", alt: ["Afirme Y diretamente, sem a oposição retórica"] },
  { id: "e-inegavel", label: "É inegável / incontestável que", pattern: "é\\s+(?:inegável|incontestável|indiscutível)\\s+que", alt: ["Apoie a afirmação com fonte, em vez de adjetivar"] },
  { id: "suma-importancia", label: "De suma importância", pattern: "de\\s+suma\\s+importância", alt: ["Justifique a relevância com evidência"] },
  { id: "pilar-fundamental", label: "Pilar fundamental", pattern: "pilar(?:es)?\\s+fundament(?:al|ais)", alt: ["Nomeie a função exata"] },
  { id: "multifacetado", label: "Multifacetado", pattern: "multifacetad[oa]s?", alt: ["Liste as facetas ou use “complexo”, se couber"] },
  { id: "adentrar", label: "Adentrar / mergulhar", pattern: "adentr(?:ar|ando|amos|a)|mergulh(?:ar|ando|amos)\\s+(?:em|no|na|nos|nas)", alt: ["Prefira “analisar”, “examinar”, “discutir”"] },
  { id: "navegar-complexidades", label: "Navegar pelas complexidades", pattern: "navegar\\s+(?:pel[ao]s?|n[ao]s?)\\s+complexidades?", alt: ["Prefira “lidar com”, “enfrentar”"] },
  { id: "em-suma", label: "Em suma", pattern: "em\\s+suma", alt: ["Conectivo legítimo; atenção à repetição"] },
  { id: "crucial-destacar", label: "Crucial destacar", pattern: "(?:é\\s+)?crucial\\s+(?:destacar|ressaltar|notar)", alt: ["Afirme a ideia sem o prefixo"] }
];

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
