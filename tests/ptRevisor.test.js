/**
 * Revisor de português — testes (node:test).
 *
 * 1. Cada regra de src/core/rules/ptbr.json traz um exemplo "ruim" e um "bom":
 *    o ruim TEM que disparar a regra, o bom NÃO pode.
 * 2. Zero-Tampering: analisar nunca altera o texto; propostasPortugues só traz
 *    correção determinística e dentro de trechos que não são protegidos.
 * 3. Trechos protegidos (aspas, fórmulas, URLs, citações, referências) não geram achado.
 * 4. Registro muda severidade/limite.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ScriptaCore as C } from "../src/core/index.js";

const regras = C.PT_REGRAS;

test("ptbr.json: ids únicos, severidade válida e exemplos presentes", () => {
  const ids = new Set();
  for (const r of regras) {
    assert.ok(!ids.has(r.id), `id duplicado: ${r.id}`);
    ids.add(r.id);
    assert.ok(r.msg && r.padrao && r.ruim && r.bom, `regra incompleta: ${r.id}`);
    for (const [reg, sev] of Object.entries(r.sev)) {
      assert.ok(C.PT_REGISTROS[reg], `${r.id}: registro desconhecido ${reg}`);
      assert.ok(C.PT_SEVERIDADES[sev], `${r.id}: severidade desconhecida ${sev}`);
    }
    if (typeof r.fix === "string") assert.ok(r.fix !== r.ruim, `${r.id}: fix inútil`);
  }
  assert.ok(regras.length >= 45);
});

for (const r of regras) {
  const registro = Object.keys(r.sev)[0];
  test(`regra ${r.id}: ruim dispara, bom não`, () => {
    const ruim = C.analisarPortugues(r.ruim, { registro }).achados.filter((a) => a.regra === r.id);
    assert.ok(ruim.length >= 1, `deveria disparar em: ${r.ruim}`);
    const bom = C.analisarPortugues(r.bom, { registro }).achados.filter((a) => a.regra === r.id);
    assert.equal(bom.length, 0, `não deveria disparar em: ${r.bom}`);
    if (typeof r.fix === "string") {
      const props = C.propostasPortugues(r.ruim, { registro }).filter((p) => p.label.includes(r.msg));
      assert.ok(props.length >= 1, "regra com fix tem que gerar proposta");
    }
  });
}

test("correção segura aplicada ao 'ruim' reproduz o 'bom' nas regras de fix simples", () => {
  const casos = ["e-etc", "a-partir", "eles-tem", "eles-vem", "entre-eu", "menas", "apesar-que", "enquanto-que", "a-fim-de"];
  for (const id of casos) {
    const r = regras.find((x) => x.id === id);
    const registro = Object.keys(r.sev)[0];
    const s = C.createReviewSession(r.ruim, C.propostasPortugues(r.ruim, { registro }));
    const out = C.renderSessionText(C.acceptAllProposals(s));
    assert.equal(out, r.bom, id);
  }
});

test("Zero-Tampering: analisar não altera o texto e proposta pendente não muda nada", () => {
  const t = "Eles tem razão , e etc. As vezes também.";
  const copia = String(t);
  const a = C.analisarPortugues(t);
  assert.equal(t, copia);
  assert.ok(a.achados.length >= 3);
  const s = C.createReviewSession(t, C.propostasPortugues(t));
  assert.equal(C.renderSessionText(s), t);
  const r = C.rejectProposal(s, s.proposals[0].id);
  assert.equal(C.renderSessionText(r), t);
});

test("trechos protegidos: aspas, fórmula, URL, DOI, citação e referências não geram achado", () => {
  const t = [
    'Segundo o autor, "eles tem razão as vezes" é a frase original.',
    "A fórmula $a  +  b = c$ vale.",
    "Veja https://exemplo.com/a?b=1 e o DOI 10.1000/xyz123 no texto.",
    "",
    "REFERÊNCIAS",
    "SILVA, J. Eles tem razão. São Paulo: Ed., 2020.",
  ].join("\n");
  const a = C.analisarPortugues(t);
  assert.deepEqual(a.achados.filter((x) => x.kind === "regra"), []);
});

test("citação ABNT no corpo não vira ortografia nem regra", () => {
  const dic = fakeChecker();
  const a = C.analisarPortugues("A tese (SILVA, 2020) mostra o resultado.", { verificador: dic });
  assert.equal(a.achados.filter((x) => x.kind === "ortografia" && /silva/i.test(x.trecho)).length, 0);
});

function fakeChecker() {
  const ok = new Set(["a", "tese", "mostra", "o", "resultado", "de", "para", "texto"]);
  return { correct: (w) => ok.has(w.toLowerCase()), suggest: () => [], has: (w) => ok.has(w.toLowerCase()), addWord() {} };
}

test("registro: divulgação aceita período mais curto que acadêmico", () => {
  const frase = Array.from({ length: 40 }, (_, i) => "palavra" + (i % 3 ? "x" : "y")).join(" ") + ".";
  const acad = C.analisarPortugues(frase, { registro: "academico" }).achados.filter((a) => a.regra === "periodo-longo");
  const div = C.analisarPortugues(frase, { registro: "divulgacao" }).achados.filter((a) => a.regra === "periodo-longo");
  assert.equal(acad.length, 0);
  assert.equal(div.length, 1);
  assert.equal(div[0].severidade, "estilo");
});

test("registro: coloquialismo é aviso no acadêmico e nada na divulgação", () => {
  const t = "Pra a gente concluir isso.";
  const acad = C.analisarPortugues(t, { registro: "academico" }).achados.filter((a) => a.categoria === "registro");
  const div = C.analisarPortugues(t, { registro: "divulgacao" }).achados.filter((a) => a.categoria === "registro");
  assert.ok(acad.length >= 1);
  assert.equal(div.length, 0);
});

test("medidor: gerúndios encadeados e passiva em série", () => {
  const g = C.analisarPortugues("Realizando a coleta, analisando os dados e interpretando os resultados, concluímos o estudo.");
  assert.ok(g.achados.some((a) => a.regra === "gerundio-encadeado"));
  const p = C.analisarPortugues("O texto foi escrito pelo autor. Os dados foram coletados em campo. A amostra foi selecionada ao acaso. O teste foi aplicado em sala.", { registro: "academico" });
  assert.ok(p.achados.some((a) => a.regra === "passiva-em-serie"));
});

test("medidor: palavras terminadas em -ndo que não são gerúndio não contam", () => {
  const r = C.analisarPortugues("O mundo grande e profundo mudou segundo o comando, quando o fundo cedeu e o redondo caiu.");
  assert.equal(r.metricas.gerundios, 0);
});

test("medidor: repetição próxima de palavra de conteúdo", () => {
  const r = C.analisarPortugues("O modelo preditivo funciona bem. O modelo preditivo também escala.");
  assert.ok(r.achados.some((a) => a.regra === "repeticao-proxima"));
  const ok = C.analisarPortugues("A pesquisa mostrou que a pesquisa cresce, e o estudo também.");
  assert.equal(ok.achados.filter((a) => a.regra === "repeticao-proxima").length, 0, "termos do tema ficam na lista de exceção");
});

test("medidor: parênteses desbalanceados e aspas mistas", () => {
  const r = C.analisarPortugues('Texto com (parêntese aberto. Depois "retas" e “curvas”.');
  assert.ok(r.achados.some((a) => a.regra === "parenteses"));
  assert.ok(r.achados.some((a) => a.regra === "aspas-mistas"));
});

test("medidor: mistura de 1ª pessoa só no acadêmico/didático", () => {
  const t = "Eu analisei os dados e nós concluímos que meu método e nosso método coincidem.";
  assert.ok(C.analisarPortugues(t, { registro: "academico" }).achados.some((a) => a.regra === "pessoa-mista"));
  assert.ok(!C.analisarPortugues(t, { registro: "divulgacao" }).achados.some((a) => a.regra === "pessoa-mista"));
});

test("resumo: contagens batem com os achados", () => {
  const a = C.analisarPortugues("Eles tem razão , as vezes.");
  const s = a.resumo;
  assert.equal(s.total, a.achados.length);
  assert.equal(s.porSeveridade.erro + s.porSeveridade.aviso + s.porSeveridade.estilo, s.total);
  assert.match(C.resumoPortugues(a), /achado\(s\)/);
});

test("entrada vazia ou estranha não quebra", () => {
  for (const t of ["", "   ", "\n\n", null, undefined, "😀😀", "a".repeat(5000)]) {
    const r = C.analisarPortugues(t);
    assert.ok(Array.isArray(r.achados));
  }
});

test("desempenho: 60 mil palavras em poucos segundos", () => {
  const par = "A pesquisa foi realizada em campo, e os dados foram analisados com cuidado pela equipe responsável. ";
  const t = par.repeat(4000);
  const t0 = Date.now();
  C.analisarPortugues(t);
  assert.ok(Date.now() - t0 < 8000, "demorou " + (Date.now() - t0) + "ms");
});

test("corpus dourado de português: achados e métricas por registro", async () => {
  const { readFileSync } = await import("node:fs");
  const { auditarPt } = await import("../tools/gerar-dourado-pt.mjs");
  const esperado = JSON.parse(readFileSync(new URL("./fixtures/golden/esperado-pt.json", import.meta.url), "utf8"));
  assert.deepEqual(auditarPt(), esperado);
  assert.equal(C.PTBR_RULES_VERSION, 1);
});

test("corpus dourado: nada dentro de aspas ou das REFERÊNCIAS vira achado", async () => {
  const { readFileSync } = await import("node:fs");
  const t = readFileSync(new URL("./fixtures/golden/trecho-pt.txt", import.meta.url), "utf8");
  const a = C.analisarPortugues(t);
  const iAspas = t.indexOf('"eles tem razão as vezes"');
  const iRefs = t.indexOf("REFERÊNCIAS");
  for (const f of a.achados.filter((x) => x.kind === "regra")) {
    assert.ok(!(f.start >= iAspas && f.start < iAspas + 26), "achado dentro das aspas");
    assert.ok(f.start < iRefs, "achado nas referências");
  }
});
