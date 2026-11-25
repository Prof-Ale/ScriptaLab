#!/usr/bin/env node
/**
 * Conferidor de contrato MathLab App <-> ScriptaLab.
 *
 * Uso (na raiz do repo ScriptaLab):
 *   node tools/conferir-contrato.mjs
 *   node tools/conferir-contrato.mjs tests/fixtures/contract/source.json
 *
 * O que ele verifica, sem depender de navegador, build ou rede:
 *  1. blockHash == SHA-256 padrão (oráculo independente: node:crypto),
 *     com normalização CRLF/CR -> LF e prefixo "sha256:".
 *  2. parseSource aceita a fixture válida e rejeita schema errado,
 *     JSON inválido, materialId ausente, blocos ausentes/vazios e
 *     bloco sem blockId ou sem body.
 *  3. proposeForBlocks: blk_01 e blk_05 mudam (ABNT), blk_02 muda
 *     (scrubber), blk_03 e blk_04 não mudam; nenhum bloco sai
 *     bloqueado; hashMatchesSource é true em todos.
 *  4. preservationLoss detecta perda de número, fórmula, marcador
 *     [F#] e citação — a trava que protege o Zero-Tampering.
 *  5. buildReview: só entram patches alterados + não bloqueados +
 *     explicitamente autorizados; schema, sourceContract e
 *     materialId são preservados; humanValidationCarried é sempre
 *     false; cada patch carrega o beforeHash correto; sem nenhum
 *     patch autorizado, buildReview lança erro.
 *
 * Regra de ouro: qualquer mudança aqui que quebre deve travar o CI.
 * Adicionar campo novo ao review/1 é permitido SOMENTE se for
 * opcional; renomear ou remover campo existente quebra o contrato
 * e este script deve falhar.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  SOURCE_SCHEMA,
  REVIEW_SCHEMA,
  blockHash,
  parseSource,
  proposeForBlocks,
  preservationLoss,
  buildReview,
} from "../src/core/mathlabBridge.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = resolve(process.argv[2] || join(ROOT, "tests/fixtures/contract/source.json"));

let passes = 0;
const fails = [];
function check(name, cond, extra = "") {
  if (cond) {
    passes++;
    console.log("  ok  ", name);
  } else {
    fails.push(name);
    console.log("  FAIL", name, extra);
  }
}
function throws(name, fn, needle) {
  try {
    fn();
    check(name, false, "(não lançou erro)");
  } catch (e) {
    check(name, !needle || String(e.message).includes(needle), `(erro: ${e.message})`);
  }
}

// Oráculo independente: SHA-256 do Node, não o do núcleo.
const oracle = (body) =>
  "sha256:" + createHash("sha256").update(String(body ?? "").replace(/\r\n?/g, "\n"), "utf8").digest("hex");

const sourceText = readFileSync(FIXTURE, "utf8");
const source = JSON.parse(sourceText);

console.log("Contrato MathLab <-> ScriptaLab");
console.log("  fixture:", FIXTURE);

// 1. Hash ---------------------------------------------------------------
check("SOURCE_SCHEMA é mathlab.scriptalab-source/1", SOURCE_SCHEMA === "mathlab.scriptalab-source/1");
check("REVIEW_SCHEMA é scriptalab.review/1", REVIEW_SCHEMA === "scriptalab.review/1");
for (const b of source.blocks) {
  check(`blockHash(${b.blockId}) == SHA-256 padrão`, blockHash(b.body) === oracle(b.body));
  check(`beforeHash da fixture confere (${b.blockId})`, b.beforeHash === oracle(b.body));
}
check("blockHash('') == SHA-256 de string vazia", blockHash("") === oracle(""));
check("blockHash normaliza CRLF para LF", blockHash("a\r\nb") === blockHash("a\nb") && blockHash("a\rb") === blockHash("a\nb"));
check("blockHash com unicode e fórmula", blockHash("soma $x^2$ é 2 — café") === oracle("soma $x^2$ é 2 — café"));

// 2. parseSource ---------------------------------------------------------
const parsed = parseSource(sourceText);
check("parseSource aceita a fixture válida", parsed.materialId === "mat_contrato_001" && parsed.blocks.length === 5);
throws("parseSource rejeita JSON inválido", () => parseSource("{não json"), "JSON válido");
throws("parseSource rejeita schema errado", () => parseSource(JSON.stringify({ ...source, schema: "mathlab.scriptalab-source/2" })), SOURCE_SCHEMA);
throws("parseSource rejeita schema ausente", () => parseSource(JSON.stringify({ materialId: "x", blocks: source.blocks })), SOURCE_SCHEMA);
throws("parseSource rejeita sem materialId", () => parseSource(JSON.stringify({ schema: SOURCE_SCHEMA, blocks: source.blocks })), "materialId");
throws("parseSource rejeita blocos vazios", () => parseSource(JSON.stringify({ schema: SOURCE_SCHEMA, materialId: "x", blocks: [] })), "pelo menos 1 bloco");
throws("parseSource rejeita bloco sem blockId", () => parseSource(JSON.stringify({ schema: SOURCE_SCHEMA, materialId: "x", blocks: [{ body: "oi" }] })), "blockId");
throws("parseSource rejeita bloco sem body", () => parseSource(JSON.stringify({ schema: SOURCE_SCHEMA, materialId: "x", blocks: [{ blockId: "b1" }] })), "body");

// 3. proposeForBlocks ----------------------------------------------------
const props = proposeForBlocks(parsed);
const byId = Object.fromEntries(props.map((p) => [p.blockId, p]));
check("proposeForBlocks devolve 1 proposta por bloco", props.length === 5);
check("blk_01 muda (SILVA -> Silva, ABNT)", byId.blk_01.changed && byId.blk_01.after.includes("(Silva, 2023)") && !byId.blk_01.after.includes("(SILVA, 2023)"));
check("blk_01 não perde número nem ano", byId.blk_01.perdas.length === 0 && !byId.blk_01.blocked);
check("blk_02 muda (remove marca de IA)", byId.blk_02.changed && !byId.blk_02.after.includes("【"));
check("blk_02 preserva o número 42", byId.blk_02.after.includes("42") && byId.blk_02.perdas.length === 0);
check("blk_03 não muda", !byId.blk_03.changed && byId.blk_03.after === byId.blk_03.before);
check("blk_04 não muda e preserva a fórmula", !byId.blk_04.changed && byId.blk_04.after.includes("$x^2 + 1$"));
check("blk_05 muda (SOUZA -> Souza) apesar do CRLF", byId.blk_05.changed && byId.blk_05.after.includes("(Souza, 2020)"));
check("nenhuma proposta sai bloqueada na fixture", props.every((p) => !p.blocked));
check("hashMatchesSource é true em todos os blocos", props.every((p) => p.hashMatchesSource));
check("beforeHash de cada proposta é o hash do body original", props.every((p) => p.beforeHash === oracle(p.before)));

// 4. Trava de preservação ------------------------------------------------
check("preservationLoss detecta número perdido", preservationLoss("a soma é 42", "a soma é", "scrubber").join(" ").includes("42"));
check("preservationLoss detecta fórmula perdida", preservationLoss("vale $x^2$", "vale", "scrubber").join(" ").includes("fórmula"));
check("preservationLoss detecta marcador [F1] perdido", preservationLoss("ver [F1]", "ver", "scrubber").join(" ").includes("marcadores"));
check("preservationLoss detecta citação perdida (scrubber)", preservationLoss("segundo (SILVA, 2023)", "segundo", "scrubber").join(" ").includes("citações"));
check("preservationLoss não acusa quando nada se perde", preservationLoss("(SILVA, 2023) diz 42", "(Silva, 2023) diz 42", "abnt_10520").length === 0);

// 5. buildReview ---------------------------------------------------------
const meta = { profileId: "abnt-padrao-2023", now: new Date("2026-11-25T12:00:00.000Z") };
const review = buildReview(parsed, props, ["blk_01", "blk_02", "blk_03", "blk_04", "blk_05"], meta);
check("review.schema é scriptalab.review/1", review.schema === REVIEW_SCHEMA);
check("review.sourceContract é o schema de origem", review.sourceContract === SOURCE_SCHEMA);
check("review.materialId é preservado", review.materialId === "mat_contrato_001");
check("review.profileId é preservado", review.profileId === "abnt-padrao-2023");
check("review.generatedAt respeita meta.now", review.generatedAt === "2026-11-25T12:00:00.000Z");
check("humanValidationCarried é sempre false", review.humanValidationCarried === false);
check("só entram os 3 blocos alterados e autorizados", review.authorizedPatches.length === 3);
check("nenhum patch de bloco sem mudança (blk_03/blk_04)", review.authorizedPatches.every((p) => ["blk_01", "blk_02", "blk_05"].includes(p.blockId)));
check("cada patch carrega beforeHash correto", review.authorizedPatches.every((p) => p.beforeHash === oracle(byId[p.blockId].before)));
check("cada patch carrega o body revisado", review.authorizedPatches.every((p) => p.body === byId[p.blockId].after));
check("nenhum patch tem campo a mais que blockId/category/beforeHash/body", review.authorizedPatches.every((p) => Object.keys(p).sort().join(",") === "beforeHash,blockId,body,category"));
const reviewParcial = buildReview(parsed, props, ["blk_01"], meta);
check("autorização parcial só inclui o bloco marcado", reviewParcial.authorizedPatches.length === 1 && reviewParcial.authorizedPatches[0].blockId === "blk_01");
// Proposta bloqueada nunca entra, mesmo autorizada.
const bloqueada = { ...byId.blk_01, blocked: true, perdas: ["números (42)"] };
const reviewBloqueada = buildReview(parsed, [bloqueada, ...props.slice(1)], ["blk_01", "blk_02", "blk_05"], meta);
check("patch bloqueado é excluído mesmo autorizado", reviewBloqueada.authorizedPatches.every((p) => p.blockId !== "blk_01"));
throws("buildReview sem nenhuma autorização lança erro", () => buildReview(parsed, props, [], meta), "Nenhuma correção autorizada");
throws("buildReview só com bloco sem mudança lança erro", () => buildReview(parsed, props, ["blk_03"], meta), "Nenhuma correção autorizada");

console.log(`\n${passes} ok, ${fails.length} falha(s).`);
if (fails.length) {
  console.log("Falhas:");
  for (const f of fails) console.log(" -", f);
  process.exit(1);
}
console.log("Contrato OK: a ponte MathLab <-> ScriptaLab está preservada.");
