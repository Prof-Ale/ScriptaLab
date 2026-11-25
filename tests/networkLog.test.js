/**
 * Teste do registro de rede + modo sem rede (node:test).
 *
 * Roda com:  node --test tests/networkLog.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NETWORK_HOSTS,
  classifyUrl,
  describeOutgoing,
  offlineError,
  createNetworkLog,
} from "../src/core/networkLog.js";

test("classifyUrl identifica cada destino", () => {
  assert.equal(classifyUrl("https://api.crossref.org/works/10.1234/abcd").kind, "crossref-doi");
  assert.equal(classifyUrl("https://api.crossref.org/works/10.1234/abcd/agency").kind, "crossref-doi");
  assert.equal(classifyUrl("https://api.crossref.org/works?query.author=Silva&filter=from-pub-date:2020,until-pub-date:2020").kind, "crossref-author-year");
  assert.equal(classifyUrl("https://api.openalex.org/works?filter=raw_author_name.search:Silva,publication_year:2020").kind, "openalex-author-year");
  assert.equal(classifyUrl("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs").kind, "cdn-library");
  assert.equal(classifyUrl("https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js").kind, "cdn-library");
  assert.equal(classifyUrl("templates-ies/usp-abnt.json").kind, "local");
  assert.equal(classifyUrl("data/cliches-ptbr.json").kind, "local");
  assert.equal(classifyUrl("https://exemplo.edu.br/artigo").kind, "other");
});

test("describeOutgoing diz o que saiu, sem vazar e-mail nem chave", () => {
  assert.equal(describeOutgoing("https://api.crossref.org/works/10.1234/abcd?mailto=voce%40exemplo.com"), "DOI 10.1234/abcd");
  assert.equal(describeOutgoing("https://api.crossref.org/works?query.author=Silva&filter=from-pub-date:2020,until-pub-date:2020&mailto=voce%40exemplo.com"), "sobrenome+ano (Silva, 2020)");
  assert.equal(describeOutgoing("https://api.openalex.org/works?filter=raw_author_name.search:Silva,publication_year:2020&api_key=CHAVE-SECRETA-123"), "sobrenome+ano (Silva, 2020)");
  const d = describeOutgoing("https://api.openalex.org/works?filter=raw_author_name.search:Silva,publication_year:2020&api_key=CHAVE-SECRETA-123");
  assert.ok(!d.includes("CHAVE-SECRETA-123"), "a chave não pode aparecer na descrição");
  assert.ok(!describeOutgoing("https://api.crossref.org/works/10.1/x?mailto=voce@exemplo.com").includes("voce@exemplo.com"));
  assert.equal(describeOutgoing("https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js"), "nenhum dado do texto (biblioteca: pdf.js/docx/mammoth)");
  assert.equal(describeOutgoing("templates-ies/usp-abnt.json"), "nenhum dado do texto (arquivo local: perfil, clichês)");
});

test("recordFetch registra envio, cache e bloqueio; summary conta tudo", () => {
  const log = createNetworkLog();
  log.recordFetch("https://api.crossref.org/works/10.1234/abcd", { status: 200 });
  log.recordFetch("https://api.crossref.org/works/10.1234/abcd", { status: "cache", fromCache: true });
  log.recordFetch("https://api.openalex.org/works?filter=raw_author_name.search:Silva,publication_year:2020", { status: "bloqueada (modo sem rede)" });
  assert.equal(log.entries.length, 3);
  assert.equal(log.entries[0].sent, true);
  assert.equal(log.entries[0].detail, "DOI 10.1234/abcd");
  assert.equal(log.entries[1].sent, false);
  assert.equal(log.entries[1].fromCache, true);
  assert.equal(log.entries[2].sent, false);
  const s = log.summary();
  assert.equal(s.total, 3);
  assert.equal(s.sent, 1);
  assert.equal(s.blocked, 1);
  assert.equal(s.fromCache, 1);
  assert.equal(s.byHost["api.crossref.org"], 2);
  assert.equal(s.byHost["api.openalex.org"], 1);
});

test("modo offline é um interruptor com estado", () => {
  const log = createNetworkLog();
  assert.equal(log.isOffline(), false);
  assert.equal(log.setOffline(true), true);
  assert.equal(log.isOffline(), true);
  assert.equal(log.summary().offline, true);
  log.setOffline(false);
  assert.equal(log.isOffline(), false);
  const e = offlineError();
  assert.equal(e.offline, true);
  assert.match(e.message, /Modo sem rede/);
});

test("limite de entradas descarta as mais antigas; clear zera", () => {
  const log = createNetworkLog({ maxEntries: 3 });
  for (let i = 0; i < 5; i++) log.recordFetch("https://api.crossref.org/works/10.1/x" + i, { status: 200 });
  assert.equal(log.entries.length, 3);
  assert.ok(log.entries[0].detail.includes("x2"));
  log.clear();
  assert.equal(log.entries.length, 0);
  assert.equal(log.summary().total, 0);
});

test("toJSON não vaza o texto nem credenciais", () => {
  const log = createNetworkLog();
  log.recordFetch("https://api.openalex.org/works?filter=raw_author_name.search:Silva,publication_year:2020&api_key=SEGREDO", { status: 200 });
  const json = JSON.stringify(log.toJSON());
  assert.ok(!json.includes("SEGREDO"));
  assert.ok(json.includes("sobrenome+ano (Silva, 2020)"));
});
