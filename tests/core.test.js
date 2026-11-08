// Testes do núcleo (sem dependências): node --test tests/
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("fs"), path = require("path"), vm = require("vm");
const html = fs.readFileSync(path.join(__dirname,"..","index.html"),"utf8");
const src = html.match(/<script id="core">([\s\S]*?)<\/script>/)[1];
const ctx = {}; vm.createContext(ctx); vm.runInContext(src, ctx);
const K = ctx.ScriptaCore;
const J = x => JSON.parse(JSON.stringify(x));   // arrays do contexto vm têm outro protótipo

test("segmentação: abreviações, iniciais e decimais não quebram o período", () => {
  const s = K.splitSentences("Segundo Mantoan (2015, p. 34), a inclusão avança. J. K. Rowling vendeu 3,5 milhões de livros. Veja a Fig. 3 e depois o texto. Fim!");
  assert.equal(s.length, 4);
});
test("segmentação: et al. com vírgula e parágrafos separados", () => {
  const s = K.splitSentences("Gatti et al. (2021) afirmam isso.\n\nOutro parágrafo curto.");
  assert.equal(s.length, 2);
});
test("CV: população uniforme tem CV 0; amostra única é null", () => {
  assert.equal(K.sentenceStats([ "a b c", "d e f", "g h i" ]).cv, 0);
  assert.equal(K.sentenceStats(["a b c"]).cv, null);
});
test("CV: valores conhecidos (σ populacional)", () => {
  // comprimentos 2, 4, 4, 4, 5, 5, 7, 9 → média 5, σ 2 → CV 40
  const lens = [2,4,4,4,5,5,7,9], sents = lens.map(n=>Array(n).fill("palavra").join(" "));
  const st = K.sentenceStats(sents);
  assert.equal(st.mean, 5); assert.equal(st.sd, 2); assert.equal(Math.round(st.cv), 40);
});
test("radar: encontra clichês sem alterar o texto de entrada", () => {
  const t = "No cenário atual, é importante destacar que a educação evolui. Nesse sentido, vale ressaltar o papel.";
  const before = t, m = K.findCliches(t);
  assert.equal(t, before);
  const ids = m.map(x=>x.id);
  assert.ok(ids.includes("cenario-atual") && ids.includes("e-importante") && ids.includes("nesse-sentido") && ids.includes("vale-ressaltar"));
});
test("radar: 'é' acentuado no início do padrão é reconhecido; palavras parecidas não", () => {
  assert.equal(K.findCliches("É inegável que sim.").length, 1);
  assert.equal(K.findCliches("Pensamos nesse sentidos distintos.").length, 0);
});
test("radar: sem sobreposição e destaque escapa HTML", () => {
  const t = "<b>Em suma</b>, é crucial destacar isto.";
  const h = K.highlightHtml(t, K.findCliches(t));
  assert.ok(h.includes("&lt;b&gt;") && h.includes('<mark class="cl"'));
});
test("siglas: IBGE mantém caixa alta; sobrenome comum não é sigla", () => {
  assert.equal(K.isSigla("IBGE"), true); assert.equal(K.isSigla("SILVA"), false);
});
test("expressões latinas e uniformidade de et al. (NBR 10520:2023)", () => {
  assert.deepEqual(J("Conforme Silva et al. (2020) apud Souza (2022).".match(K.LATIN_ITALIC)), ["et al.", "apud"]);
  const u1 = K.checkEtAlUniformity("Texto (Silva et al., 2020) e (Souza; Lima; Costa; Santos, 2021).");
  assert.equal(u1.mixed, true);
  const u2 = K.checkEtAlUniformity("Texto (Silva et al., 2020) e (Souza et al., 2021).");
  assert.equal(u2.mixed, false);
});
test("citações: coleta parentética e narrativa, sem duplicar", () => {
  const c = K.collectCitations("Como (MANTOAN, 2015, p. 34) e Mantoan (2015) e (GATTI et al., 2021) e (IBGE, 2020).");
  assert.equal(c.length, 3); assert.equal(c.find(x=>x.sur==="IBGE").sigla, true);
});
test("referências: detecta citação sem referência e referência sem citação", () => {
  const t = "Texto (SILVA, 2020) e (SOUZA, 2019).\n\nREFERÊNCIAS\n\nSILVA, Ana. Título. São Paulo: X, 2020.\nLIMA, Bruno. Outro. Rio: Y, 2018.";
  const x = K.crossCheckRefs(t);
  assert.equal(x.has, true);
  assert.deepEqual(J(x.missing.map(c=>c.sur)), ["SOUZA"]);
  assert.equal(x.uncited.length, 1);
});
test("referências: sem título REFERÊNCIAS, não conclui nada", () => {
  assert.equal(K.crossCheckRefs("Texto (SILVA, 2020).").has, false);
});
test("DOIs: extrai, tira pontuação final e deduplica sem diferenciar caixa", () => {
  const d = K.extractDois("Veja 10.1000/ABC.1, e https://doi.org/10.1000/abc.1). Também 10.5555/xyz;");
  assert.deepEqual(J(d), ["10.1000/ABC.1","10.5555/xyz"]);
});
test("DOI × referência: coerente e divergente", () => {
  const ok = "SILVA, Ana. Aprendizagem de matemática com jogos digitais. Revista X, 2020. DOI 10.1000/abc.";
  assert.equal(K.compareRef(K.refBlockFor(ok,"10.1000/abc"), {title:"Aprendizagem de matemática com jogos digitais", family:"Silva", year:2020}).verdict, "coerente");
  const bad = "SILVA, Ana. Aprendizagem de matemática com jogos digitais. Revista X, 2020. DOI 10.1000/abc.";
  assert.equal(K.compareRef(bad, {title:"Quantum chromodynamics lattice simulations", family:"Nakamura", year:2011}).verdict, "divergente");
});
test("modelos de IES: JSON dos clichês coincide com o padrão embutido", () => {
  const f = path.join(__dirname,"..","data","cliches-ptbr.json");
  if(!fs.existsSync(f)) return;
  const j = JSON.parse(fs.readFileSync(f,"utf8"));
  assert.deepEqual(j.items.map(x=>x.id), J(K.CLICHES_DEFAULT.map(x=>x.id)));
});
