#!/usr/bin/env node
/**
 * Gerador do corpus dourado (tests/fixtures/golden/esperado.json).
 *
 * Roda com: node tools/gerar-dourado.mjs
 * Exporta `auditarDourado(nome)` para o teste `tests/golden.test.js`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ScriptaCore as C } from "../src/core/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GOLDEN_DIR = join(ROOT, "tests/fixtures/golden");
export const GOLDEN_FILES = ["trecho-tese.txt", "trecho-limpo.txt", "trecho-cliches.txt"];

export function auditarDourado(nome) {
  const text = readFileSync(join(GOLDEN_DIR, nome), "utf8").replace(/\r\n?/g, "\n");
  const sentences = C.splitSentences(text);
  const stats = C.sentenceStats(sentences);
  const refs = C.splitReferences(text);
  const x = C.crossCheckRefs(text);
  const latinMatches = text.match(C.LATIN_ITALIC) || [];
  const cits = C.collectCitations(refs.body);
  return {
    arquivo: nome,
    palavras: C.countWords(text),
    periodos: stats.n,
    cv: stats.cv === null ? null : Math.round(stats.cv * 100) / 100,
    banda: C.cvBand(stats.cv),
    cliches: C.findCliches(text).map((c) => c.id),
    marcasIA: C.scanScrubIssues(text),
    siglasDetectadas: cits.filter((c) => C.isSigla(c.name)).map((c) => c.name),
    latinItalic: latinMatches,
    etAl: C.checkEtAlUniformity(text),
    pontos: C.checkCitationPeriods(text),
    crossCheck: {
      has: x.has,
      entries: x.entries,
      missing: x.missing.map((m) => `${m.name}, ${m.year}`),
      uncitedCount: x.uncited.length,
    },
    tiposReferencia: refs.entries.map((e) => C.classifyReferenceType(e)),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const esperado = GOLDEN_FILES.map(auditarDourado);
  const dest = join(GOLDEN_DIR, "esperado.json");
  writeFileSync(dest, JSON.stringify(esperado, null, 2) + "\n", "utf8");
  console.log("Corpus dourado gerado em", dest);
}
