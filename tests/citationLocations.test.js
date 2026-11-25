/**
 * Teste do localizador de citações × referências (node:test).
 *
 * Roda com:  node --test tests/citationLocations.test.js
 *
 * O verificador continua sendo crossCheckRefs; aqui só é travado o
 * "onde": trecho, parágrafo, linha, posição e página estimada de
 * cada ocorrência — e a entrada correspondente de cada referência
 * sem citação.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { locateCrossCheck, locateMissingCitations, locateUncitedReferences, DEFAULT_CHARS_PER_PAGE } from "../src/core/citationLocations.js";
import { crossCheckRefs } from "../src/core/citationAuditor.js";

const TEXT = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures/trecho-tese.txt"), "utf8");

test("fixture: Vygotsky 1934 é a única citação sem referência; Vygotsky 2007 é a única referência sem citação", () => {
  const r = locateCrossCheck(TEXT);
  assert.equal(r.has, true);
  assert.equal(r.entries, 4);
  assert.equal(r.missing.length, 1);
  assert.equal(r.missing[0].name, "Vygotsky");
  assert.equal(r.missing[0].year, "1934");
  assert.equal(r.uncited.length, 1);
  assert.match(r.uncited[0].entry, /VYGOTSKY, L\. S\./);
  assert.equal(r.uncited[0].entryIndex, 4);
});

test("ocorrência traz trecho, parágrafo, linha, posição e página estimada", () => {
  const [m] = locateMissingCitations(TEXT);
  assert.equal(m.occurrences.length, 1);
  const o = m.occurrences[0];
  assert.equal(o.raw, "Vygotsky (1934)");
  assert.equal(o.paragraph, 1);
  assert.equal(o.line, 1);
  assert.equal(TEXT.slice(o.index, o.index + o.length), "Vygotsky (1934)");
  assert.ok(o.excerpt.includes("Vygotsky (1934)"));
  assert.ok(o.excerpt.includes("zona de desenvolvimento proximal"));
  assert.equal(o.pageEstimated, 1);
  assert.equal(o.pageEstimated, Math.floor(o.index / DEFAULT_CHARS_PER_PAGE) + 1);
});

test("referência sem citação aponta para a entrada na lista", () => {
  const [u] = locateUncitedReferences(TEXT);
  assert.ok(u.location.excerpt.includes("VYGOTSKY"));
  assert.ok(u.location.excerpt.includes("A formação social da mente"));
  assert.ok(u.location.index > TEXT.indexOf("REFERÊNCIAS"));
  assert.equal(u.location.paragraph, 4);
});

test("mesma citação em dois lugares gera duas ocorrências", () => {
  const text = "(SILVA, 2020) abre o capítulo. No fim, (SILVA, 2020) fecha o argumento.\n\nREFERÊNCIAS\nSOUZA, A. Outro livro. São Paulo: Edusp, 2019.\n";
  const r = locateCrossCheck(text);
  assert.equal(r.missing.length, 1);
  assert.equal(r.missing[0].occurrences.length, 2);
  assert.ok(r.missing[0].occurrences[0].index < r.missing[0].occurrences[1].index);
  assert.ok(r.missing[0].occurrences.every((o) => o.excerpt.includes("(SILVA, 2020)")));
});

test("página estimada muda com charsPerPage e com a posição no texto", () => {
  const pad = "Texto de enchimento. ".repeat(200);
  const text = pad + "(SILVA, 2020) no fim do documento.\n\nREFERÊNCIAS\nSOUZA, A. Outro livro. São Paulo: Edusp, 2019.\n";
  const r1 = locateCrossCheck(text, { charsPerPage: 2800 });
  const r2 = locateCrossCheck(text, { charsPerPage: 1000 });
  const p1 = r1.missing[0].occurrences[0].pageEstimated;
  const p2 = r2.missing[0].occurrences[0].pageEstimated;
  assert.ok(p1 > 1, "com 2800 caracteres por página, a citação não está na página 1");
  assert.ok(p2 > p1, "página menor => número de página maior");
});

test("sem seção REFERÊNCIAS, não há o que localizar", () => {
  const r = locateCrossCheck("Texto com (SILVA, 2020) mas sem lista de referências.");
  assert.equal(r.has, false);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.uncited, []);
});

test("tudo conferido: nenhuma pendência", () => {
  const text = "Segundo Silva (2020), a mediação é central.\n\nREFERÊNCIAS\nSILVA, T. T. Documentos de identidade. Belo Horizonte: Autêntica, 2020.\n";
  const r = locateCrossCheck(text);
  assert.equal(r.missing.length, 0);
  assert.equal(r.uncited.length, 0);
});

test("o localizador concorda com o crossCheckRefs em todos os casos", () => {
  const cases = [TEXT, "(SILVA, 2020) abre.\n\nREFERÊNCIAS\nSOUZA, A. Livro. São Paulo: Edusp, 2019.\n"];
  for (const t of cases) {
    const x = crossCheckRefs(t);
    const r = locateCrossCheck(t);
    assert.equal(r.has, x.has);
    assert.equal(r.entries, x.entries);
    assert.equal(r.missing.length, x.missing.length);
    assert.equal(r.uncited.length, x.uncited.length);
    assert.deepEqual(r.missing.map((m) => `${m.sur}|${m.year}`).sort(), x.missing.map((m) => `${m.sur}|${m.year}`).sort());
  }
});
