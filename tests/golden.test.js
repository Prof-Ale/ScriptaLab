/**
 * Corpus dourado — ScriptaLab (node:test).
 *
 * Roda com:  node --test tests/golden.test.js
 *
 * O que é: 3 trechos fixos + as saídas esperadas do núcleo
 * (tests/fixtures/golden/esperado.json), geradas do núcleo atual.
 * O teste roda as MESMAS funções sobre os MESMOS trechos e compara
 * tudo — palavras, CV, clichês, marcas de IA, citações × referências,
 * tipos de referência, et al., pontos, itálico latino e siglas.
 *
 * Por que existe: as regras ABNT agora vivem como dados
 * (src/core/rules/*.json). Se uma regra mudar o comportamento —
 * um termo latino a menos, uma sigla a menos, um tipo de referência
 * reclassificado — este teste quebra ANTES do merge. Para atualizar
 * o esperado de propósito, regenere com:
 *   node tools/gerar-dourado.mjs
 * ...e revise o diff do esperado.json como se fosse código.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ScriptaCore as K } from "../src/core/index.js";
import { auditarDourado } from "../tools/gerar-dourado.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("corpus dourado: o núcleo devolve exatamente o esperado", () => {
  const esperado = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/golden/esperado.json"), "utf8"));
  const atual = ["trecho-tese.txt", "trecho-limpo.txt", "trecho-cliches.txt"].map(auditarDourado);
  assert.deepEqual(atual, esperado);
});

test("corpus dourado: versões das regras estão travadas", () => {
  assert.equal(K.ABNT10520_RULES_VERSION, 1);
  assert.equal(K.ABNT6023_RULES_VERSION, 1);
  assert.equal(K.STYLOMETRY_RULES_VERSION, 1);
});
