#!/usr/bin/env node
/**
 * CLI do núcleo ScriptaLab — `npx scriptalab ...` / `scriptalab ...`.
 *
 * Não é um fork: o CLI chama as MESMAS funções do src/core/index.js
 * que a página usa. Nada aqui reimplementa regra nenhuma.
 *
 *   scriptalab auditar <arquivo.txt> [--json]
 *     Diagnóstico local: palavras, períodos, CV, clichês, marcas de
 *     IA, citações × referências e auditoria da lista (NBR 6023).
 *   scriptalab ponte <source.mathlab.json> [--autorizar blk_01,blk_02] [--perfil abnt-padrao-2023] [--saida review.json]
 *     Valida o source da ponte (mathlab.scriptalab-source/1), propõe
 *     por bloco e emite o review (scriptalab.review/1) com só o que
 *     foi autorizado — as mesmas parseSource/proposeForBlocks/
 *     buildReview do núcleo, com a mesma trava de preservação.
 *   scriptalab portugues <arquivo.txt> [--registro academico|didatico|divulgacao] [--ortografia] [--json]
 *     Revisão de português local: regras como dados (pontuação, crase,
 *     regência, concordância, vícios, pleonasmos), medidores (gerúndio,
 *     período longo, repetição, passiva, pessoa) e, com --ortografia,
 *     o dicionário pt-BR offline. Só sinaliza; não altera o arquivo.
 *   scriptalab regras
 *     Mostra as versões das regras como dados (rules/*.json).
 *   scriptalab versao
 *
 * Saída padrão é JSON (auditar/ponte) para encadear com outras
 * ferramentas; erros vão para stderr com exit 1.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { ScriptaCore as C } from "./index.js";
import pkg from "./package.json" with { type: "json" };

const usage = `Uso:
  scriptalab auditar <arquivo.txt> [--json]
  scriptalab ponte <source.mathlab.json> [--autorizar blk_01,blk_02] [--perfil <id>] [--saida <review.json>]
  scriptalab portugues <arquivo.txt> [--registro academico|didatico|divulgacao] [--ortografia] [--json]
  scriptalab regras
  scriptalab versao`;

function fail(msg) {
  process.stderr.write("scriptalab: " + msg + "\n");
  process.exit(1);
}

function flag(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}

function auditar(file, asJson) {
  let text;
  try { text = readFileSync(file, "utf8"); } catch (e) { fail("não consegui ler " + file + ": " + e.message); }
  const sentences = C.splitSentences(text);
  const stats = C.sentenceStats(sentences);
  const refs = C.splitReferences(text);
  const report = {
    arquivo: file,
    palavras: C.countWords(text),
    caracteres: text.length,
    periodos: { n: stats.n, media: stats.mean, cv: stats.cv, banda: C.cvBand(stats.cv) },
    cliches: (() => {
      const byId = new Map();
      for (const c of C.findCliches(text)) {
        const e = byId.get(c.id) || { id: c.id, label: c.label, ocorrencias: 0 };
        e.ocorrencias++;
        byId.set(c.id, e);
      }
      return [...byId.values()];
    })(),
    marcasIA: C.scanScrubIssues(text),
    citacoes: C.collectCitations(refs.body).map((c) => ({ nome: c.name, ano: c.year })),
    referencias: C.auditReferencesSection(text),
  };
  if (asJson) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  else {
    process.stdout.write(
      `${file}: ${report.palavras} palavras, ${report.periodos.n} períodos, CV ${report.periodos.cv === null ? "—" : Math.round(report.periodos.cv)} (${report.periodos.banda})\n` +
      `Clichês: ${report.cliches.length ? report.cliches.map((c) => `${c.label} (${c.ocorrencias}x)`).join("; ") : "nenhum"}\n` +
      `Marcas de IA: invisíveis ${report.marcasIA.invis} · tags ${report.marcasIA.aiTags} · utm ${report.marcasIA.utm} · hífens ${report.marcasIA.hyphBreak}\n` +
      `Citações: ${report.citacoes.length} · Referências: ${report.referencias.total} (${report.referencias.withIssuesCount} com problema)\n`
    );
  }
}

function ponte(file, opts) {
  let raw;
  try { raw = readFileSync(file, "utf8"); } catch (e) { fail("não consegui ler " + file + ": " + e.message); }
  let source;
  try { source = C.parseSource(raw); } catch (e) { fail("source inválido: " + e.message); }
  const proposals = C.proposeForBlocks(source);
  const authorized = (opts.autorizar || "").split(",").map((s) => s.trim()).filter(Boolean);
  const review = C.buildReview(source, proposals, authorized, {
    profileId: opts.perfil || "abnt-padrao-2023",
    now: new Date(),
  });
  const out = JSON.stringify(review, null, 2) + "\n";
  if (opts.saida) writeFileSync(opts.saida, out);
  else process.stdout.write(out);
  process.stderr.write(`ponte: ${proposals.length} proposta(s), ${authorized.length} autorizada(s), ${review.authorizedPatches.length} patch(es) no review.\n`);
}

function portugues(file, opts) {
  let text;
  try { text = readFileSync(file, "utf8"); } catch (e) { fail("não consegui ler " + file + ": " + e.message); }
  if (opts.registro && !C.PT_REGISTROS[opts.registro]) fail(`registro desconhecido: ${opts.registro} (use ${Object.keys(C.PT_REGISTROS).join(", ")})`);
  let verificador = null;
  if (opts.ortografia) {
    try {
      const bytes = new Uint8Array(readFileSync(new URL("../../data/ortografia/pt-br.bloom", import.meta.url)));
      verificador = C.createSpellChecker(bytes);
    } catch (e) { fail("não consegui carregar o dicionário: " + e.message); }
  }
  const r = C.analisarPortugues(text, { registro: opts.registro || "academico", verificador });
  if (opts.json) { process.stdout.write(JSON.stringify(r, null, 2) + "\n"); return; }
  process.stdout.write(C.resumoPortugues(r) + "\n");
  const linhaDe = (pos) => text.slice(0, pos).split("\n").length;
  for (const a of r.achados) {
    process.stdout.write(`L${linhaDe(a.start)} [${a.severidade}] ${a.regra}: ${a.msg}${a.trecho ? ` — “${a.trecho.slice(0, 50)}”` : ""}${a.fix !== null ? ` → “${a.fix}”` : ""}\n`);
  }
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "auditar") {
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) fail("falta o arquivo.\n" + usage);
  auditar(file, args.includes("--json"));
} else if (cmd === "ponte") {
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) fail("falta o arquivo source.\n" + usage);
  ponte(file, { autorizar: flag(args, "--autorizar"), perfil: flag(args, "--perfil"), saida: flag(args, "--saida") });
} else if (cmd === "portugues") {
  const file = args.find((a, i) => !a.startsWith("--") && !["--registro"].includes(args[i - 1]));
  if (!file) fail("falta o arquivo.\n" + usage);
  portugues(file, { registro: flag(args, "--registro"), ortografia: args.includes("--ortografia"), json: args.includes("--json") });
} else if (cmd === "regras") {
  process.stdout.write(JSON.stringify({
    pacote: pkg.name + "@" + pkg.version,
    abnt10520: C.ABNT10520_RULES_VERSION,
    abnt6023: C.ABNT6023_RULES_VERSION,
    stylometry: C.STYLOMETRY_RULES_VERSION,
    portugues: C.PTBR_RULES_VERSION,
  }, null, 2) + "\n");
} else if (cmd === "versao") {
  process.stdout.write(pkg.name + " " + pkg.version + "\n");
} else {
  process.stderr.write(usage + "\n");
  process.exit(cmd ? 1 : 0);
}
