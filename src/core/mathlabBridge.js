import { normStr, titleCase } from "./textUtils.js";
import { INVIS, AI_TAGS, UTM, HYPH_BREAK } from "./scrubber.js";
import { mkCit, isSigla, checkCitationPeriods } from "./abnt10520.js";
import { CLICHES_DEFAULT, analyzeStyle } from "./stylometry.js";
import { crossCheckRefs } from "./citationAuditor.js";
import { detectAiSyntaxPatterns } from "./literaryReview.js";

// ---------- Ponte com o MathLab App (mathlab.scriptalab-source/1 -> scriptalab.review/1) ----------
// SHA-256 síncrono em JS puro, para o núcleo continuar testável sem navegador e sem dependências.
const SHA_K = [];
const SHA_H0 = [];
(function initShaConstants() {
  let n = 2;
  const primes = [];
  while (primes.length < 64) {
    let p = true;
    for (const q of primes) {
      if (q * q > n) break;
      if (n % q === 0) { p = false; break; }
    }
    if (p) primes.push(n);
    n++;
  }
  const frac = (x) => Math.floor((x - Math.floor(x)) * 4294967296) >>> 0;
  primes.forEach((p, i) => {
    SHA_K.push(frac(Math.cbrt(p)));
    if (i < 8) SHA_H0.push(frac(Math.sqrt(p)));
  });
})();

function utf8Bytes(str) {
  const s = String(str).replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD");
  const out = [];
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

export function sha256Hex(str) {
  const b = utf8Bytes(str);
  const bitLen = b.length * 8;
  b.push(0x80);
  while (b.length % 64 !== 56) b.push(0);
  const hi = Math.floor(bitLen / 4294967296);
  const lo = bitLen >>> 0;
  for (const v of [hi, lo]) b.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
  const H = SHA_H0.slice();
  const w = new Array(64);
  const rr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < b.length; o += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = ((b[o + 4 * i] << 24) | (b[o + 4 * i + 1] << 16) | (b[o + 4 * i + 2] << 8) | b[o + 4 * i + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rr(w[i - 15], 7) ^ rr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rr(w[i - 2], 17) ^ rr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, bb, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA_K[i] + w[i]) >>> 0;
      const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22);
      const mj = (a & bb) ^ (a & c) ^ (bb & c);
      const t2 = (S0 + mj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = bb; bb = a; a = (t1 + t2) >>> 0;
    }
    [a, bb, c, d, e, f, g, h].forEach((v, i) => { H[i] = (H[i] + v) >>> 0; });
  }
  return H.map((v) => v.toString(16).padStart(8, "0")).join("");
}

// Mesmo cálculo do MathLab App: SHA-256 do corpo em UTF-8, quebras de linha em LF, prefixo "sha256:".
export const blockHash = (body) => "sha256:" + sha256Hex(String(body ?? "").replace(/\r\n?/g, "\n"));

const FORMULA_RE = /\$\$[^$]+\$\$|\$[^$\n]+\$|\\\([^)]*\\\)|\\\[[^\]]*\\\]/g;
const CIT_PAREN = /\(([A-ZÁÉÍÓÚÂÊÔÃÕÇ][^()\d]{1,60}),?\s*(\d{4}[a-z]?)(?:,\s*p\.\s*[\d-]+)?\)/g;
const nkey = (s) => normStr(s).replace(/\s+/g, " ").trim();
const countMap = (l) => { const m = new Map(); for (const x of l) m.set(x, (m.get(x) || 0) + 1); return m; };
const missingFrom = (a, d) => {
  const A = countMap(a);
  const D = countMap(d);
  const out = [];
  for (const [k, n] of A) if ((D.get(k) || 0) < n) out.push(k);
  return out;
};
const numsOf = (t) =>
  String(t)
    .replace(AI_TAGS, " ")
    .replace(UTM, " ")
    .replace(FORMULA_RE, " ")
    .replace(CIT_PAREN, " ")
    .replace(/\([^()]*\b\d{4}[a-z]?\)/g, " ")
    .match(/\d+(?:[.,]\d+)?/g) || [];
const yearsCited = (t) => [...String(t).matchAll(/\(([^()]*)\)/g)].flatMap((m) => m[1].match(/\b(?:1[5-9]\d{2}|20\d{2})[a-z]?\b/g) || []);
const formulasOf = (t) => [...String(t).matchAll(FORMULA_RE)].map((m) => m[0].replace(/\s+/g, ""));
const markersOf = (t) => String(t).match(/\[F\d{1,2}\]/g) || [];
const citsOf = (t) => [...String(t).matchAll(CIT_PAREN)].map((m) => nkey(m[1]) + "|" + m[2]);

// Trava de preservação (igual à do App): lista o que o texto revisado perdeu. Vazia = respeitada.
export function preservationLoss(antes, depois, categoria) {
  const out = [];
  const n = missingFrom(numsOf(antes), numsOf(depois));
  if (n.length) out.push("números (" + n.slice(0, 4).join(", ") + ")");
  const f = missingFrom(formulasOf(antes), formulasOf(depois));
  if (f.length) out.push("fórmulas (" + f.slice(0, 2).join(", ") + ")");
  const m = missingFrom(markersOf(antes), markersOf(depois));
  if (m.length) out.push("marcadores de fonte (" + m.join(", ") + ")");
  if (categoria !== "abnt_10520") {
    const c = missingFrom(citsOf(antes), citsOf(depois));
    if (c.length) out.push("citações (" + c.slice(0, 2).join("; ") + ")");
  } else {
    const y = missingFrom(yearsCited(antes), yearsCited(depois));
    if (y.length) out.push("anos de citação (" + y.join(", ") + ")");
  }
  return out;
}

// Normaliza um bloco sem tocar em fórmulas e sem NFKC (que trocaria "x²" por "x2" e mudaria a matemática).
export function normalizeBlock(body, o) {
  o = Object.assign({ scrubber: true, ai: true, utm: true, abnt: true }, o || {});
  const orig = String(body ?? "").replace(/\r\n?/g, "\n");
  const keep = [];
  let t = orig.replace(FORMULA_RE, (m) => { keep.push(m); return "\uE000" + (keep.length - 1) + "\uE001"; });
  const c = { inv: 0, hy: 0, ai: 0, cit: 0 };
  if (o.scrubber) {
    t = t.replace(INVIS, (m) => { c.inv++; return m === "\u202F" ? " " : ""; });
    t = t.replace(HYPH_BREAK, (m, a, b) => { c.hy++; return a + b; });
  }
  if (o.ai) t = t.replace(AI_TAGS, () => { c.ai++; return ""; });
  if (o.utm) t = t.replace(UTM, () => { c.ai++; return ""; });
  const scrubberChanges = c.inv + c.hy + c.ai;
  if (o.abnt) {
    t = t.replace(mkCit(), (m, name, etal, year) => {
      if (name !== name.toUpperCase() || isSigla(name)) return m;
      c.cit++;
      return titleCase(name) + (etal ? " et al." : "") + ", " + year;
    });
  }
  t = t.replace(/\uE000(\d+)\uE001/g, (m, i) => keep[+i]);
  const category = scrubberChanges > 0 ? "scrubber" : "abnt_10520";
  return { before: orig, after: t, changed: t !== orig, counts: c, category };
}

export const SOURCE_SCHEMA = "mathlab.scriptalab-source/1";
export const REVIEW_SCHEMA = "scriptalab.review/1";

export function parseSource(text) {
  let d;
  try { d = JSON.parse(text); } catch { throw new Error("O arquivo não é um JSON válido."); }
  if (!d || d.schema !== SOURCE_SCHEMA) {
    throw new Error('Esperado "' + SOURCE_SCHEMA + '" e veio "' + ((d && d.schema) || "sem schema") + '". Exporte pelo botão "Enviar ao ScriptaLab" do App.');
  }
  if (!d.materialId || !Array.isArray(d.blocks) || !d.blocks.length) {
    throw new Error("O arquivo precisa de materialId e de pelo menos 1 bloco.");
  }
  for (const b of d.blocks) {
    if (!b || !b.blockId || typeof b.body !== "string") throw new Error("Bloco sem blockId ou sem body.");
  }
  return d;
}

export function proposeForBlocks(source, o) {
  return source.blocks.map((b) => {
    const r = normalizeBlock(b.body, o);
    const perdas = r.changed ? preservationLoss(r.before, r.after, r.category) : [];
    return {
      blockId: b.blockId,
      title: b.title || b.blockId,
      category: r.category,
      beforeHash: blockHash(b.body),
      before: r.before,
      after: r.after,
      changed: r.changed,
      counts: r.counts,
      perdas,
      blocked: perdas.length > 0,
      hashMatchesSource: !b.beforeHash || b.beforeHash === blockHash(b.body),
    };
  });
}

export function buildReview(source, proposals, authorizedIds, meta) {
  meta = meta || {};
  const ok = new Set(authorizedIds);
  const chosen = proposals.filter((p) => p.changed && !p.blocked && ok.has(p.blockId));
  if (!chosen.length) throw new Error("Nenhuma correção autorizada. Marque pelo menos um bloco com alteração.");
  const all = source.blocks.map((b) => b.body).join("\n\n");
  const st = analyzeStyle(all, meta.cliches || CLICHES_DEFAULT);
  const syn = detectAiSyntaxPatterns(all);
  const refs = crossCheckRefs(all);
  return {
    schema: REVIEW_SCHEMA,
    sourceContract: source.schema,
    materialId: source.materialId,
    profileId: meta.profileId || "abnt-padrao-2023",
    generatedAt: (meta.now || new Date()).toISOString(),
    stylometrySummary: {
      sentenceCount: st.sentences.length,
      cvPercent: st.stats.cv == null ? null : Math.round(st.stats.cv * 10) / 10,
      clicheHits: st.matches.length,
      structuralAlerts: syn.alerts,
    },
    abntSummary: {
      citationIssues: checkCitationPeriods(all).total,
      referenceIssues: refs.has ? refs.missing.length + refs.uncited.length : 0,
    },
    authorizedPatches: chosen.map((p) => ({
      blockId: p.blockId,
      category: p.category,
      beforeHash: p.beforeHash,
      body: p.after,
    })),
    humanValidationCarried: false,
  };
}
