/**
 * Teste do service worker — ScriptaLab PWA (node:test).
 *
 * Roda com:  node --test tests/sw.test.js
 *
 * O sw.js REAL é executado num harness VM com um ServiceWorker
 * mockado (self, caches, fetch). Nada aqui testa uma cópia da
 * política: testa o arquivo que vai para o repo.
 *
 * O que é travado:
 *  - APP_VERSION == package.json version; CACHE_NAME versionado;
 *  - install pré-cacheia o app shell e NÃO inclui .mathlab.json,
 *    review/1 nem CrossRef;
 *  - activate apaga caches scriptalab-* antigos e mantém o atual;
 *  - index.html é network-first (nunca fica preso em versão velha);
 *  - .mathlab.json, scriptalab.review/1, CrossRef/OpenAlex e POST
 *    passam direto, sem cache;
 *  - core JS offline vem do cache; CDN versionada (cdnjs) também;
 *  - SKIP_WAITING só via mensagem (aviso de atualização), nunca
 *    automático no install;
 *  - o teste de contrato da ponte passa com o SW registrado/ativo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SW_SRC = readFileSync(join(ROOT, "sw.js"), "utf8");
const BASE = "https://prof-ale.github.io/ScriptaLab/";

function resolve(url) {
  return new URL(url, BASE).href;
}

class MockCache {
  constructor() { this.map = new Map(); this.puts = []; }
  async match(req) {
    const url = typeof req === "string" ? resolve(req) : req.url;
    return this.map.get(url);
  }
  async put(req, res) {
    const url = typeof req === "string" ? resolve(req) : req.url;
    this.map.set(url, res);
    this.puts.push(url);
  }
  async addAll(list) {
    for (const u of list) {
      const res = await this._fetch(resolve(u));
      if (!res || !res.ok) throw new Error("falha ao pré-cachear " + u);
      await this.put(resolve(u), res);
    }
  }
}

function loadSW({ offline = new Set(), network = new Map() } = {}) {
  const handlers = {};
  let skipWaitingCalled = false;
  let claimCalled = false;
  const cachesByName = new Map();
  const getCache = (name) => {
    if (!cachesByName.has(name)) {
      const c = new MockCache();
      c._fetch = fetchMock;
      cachesByName.set(name, c);
    }
    return cachesByName.get(name);
  };
  async function fetchMock(input) {
    const url = typeof input === "string" ? resolve(input) : input.url;
    if (offline.has(url)) throw new Error("offline: " + url);
    if (network.has(url)) return network.get(url);
    return new Response("network:" + url, { status: 200 });
  }
  const sandbox = {
    console,
    URL,
    Response,
    Request,
    Promise,
    self: {
      location: { href: BASE + "sw.js", origin: "https://prof-ale.github.io" },
      addEventListener: (type, fn) => { handlers[type] = fn; },
      skipWaiting: () => { skipWaitingCalled = true; },
      clients: { claim: () => { claimCalled = true; } },
    },
  };
  sandbox.caches = {
    open: async (name) => getCache(name),
    keys: async () => [...cachesByName.keys()],
    delete: async (name) => cachesByName.delete(name),
  };
  sandbox.fetch = fetchMock;
  // O SW usa `caches`, `fetch` e `self` globais.
  sandbox.caches.open = sandbox.caches.open;
  vm.createContext(sandbox);
  vm.runInContext(SW_SRC, sandbox, { filename: "sw.js" });
  // Expõe os mocks no mesmo objeto global do SW.
  sandbox.self.caches = sandbox.caches;
  sandbox.self.fetch = fetchMock;
  // O código do SW referencia `caches` e `fetch` como globais livres:
  // o vm já os tem via sandbox (caches/fetch definidos acima).
  async function fire(type, event) {
    const ev = { ...event, waitUntil(p) { this._p = p; }, respondWith(p) { this._p = p; } };
    handlers[type](ev);
    return ev._p;
  }
  return {
    handlers, sandbox, fire, cachesByName, getCache,
    wasSkipWaiting: () => skipWaitingCalled,
    wasClaim: () => claimCalled,
    offline, network,
  };
}

function req(url, method = "GET", mode = "cors") {
  return { url: resolve(url), method, mode };
}

test("versão do SW é a do package.json e o cache é versionado", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  assert.match(SW_SRC, new RegExp(`APP_VERSION = '${pkg.version}'`));
  assert.ok(SW_SRC.includes("CACHE_NAME = 'scriptalab-v' + APP_VERSION"));
  // skipWaiting() só existe no handler de mensagem (aviso de atualização);
  // o install nunca ativa sozinho.
  assert.equal(SW_SRC.split("skipWaiting()").length - 1, 1);
  assert.ok(SW_SRC.includes("SKIP_WAITING"));
});

test("install pré-cacheia o app shell, sem ponte nem CrossRef", async () => {
  const sw = loadSW();
  await sw.fire("install", {});
  const cache = sw.getCache("scriptalab-v0.4.0");
  for (const u of ["./index.html", "./manifest.webmanifest", "./src/core/mathlabBridge.js", "./src/core/aiBridge.js", "./src/core/networkLog.js", "./templates-ies/usp-abnt.json", "./src/core/rules/abnt10520.json", "./src/core/rules/abnt6023.json", "./src/core/rules/stylometry.json"]) {
    assert.ok(cache.map.has(resolve(u)), "falta no pré-cache: " + u);
  }
  assert.ok(![...cache.map.keys()].some((k) => k.includes(".mathlab.json") || k.includes("scriptalab.review") || k.includes("crossref")));
  assert.equal(sw.wasSkipWaiting(), false, "install não pode ativar sozinho");
});

test("activate apaga o cache antigo e mantém o atual", async () => {
  const sw = loadSW();
  await sw.fire("install", {});
  // Simula um cache da versão anterior.
  const old = await sw.sandbox.caches.open("scriptalab-v0.2.0");
  await old.put(resolve("./index.html"), new Response("velho", { status: 200 }));
  await sw.fire("activate", {});
  assert.deepEqual([...sw.cachesByName.keys()].sort(), ["scriptalab-v0.4.0"]);
  assert.equal(sw.wasClaim(), true);
});

test(".mathlab.json e scriptalab.review/1 passam direto, sem cache", async () => {
  const sw = loadSW();
  await sw.fire("install", {});
  const cache = sw.getCache("scriptalab-v0.4.0");
  const before = cache.puts.length;
  const r1 = await sw.fire("fetch", { request: req("https://exemplo.com/material.mathlab.json") });
  assert.equal(await r1.text(), "network:https://exemplo.com/material.mathlab.json");
  const r2 = await sw.fire("fetch", { request: req("https://exemplo.com/scriptalab.review/1.json") });
  assert.equal(await r2.text(), "network:https://exemplo.com/scriptalab.review/1.json");
  assert.equal(cache.puts.length, before, "arquivo da ponte não pode entrar no cache");
});

test("CrossRef e OpenAlex nunca entram no cache", async () => {
  const sw = loadSW();
  await sw.fire("install", {});
  const cache = sw.getCache("scriptalab-v0.4.0");
  const before = cache.puts.length;
  await sw.fire("fetch", { request: req("https://api.crossref.org/works/10.1234/abcd") });
  await sw.fire("fetch", { request: req("https://api.openalex.org/works?filter=raw_author_name.search:Silva") });
  assert.equal(cache.puts.length, before);
});

test("index.html é network-first: online vem da rede, offline vem do cache", async () => {
  const sw = loadSW();
  await sw.fire("install", {});
  // A rede agora serve uma versão NOVA, diferente do que foi pré-cacheado.
  sw.network.set(resolve("./index.html"), new Response("index-v0.4.0-nova", { status: 200 }));
  const online = await sw.fire("fetch", { request: req("./index.html", "GET", "navigate") });
  assert.equal(await online.text(), "index-v0.4.0-nova", "online tem que vir da rede, nunca do cache velho");
  sw.offline.add(resolve("./index.html"));
  const offlineRes = await sw.fire("fetch", { request: req("./index.html", "GET", "navigate") });
  assert.equal(await offlineRes.text(), "index-v0.4.0-nova", "offline serve o index.html em cache (o atualizado)");
});

test("JS do núcleo offline vem do cache; POST passa direto", async () => {
  const sw = loadSW();
  await sw.fire("install", {});
  sw.offline.add(resolve("./src/core/mathlabBridge.js"));
  const cached = await sw.fire("fetch", { request: req("./src/core/mathlabBridge.js") });
  assert.equal(await cached.text(), "network:" + resolve("./src/core/mathlabBridge.js"));
  const cache = sw.getCache("scriptalab-v0.4.0");
  const before = cache.puts.length;
  const post = await sw.fire("fetch", { request: req("./index.html", "POST") });
  assert.equal(await post.text(), "network:" + resolve("./index.html"));
  assert.equal(cache.puts.length, before, "POST não pode entrar no cache");
});

test("CDN versionada (cdnjs) usa cache; jsdelivr passa direto", async () => {
  const sw = loadSW();
  const pdfUrl = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";
  const first = await sw.fire("fetch", { request: req(pdfUrl) });
  assert.equal(await first.text(), "network:" + pdfUrl);
  sw.offline.add(pdfUrl);
  const second = await sw.fire("fetch", { request: req(pdfUrl) });
  assert.equal(await second.text(), "network:" + pdfUrl, "offline serve o pdf.js em cache");
  const cache = sw.getCache("scriptalab-v0.4.0");
  const before = cache.puts.length;
  await sw.fire("fetch", { request: req("https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js") });
  assert.equal(cache.puts.length, before, "jsdelivr não é cacheado pelo SW (fora do connect-src)");
});

test("SKIP_WAITING só via mensagem", async () => {
  const sw = loadSW();
  await sw.fire("install", {});
  assert.equal(sw.wasSkipWaiting(), false);
  await sw.fire("message", { data: { type: "SKIP_WAITING" } });
  assert.equal(sw.wasSkipWaiting(), true);
  await sw.fire("message", { data: { type: "OUTRA" } });
});

test("teste de contrato da ponte passa com o SW ativo", async () => {
  const sw = loadSW();
  await sw.fire("install", {});
  await sw.fire("activate", {});
  // A ponte é arquivo local: o SW não a intercepta nem a altera.
  const { parseSource, proposeForBlocks, buildReview } = await import("../src/core/mathlabBridge.js");
  const fixture = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/contract/source.json"), "utf8"));
  const source = parseSource(JSON.stringify(fixture));
  const props = proposeForBlocks(source);
  const review = buildReview(source, props, ["blk_01", "blk_02", "blk_05"], { profileId: "abnt-padrao-2023", now: new Date("2026-11-25T12:00:00.000Z") });
  assert.equal(review.schema, "scriptalab.review/1");
  assert.equal(review.humanValidationCarried, false);
  assert.equal(review.authorizedPatches.length, 3);
  // E um .mathlab.json que viesse por URL sairia fresco, não do cache.
  const r = await sw.fire("fetch", { request: req("https://exemplo.com/mat_001.mathlab.json") });
  assert.equal(await r.text(), "network:https://exemplo.com/mat_001.mathlab.json");
});
