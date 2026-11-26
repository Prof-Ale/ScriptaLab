#!/usr/bin/env node
/**
 * Gera data/ortografia/pt-br.bloom a partir do dicionário VERO
 * (pacote npm `dictionary-pt`, devDependency).
 *
 * Roda com:  node --max-old-space-size=6000 tools/gerar-dicionario.mjs
 *
 * O que faz:
 *  1. Lê o .aff e o .dic do Hunspell (VERO 3.2, LibreOffice).
 *  2. Expande cada verbete com as regras de sufixo e prefixo
 *     (e continuações de um nível; produto cruzado prefixo+sufixo).
 *  3. NÃO expande formas com pronome após hífen (dá-me, fazê-lo,
 *     dar-lhe-ei...): são 7,7 milhões de formas. O verificador em
 *     src/core/spell.js reconhece esse padrão por regra.
 *  4. Descarta verbetes marcados como palavra proibida.
 *  5. Grava um filtro de Bloom (src/core/spell.js: packBloom) — mesma
 *     função de hash que roda no navegador.
 *
 * O resultado é determinístico para a mesma versão do dicionário.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { packBloom } from "../src/core/spell.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = join(ROOT, "node_modules", "dictionary-pt");
const pkgInfo = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));

const aff = readFileSync(join(pkgDir, "index.aff"), "utf8").split(/\r?\n/);
const dic = readFileSync(join(pkgDir, "index.dic"), "utf8").split(/\r?\n/);

const pfx = new Map();
const sfx = new Map();
let forbid = null;
for (const l of aff) {
  if (!l || l.startsWith("#")) continue;
  const p = l.trim().split(/\s+/);
  if (p[0] === "FORBIDDENWORD") forbid = p[1];
  if (p[0] !== "PFX" && p[0] !== "SFX") continue;
  const map = p[0] === "PFX" ? pfx : sfx;
  if (p.length === 4 && /^[YN]$/.test(p[2]) && /^\d+$/.test(p[3])) {
    map.set(p[1], { cross: p[2] === "Y", rules: [] });
    continue;
  }
  const e = map.get(p[1]);
  if (!e) continue;
  let [, , strip, add, cond] = p;
  let cont = "";
  const si = add.indexOf("/");
  if (si >= 0) { cont = add.slice(si + 1); add = add.slice(0, si); }
  if (strip === "0") strip = "";
  if (add === "0") add = "";
  const re = new RegExp(p[0] === "PFX" ? "^(?:" + (cond || ".") + ")" : "(?:" + (cond || ".") + ")$", "u");
  e.rules.push({ strip, add, re, cont });
}

function applySfx(w, flag, acc) {
  const e = sfx.get(flag);
  if (!e) return;
  for (const r of e.rules) {
    if (r.add.includes("-")) continue; // pronome após hífen: tratado por regra no verificador
    if (!r.re.test(w)) continue;
    if (r.strip && !w.endsWith(r.strip)) continue;
    acc.push({ w: w.slice(0, w.length - r.strip.length) + r.add, cross: e.cross, cont: r.cont });
  }
}
function applyPfx(w, flag, acc) {
  const e = pfx.get(flag);
  if (!e) return;
  for (const r of e.rules) {
    if (!r.re.test(w)) continue;
    if (r.strip && !w.startsWith(r.strip)) continue;
    acc.push({ w: r.add + w.slice(r.strip.length), cross: e.cross, cont: r.cont });
  }
}

const out = new Set();
let entries = 0;
for (let i = 1; i < dic.length; i++) {
  const l = dic[i];
  if (!l) continue;
  const sl = l.indexOf("/");
  const w = (sl >= 0 ? l.slice(0, sl) : l).trim();
  const flags = sl >= 0 ? l.slice(sl + 1) : "";
  if (!w) continue;
  entries++;
  const fl = [...flags];
  if (forbid && fl.includes(forbid)) continue;
  out.add(w.normalize("NFC"));
  const sf = [];
  const pf = [];
  for (const f of fl) { applySfx(w, f, sf); applyPfx(w, f, pf); }
  for (const s of [...sf]) if (s.cont) for (const c of [...s.cont]) applySfx(s.w, c, sf);
  for (const s of sf) out.add(s.w.normalize("NFC"));
  for (const p of pf) {
    out.add(p.w.normalize("NFC"));
    if (p.cont) for (const c of [...p.cont]) { const t = []; applyPfx(p.w, c, t); for (const x of t) out.add(x.w.normalize("NFC")); }
  }
  for (const f of fl) {
    const pe = pfx.get(f);
    if (!pe || !pe.cross) continue;
    for (const s of sf) {
      if (!s.cross) continue;
      for (const r of pe.rules) {
        if (!r.re.test(s.w)) continue;
        if (r.strip && !s.w.startsWith(r.strip)) continue;
        out.add((r.add + s.w.slice(r.strip.length)).normalize("NFC"));
      }
    }
  }
}

const sorted = [...out].sort();
const digest = createHash("sha256").update(sorted.join("\n")).digest("hex").slice(0, 16);
const info = {
  fonte: "VERO 3.2 (Verificador Ortográfico Livre) via LibreOffice/dictionaries",
  pacote: `${pkgInfo.name}@${pkgInfo.version}`,
  licenca: pkgInfo.license,
  verbetes: entries,
  formasSemHifenDePronome: sorted.length,
  sha256formas: digest,
  expansao: "sufixos, prefixos e produto cruzado; pronome após hífen por regra no verificador",
};
const bytes = packBloom(sorted, { bitsPerItem: 16, k: 11, info });
const dir = join(ROOT, "data", "ortografia");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "pt-br.bloom"), bytes);
writeFileSync(join(dir, "pt-br.meta.json"), JSON.stringify({ ...JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + new DataView(bytes.buffer).getUint32(4, true)))) }, null, 2) + "\n");
console.log(`verbetes: ${entries} · formas: ${sorted.length} · arquivo: ${(bytes.length / 1048576).toFixed(2)} MB · sha256(formas): ${digest}`);
