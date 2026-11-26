/**
 * Teste do CLI — ScriptaLab (node:test).
 *
 * Roda com:  node --test tests/cli.test.js
 *
 * Executa o src/core/cli.mjs de verdade (processo filho) contra
 * arquivos temporários: auditar (texto e JSON), ponte (source da
 * fixture de contrato) e regras/versao. O CLI chama as mesmas
 * funções do núcleo — o teste prova isso pelo resultado, não pela
 * leitura do código.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "core", "cli.mjs");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

async function cli(args) {
  return run(process.execPath, [CLI, ...args], { cwd: ROOT });
}

test("cli auditar: texto e JSON sobre o trecho dourado", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sl-cli-"));
  const file = join(dir, "trecho.txt");
  writeFileSync(file, "No cenário atual, é importante ressaltar que a educação evolui. Silva (2020) afirma isso.\n\nREFERÊNCIAS\nSILVA, J. Educação. São Paulo: Editora, 2020.\n");
  const { stdout } = await cli(["auditar", file]);
  assert.match(stdout, /palavras/);
  assert.match(stdout, /Clichês: .*Nesse sentido|cenário atual/i);
  const { stdout: json } = await cli(["auditar", file, "--json"]);
  const report = JSON.parse(json);
  assert.equal(report.citacoes.length, 1);
  assert.equal(report.citacoes[0].nome, "Silva");
  assert.equal(report.referencias.total, 1);
});

test("cli ponte: emite review/1 com só o autorizado", async () => {
  const { stdout, stderr } = await cli([
    "ponte",
    join(ROOT, "tests/fixtures/contract/source.json"),
    "--autorizar", "blk_01,blk_02,blk_05",
    "--perfil", "abnt-padrao-2023",
  ]);
  const review = JSON.parse(stdout);
  assert.equal(review.schema, "scriptalab.review/1");
  assert.equal(review.humanValidationCarried, false);
  assert.equal(review.authorizedPatches.length, 3);
  assert.match(stderr, /3 patch\(es\) no review/);
});

test("cli ponte: source com schema errado é recusado", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sl-cli-"));
  const file = join(dir, "bad.json");
  writeFileSync(file, JSON.stringify({ schema: "scriptalab.review/1", blocks: [] }));
  await assert.rejects(cli(["ponte", file]), /source inválido/);
});

test("cli regras e versao", async () => {
  const { stdout: regras } = await cli(["regras"]);
  const r = JSON.parse(regras);
  assert.equal(r.abnt10520, 1);
  assert.equal(r.abnt6023, 1);
  assert.equal(r.stylometry, 1);
  assert.match(r.pacote, /@scriptalab\/core@0\.4\.0/);
  const { stdout: versao } = await cli(["versao"]);
  assert.match(versao, /@scriptalab\/core 0\.4\.0/);
});

test("cli portugues: relatório em texto, JSON e ortografia offline", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sl-cli-pt-"));
  const file = join(dir, "pt.txt");
  writeFileSync(file, "Eles tem razão , as vezes. A analize dos resultdos.\n");
  const { stdout } = await cli(["portugues", file]);
  assert.match(stdout, /achado\(s\)/);
  assert.match(stdout, /eles-tem/);
  assert.match(stdout, /as-vezes/);
  const { stdout: json } = await cli(["portugues", file, "--registro", "didatico", "--ortografia", "--json"]);
  const r = JSON.parse(json);
  assert.equal(r.registro, "didatico");
  assert.ok(r.achados.some((a) => a.regra === "ortografia" && a.trecho === "resultdos"));
  await assert.rejects(cli(["portugues", file, "--registro", "inexistente"]), /registro desconhecido/);
  const { stdout: regras } = await cli(["regras"]);
  assert.equal(JSON.parse(regras).portugues, 1);
});
