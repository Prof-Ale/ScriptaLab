export const UP = "[A-ZÁÉÍÓÚÂÊÔÃÕÇ]";
export const NAME = `(?:${UP}{2,}(?:\\s+${UP}{2,})*|${UP}[A-Za-zÀ-ÿ'’]+(?:\\s+(?:[Dd][aeo]s?|[Ee])\\s+${UP}[A-Za-zÀ-ÿ'’]+)*)`;

export const titleCase = (s) =>
  String(s).toLowerCase().replace(/(^|\s)([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase());

export const normStr = (s) =>
  String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export const paras = (t) =>
  String(t)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

export const isLongQuote = (p, minChars) => /^["“]/.test(p) && p.length > minChars;

export const lastSurname = (n) => String(n).trim().split(/\s+/).pop() || "";
