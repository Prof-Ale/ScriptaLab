/**
 * Ponte de IA para português (scriptalab.pt-suggestion/1) — testes.
 * Garante: contrato próprio, recusa de resposta malformada, trava de preservação,
 * diff item a item e que o contrato antigo (ai-suggestion/1) segue igual.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ScriptaCore as C } from "../src/core/index.js";

const body = "Segundo Silva (2020), os dados foram coletados em 2019. As vezes eles tem dúvidas sobre a fórmula $x^2$.";
const resp = (suggestions, extra = {}) => JSON.stringify({ schema: C.PT_SUGGESTION_SCHEMA, blockId: "b1", suggestions, ...extra });

test("prompt traz regras, trecho, achados locais e o schema", () => {
  const achados = C.analisarPortugues(body).achados;
  const p = C.buildPtPrompt({ blockId: "b1", body }, { registro: "didatico", achados });
  assert.match(p, /scriptalab\.pt-suggestion\/1/);
  assert.match(p, /Didático/);
  assert.ok(p.includes(body));
  assert.match(p, /NÃO mexa em trechos entre aspas/);
  assert.match(p, /"crase"/);
});

test("resposta válida vira proposta pendente; nada muda até aceitar", () => {
  const r = C.validatePtResponse(resp([
    { id: "p1", category: "crase", original: "As vezes", suggested: "Às vezes", reason: "locução adverbial" },
    { id: "p2", category: "concordancia", original: "eles tem", suggested: "eles têm" },
  ]), body, "b1");
  assert.equal(r.ok, true, r.errors.join(";"));
  const s = C.createPtReviewSession(r.data, body);
  assert.equal(s.proposals.length, 2);
  assert.equal(C.renderSessionText(s), body);
  const s2 = C.acceptProposal(s, "p1");
  assert.match(C.renderSessionText(s2), /Às vezes eles tem/);
  assert.equal(s.proposals[0].category, "pt_ai_crase");
});

test("trava: sugestão que mexe em número, citação ou fórmula nasce bloqueada", () => {
  const r = C.validatePtResponse(resp([
    { id: "a", category: "clareza", original: "em 2019", suggested: "em 2018" },
    { id: "b", category: "clareza", original: "Silva (2020)", suggested: "Silva" },
    { id: "c", category: "ortografia", original: "$x^2$", suggested: "$x^3$" },
    { id: "d", category: "crase", original: "As vezes", suggested: "Às vezes" },
  ]), body, "b1");
  assert.equal(r.ok, true);
  const bloqueadas = r.data.suggestions.filter((s) => s.blocked).map((s) => s.id);
  assert.deepEqual(bloqueadas, ["a", "b", "c"]);
  assert.equal(C.ptSuggestionsToProposals(r.data, body).length, 1);
});

test("recusa: schema errado, categoria fora, campo extra, original ausente ou ambíguo, blockId trocado", () => {
  const casos = [
    [JSON.stringify({ schema: "scriptalab.ai-suggestion/1", blockId: "b1", suggestions: [{ id: "x", category: "crase", original: "As vezes", suggested: "Às vezes" }] }), /Schema esperado/],
    [resp([{ id: "x", category: "cliche", original: "As vezes", suggested: "Às vezes" }]), /category/],
    [resp([{ id: "x", category: "crase", original: "As vezes", suggested: "Às vezes", extra: 1 }]), /desconhecido/],
    [resp([{ id: "x", category: "crase", original: "inexistente", suggested: "outra" }]), /não foi encontrado/],
    [resp([{ id: "x", category: "clareza", original: "os", suggested: "as" }]), /ambíguo|não foi encontrado/],
    [resp([{ id: "x", category: "crase", original: "As vezes", suggested: "Às vezes" }], { blockId: "outro" }), /não é o bloco esperado/],
    ["isto não é json", /sem JSON/i],
  ];
  for (const [txt, re] of casos) {
    const r = C.validatePtResponse(txt, body, "b1");
    assert.equal(r.ok, false, String(txt).slice(0, 60));
    assert.match(r.errors.join(" "), re);
  }
  assert.throws(() => C.parsePtResponse("{}", body, "b1"), /recusada/);
});

test("aceita resposta dentro de cerca de código markdown", () => {
  const txt = "```json\n" + resp([{ id: "p1", category: "crase", original: "As vezes", suggested: "Às vezes" }]) + "\n```";
  assert.equal(C.validatePtResponse(txt, body, "b1").ok, true);
});

test("sobreposição de sugestões é recusada ao montar o diff", () => {
  const r = C.validatePtResponse(resp([
    { id: "p1", category: "crase", original: "As vezes eles", suggested: "Às vezes eles" },
    { id: "p2", category: "crase", original: "vezes eles tem", suggested: "vezes eles têm" },
  ]), body, "b1");
  assert.equal(r.ok, true);
  assert.throws(() => C.ptSuggestionsToProposals(r.data, body), /sobrepõe/);
});

test("contrato antigo ai-suggestion/1 continua igual (regressão)", () => {
  const ok = C.validateAiResponse(JSON.stringify({ schema: "scriptalab.ai-suggestion/1", blockId: "b1", suggestions: [{ id: "s", category: "cliche", original: "As vezes", suggested: "Por vezes" }] }), body, "b1");
  assert.equal(ok.ok, true);
  const no = C.validateAiResponse(JSON.stringify({ schema: "scriptalab.ai-suggestion/1", blockId: "b1", suggestions: [{ id: "s", category: "crase", original: "As vezes", suggested: "Às vezes" }] }), body, "b1");
  assert.equal(no.ok, false);
  assert.match(no.errors.join(" "), /"cliche", "variation"/);
});
