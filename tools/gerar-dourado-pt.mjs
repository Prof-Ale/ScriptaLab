#!/usr/bin/env node
/**
 * Gera tests/fixtures/golden/esperado-pt.json a partir do núcleo atual.
 * Revise o diff do arquivo como se fosse código antes de commitar.
 *   node tools/gerar-dourado-pt.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ScriptaCore as C } from "../src/core/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function auditarPt(nome = "trecho-pt.txt") {
  const text = readFileSync(join(ROOT, "tests/fixtures/golden", nome), "utf8");
  const out = { arquivo: nome, registros: {} };
  for (const registro of Object.keys(C.PT_REGISTROS)) {
    const a = C.analisarPortugues(text, { registro });
    out.registros[registro] = {
      resumo: a.resumo,
      metricas: a.metricas,
      achados: a.achados.map((x) => ({ regra: x.regra, severidade: x.severidade, trecho: x.trecho.slice(0, 40), fix: x.fix })),
    };
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(join(ROOT, "tests/fixtures/golden/esperado-pt.json"), JSON.stringify(auditarPt(), null, 2) + "\n");
  console.log("esperado-pt.json gerado.");
}
