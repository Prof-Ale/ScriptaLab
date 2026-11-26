/**
 * Conferência de ortografia PT-BR local — ScriptaLab.
 *
 * Zero dependência, ESM puro, roda no navegador e em Node. O dicionário
 * é um arquivo binário (filtro de Bloom) gerado por
 * `tools/gerar-dicionario.mjs` a partir do VERO (LibreOffice) —
 * ver data/ortografia/LICENCA-VERO.txt.
 *
 * Por que filtro de Bloom e não Hunspell/nspell: o Hunspell pt-BR tem
 * ~25 mil regras de afixo e o nspell leva minutos e mais de 1 GB de
 * memória para carregá-lo, o que trava a aba. O filtro é carregado em
 * milissegundos.
 *
 * Garantias e limites (dizer sempre ao usuário):
 *  - Nunca recusa uma palavra que está no dicionário (sem falso
 *    negativo de dicionário).
 *  - Com taxa pequena (ver `meta.fpRate`), aceita por engano uma
 *    palavra errada que "colidiu" no filtro. Por isso o resultado é
 *    SINAL de revisão, não prova de erro nem de acerto.
 *  - Só confere grafia. Crase, concordância e regência NÃO são
 *    conferidas aqui (ficam para as regras e para a IA, via contrato).
 *  - Nomes próprios, siglas, termos técnicos e estrangeirismos podem
 *    aparecer como suspeitos: há "ignorar" e dicionário do autor.
 *  - Nada é alterado no texto: só se devolve posição, palavra e
 *    candidatas.
 */

export const SPELL_FORMAT = "scriptalab.bloom/1";
const MAGIC = [0x53, 0x4c, 0x42, 0x31]; // "SLB1"

// ---------- Hash (idêntico no gerador e no navegador) ----------
export function hash2(str) {
  let h1 = 0x811c9dc5;
  let h2 = 0x9747b28c;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
    h2 ^= h2 >>> 15;
  }
  h1 ^= h1 >>> 16;
  h1 = Math.imul(h1, 0x85ebca6b);
  h1 ^= h1 >>> 13;
  h2 = Math.imul(h2, 0xc2b2ae35);
  h2 ^= h2 >>> 16;
  return [h1 >>> 0, (h2 | 1) >>> 0];
}

function positions(str, k, m) {
  const [h1, h2] = hash2(str);
  const out = new Array(k);
  for (let i = 0; i < k; i++) out[i] = (h1 + Math.imul(i, h2)) >>> 0;
  for (let i = 0; i < k; i++) out[i] = out[i] % m;
  return out;
}

/** Empacota um conjunto de palavras num filtro (usado pelo gerador). */
export function packBloom(words, { bitsPerItem = 11, k = 7, info = {} } = {}) {
  const list = Array.isArray(words) ? words : [...words];
  const n = list.length;
  const m = Math.max(64, Math.ceil(n * bitsPerItem));
  const bits = new Uint8Array(Math.ceil(m / 8));
  for (const w of list) {
    for (const p of positions(w, k, m)) bits[p >>> 3] |= 1 << (p & 7);
  }
  const fpRate = Math.pow(1 - Math.exp((-k * n) / m), k);
  const header = new TextEncoder().encode(
    JSON.stringify({ format: SPELL_FORMAT, n, m, k, fpRate: Number(fpRate.toFixed(5)), ...info })
  );
  const out = new Uint8Array(4 + 4 + header.length + bits.length);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(4, header.length, true);
  out.set(header, 8);
  out.set(bits, 8 + header.length);
  return out;
}

/** Lê o arquivo do filtro. Aceita Uint8Array ou ArrayBuffer. */
export function readBloom(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 9 || MAGIC.some((b, i) => bytes[i] !== b)) {
    throw new Error("Arquivo de dicionário inválido (cabeçalho SLB1 ausente).");
  }
  const hlen = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
  const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + hlen)));
  if (meta.format !== SPELL_FORMAT) throw new Error(`Formato de dicionário desconhecido: ${meta.format}`);
  const bits = bytes.subarray(8 + hlen);
  if (bits.length * 8 < meta.m) throw new Error("Dicionário truncado: faltam bits no arquivo.");
  return { meta, bits };
}

// ---------- Utilidades ----------
const LETRAS_SUGESTAO = "abcdefghijklmnopqrstuvwxyz"; // acentos entram por acentuacoes(), nunca por inserção cega
const CONFUSOES = [new Set("szcçxj"), new Set("gj"), new Set("ou"), new Set("ei")];
const DUPLICAVEIS = new Set("hscrç");
const ACENTOS = {
  a: ["á", "à", "â", "ã"],
  e: ["é", "ê"],
  i: ["í"],
  o: ["ó", "ô", "õ"],
  u: ["ú", "ü"],
  c: ["ç"],
};
const SEM_ACENTO = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Pronomes oblíquos e finais de mesóclise que podem vir após hífen.
export const CLITICOS = new Set([
  "me", "te", "se", "lhe", "lhes", "nos", "vos", "o", "a", "os", "as",
  "lo", "la", "los", "las", "no", "na", "nas",
]);
export const MESOCLISE = new Set([
  "ei", "ás", "á", "emos", "eis", "ão", "ia", "ias", "íamos", "íeis", "iam",
]);
// Prefixos produtivos: palavra = prefixo + palavra válida (≥ 4 letras).
const PREFIXOS = [
  "anti", "auto", "contra", "extra", "infra", "intra", "macro", "micro", "mini", "multi",
  "neo", "pseudo", "semi", "sobre", "sub", "super", "supra", "ultra", "inter", "hiper",
  "hipo", "poli", "co", "re", "des", "pre", "pos", "pro", "bio", "geo", "eco", "psico",
  "socio", "etno", "tele", "pluri", "trans", "meta", "para", "ante", "arqui", "mono",
];

/**
 * Cria o verificador a partir dos bytes do dicionário.
 * `userWords`: palavras do autor (aceitas como corretas).
 */
export function createSpellChecker(bytes, { userWords = [] } = {}) {
  const { meta, bits } = readBloom(bytes);
  const { m, k } = meta;
  const user = new Set(userWords.map((w) => String(w).toLowerCase()));
  const has = (w) => {
    const ps = positions(w, k, m);
    for (let i = 0; i < ps.length; i++) {
      if (!(bits[ps[i] >>> 3] & (1 << (ps[i] & 7)))) return false;
    }
    return true;
  };

  function formaSimples(w) {
    if (has(w)) return true;
    const lower = w.toLowerCase();
    if (lower !== w && has(lower)) return true; // Capitalizada no início de frase
    if (w === w.toUpperCase() && w.length > 1) {
      if (has(lower) || has(cap(lower))) return true; // SIGLA/ênfase
    }
    return false;
  }

  function comPrefixo(w) {
    const lower = w.toLowerCase();
    if (lower.length < 8) return false;
    for (const p of PREFIXOS) {
      if (!lower.startsWith(p)) continue;
      const rest = lower.slice(p.length);
      if (rest.length >= 4 && has(rest)) return true;
    }
    return false;
  }

  function comHifen(w) {
    const parts = w.split("-").filter((x) => x.length);
    if (parts.length < 2) return false;
    if (parts.every((p) => formaSimples(p))) return true;
    // verbo-clítico(s) e mesóclise: dá-me, fazê-lo, dar-lhe-ei
    const [first, ...rest] = parts;
    const ok = (s) => CLITICOS.has(s.toLowerCase()) || MESOCLISE.has(s.toLowerCase());
    if (!rest.every(ok)) return false;
    const f = first.toLowerCase();
    const cands = [f, f + "r", SEM_ACENTO(f) + "r", SEM_ACENTO(f) + "s", f.replace(/[ao]$/, "") + "ar"];
    return cands.some((c) => has(c));
  }

  /** True se a palavra é aceita (dicionário, hífen, prefixo ou dicionário do autor). */
  function correct(word) {
    const w = String(word).normalize("NFC");
    if (!w) return true;
    if (user.has(w.toLowerCase())) return true;
    if (formaSimples(w)) return true;
    if (w.includes("-") && comHifen(w)) return true;
    if (/['’]/.test(w)) {
      const parts = w.split(/['’]/).filter(Boolean);
      if (parts.length > 1 && parts.every((p) => formaSimples(p))) return true; // d'água
    }
    return comPrefixo(w);
  }

  const DIGRAFOS = [["ss", "ç"], ["ss", "c"], ["ç", "ss"], ["c", "ss"], ["sc", "ç"], ["sc", "c"], ["sç", "ç"], ["xc", "c"], ["x", "ch"], ["ch", "x"], ["z", "s"], ["s", "z"], ["ss", "s"], ["rr", "r"], ["lh", "li"], ["nh", "ni"], ["ao", "ão"], ["oes", "ões"], ["x", "z"], ["z", "x"], ["g", "gu"], ["gu", "g"], ["qu", "c"], ["c", "qu"], ["m", "n"], ["n", "m"]];
  function digrafos(w) {
    const out = new Set();
    for (const [de, para] of DIGRAFOS) {
      let i = w.indexOf(de);
      while (i >= 0) {
        out.add(w.slice(0, i) + para + w.slice(i + de.length));
        i = w.indexOf(de, i + 1);
      }
    }
    out.delete(w);
    return out;
  }

  function edits1(w) {
    const out = new Set();
    for (let i = 0; i <= w.length; i++) {
      const L = w.slice(0, i);
      const R = w.slice(i);
      if (R) out.add(L + R.slice(1)); // remoção
      if (R.length > 1) out.add(L + R[1] + R[0] + R.slice(2)); // troca
      for (const c of LETRAS_SUGESTAO) {
        if (R) out.add(L + c + R.slice(1)); // substituição
        out.add(L + c + R); // inserção
      }
    }
    out.delete(w);
    return out;
  }

  // Plausibilidade fonotática do português: ç só depois de vogal e antes de a/o/u/ã/õ;
  // ã só antes de o/e ou no fim (com s); õ só antes de e ou no fim.
  function acentoPlausivel(w, a, i) {
    if (a === "ç") return i > 0 && /[aeiouáâãàéêíóôõú]/.test(w[i - 1]) && /[aouãõ]/.test(w[i + 1] || "");
    if (a === "ã") return /^(?:[oe]|s?$)/.test(w.slice(i + 1));
    if (a === "õ") return /^(?:e|s?$)/.test(w.slice(i + 1));
    return true;
  }

  /**
   * Restaura acentos/cedilha com plausibilidade: no máximo 1 acento tônico
   * (á é í ó ú â ê ô à), 1 til (ã õ) e 1 cedilha (ç) — ex.: paralisacao → paralisação.
   */
  function acentuacoes(w) {
    const out = new Set();
    const pos = [];
    for (let i = 0; i < w.length; i++) if (ACENTOS[w[i]]) pos.push(i);
    if (pos.length > 14) return out;
    const TIPO = (c) => (c === "ç" ? "c" : "ãõ".includes(c) ? "n" : "t");
    const rec = (idx, cur, usados) => {
      if (idx === pos.length) return;
      for (let q = idx; q < pos.length; q++) {
        const i = pos[q];
        for (const a of ACENTOS[w[i]]) {
          if (a === "ü") continue;
          const t = TIPO(a);
          if (usados.includes(t)) continue;
          const next = cur.slice(0, i) + a + cur.slice(i + 1);
          if (!acentoPlausivel(next, a, i)) continue;
          out.add(next);
          rec(q + 1, next, usados.concat(t));
        }
      }
    };
    rec(0, w, []);
    return out;
  }

  /** Até `max` candidatas existentes no dicionário (melhor primeiro). */
  function suggest(word, max = 5) {
    const raw = String(word).normalize("NFC");
    const lower = raw.toLowerCase();
    const base = SEM_ACENTO(lower);
    const capital = raw[0] !== raw[0]?.toLowerCase();
    const scored = new Map(); // candidata -> menor pontuação (menor = melhor)
    const add = (c, score) => {
      if (c === lower || !has(c)) return;
      if (!scored.has(c) || scored.get(c) > score) scored.set(c, score);
    };
    // 1) só acentos/cedilha (ex.: excecao → exceção) ou sem acento nenhum (idéia → ideia)
    add(base, 0.1);
    for (const c of acentuacoes(lower)) add(c, 0);
    for (const c of acentuacoes(base)) add(c, 0.2);
    // 2) uma edição (troca, remoção, inserção, transposição). Confusões típicas do português
    //    (s/z/c/ç/x, g/j, dobra de h/s/c/r) vêm na frente; as demais ficam por último.
    const plausiveis = [];
    for (const c of edits1(base)) {
      let score = 2;
      if (c.length === base.length) {
        for (let i = 0; i < base.length; i++) {
          if (base[i] !== c[i] && CONFUSOES.some((g) => g.has(base[i]) && g.has(c[i]))) { score = 1; break; }
        }
      } else if (Math.abs(c.length - base.length) === 1) {
        const longer = c.length > base.length ? c : base;
        const shorter = c.length > base.length ? base : c;
        let i = 0;
        while (i < shorter.length && longer[i] === shorter[i]) i++;
        const dobra = longer[i] === longer[i + 1] || longer[i] === longer[i - 1];
        const hMudo = longer[i] === "h" && (i === 0 || "cnl".includes(longer[i - 1]));
        if ((DUPLICAVEIS.has(longer[i]) && dobra && longer[i] !== "h") || hMudo) score = 1;
      }
      if (score === 1 && c[0] === base[0]) plausiveis.push(c);
      add(c, score);
    }
    // 2b) dígrafos trocados (ssão → ção, ch ↔ x, sc → ç...), com e sem acento
    for (const c of digrafos(base)) {
      add(c, 1);
      for (const a of acentuacoes(c)) add(a, 1.5);
    }
    // 3) confusão típica + acento (ex.: atravez → através, paralizacao → paralisação, conciência → consciência)
    for (const c of plausiveis) for (const a of acentuacoes(c)) add(a, 1.5);
    let found = [...scored.entries()].sort((a, b) => a[1] - b[1] || a[0].length - b[0].length || a[0].localeCompare(b[0], "pt"));
    if (found.length && found[0][1] <= 1.5) { const lim = found[0][1] <= 1 ? 1.5 : 2; found = found.filter((x) => x[1] <= lim); } // sem as edições "cegas" quando há palpite bom
    const top = found.slice(0, max).map((x) => x[0]);
    return capital ? top.map(cap) : top;
  }

  return { meta, correct, suggest, has, addWord: (w) => user.add(String(w).toLowerCase()) };
}

// ---------- Varredura do texto ----------
const TOKEN = /[\p{L}\p{M}][\p{L}\p{M}'’-]*/gu;

function inRanges(ranges, start, end) {
  for (const [a, b] of ranges) if (start < b && end > a) return true;
  return false;
}

function sentenceInitial(text, start) {
  let i = start - 1;
  while (i >= 0 && /[\s"“‘'(\[—–-]/.test(text[i])) i--;
  return i < 0 || /[.!?:\n]/.test(text[i]);
}

/**
 * Procura palavras suspeitas. NÃO altera o texto.
 * opts: { ignorar: Set|Array de palavras, protegidos: [[ini,fim],...],
 *         minLetras: 3, max: 400, sugestoes: true }
 * Regras para reduzir ruído (decididas com cautela, nunca silenciosas):
 *  - ignora trechos protegidos (citações, fórmulas, referências, URLs);
 *  - ignora palavra com número, SIGLA, MaIúScuLa no meio e nome próprio
 *    (maiúscula fora de início de frase);
 *  - no início de frase, só sinaliza se houver candidata próxima.
 */
export function findMisspellings(text, checker, opts = {}) {
  const src = String(text ?? "");
  const ignorar = new Set([...(opts.ignorar || [])].map((w) => String(w).toLowerCase()));
  const protegidos = opts.protegidos || [];
  const minLetras = opts.minLetras ?? 3;
  const max = opts.max ?? 400;
  const out = [];
  TOKEN.lastIndex = 0;
  let m;
  while ((m = TOKEN.exec(src))) {
    let word = m[0].replace(/[-'’]+$/, "");
    const start = m.index;
    const end = start + word.length;
    if (word.length < minLetras) continue;
    if (inRanges(protegidos, start, end)) continue;
    if (ignorar.has(word.toLowerCase())) continue;
    const next = src[end];
    const prev = src[start - 1];
    if (/[\d@/_]/.test(next || "") || /[\d@/_]/.test(prev || "")) continue; // número colado, e-mail, URL, caminho
    if (/[A-ZÀ-Ý].*[A-ZÀ-Ý]/u.test(word) && word !== word.toUpperCase()) continue; // CamelCase, McDonald
    if (word === word.toUpperCase()) continue; // sigla
    if (checker.correct(word)) continue;
    const capital = word[0] !== word[0].toLowerCase();
    const inicio = sentenceInitial(src, start);
    if (capital && !inicio) continue; // nome próprio no meio da frase
    const suggestions = opts.sugestoes === false ? [] : checker.suggest(word, 5);
    if (capital && inicio && suggestions.length === 0) continue; // provável nome próprio
    out.push({ start, end, word, suggestions, kind: "ortografia" });
    if (out.length >= max) break;
  }
  return out;
}
