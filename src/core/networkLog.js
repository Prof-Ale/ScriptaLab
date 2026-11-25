/**
 * Registro de rede + modo sem rede — ScriptaLab (só apresentação).
 *
 * O painel "O que saiu desta aba" lista cada requisição da sessão:
 * para onde foi, o que saiu e se saiu mesmo (cache não sai).
 * Ele NÃO muda nenhuma requisição — só registra.
 *
 * O modo sem rede é um interruptor na interface: quando ligado, o
 * getJSON (único ponto de saída para CrossRef/OpenAlex) recusa a
 * chamada antes do fetch. Tudo o que é local continua funcionando
 * do mesmo jeito: scrubber, estilometria, ABNT, DOCX e a ponte
 * MathLab (arquivo local) não dependem de rede.
 *
 * Regra de privacidade do registro: o texto do usuário NUNCA aparece
 * aqui. Nem e-mail, nem chave OpenAlex: describeOutgoing redige
 * `mailto` e `api_key` antes de qualquer exibição.
 */
export const NETWORK_HOSTS = {
  crossref: "api.crossref.org",
  openalex: "api.openalex.org",
  cdnjs: "cdnjs.cloudflare.com",
  jsdelivr: "cdn.jsdelivr.net",
};

function parseUrl(url) {
  try {
    return new URL(String(url));
  } catch {
    try {
      return new URL(String(url), "https://localhost/");
    } catch {
      return null;
    }
  }
}

function decode(v) {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

/**
 * Classifica uma URL: { host, kind }.
 * kind: crossref-doi | crossref-author-year | openalex-author-year |
 *       cdn-library | local | other
 */
export function classifyUrl(url) {
  const u = parseUrl(url);
  if (!u) return { host: "", kind: "other" };
  const host = u.hostname;
  const path = u.pathname;
  if (host === NETWORK_HOSTS.crossref) {
    if (/\/works\/10\./.test(path) || path.includes("/agency")) return { host, kind: "crossref-doi" };
    if (u.searchParams.has("query.author")) return { host, kind: "crossref-author-year" };
    return { host, kind: "crossref-doi" };
  }
  if (host === NETWORK_HOSTS.openalex) return { host, kind: "openalex-author-year" };
  if (host === NETWORK_HOSTS.cdnjs || host === NETWORK_HOSTS.jsdelivr) return { host, kind: "cdn-library" };
  if (host === "localhost") return { host: "local", kind: "local" };
  return { host, kind: "other" };
}

/** O que saiu do navegador naquela URL, já com e-mail e chave redigidos. */
export function describeOutgoing(url) {
  const u = parseUrl(url);
  if (!u) return "URL inválida";
  const { kind } = classifyUrl(url);
  if (kind === "crossref-doi") {
    const m = u.pathname.match(/\/works\/(10\.[^/]+\/.+?)(?:\/agency)?$/);
    return m ? `DOI ${decode(m[1])}` : "DOI";
  }
  if (kind === "crossref-author-year") {
    const sur = u.searchParams.get("query.author") || "";
    const filter = u.searchParams.get("filter") || "";
    const year = (filter.match(/from-pub-date:(\d{4})/) || [])[1] || "";
    return `sobrenome+ano (${decode(sur)}${year ? `, ${year}` : ""})`;
  }
  if (kind === "openalex-author-year") {
    const filter = u.searchParams.get("filter") || "";
    const sur = (filter.match(/raw_author_name\.search:([^,]+)/) || [])[1] || u.searchParams.get("search") || "";
    const year = (filter.match(/publication_year:(\d{4})/) || [])[1] || "";
    return `sobrenome+ano (${decode(sur)}${year ? `, ${year}` : ""})`;
  }
  if (kind === "cdn-library") return "nenhum dado do texto (biblioteca: pdf.js/docx/mammoth)";
  if (kind === "local") return "nenhum dado do texto (arquivo local: perfil, clichês)";
  return "URL (sem dados do texto)";
}

/** Erro lançado quando o modo sem rede bloqueia uma chamada. */
export function offlineError() {
  const e = new Error("Modo sem rede ativo: chamada externa bloqueada antes do envio.");
  e.offline = true;
  return e;
}

export function createNetworkLog(options = {}) {
  const maxEntries = options.maxEntries || 200;
  const log = {
    entries: [],
    offline: false,
    setOffline(v) {
      log.offline = !!v;
      return log.offline;
    },
    isOffline() {
      return log.offline;
    },
    record(entry) {
      const e = entry || {};
      const classified = e.url ? classifyUrl(e.url) : { host: e.host || "", kind: e.kind || "other" };
      const rec = {
        at: e.at || new Date().toISOString(),
        host: classified.host,
        kind: classified.kind,
        sent: e.sent !== undefined ? !!e.sent : !e.fromCache,
        status: e.status !== undefined ? String(e.status) : "",
        fromCache: !!e.fromCache,
        detail: e.detail !== undefined ? e.detail : e.url ? describeOutgoing(e.url) : "",
      };
      log.entries.push(rec);
      while (log.entries.length > maxEntries) log.entries.shift();
      return rec;
    },
    /** Atalho para registrar um fetch: classifica e descreve sozinho. */
    recordFetch(url, result = {}) {
      return log.record({
        url,
        status: result.status !== undefined ? result.status : "",
        fromCache: !!result.fromCache,
        sent: !result.fromCache && result.status !== "bloqueada (modo sem rede)",
        at: result.at,
      });
    },
    summary() {
      const byHost = {};
      let sent = 0;
      let blocked = 0;
      let fromCache = 0;
      for (const e of log.entries) {
        byHost[e.host || "local"] = (byHost[e.host || "local"] || 0) + 1;
        if (e.sent) sent++;
        if (e.status === "bloqueada (modo sem rede)") blocked++;
        if (e.fromCache) fromCache++;
      }
      return { total: log.entries.length, sent, blocked, fromCache, byHost, offline: log.offline };
    },
    clear() {
      log.entries = [];
    },
    toJSON() {
      return { offline: log.offline, entries: log.entries.map((e) => ({ ...e })) };
    },
  };
  return log;
}
