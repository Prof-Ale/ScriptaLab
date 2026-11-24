// Testes do núcleo (sem dependências): node --test tests/
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
let K;
test.before(async () => {
  ({ ScriptaCore: K } = await import("../src/core/index.js"));
});
const J = x => JSON.parse(JSON.stringify(x));

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

test("itálico: expressões latinas da NBR 10520:2023 (e Id. só dentro de citação)", () => {
  const t = "Veja (Assis, 1997 apud Canuto, 1999; Id., 2001) e Silva et al. (2020), Cf. Souza, ibid., p. 3, op. cit., loc. cit., passim, p. 10 et seq. O id freudiano não conta.";
  assert.deepEqual(J(t.match(K.LATIN_ITALIC)), ["apud","Id.","et al.","Cf.","ibid.","op. cit.","loc. cit.","passim","et seq."]);
});
test("ponto final: sinaliza ponto antes da citação e ponto dentro dos parênteses", () => {
  assert.equal(K.checkCitationPeriods("A tese avança no país. (Araújo, 2020).").before, 1);
  assert.equal(K.checkCitationPeriods("“Não se mova” (Clarac; Bonnin, 1985, p. 72.)").inside, 1);
  assert.equal(K.checkCitationPeriods("Correto (Clarac; Bonnin, 1985, p. 72). Outro (Bell et al., 2011).").total, 0);
  assert.equal(K.checkCitationPeriods("Ok (Silva et al., 2020 apud Souza et al.)").total, 0);
});

// ---------- Ponte com o MathLab App ----------
const crypto = require("node:crypto");
test("ponte: SHA-256 próprio confere com o do Node (vazio, acentos, emoji, bloco longo)", () => {
  for(const s of ["", "abc", "Área do triângulo: b·h/2 ≈ 3,5 ✓", "😀 emoji", "x".repeat(1000), "a".repeat(55), "a".repeat(56), "a".repeat(64)])
    assert.equal(K.sha256Hex(s), crypto.createHash("sha256").update(s, "utf8").digest("hex"));
});
test("ponte: blockHash normaliza CRLF para LF e leva o prefixo sha256:", () => {
  assert.equal(K.blockHash("a\r\nb"), K.blockHash("a\nb"));
  assert.match(K.blockHash("x"), /^sha256:[0-9a-f]{64}$/);
  assert.equal(K.blockHash("x"), "sha256:" + crypto.createHash("sha256").update("x").digest("hex"));
});
test("ponte: normalizeBlock limpa vestígios e não mexe em fórmulas nem usa NFKC", () => {
  const r = K.normalizeBlock("A área é $x^2 + 3​$ e vale 12 m² .​ Fonte【4:0†source】.");
  assert.ok(r.after.includes("$x^2 + 3​$"));          // dentro da fórmula, intocado
  assert.ok(r.after.includes("m²"));                        // NFKC não foi aplicado
  assert.ok(!r.after.includes("【"));
  assert.equal(r.category, "scrubber");
});
test("ponte: só citação em caixa alta vira abnt_10520; sigla permanece", () => {
  const r = K.normalizeBlock("Veja (SILVA, 2023) e (IBGE, 2022).");
  assert.equal(r.after, "Veja (Silva, 2023) e (IBGE, 2022).");
  assert.equal(r.category, "abnt_10520");
  assert.equal(K.normalizeBlock("Texto limpo.").changed, false);
});
test("ponte: trava de preservação acusa número, fórmula, marcador e citação perdidos", () => {
  assert.deepEqual(J(K.preservationLoss("tem 12 itens $a+b$ [F1] (Silva, 2023)", "tem 12 itens $a+b$ [F1] (Silva, 2023)", "scrubber")), []);
  const p = K.preservationLoss("tem 12 itens $a+b$ [F1] (Silva, 2023)", "tem itens", "scrubber");
  assert.equal(p.length, 4);
  assert.deepEqual(J(K.preservationLoss("(SILVA, 2023)", "(Silva, 2023)", "abnt_10520")), []);
  assert.equal(K.preservationLoss("(SILVA, 2023)", "(Silva)", "abnt_10520").length, 1);
});
const fonte = () => ({ schema:"mathlab.scriptalab-source/1", materialId:"mat_1", blocks:[
  { blockId:"b1", title:"Intro", body:"Segundo (SILVA, 2023), são 12 casos." },
  { blockId:"b2", title:"Limpo", body:"Nada a corrigir aqui." },
  { blockId:"b3", title:"Resíduo", body:"Texto com resíduo【4:0†source】 e a fórmula $x^2$." } ] });
test("ponte: parseSource recusa schema errado e bloco sem id", () => {
  assert.throws(() => K.parseSource("{"), /JSON válido/);
  assert.throws(() => K.parseSource(JSON.stringify({schema:"outro/1"})), /Esperado/);
  assert.throws(() => K.parseSource(JSON.stringify({schema:"mathlab.scriptalab-source/1", materialId:"m", blocks:[{body:"x"}]})), /blockId/);
});
test("ponte: buildReview leva só o autorizado, com beforeHash, e humanValidationCarried false", () => {
  const src = fonte(), props = K.proposeForBlocks(src);
  assert.deepEqual(J(props.map(p => p.changed)), [true, false, true]);
  const rev = K.buildReview(src, props, ["b1", "b2"], { profileId:"usp-abnt", now:new Date("2026-11-24T20:00:00Z") });
  assert.equal(rev.schema, "scriptalab.review/1");
  assert.equal(rev.humanValidationCarried, false);
  assert.equal(rev.authorizedPatches.length, 1);              // b2 não mudou, b3 não foi autorizado
  assert.equal(rev.authorizedPatches[0].blockId, "b1");
  assert.equal(rev.authorizedPatches[0].category, "abnt_10520");
  assert.equal(rev.authorizedPatches[0].beforeHash, K.blockHash(src.blocks[0].body));
  assert.equal(rev.authorizedPatches[0].body, "Segundo (Silva, 2023), são 12 casos.");
  assert.equal(rev.generatedAt, "2026-11-24T20:00:00.000Z");
  assert.throws(() => K.buildReview(src, props, ["b2"]), /Nenhuma correção/);
});

// ---------- Blocos 1, 2 e 3 (modularização ESM, diffEngine, NBR 6023/14724, estilometria profunda) ----------
test("scrubber: detecta e limpa artefatos de IA, Unicode invisível, UTM e quebra com hífen", () => {
  const raw = "Texto\u200B com tag【4:0†source】 e link https://x.org?utm_source=gpt e pala-\nvra.";
  assert.deepEqual(K.scanScrubIssues(raw), { invis: 1, aiTags: 1, utm: 1, hyphBreak: 1 });
  assert.equal(K.scrubText(raw), "Texto com tag e link https://x.org e palavra.");
});

test("diffEngine (Zero-Tampering): nenhuma proposta é aplicada sem aceite explícito", () => {
  const raw = "Segundo (SILVA, 2020) e (IBGE, 2021), o texto【1:0†src】 avança.\n\nREFERÊNCIAS\n\nSILVA, Ana. Obra. 2020.";
  const session = K.createReviewSession(raw);
  const summary = K.summarizeSession(session);
  assert.equal(summary.total, 2);
  assert.equal(summary.accepted, 0);
  assert.equal(K.renderSessionText(session), raw);
});

test("diffEngine: aceitar, rejeitar, desfazer e filtrar opções sem deslocar offsets", () => {
  const raw = "Segundo (SILVA, 2020), há nota【2:1†source】 e outro (SOUZA, 2019).";
  let s = K.createReviewSession(raw);
  const pTag = s.proposals.find((p) => p.category === "scrubber_ai_tag");
  const pSilva = s.proposals.find((p) => p.before.startsWith("SILVA"));
  const pSouza = s.proposals.find((p) => p.before.startsWith("SOUZA"));
  s = K.acceptProposal(s, pTag.id);
  s = K.rejectProposal(s, pSilva.id);
  s = K.acceptProposal(s, pSouza.id);
  assert.equal(K.renderSessionText(s), "Segundo (SILVA, 2020), há nota e outro (Souza, 2019).");
  s = K.undoLastAction(s);
  assert.equal(K.renderSessionText(s), "Segundo (SILVA, 2020), há nota e outro (SOUZA, 2019).");
  s = K.resetSession(s);
  assert.equal(K.renderSessionText(s), raw);
  const onlyAbnt = K.buildProposals("Veja (SILVA, 2020) com tag【1:0†src】 e https://x.org?utm_medium=ai.", { aiTags: false, utm: false, abntCitationCase: true });
  assert.equal(onlyAbnt.length, 1);
  assert.equal(onlyAbnt[0].category, "abnt_citation_case");
});

test("modularização: index.html importa ./src/core/index.js via ES module e preserva ponte e handlers", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.ok(html.includes('<script type="module" id="app">'));
  assert.ok(html.includes('import { ScriptaCore as C } from "./src/core/index.js"'));
  assert.ok(!html.includes('<script id="core">'));
  assert.ok(html.includes('id="diffPanel"'));
  assert.ok(html.includes('id="bridgeSection"'));
  for (const fn of ["loadIesProfile", "handleFileUpload", "markDirty", "runDiagnostic", "authorizeCorrections", "runStyle", "audit", "exportToDocx", "handleDiffAccept", "handleDiffReject", "handleDiffUndo"]) {
    assert.ok(html.includes(fn), `handler ${fn} ausente`);
  }
});

test("NBR 6023:2025: classifica tipos de obra e audita campos ausentes sem inventar metadados", () => {
  assert.equal(K.classifyReferenceType("BRASIL. Ministério da Educação. Base Nacional Comum Curricular. Brasília: MEC, 2018."), "legislacao");
  assert.equal(K.classifyReferenceType("SOUZA, M. Capítulo. In: SILVA, A. (org.). Livro. São Paulo: X, 2021."), "capitulo");
  assert.equal(K.classifyReferenceType("LIMA, C. Estudo. Revista Brasileira, v. 12, n. 2, p. 10-25, 2022."), "artigo");
  assert.equal(K.classifyReferenceType("COSTA, R. Ensino. 2020. Dissertação (Mestrado) – USP, São Paulo, 2020."), "tese");
  assert.equal(K.auditReferenceEntry("MANTOAN, M. T. E. Inclusão escolar. São Paulo: Moderna, 2015.").ok, true);
  const badCodes = K.auditReferenceEntry("silva, ana. Artigo sem ano. Disponível em: https://exemplo.org").issues.map((i) => i.code);
  assert.ok(badCodes.includes("ENTRY_CASE") && badCodes.includes("MISSING_YEAR") && badCodes.includes("MISSING_ACCESS_DATE"));
});

test("NBR 6023:2025: ordenação alfabética PT-BR, duplicadas e NBR 14724 legendas/notas", () => {
  const doc = [
    "Texto do artigo (VYGOTSKY, 1998).",
    "",
    "REFERÊNCIAS",
    "",
    "VYGOTSKY, L. S. A formação social da mente. São Paulo: Martins Fontes, 1998.",
    "ÁVILA, G. Análise matemática. São Paulo: Blucher, 2006.",
    "BRASIL. Lei nº 9.394, de 20 de dezembro de 1996. Brasília: MEC, 1996.",
    "ÁVILA, G. Análise matemática. São Paulo: Blucher, 2006."
  ].join("\n");
  const audit = K.auditReferencesSection(doc);
  assert.equal(audit.alreadySorted, false);
  assert.equal(audit.duplicates.length, 1);
  const sortedRes = K.formatReferencesSectionSorted(doc);
  const refsPart = sortedRes.text.slice(sortedRes.text.indexOf("REFERÊNCIAS"));
  assert.ok(refsPart.indexOf("ÁVILA") < refsPart.indexOf("BRASIL") && refsPart.indexOf("BRASIL") < refsPart.indexOf("VYGOTSKY"));
  assert.equal(K.isCaptionOrNote("Figura 1 – Esquema do DUA."), true);
  assert.equal(K.isCaptionOrNote("Fonte: Elaborado pelo autor (2026)."), true);
  assert.equal(K.isCaptionOrNote("A inclusão exige planejamento."), false);
});

test("Bloco 3: estilometria profunda, VoiceProfile, trava conceitual e prompt cirúrgico", () => {
  const robotic = [
    "Além disso, o processo é claro, objetivo e eficaz. O método é rápido, seguro e prático. O plano é justo, sólido e atual.",
    "",
    "Além disso, observe:",
    "- **Clareza:** explica.",
    "- **Rigor:** mantém.",
    "- **Alcance:** atende."
  ].join("\n");
  const codes = K.detectAiSyntaxPatterns(robotic).alerts.map((a) => a.code);
  assert.ok(codes.includes("EXCESSIVE_TRIADS") && codes.includes("BOLD_COLON_LISTS") && codes.includes("REPEATED_OPENERS"));

  const vp = K.buildVoiceProfile(["Ensinar pede escuta. Já testou isso em sala? Uma pergunta curta quebra a rigidez."], "Prof. Alê");
  assert.equal(vp.schema, "scriptalab.voice/1");
  const blocked = K.validateConceptualPreservation("Segundo Mantoan (2015), $a+b=c$ [F1] em 10.1000/abc.1.", "Texto genérico.");
  assert.equal(blocked.preserved, false);
  const prompt = K.buildLiteraryReviewPrompt("No cenário atual, vale ressaltar $x^2=4$.");
  assert.ok(prompt.prompt.includes("NÃO declare o texto como validado ou aprovado por humano"));
});

test("UI Bloco 2+3: painéis NBR 6023 (ordenação A-Z), VoiceProfile e Revisão Literária conectados em index.html", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  for (const id of [
    "refsAbntPanel", "btnSortRefs", "btnUndoSortRefs", "refsAbntList",
    "styleSyntaxBox", "voiceLiteraryPanel", "voiceSample", "voiceLabel", "voiceStatus",
    "literaryPromptOut", "literaryReturnIn", "btnCheckLiterary", "btnApplyLiterary", "literaryCheckOut"
  ]) {
    assert.ok(html.includes(`id="${id}"`), `elemento id="${id}" ausente em index.html`);
  }
  for (const fn of [
    "handleSortReferences", "handleUndoSortReferences",
    "calibrateVoiceProfile", "clearVoiceProfile",
    "generateLiteraryPrompt", "copyLiteraryPrompt",
    "validateLiteraryReturn", "applyValidatedLiteraryReturn"
  ]) {
    assert.ok(html.includes(fn), `handler ${fn} ausente em index.html`);
  }
});
