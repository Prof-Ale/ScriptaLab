/**
 * Service Worker — ScriptaLab PWA.
 *
 * Zero-build, script clássico (sem imports), escopo = pasta do sw.js
 * (no GitHub Pages: /ScriptaLab/).
 *
 * REGRA DE OURO — nunca servir um index.html velho com o motor antigo:
 *  - index.html e navegações são NETWORK-FIRST: tenta a rede primeiro
 *    e só usa o cache quando offline. Uma versão nova do site nunca
 *    fica presa atrás do cache.
 *  - Todo o resto do app shell é versionado pelo CACHE_NAME. Quando
 *    APP_VERSION muda, o cache antigo é apagado no activate e o novo
 *    é instalado. A ativação só acontece quando o usuário confirma
 *    no aviso de atualização (mensagem SKIP_WAITING) — nunca sozinha.
 *
 * NUNCA interceptar / cachear:
 *  - arquivos .mathlab.json e scriptalab.review/1 (e os .json de
 *    revisão baixados, scriptalab_revisao_*.json): passam direto,
 *    sempre frescos. A importação da ponte é por FileReader (nem
 *    passa pelo fetch), mas o SW também não os toca se vierem por URL.
 *  - api.crossref.org e api.openalex.org: rede sempre, sem cache
 *    (frescor + privacidade).
 *  - tudo que não é GET, e o próprio sw.js (o navegador gerencia
 *    a atualização dele).
 *
 * Bibliotecas de CDN (cdnjs: pdf.js, mammoth): cache-first, porque
 * a URL já é versionada (4.10.38 / 1.6.0) e a página confere SRI.
 * O docx (jsdelivr) NÃO é cacheado pelo SW: não está no connect-src
 * da CSP, então o SW não o busca — a tag <script> da página carrega.
 *
 * Para mudar a versão: altere APP_VERSION (tem que ser igual à
 * "version" do package.json — o teste tests/sw.test.js trava isso).
 */
'use strict';

const APP_VERSION = '0.3.0';
const CACHE_NAME = 'scriptalab-v' + APP_VERSION;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-app.svg',
  './favicon.svg',
  './favicon-32.png',
  './favicon-64.png',
  './logo-horizontal.svg',
  './src/core/index.js',
  './src/core/textUtils.js',
  './src/core/scrubber.js',
  './src/core/abnt10520.js',
  './src/core/abnt6023.js',
  './src/core/citationAuditor.js',
  './src/core/citationLocations.js',
  './src/core/diffEngine.js',
  './src/core/stylometry.js',
  './src/core/literaryReview.js',
  './src/core/mathlabBridge.js',
  './src/core/aiBridge.js',
  './src/core/networkLog.js',
  './src/core/auditWorkerClient.js',
  './workers/auditWorker.js',
  './templates-ies/abnt-padrao-2023.json',
  './templates-ies/usp-abnt.json',
  './templates-ies/unicamp-ccpg-abnt.json',
  './templates-ies/unesp-cgb-abnt.json',
  './templates-ies/ifsp-abnt.json',
  './templates-ies/ifsuldeminas-carmo-tcc-artigo.json',
  './templates-ies/anhanguera-uam.json',
  './templates-ies/schema.json',
  './data/cliches-ptbr.json',
];

const CDN_LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs',
  'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js',
];

const NEVER_CACHE_HOSTS = ['api.crossref.org', 'api.openalex.org'];

function isNeverCacheUrl(url) {
  const u = new URL(url, self.location.href);
  if (NEVER_CACHE_HOSTS.includes(u.hostname)) return true;
  const path = u.pathname.toLowerCase();
  if (path.endsWith('.mathlab.json')) return true;
  if (path.includes('scriptalab.review') || path.includes('scriptalab_revisao')) return true;
  return false;
}

function isNavigationOrIndex(request, url) {
  if (request.mode === 'navigate') return true;
  const path = url.pathname.toLowerCase();
  return path.endsWith('/index.html') || path.endsWith('/') || path === '';
}

function isAppShellUrl(url) {
  return url.origin === self.location.origin;
}

function isCdnLibUrl(url) {
  return CDN_LIBS.includes(url.href);
}

/** Estratégia por requisição: network-only | network-first | cache-first | pass-through. */
function decide(request) {
  const url = new URL(request.url, self.location.href);
  if (request.method !== 'GET') return 'pass-through';
  if (url.pathname.endsWith('/sw.js')) return 'network-only';
  if (isNeverCacheUrl(request.url)) return 'network-only';
  if (isNavigationOrIndex(request, url)) return 'network-first';
  if (isCdnLibUrl(url)) return 'cache-first';
  if (isAppShellUrl(url)) return 'cache-first';
  return 'network-only';
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (e) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    // Último recurso offline para navegação: o index.html em cache.
    if (request.mode === 'navigate') {
      const index = await cache.match('./index.html');
      if (index) return index;
    }
    throw e;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const res = await fetch(request);
  if (res && res.ok) cache.put(request, res.clone());
  return res;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  // NÃO chama skipWaiting aqui: a nova versão só ativa quando o
  // usuário confirma no aviso de atualização (mensagem SKIP_WAITING).
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith('scriptalab-') && k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const strategy = decide(event.request);
  if (strategy === 'pass-through' || strategy === 'network-only') {
    event.respondWith(fetch(event.request));
    return;
  }
  if (strategy === 'network-first') {
    event.respondWith(networkFirst(event.request));
    return;
  }
  event.respondWith(cacheFirst(event.request));
});
