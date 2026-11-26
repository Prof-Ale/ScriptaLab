/**
 * Ortografia pt-BR offline — testes (node:test).
 * Dicionário: data/ortografia/pt-br.bloom (VERO 3.2, filtro de Bloom, ~5,4 MB).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ScriptaCore as C } from "../src/core/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const bytes = new Uint8Array(readFileSync(join(ROOT, "data/ortografia/pt-br.bloom")));
const meta = JSON.parse(readFileSync(join(ROOT, "data/ortografia/pt-br.meta.json"), "utf8"));
const sp = C.createSpellChecker(bytes);

test("filtro de Bloom: ida e volta e sem falso negativo", () => {
  const palavras = ["casa", "análise", "coração", "açúcar", "pôr", "têm", "lingüiça", "x".repeat(8)];
  const packed = C.packBloom(palavras, { bitsPerItem: 16, k: 11, info: { teste: true } });
  const meta = C.readBloom(packed).meta;
  const b = C.createSpellChecker(packed);
  for (const p of palavras) assert.ok(b.has(p), p);
  assert.equal(b.has("zzzqqq"), false);
  assert.equal(meta.n, palavras.length);
});

test("dicionário: formato, metadados e licença registrados", () => {
  assert.equal(sp.meta.format, "scriptalab.bloom/1");
  assert.ok(meta.n > 2_000_000);
  assert.match(meta.licenca, /LGPL|MPL/);
  assert.ok(meta.fpRate < 0.001);
  const lic = readFileSync(join(ROOT, "data/ortografia/LICENCA-VERO.txt"), "utf8");
  assert.ok(lic.length > 200);
});

test("palavras corretas comuns são aceitas", () => {
  const ok = ["análise", "estratégia", "ortografia", "sentimentos", "coração", "ação", "ações", "açúcar", "pesquisa", "dissertação", "metodologia", "referências", "fundamentação", "à", "é", "têm", "vêm", "pôr", "você", "também", "não", "então", "através", "contexto", "currículo", "educação", "aprendizagem", "avaliação"];
  const erradas = ok.filter((w) => !sp.correct(w));
  assert.deepEqual(erradas, []);
});

test("formas flexionadas e clíticos", () => {
  for (const w of ["fizeram-se", "disse-lhe", "dá-lo-ei", "guarda-chuva", "ex-aluno", "anti-inflamatório", "microssistema", "autoavaliação", "coordenador-geral"]) {
    assert.ok(sp.correct(w), w);
  }
});

test("erros típicos são recusados", () => {
  for (const w of ["resultdos", "analize", "pesquiza", "dissertassão", "metodoligia", "refêrencias", "fundamentaçao"]) {
    assert.equal(sp.correct(w), false, w);
  }
});

test("sugestões: a correta aparece entre as primeiras", () => {
  const pares = { resultdos: "resultados", pesquiza: "pesquisa", dissertassão: "dissertação", fundamentaçao: "fundamentação", analize: "análise" };
  for (const [errada, certa] of Object.entries(pares)) {
    const s = sp.suggest(errada, 5);
    assert.ok(s.includes(certa) || (certa === "análise" && s.includes("analise")), `${errada} → ${s.join(", ")}`);
  }
});

test("restaura acento quando só ele falta", () => {
  assert.ok(sp.suggest("alem", 5).includes("além"));
  assert.ok(sp.suggest("ate", 5).some((x) => x === "até"));
});

test("findMisspellings: ignora nomes, siglas, números, CamelCase e trechos protegidos", () => {
  const t = "A UNESCO e o ScriptaLab usam 2024 dados. Maria Silva escreveu resultdos aqui. \"citaçao errda\" não conta.";
  const protegidos = C.trechosProtegidos(t);
  const r = C.findMisspellings(t, sp, { protegidos });
  const palavras = r.map((x) => x.word);
  assert.ok(palavras.includes("resultdos"));
  for (const nao of ["UNESCO", "ScriptaLab", "Maria", "Silva", "citaçao", "errda", "2024"]) assert.ok(!palavras.includes(nao), nao);
});

test("lista de ignorar do usuário e addWord", () => {
  const t = "O termo zorblax aparece.";
  assert.equal(C.findMisspellings(t, sp, {}).some((x) => x.word === "zorblax"), true);
  assert.equal(C.findMisspellings(t, sp, { ignorar: ["zorblax"] }).some((x) => x.word === "zorblax"), false);
  const sp2 = C.createSpellChecker(bytes, { userWords: ["zorblax"] });
  assert.equal(sp2.correct("zorblax"), true);
});

test("taxa de falsos positivos: palavras de texto real", () => {
  const texto = readFileSync(join(ROOT, "tests/fixtures/golden/trecho-tese.txt"), "utf8") + readFileSync(join(ROOT, "tests/fixtures/golden/trecho-limpo.txt"), "utf8");
  const r = C.findMisspellings(texto, sp, { protegidos: C.trechosProtegidos(texto) });
  const total = C.countWords(texto);
  assert.ok(r.length / total < 0.05, `${r.length}/${total} marcadas: ${r.map((x) => x.word).join(", ")}`);
});

test("desempenho: carregar e checar 20 mil palavras", () => {
  const t0 = Date.now();
  const s = C.createSpellChecker(bytes);
  let n = 0;
  for (let i = 0; i < 20000; i++) if (s.correct("pesquisa" + (i % 2 ? "s" : ""))) n++;
  assert.equal(n, 20000);
  assert.ok(Date.now() - t0 < 1500, "demorou " + (Date.now() - t0) + "ms");
});
