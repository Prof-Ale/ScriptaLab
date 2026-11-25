/**
 * Teste de contrato MathLab App <-> ScriptaLab (node:test, zero dependências).
 *
 * Roda com:  node --test tests/contract.test.js
 * (ou:      npm run check   — depois de incluir este arquivo no script de teste)
 *
 * Invariantes travadas aqui — mudar qualquer uma quebra o MathLab App:
 *  - schemas "mathlab.scriptalab-source/1" e "scriptalab.review/1";
 *  - blockHash == SHA-256 padrão (oráculo: node:crypto), CRLF -> LF, prefixo "sha256:";
 *  - parseSource rejeita schema errado, JSON inválido e blocos incompletos;
 *  - trava de preservação bloqueia perda de número, fórmula, [F#] e citação;
 *  - buildReview só inclui patch alterado + não bloqueado + autorizado;
 *  - humanValidationCarried é sempre false.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  SOURCE_SCHEMA,
  REVIEW_SCHEMA,
  blockHash,
  parseSource,
  proposeForBlocks,
  preservationLoss,
  buildReview,
} from "../src/core/mathlabBridge.js";

const oracle = (body) =>
  "sha256:" + createHash("sha256").update(String(body ?? "").replace(/\r\n?/g, "\n"), "utf8").digest("hex");

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "fixtures/contract/source.json");
const sourceText = readFileSync(fixturePath, "utf8");
const source = JSON.parse(sourceText);
const parsed = parseSource(sourceText);
const props = proposeForBlocks(parsed);
const byId = Object.fromEntries(props.map((p) => [p.blockId, p]));

test("schemas do contrato são os versionados", () => {
  assert.equal(SOURCE_SCHEMA, "mathlab.scriptalab-source/1");
  assert.equal(REVIEW_SCHEMA, "scriptalab.review/1");
});

test("blockHash é o SHA-256 padrão, com normalização de quebra de linha", () => {
  for (const b of source.blocks) {
    assert.equal(blockHash(b.body), oracle(b.body), b.blockId);
    assert.equal(b.beforeHash, oracle(b.body), `beforeHash da fixture (${b.blockId})`);
  }
  assert.equal(blockHash(""), oracle(""));
  assert.equal(blockHash("a\r\nb"), blockHash("a\nb"));
  assert.equal(blockHash("a\rb"), blockHash("a\nb"));
  assert.equal(blockHash("soma $x^2$ é 2 — café"), oracle("soma $x^2$ é 2 — café"));
});

test("parseSource aceita a fixture e rejeita tudo fora do contrato", () => {
  assert.equal(parsed.materialId, "mat_contrato_001");
  assert.equal(parsed.blocks.length, 5);
  assert.throws(() => parseSource("{não json"), /JSON válido/);
  assert.throws(() => parseSource(JSON.stringify({ ...source, schema: "mathlab.scriptalab-source/2" })), /mathlab\.scriptalab-source\/1/);
  assert.throws(() => parseSource(JSON.stringify({ materialId: "x", blocks: source.blocks })), /mathlab\.scriptalab-source\/1/);
  assert.throws(() => parseSource(JSON.stringify({ schema: SOURCE_SCHEMA, blocks: source.blocks })), /materialId/);
  assert.throws(() => parseSource(JSON.stringify({ schema: SOURCE_SCHEMA, materialId: "x", blocks: [] })), /pelo menos 1 bloco/);
  assert.throws(() => parseSource(JSON.stringify({ schema: SOURCE_SCHEMA, materialId: "x", blocks: [{ body: "oi" }] })), /blockId/);
  assert.throws(() => parseSource(JSON.stringify({ schema: SOURCE_SCHEMA, materialId: "x", blocks: [{ blockId: "b1" }] })), /body/);
});

test("proposeForBlocks: muda só o que deve mudar, sem bloqueio, com hash conferido", () => {
  assert.equal(props.length, 5);
  assert.ok(byId.blk_01.changed && byId.blk_01.after.includes("(Silva, 2023)"));
  assert.ok(byId.blk_02.changed && !byId.blk_02.after.includes("【") && byId.blk_02.after.includes("42"));
  assert.ok(!byId.blk_03.changed);
  assert.ok(!byId.blk_04.changed && byId.blk_04.after.includes("$x^2 + 1$"));
  assert.ok(byId.blk_05.changed && byId.blk_05.after.includes("(Souza, 2020)"));
  assert.ok(props.every((p) => !p.blocked && p.hashMatchesSource));
  assert.ok(props.every((p) => p.beforeHash === oracle(p.before)));
});

test("trava de preservação detecta perda de número, fórmula, marcador e citação", () => {
  assert.match(preservationLoss("a soma é 42", "a soma é", "scrubber").join(" "), /42/);
  assert.match(preservationLoss("vale $x^2$", "vale", "scrubber").join(" "), /fórmula/);
  assert.match(preservationLoss("ver [F1]", "ver", "scrubber").join(" "), /marcadores/);
  assert.match(preservationLoss("segundo (SILVA, 2023)", "segundo", "scrubber").join(" "), /citações/);
  assert.equal(preservationLoss("(SILVA, 2023) diz 42", "(Silva, 2023) diz 42", "abnt_10520").length, 0);
});

test("buildReview: só autorizado + alterado + não bloqueado; validação humana nunca viaja", () => {
  const meta = { profileId: "abnt-padrao-2023", now: new Date("2026-11-25T12:00:00.000Z") };
  const review = buildReview(parsed, props, ["blk_01", "blk_02", "blk_03", "blk_04", "blk_05"], meta);
  assert.equal(review.schema, REVIEW_SCHEMA);
  assert.equal(review.sourceContract, SOURCE_SCHEMA);
  assert.equal(review.materialId, "mat_contrato_001");
  assert.equal(review.profileId, "abnt-padrao-2023");
  assert.equal(review.generatedAt, "2026-11-25T12:00:00.000Z");
  assert.equal(review.humanValidationCarried, false);
  assert.equal(review.authorizedPatches.length, 3);
  assert.deepEqual(review.authorizedPatches.map((p) => p.blockId).sort(), ["blk_01", "blk_02", "blk_05"]);
  for (const p of review.authorizedPatches) {
    assert.equal(p.beforeHash, oracle(byId[p.blockId].before));
    assert.equal(p.body, byId[p.blockId].after);
    assert.deepEqual(Object.keys(p).sort(), ["beforeHash", "blockId", "body", "category"]);
  }
  const parcial = buildReview(parsed, props, ["blk_01"], meta);
  assert.equal(parcial.authorizedPatches.length, 1);

  const bloqueada = { ...byId.blk_01, blocked: true, perdas: ["números (42)"] };
  const comBloqueio = buildReview(parsed, [bloqueada, ...props.slice(1)], ["blk_01", "blk_02", "blk_05"], meta);
  assert.ok(comBloqueio.authorizedPatches.every((p) => p.blockId !== "blk_01"));

  assert.throws(() => buildReview(parsed, props, [], meta), /Nenhuma correção autorizada/);
  assert.throws(() => buildReview(parsed, props, ["blk_03"], meta), /Nenhuma correção autorizada/);
});
