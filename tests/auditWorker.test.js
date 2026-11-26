/**
 * Teste do worker de auditoria + cliente — ScriptaLab (node:test).
 *
 * Roda com:  node --test tests/auditWorker.test.js
 *
 * Parte 1: o workers/auditWorker.js REAL é executado num harness VM
 * com o ambiente de worker mockado (self, postMessage, importScripts,
 * fetch). Nada aqui testa uma cópia da lógica de DOI.
 *
 * Parte 2: o cliente (src/core/auditWorkerClient.js) é testado com
 * um Worker mockado — fallback, cache, painel de rede, cancelamento.
 *
 * O que é travado:
 *  - o worker devolve o resultado BRUTO (state/meta/hit) — a
 *    validação (compareRef) continua na thread principal;
 *  - progresso por item, cancelamento com parciais, retry em 429;
 *  - DOCX via mammoth no worker, com erro MAMMOTH_UNAVAILABLE;
 *  - o cliente nunca importa o mathlabBridge (que fica síncrono
 *    e intacto no núcleo) e cai para o fallback sem Worker.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { createAuditWorkerClient, AUDIT_WORKER_PROTOCOL } from "../src/core/auditWorkerClient.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKER_SRC = readFileSync(join(ROOT, "workers/auditWorker.js"), "utf8");
const CLIENT_SRC = readFileSync(join(ROOT, "src/core/auditWorkerClient.js"), "utf8");

// ---------- Harness do worker ----------

function loadWorker({ fetchImpl, mammothImpl = null, importScriptsThrows = false } = {}) {
  const posted = [];
  let fetchCalls = [];
  const sandbox = {
    console,
    URL,
    Promise,
    setTimeout,
    clearTimeout,
    self: {},
    postMessage: (msg) => posted.push(msg),
    fetch: async (url, opts) => { fetchCalls.push(url); return fetchImpl(url, opts); },
    importScripts: (...urls) => {
      if (importScriptsThrows) throw new Error("importScripts bloqueado");
      if (mammothImpl) sandbox.mammoth = mammothImpl;
    },
  };
  sandbox.self.postMessage = sandbox.postMessage;
  vm.createContext(sandbox);
  vm.runInContext(WORKER_SRC, sandbox, { filename: "auditWorker.js" });
  const send = (msg) => sandbox.self.onmessage({ data: msg });
  const waitFor = async (type, timeoutMs = 5000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const m = posted.find((p) => p.type === type);
      if (m) return m;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error("timeout esperando " + type + "; recebidos: " + JSON.stringify(posted.map((p) => p.type)));
  };
  return { sandbox, posted, send, waitFor, get fetchCalls() { return fetchCalls; } };
}

function jsonResponse(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function crossrefFetch() {
  return (url) => {
    if (url.includes("/works/10.1234%2Fabcd") || url.includes("/works/10.1234/abcd")) {
      return jsonResponse({ message: { title: ["Título da obra"], author: [{ family: "Silva" }], issued: { "date-parts": [[2020]] } } });
    }
    if (url.includes("/works/10.9999%2Fxxxx") || url.includes("/works/10.9999/xxxx")) {
      if (url.includes("/agency")) return jsonResponse({ message: { agency: { label: "DataCite" } } });
      return new Response("", { status: 404 });
    }
    if (url.includes("/works/10.0000%2Fmissing")) return new Response("", { status: 404 });
    if (url.includes("/agency")) return new Response("", { status: 404 });
    if (url.includes("query.author=Silva")) {
      return jsonResponse({ message: { items: [{ DOI: "10.1234/abcd", title: ["Título da obra"], author: [{ family: "Silva" }] }] } });
    }
    if (url.includes("query.author=Ninguem")) {
      return jsonResponse({ message: { items: [] } });
    }
    if (url.includes("api.openalex.org")) {
      return jsonResponse({ results: [{ doi: "https://doi.org/10.5555/oa", title: "Obra OpenAlex", authorships: [{ author: { display_name: "Ninguem da Silva" } }] }] });
    }
    return new Response("", { status: 404 });
  };
}

// ---------- Parte 1: o worker ----------

test("worker: DOI encontrado devolve bruto com meta; lookup é registrado", async () => {
  const w = loadWorker({ fetchImpl: crossrefFetch() });
  w.send({ protocol: AUDIT_WORKER_PROTOCOL, type: "audit-dois", requestId: 1, jobs: [{ kind: "doi", doi: "10.1234/abcd" }], cfg: { email: "a@b.com", key: "" } });
  const res = await w.waitFor("result");
  assert.equal(res.results.length, 1);
  assert.equal(res.results[0].ok, true);
  // Os objetos vêm do realm do VM: compara via JSON, não por protótipo.
  assert.deepEqual(JSON.parse(JSON.stringify(res.results[0].data)), { state: "found", meta: { title: "Título da obra", family: "Silva", year: 2020 } });
  const lookups = w.posted.filter((p) => p.type === "lookup");
  assert.equal(lookups.length, 1);
  assert.ok(lookups[0].url.includes("api.crossref.org/works/10.1234/abcd"));
  assert.ok(lookups[0].url.includes("mailto=a%40b.com"), "o e-mail vai na URL como no getJSON");
});

test("worker: DOI de outra agência e DOI inexistente", async () => {
  const w = loadWorker({ fetchImpl: crossrefFetch() });
  w.send({ protocol: AUDIT_WORKER_PROTOCOL, type: "audit-dois", requestId: 1, jobs: [
    { kind: "doi", doi: "10.9999/xxxx" },
    { kind: "doi", doi: "10.0000/missing" },
  ], cfg: { email: "", key: "" } });
  const res = await w.waitFor("result");
  assert.equal(res.results[0].data.state, "other-agency");
  assert.equal(res.results[0].data.agency, "DataCite");
  assert.equal(res.results[1].data.state, "missing");
});

test("worker: Autor+Ano — CrossRef acerta; sem acerto, OpenAlex responde", async () => {
  const w = loadWorker({ fetchImpl: crossrefFetch() });
  w.send({ protocol: AUDIT_WORKER_PROTOCOL, type: "audit-dois", requestId: 1, jobs: [
    { kind: "author-year", sur: "Silva", year: 2020 },
    { kind: "author-year", sur: "Ninguem", year: 2021 },
  ], cfg: { email: "", key: "" } });
  const res = await w.waitFor("result");
  assert.equal(res.results[0].data.source, "CrossRef");
  assert.equal(res.results[0].data.hit.doi, "10.1234/abcd");
  assert.equal(res.results[1].data.source, "OpenAlex");
  assert.equal(res.results[1].data.hit.title, "Obra OpenAlex");
  assert.equal(res.results[1].data.oaAnswered, true);
});

test("worker: progresso por item e 429 com retry", async () => {
  let calls = 0;
  const w = loadWorker({
    fetchImpl: (url) => {
      calls++;
      if (calls === 1) return new Response("", { status: 429, headers: { "Retry-After": "0" } });
      return jsonResponse({ message: { title: ["T"], author: [{ family: "S" }], issued: { "date-parts": [[2020]] } } });
    },
  });
  w.send({ protocol: AUDIT_WORKER_PROTOCOL, type: "audit-dois", requestId: 1, jobs: [{ kind: "doi", doi: "10.1234/abcd" }], cfg: { email: "", key: "" } });
  const res = await w.waitFor("result");
  assert.equal(res.results[0].data.state, "found");
  assert.equal(calls, 2, "429 retenta uma vez");
  const progress = w.posted.filter((p) => p.type === "progress");
  assert.equal(progress.length, 1);
  assert.deepEqual({ done: progress[0].done, total: progress[0].total }, { done: 1, total: 1 });
});

test("worker: cancelamento para o loop e devolve parciais", async () => {
  const w = loadWorker({ fetchImpl: crossrefFetch() });
  const jobs = Array.from({ length: 5 }, (_, i) => ({ kind: "doi", doi: "10.1234/abcd" }));
  w.send({ protocol: AUDIT_WORKER_PROTOCOL, type: "audit-dois", requestId: 7, jobs, cfg: { email: "", key: "" } });
  w.send({ protocol: AUDIT_WORKER_PROTOCOL, type: "cancel", requestId: 7 });
  const cancelled = await w.waitFor("cancelled");
  assert.ok(cancelled.results.length < 5, "parou antes do fim");
  assert.ok(!w.posted.some((p) => p.type === "result"), "não emite result após cancelar");
});

test("worker: DOCX via mammoth; sem mammoth, erro com código", async () => {
  const mammoth = { extractRawText: async () => ({ value: "texto do docx" }) };
  const w = loadWorker({ fetchImpl: crossrefFetch(), mammothImpl: mammoth });
  w.send({ protocol: AUDIT_WORKER_PROTOCOL, type: "parse-docx", requestId: 3, buffer: new ArrayBuffer(8) });
  const docx = await w.waitFor("docx");
  assert.equal(docx.text, "texto do docx");

  const w2 = loadWorker({ fetchImpl: crossrefFetch(), importScriptsThrows: true });
  w2.send({ protocol: AUDIT_WORKER_PROTOCOL, type: "parse-docx", requestId: 4, buffer: new ArrayBuffer(8) });
  const err = await w2.waitFor("error");
  assert.equal(err.code, "MAMMOTH_UNAVAILABLE");
});

test("worker: mensagem sem protocolo é ignorada", async () => {
  const w = loadWorker({ fetchImpl: crossrefFetch() });
  w.send({ type: "audit-dois", requestId: 9, jobs: [], cfg: {} });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(w.posted.length, 0);
});

// ---------- Parte 2: o cliente ----------

class MockWorker {
  static instances = [];
  constructor(url) { this.url = url; this.listeners = {}; this.terminated = false; this.sent = []; MockWorker.instances.push(this); }
  postMessage(msg, transfer) { this.sent.push(msg); }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); }
  emit(msg) { for (const fn of this.listeners.message || []) fn({ data: msg }); }
  terminate() { this.terminated = true; }
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test("cliente: sem Worker, usa o fallback da thread principal", async () => {
  const fallback = {
    crossrefDOI: async (doi) => ({ state: "found", meta: { title: "T", family: "S", year: 2020 } }),
    crossrefAuthorYear: async () => null,
    openalexAuthorYear: async () => ({ ok: true, hit: { url: "https://doi.org/10.5/oa", title: "OA" } }),
    parseDocxMain: async () => "texto main",
  };
  const client = createAuditWorkerClient({ WorkerClass: null, fallback });
  const { results, fromWorker } = await client.runDoiAudit([
    { kind: "doi", doi: "10.1234/abcd" },
    { kind: "author-year", sur: "Ninguem", year: 2021 },
  ], { cfg: {} });
  assert.equal(fromWorker, false);
  assert.equal(results[0].data.state, "found");
  assert.equal(results[1].data.source, "OpenAlex");
  assert.equal(await client.runDocx(new ArrayBuffer(4)), "texto main");
});

test("cliente: worker devolve bruto sem validar; progresso e painel passam por ele", async () => {
  MockWorker.instances = [];
  const progress = [];
  const recorded = [];
  const client = createAuditWorkerClient({
    WorkerClass: MockWorker,
    loadWorkerScript: async () => "codigo",
    onRecordFetch: (url, status) => recorded.push([url, status]),
  });
  const p = client.runDoiAudit([{ kind: "doi", doi: "10.1234/abcd" }], {
    cfg: { email: "a@b.com" },
    onProgress: (pr) => progress.push(pr),
  });
  await tick(); await tick();
  const w = MockWorker.instances[0];
  assert.ok(w.url.startsWith("blob:"), "worker criado por Blob URL");
  const sent = w.sent[0];
  assert.equal(sent.type, "audit-dois");
  w.emit({ protocol: AUDIT_WORKER_PROTOCOL, type: "lookup", requestId: sent.requestId, url: "https://api.crossref.org/works/10.1234%2Fabcd?mailto=a%40b.com", status: 200 });
  w.emit({ protocol: AUDIT_WORKER_PROTOCOL, type: "progress", requestId: sent.requestId, done: 1, total: 1, current: "10.1234/abcd" });
  // O bruto passa intacto: o cliente NÃO valida semântica.
  w.emit({ protocol: AUDIT_WORKER_PROTOCOL, type: "result", requestId: sent.requestId, results: [{ job: { kind: "doi", doi: "10.1234/abcd" }, ok: true, data: { state: "found", meta: { title: "T", family: "S", year: 2020 } } }] });
  const { results, fromWorker } = await p;
  assert.equal(fromWorker, true);
  assert.deepEqual(results[0].data, { state: "found", meta: { title: "T", family: "S", year: 2020 } });
  assert.equal(progress.length, 1);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0][1], 200);
});

test("cliente: pré-filtro de cache usa o DOI com 200 e não despacha", async () => {
  MockWorker.instances = [];
  const cache = new Map();
  cache.set("https://api.crossref.org/works/10.1234/abcd?mailto=a%40b.com", { status: 200, data: { message: { title: ["T"], author: [{ family: "S" }], issued: { "date-parts": [[2020]] } } } });
  const client = createAuditWorkerClient({
    WorkerClass: MockWorker,
    loadWorkerScript: async () => "codigo",
    isCached: (u) => cache.has(u),
    getCached: (u) => cache.get(u),
  });
  const p = client.runDoiAudit([
    { kind: "doi", doi: "10.1234/abcd" },
    { kind: "author-year", sur: "Silva", year: 2020 },
  ], { cfg: { email: "a@b.com" } });
  await tick(); await tick();
  const w = MockWorker.instances[0];
  assert.equal(w.sent[0].jobs.length, 1, "só o Autor+Ano vai ao worker");
  assert.equal(w.sent[0].jobs[0].kind, "author-year");
  w.emit({ protocol: AUDIT_WORKER_PROTOCOL, type: "result", requestId: w.sent[0].requestId, results: [{ job: { kind: "author-year", sur: "Silva", year: 2020 }, ok: true, data: { hit: { doi: "10.1/x", title: "T" }, source: "CrossRef", oaAnswered: false } }] });
  const { results } = await p;
  assert.equal(results.length, 2);
  assert.equal(results.find((r) => r.fromCache).data.meta.year, 2020);
});

test("cliente: AbortSignal cancela e o worker recebe 'cancel'", async () => {
  MockWorker.instances = [];
  const client = createAuditWorkerClient({ WorkerClass: MockWorker, loadWorkerScript: async () => "codigo" });
  const ctrl = new AbortController();
  const p = client.runDoiAudit([{ kind: "doi", doi: "10.1234/abcd" }], { cfg: {}, signal: ctrl.signal });
  await tick(); await tick();
  ctrl.abort();
  const w = MockWorker.instances[0];
  assert.ok(w.sent.some((m) => m.type === "cancel"), "cancel enviado ao worker");
  // O worker não responde: o cliente termina à força em 500 ms.
  await assert.rejects(p, (e) => e.cancelled === true);
  assert.equal(w.terminated, true);
});

test("cliente: DOCX sem mammoth no worker cai para o fallback main-thread", async () => {
  MockWorker.instances = [];
  const client = createAuditWorkerClient({
    WorkerClass: MockWorker,
    loadWorkerScript: async () => "codigo",
    fallback: { parseDocxMain: async () => "texto main" },
  });
  const p = client.runDocx(new ArrayBuffer(8));
  await tick(); await tick();
  const w = MockWorker.instances[0];
  w.emit({ protocol: AUDIT_WORKER_PROTOCOL, type: "error", requestId: w.sent[0].requestId, code: "MAMMOTH_UNAVAILABLE", message: "mammoth não carregou" });
  assert.equal(await p, "texto main");
});

test("cliente e worker não importam o mathlabBridge", () => {
  // O nome pode aparecer em comentário ("não importa o mathlabBridge");
  // o que é proibido é importar. O mathlabBridge fica síncrono no núcleo.
  const importRe = /import\s+[^;]*mathlabBridge|from\s+["']\.\/mathlabBridge\.js["']|require\(["'].*mathlabBridge/;
  assert.ok(!importRe.test(CLIENT_SRC), "cliente não importa mathlabBridge");
  assert.ok(!importRe.test(WORKER_SRC), "worker não importa mathlabBridge");
  assert.ok(WORKER_SRC.includes("scriptalab.audit-worker/1"));
});
