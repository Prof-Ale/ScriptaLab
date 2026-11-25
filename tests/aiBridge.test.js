/**
 * Teste da ponte de IA copiar-e-colar (node:test, zero dependências).
 *
 * Roda com:  node --test tests/aiBridge.test.js
 *
 * O que é travado aqui:
 *  - o prompt gerado traz o schema, o blockId, o trecho e as regras;
 *  - resposta malformada é recusada inteira (JSON, schema, campos,
 *    categoria, trecho inexistente/ambíguo, sugestão igual ao original);
 *  - sugestão que perde ou inventa conteúdo protegido nasce bloqueada
 *    e nunca chega às propostas;
 *  - só o que o humano aceita vira texto; pendente/rejeitado não muda nada;
 *  - a proposta final tem o formato antigo da ponte e o review/1 não
 *    ganha campo novo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  AI_SUGGESTION_SCHEMA,
  buildAiPrompt,
  extractJsonObject,
  validateAiResponse,
  parseAiResponse,
  aiSuggestionsToProposals,
  createAiReviewSession,
  aiSessionToBlockProposal,
} from "../src/core/aiBridge.js";
import { acceptProposal, rejectProposal, renderSessionText } from "../src/core/diffEngine.js";
import { parseSource, proposeForBlocks, buildReview, blockHash } from "../src/core/mathlabBridge.js";

const BODY =
  "No cenário atual, é importante destacar que a soma de 2 e 3 é 5, segundo (SILVA, 2023). Vale ressaltar que o método funciona em sala de aula.";
const BLOCK = { blockId: "blk_01", title: "Soma", body: BODY, beforeHash: blockHash(BODY) };
const fix = (name) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures/ai", name), "utf8");
const validText = fix("valid-response.json");
const blockedText = fix("blocked-response.json");

test("buildAiPrompt traz schema, blockId, trecho e regras de preservação", () => {
  const p = buildAiPrompt(BLOCK, { label: "Clichê detectado", rule: "NBR 10520:2023", detail: "Abertura com clichê." });
  assert.ok(p.includes(AI_SUGGESTION_SCHEMA));
  assert.ok(p.includes("blk_01"));
  assert.ok(p.includes(BODY));
  assert.ok(p.includes("Clichê detectado"));
  assert.ok(p.includes("NÃO remova, invente nem altere números"));
  assert.ok(p.includes('"category": "cliche"'));
  assert.ok(!p.includes("validado ou aprovado por humano") || p.includes("NÃO declare"));
});

test("extractJsonObject aceita cerca de código e texto ao redor", () => {
  const wrapped = "Claro! Segue:\n```json\n" + validText + "\n```\nEspero que ajude.";
  assert.equal(JSON.parse(extractJsonObject(wrapped)).schema, AI_SUGGESTION_SCHEMA);
  assert.throws(() => extractJsonObject("sem json aqui"), /sem JSON/);
  assert.throws(() => extractJsonObject('{"schema": "x"'), /incompleto/);
});

test("resposta válida passa, com 2 sugestões não bloqueadas", () => {
  const r = validateAiResponse(validText, BODY, "blk_01");
  assert.equal(r.ok, true, r.errors.join("; "));
  assert.equal(r.data.suggestions.length, 2);
  assert.ok(r.data.suggestions.every((s) => !s.blocked));
  assert.equal(parseAiResponse(validText, BODY, "blk_01").blockId, "blk_01");
});

test("resposta malformada é recusada inteira", () => {
  const cases = [
    ["JSON inválido", "{não json", /JSON|sem JSON/],
    ["schema errado", JSON.stringify({ schema: "scriptalab.ai-suggestion/2", blockId: "blk_01", suggestions: [{ id: "s1", category: "cliche", original: "x", suggested: "y" }] }), /Schema esperado/],
    ["campo desconhecido no topo", JSON.stringify({ schema: AI_SUGGESTION_SCHEMA, blockId: "blk_01", extra: 1, suggestions: [{ id: "s1", category: "cliche", original: "x", suggested: "y" }] }), /desconhecido/],
    ["sem blockId", JSON.stringify({ schema: AI_SUGGESTION_SCHEMA, suggestions: [{ id: "s1", category: "cliche", original: "x", suggested: "y" }] }), /blockId/],
    ["blockId de outro bloco", validText, /não é o bloco esperado/],
    ["sugestões vazias", JSON.stringify({ schema: AI_SUGGESTION_SCHEMA, blockId: "blk_01", suggestions: [] }), /pelo menos 1/],
    ["categoria fora do permitido", JSON.stringify({ schema: AI_SUGGESTION_SCHEMA, blockId: "blk_01", suggestions: [{ id: "s1", category: "rewrite", original: "x", suggested: "y" }] }), /category/],
    ["sugestão sem suggested", JSON.stringify({ schema: AI_SUGGESTION_SCHEMA, blockId: "blk_01", suggestions: [{ id: "s1", category: "cliche", original: "x" }] }), /suggested/],
    ["campo desconhecido na sugestão", JSON.stringify({ schema: AI_SUGGESTION_SCHEMA, blockId: "blk_01", suggestions: [{ id: "s1", category: "cliche", original: "x", suggested: "y", tone: "formal" }] }), /desconhecido/],
    ["id duplicado", JSON.stringify({ schema: AI_SUGGESTION_SCHEMA, blockId: "blk_01", suggestions: [{ id: "s1", category: "cliche", original: "No cenário atual", suggested: "Hoje" }, { id: "s1", category: "cliche", original: "Vale ressaltar", suggested: "Note" }] }), /duplicado/],
    ["original inexistente", JSON.stringify({ schema: AI_SUGGESTION_SCHEMA, blockId: "blk_01", suggestions: [{ id: "s1", category: "cliche", original: "trecho que não existe", suggested: "outro" }] }), /não foi encontrado/],
    ["suggested igual ao original", JSON.stringify({ schema: AI_SUGGESTION_SCHEMA, blockId: "blk_01", suggestions: [{ id: "s1", category: "cliche", original: "Vale ressaltar", suggested: "Vale ressaltar" }] }), /igual/],
  ];
  for (const [name, text, re] of cases) {
    const r = name === "blockId de outro bloco" ? validateAiResponse(text, BODY, "blk_99") : validateAiResponse(text, BODY, "blk_01");
    assert.equal(r.ok, false, name + " deveria ser recusada");
    assert.equal(r.data, null, name);
    assert.match(r.errors.join(" "), re, name);
    assert.throws(() => parseAiResponse(text, BODY, name === "blockId de outro bloco" ? "blk_99" : "blk_01"), /recusada/, name);
  }
});

test("original ambíguo é recusado", () => {
  const body = "O método funciona. O método funciona de novo.";
  const text = JSON.stringify({ schema: AI_SUGGESTION_SCHEMA, blockId: "b", suggestions: [{ id: "s1", category: "variation", original: "O método funciona", suggested: "O método opera" }] });
  const r = validateAiResponse(text, body, "b");
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /ambíguo/);
});

test("sugestão que perde número e citação nasce bloqueada, sem invalidar a outra", () => {
  const r = validateAiResponse(blockedText, BODY, "blk_01");
  assert.equal(r.ok, true, r.errors.join("; "));
  const [s1, s2] = r.data.suggestions;
  assert.equal(s1.blocked, false);
  assert.equal(s2.blocked, true);
  assert.ok(s2.perdas.join(" ").includes("2") || s2.perdas.join(" ").includes("números"));
  assert.ok(r.warnings.length >= 1);
  const props = aiSuggestionsToProposals(r.data, BODY);
  assert.equal(props.length, 1);
  assert.equal(props[0].id, "s1");
});

test("sugestão que inventa número ou citação é bloqueada", () => {
  const invented = JSON.stringify({
    schema: AI_SUGGESTION_SCHEMA, blockId: "blk_01",
    suggestions: [{ id: "s1", category: "variation", original: "Vale ressaltar que o método funciona em sala de aula.", suggested: "Vale ressaltar que o método funciona em 42 escolas, segundo (SOUZA, 2020)." }],
  });
  const r = validateAiResponse(invented, BODY, "blk_01");
  assert.equal(r.ok, true);
  assert.equal(r.data.suggestions[0].blocked, true);
  assert.match(r.data.suggestions[0].perdas.join(" "), /inventado/);
});

test("sugestão que perde fórmula é bloqueada", () => {
  const body = "A fórmula $x^2 + 1$ vale 2 quando x é 1.";
  const text = JSON.stringify({
    schema: AI_SUGGESTION_SCHEMA, blockId: "b",
    suggestions: [{ id: "s1", category: "variation", original: "A fórmula $x^2 + 1$ vale 2 quando x é 1.", suggested: "A fórmula vale 2." }],
  });
  const r = validateAiResponse(text, body, "b");
  assert.equal(r.data.suggestions[0].blocked, true);
});

test("diff item a item: só o aceito muda o texto", () => {
  const data = parseAiResponse(validText, BODY, "blk_01");
  let session = createAiReviewSession(data, BODY);
  assert.equal(session.proposals.length, 2);
  assert.ok(session.proposals.every((p) => p.status === "pending"));
  session = acceptProposal(session, "s1");
  session = rejectProposal(session, "s2");
  const out = renderSessionText(session);
  assert.ok(out.startsWith("Hoje, vale notar que"));
  assert.ok(out.includes("Vale ressaltar que o método funciona em sala de aula."));
  assert.ok(!out.includes("No cenário atual"));
});

test("fim a fim na ponte: sugestão aceita vira authorizedPatch no formato antigo", () => {
  const source = { schema: "mathlab.scriptalab-source/1", materialId: "mat_001", blocks: [BLOCK] };
  const parsed = parseSource(JSON.stringify(source));
  const bridgeProps = proposeForBlocks(parsed);
  assert.equal(bridgeProps[0].changed, true); // a ponte normal corrige SILVA -> Silva; a IA não toca nisso
  assert.ok(bridgeProps[0].after.includes("(Silva, 2023)"));

  const data = parseAiResponse(validText, BODY, "blk_01");
  let session = createAiReviewSession(data, BODY);
  session = acceptProposal(session, "s1");
  session = acceptProposal(session, "s2");
  const aiProp = aiSessionToBlockProposal(BLOCK, session);
  assert.equal(aiProp.category, "style_human_approved");
  assert.equal(aiProp.changed, true);
  assert.equal(aiProp.blocked, false);
  assert.equal(aiProp.beforeHash, blockHash(BODY));
  assert.equal(aiProp.hashMatchesSource, true);
  assert.deepEqual(Object.keys(aiProp).sort(), ["after", "before", "beforeHash", "blockId", "blocked", "category", "changed", "counts", "hashMatchesSource", "perdas", "title"]);

  const review = buildReview(parsed, [aiProp], ["blk_01"], { profileId: "abnt-padrao-2023", now: new Date("2026-11-25T12:00:00.000Z") });
  assert.equal(review.schema, "scriptalab.review/1");
  assert.equal(review.humanValidationCarried, false);
  assert.equal(review.authorizedPatches.length, 1);
  const patch = review.authorizedPatches[0];
  assert.deepEqual(Object.keys(patch).sort(), ["beforeHash", "blockId", "body", "category"]);
  assert.equal(patch.body, renderSessionText(session));
  assert.ok(patch.body.startsWith("Hoje, vale notar que"));
  assert.ok(patch.body.includes("O método funciona em sala de aula."));
  // O review/1 não ganhou campo novo por causa da IA.
  assert.deepEqual(Object.keys(review).sort(), ["abntSummary", "authorizedPatches", "generatedAt", "humanValidationCarried", "materialId", "profileId", "schema", "sourceContract", "stylometrySummary"]);
});

test("nada aceito: a proposta não muda e o buildReview recusa o pacote vazio", () => {
  const data = parseAiResponse(validText, BODY, "blk_01");
  const session = createAiReviewSession(data, BODY);
  const aiProp = aiSessionToBlockProposal(BLOCK, session);
  assert.equal(aiProp.changed, false);
  const source = { schema: "mathlab.scriptalab-source/1", materialId: "mat_001", blocks: [BLOCK] };
  assert.throws(() => buildReview(parseSource(JSON.stringify(source)), [aiProp], ["blk_01"], {}), /Nenhuma correção autorizada/);
});
