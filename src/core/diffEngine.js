import { INVIS, AI_TAGS, UTM, HYPH_BREAK } from "./scrubber.js";
import { mkCit, isSigla, splitReferences } from "./abnt10520.js";
import { titleCase } from "./textUtils.js";

function sliceContext(text, start, end, radius = 28) {
  const pre = text.slice(Math.max(0, start - radius), start);
  const post = text.slice(end, Math.min(text.length, end + radius));
  return { contextBefore: pre, contextAfter: post };
}

function collectRegexProposals(text, regex, { category, label, limitEnd = text.length, transform }) {
  const re = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g");
  const out = [];
  let m;
  while ((m = re.exec(text))) {
    if (!m[0]) {
      re.lastIndex++;
      continue;
    }
    const start = m.index;
    const end = start + m[0].length;
    if (start >= limitEnd) break;
    if (end > limitEnd) continue;
    const after = transform(m);
    if (after === m[0]) continue;
    out.push({
      category,
      label,
      start,
      end,
      before: m[0],
      after,
      ...sliceContext(text, start, end),
    });
  }
  return out;
}

/**
 * Constrói propostas discretas e não sobrepostas de alteração (Zero-Tampering).
 * Nunca altera o texto de entrada; cada proposta nasce com status "pending".
 */
export function buildProposals(text, options = {}) {
  const s = String(text || "");
  const includeScrubber = options.scrubber !== false;
  const includeInvis = includeScrubber && options.invis !== false;
  const includeAiTags = includeScrubber && options.aiTags !== false;
  const includeUtm = includeScrubber && options.utm !== false;
  const includeHyphen = includeScrubber && options.hyphen !== false;
  const includeAbntCase = options.abntCitationCase !== false;

  const raw = [];
  if (includeInvis) {
    raw.push(
      ...collectRegexProposals(s, INVIS, {
        category: "scrubber_invis",
        label: "Caractere Unicode invisível",
        transform: (m) => (m[0] === "\u202F" ? " " : ""),
      })
    );
  }
  if (includeAiTags) {
    raw.push(
      ...collectRegexProposals(s, AI_TAGS, {
        category: "scrubber_ai_tag",
        label: "Marcador residual de IA",
        transform: () => "",
      })
    );
  }
  if (includeUtm) {
    raw.push(
      ...collectRegexProposals(s, UTM, {
        category: "scrubber_utm",
        label: "Parâmetro de rastreamento UTM",
        transform: () => "",
      })
    );
  }
  if (includeHyphen) {
    raw.push(
      ...collectRegexProposals(s, HYPH_BREAK, {
        category: "scrubber_hyphen",
        label: "Hífen de quebra de linha",
        transform: (m) => `${m[1]}${m[2]}`,
      })
    );
  }

  if (includeAbntCase) {
    // NBR 10520:2023: caixa baixa/inicial maiúscula aplica-se às citações no corpo,
    // preservando caixa alta na seção REFERÊNCIAS e em siglas institucionais.
    const refSplit = splitReferences(s);
    const bodyLimit = refSplit.has ? refSplit.body.length : s.length;
    raw.push(
      ...collectRegexProposals(s, mkCit(), {
        category: "abnt_citation_case",
        label: "NBR 10520:2023 — caixa do sobrenome na citação",
        limitEnd: bodyLimit,
        transform: (m) => {
          const name = m[1];
          const etAl = m[2] || "";
          const year = m[3];
          if (name === name.toUpperCase() && !isSigla(name)) {
            return `${titleCase(name)}${etAl}, ${year}`;
          }
          return m[0];
        },
      })
    );
  }

  // Ordena por posição e descarta sobreposições mantendo a ocorrência mais longa primeiro
  raw.sort((a, b) => a.start - b.start || b.end - a.end);
  const proposals = [];
  let cursor = 0;
  for (const item of raw) {
    if (item.start >= cursor) {
      proposals.push({
        id: `prop_${proposals.length + 1}`,
        ...item,
        status: "pending",
      });
      cursor = item.end;
    }
  }
  return proposals;
}

export function createReviewSession(text, options = {}) {
  const originalText = String(text || "");
  const proposals = Array.isArray(options) ? options.map((p) => ({ ...p })) : buildProposals(originalText, options);
  return {
    originalText,
    proposals,
    history: [],
  };
}

function updateStatus(session, id, nextStatus) {
  const idx = session.proposals.findIndex((p) => p.id === id);
  if (idx < 0) return session;
  const current = session.proposals[idx];
  if (current.status === nextStatus) return session;
  const proposals = session.proposals.map((p, i) => (i === idx ? { ...p, status: nextStatus } : p));
  return {
    originalText: session.originalText,
    proposals,
    history: [...session.history, { type: "single", id, prevStatus: current.status, nextStatus }],
  };
}

export const acceptProposal = (session, id) => updateStatus(session, id, "accepted");
export const rejectProposal = (session, id) => updateStatus(session, id, "rejected");

export function acceptAllProposals(session, category = null) {
  const changes = [];
  const proposals = session.proposals.map((p) => {
    const match = !category || p.category === category;
    if (match && p.status !== "accepted") {
      changes.push({ id: p.id, prevStatus: p.status, nextStatus: "accepted" });
      return { ...p, status: "accepted" };
    }
    return p;
  });
  if (!changes.length) return session;
  return {
    originalText: session.originalText,
    proposals,
    history: [...session.history, { type: "batch", changes }],
  };
}

export function undoLastAction(session) {
  if (!session.history.length) return session;
  const last = session.history[session.history.length - 1];
  const history = session.history.slice(0, -1);
  if (last.type === "single") {
    const proposals = session.proposals.map((p) => (p.id === last.id ? { ...p, status: last.prevStatus } : p));
    return { originalText: session.originalText, proposals, history };
  }
  if (last.type === "batch") {
    const prevById = new Map(last.changes.map((c) => [c.id, c.prevStatus]));
    const proposals = session.proposals.map((p) =>
      prevById.has(p.id) ? { ...p, status: prevById.get(p.id) } : p
    );
    return { originalText: session.originalText, proposals, history };
  }
  return session;
}

export function resetSession(session) {
  return {
    originalText: session.originalText,
    proposals: session.proposals.map((p) => ({ ...p, status: "pending" })),
    history: [],
  };
}

/**
 * Gera o texto final aplicando EXCLUSIVAMENTE as propostas com status "accepted".
 * Propostas "pending" ou "rejected" nunca alteram o texto (Zero-Tampering).
 */
export function renderSessionText(session) {
  const accepted = session.proposals
    .filter((p) => p.status === "accepted")
    .sort((a, b) => b.start - a.start);
  let out = session.originalText;
  for (const p of accepted) {
    out = out.slice(0, p.start) + p.after + out.slice(p.end);
  }
  return out;
}

export function summarizeSession(session) {
  const byCategory = {};
  let accepted = 0;
  let rejected = 0;
  let pending = 0;
  for (const p of session.proposals) {
    if (p.status === "accepted") accepted++;
    else if (p.status === "rejected") rejected++;
    else pending++;
    const bucket = byCategory[p.category] || { total: 0, accepted: 0, rejected: 0, pending: 0 };
    bucket.total++;
    bucket[p.status]++;
    byCategory[p.category] = bucket;
  }
  return {
    total: session.proposals.length,
    accepted,
    rejected,
    pending,
    canUndo: session.history.length > 0,
    byCategory,
  };
}
