export const INVIS = /[\u200B-\u200D\u2060\uFEFF\u202F]/g;
export const AI_TAGS = /【[^】]*】|\[oai_citation:[^\]]*\]/g;
export const UTM = /[?&]utm_[a-z0-9_]+=[^\s&)\]]*/gi;
export const HYPH_BREAK = /([a-zà-ÿ])-[ \t]*\r?\n[ \t]*([a-zà-ÿ])/gi;

export function scanScrubIssues(text) {
  const s = String(text || "");
  return {
    invis: (s.match(INVIS) || []).length,
    aiTags: (s.match(AI_TAGS) || []).length,
    utm: (s.match(UTM) || []).length,
    hyphBreak: (s.match(HYPH_BREAK) || []).length,
  };
}

export function scrubText(text) {
  return String(text || "")
    .replace(INVIS, "")
    .replace(AI_TAGS, "")
    .replace(UTM, "")
    .replace(HYPH_BREAK, "$1$2");
}
