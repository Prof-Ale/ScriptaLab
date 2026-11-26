/**
 * Ponte de IA sem API (copiar e colar) — ScriptaLab.
 *
 * Fluxo:
 *   1. buildAiPrompt(bloco, problema) gera o prompt para o LLM que o
 *      usuário já usa. Nenhum texto sai do navegador pelo ScriptaLab:
 *      é o usuário quem copia o prompt e cola a resposta de volta.
 *   2. parseAiResponse(textoColado, corpoDoBloco) valida a resposta
 *      contra o schema "scriptalab.ai-suggestion/1" e RECUSA resposta
 *      malformada (JSON inválido, schema errado, campo desconhecido,
 *      categoria fora do permitido, trecho original que não existe no
 *      bloco, trecho ambíguo, sugestão idêntica ao original).
 *   3. A sugestão validada NÃO vira patch direto. Ela entra no mesmo
 *      funil de sempre: preservationLoss + validateConceptualPreservation
 *      (trava), diff item a item (diffEngine) e aceite humano.
 *      Sugestão que perde número, fórmula, citação, DOI ou marcador
 *      [F#], ou que INVENTA número, citação, DOI ou fórmula, nasce
 *      bloqueada e nunca chega ao review.
 *   4. aiSessionToBlockProposal(bloco, sessão) converte só o que foi
 *      aceito em proposta no formato antigo da ponte
 *      (mathlabBridge.proposeForBlocks), categoria
 *      "style_human_approved". O review/1 NÃO ganha campo novo:
 *      buildReview recebe a proposta como qualquer outra.
 *
 * Escopo permitido: reformulação de clichê ("cliche") e variação de
 * período/ritmo ("variation"). Nunca reescrita automática do texto,
 * nunca mudança de conteúdo, nunca validação humana pela IA.
 */
import { preservationLoss, blockHash } from "./mathlabBridge.js";
import { validateConceptualPreservation, extractProtectedTokens } from "./literaryReview.js";
import { INVIS, AI_TAGS } from "./scrubber.js";
import { createReviewSession, renderSessionText } from "./diffEngine.js";

export const AI_SUGGESTION_SCHEMA = "scriptalab.ai-suggestion/1";
export const AI_CATEGORIES = ["cliche", "variation"];
export const MAX_SUGGESTIONS = 10;
export const MAX_SUGGESTED_CHARS = 2000;

/** Configuração do contrato padrão (estilo). A ponte de português passa a sua. */
export const AI_CONTRACT_STYLE = Object.freeze({ schema: AI_SUGGESTION_SCHEMA, categories: AI_CATEGORIES });

const AI_TAG_RE = new RegExp(AI_TAGS.source);
const INVIS_RE = new RegExp(INVIS.source);
const TOP_KEYS = ["schema", "blockId", "suggestions"];
const SUGGESTION_KEYS = ["id", "category", "original", "suggested", "reason"];

/**
 * Gera o prompt estruturado para colar no LLM do usuário.
 * `block` = { blockId, body, title? } (um bloco da fonte
 * mathlab.scriptalab-source/1). `issue` é opcional:
 * { label, rule, detail } — ex.: clichê detectado pela estilometria.
 */
export function buildAiPrompt(block, issue) {
  const b = block || {};
  const body = String(b.body ?? "");
  const blockId = String(b.blockId ?? "");
  const problema = issue && (issue.label || issue.detail)
    ? `${issue.label ? issue.label + ". " : ""}${issue.detail ? issue.detail : ""}${issue.rule ? ` Regra: ${issue.rule}.` : ""}`
    : "Reformule os clichês e varie o ritmo dos períodos, sem mudar o conteúdo.";
  return [
    "# Revisão estilística — ScriptaLab (copiar e colar)",
    "",
    "Você é um revisor de texto acadêmico. Melhore SÓ a fluidez e o ritmo.",
    "",
    "## Regras obrigatórias",
    "1. NÃO remova, invente nem altere números, citações (Autor, ano), DOIs, fórmulas matemáticas/LaTeX ou marcadores [F1], [Fonte 1].",
    "2. NÃO invente dados, datas, autores ou referências.",
    "3. NÃO declare o texto como validado ou aprovado por humano.",
    "4. NÃO reescreva o texto inteiro: proponha no máximo " + MAX_SUGGESTIONS + " trechos curtos.",
    "5. Cada \"original\" tem que ser copiado EXATAMENTE como está no trecho, e tem que aparecer uma única vez nele.",
    "6. Responda SOMENTE com o JSON abaixo, sem texto antes ou depois, sem bloco de código.",
    "",
    "## Trecho (bloco " + blockId + (b.title ? " — " + b.title : "") + ")",
    body,
    "",
    "## Problema detectado",
    problema,
    "",
    "## Formato exato da resposta",
    "{",
    "  \"schema\": \"" + AI_SUGGESTION_SCHEMA + "\",",
    "  \"blockId\": \"" + blockId + "\",",
    "  \"suggestions\": [",
    "    { \"id\": \"s1\", \"category\": \"cliche\", \"original\": \"trecho exato\", \"suggested\": \"trecho reescrito\", \"reason\": \"por que melhora\" },",
    "    { \"id\": \"s2\", \"category\": \"variation\", \"original\": \"trecho exato\", \"suggested\": \"trecho reescrito\" }",
    "  ]",
    "}",
    "",
    "Categorias permitidas: \"cliche\" (reformulação de clichê) e \"variation\" (variação de período/ritmo).",
  ].join("\n");
}

/** Extrai o primeiro objeto JSON balanceado do texto colado (aceita cerca de código ```json). */
export function extractJsonObject(text) {
  const s = String(text ?? "");
  const start = s.indexOf("{");
  if (start < 0) throw new Error("Resposta sem JSON: cole somente o objeto JSON no formato pedido.");
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  throw new Error("JSON incompleto: chaves desbalanceadas. Cole a resposta inteira.");
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function addedTokens(before, after) {
  const b = extractProtectedTokens(before);
  const a = extractProtectedTokens(after);
  const added = [];
  const diff = (label, xs, ys) => {
    const set = new Set(ys);
    for (const x of xs) if (!set.has(x)) added.push(`${label} (${x})`);
  };
  diff("citação", a.citations, b.citations);
  diff("DOI", a.dois, b.dois);
  diff("fórmula", a.formulas, b.formulas);
  diff("número", a.numbers, b.numbers);
  return added;
}

/**
 * Valida a resposta colada. Não lança: devolve { ok, errors, warnings, data }.
 *  - Erro estrutural (ok:false): a resposta inteira é recusada, data é null.
 *  - Sugestão que quebra a trava (warnings): nasce bloqueada, com `perdas`,
 *    e é excluída das propostas — mas não invalida as outras sugestões.
 * `body` é o corpo original do bloco; `expectedBlockId`, quando dado,
 * tem que ser igual ao blockId da resposta.
 */
export function validateAiResponse(text, body, expectedBlockId, contract = AI_CONTRACT_STYLE) {
  const errors = [];
  const warnings = [];
  const src = String(body ?? "");
  let raw;
  try {
    raw = JSON.parse(extractJsonObject(text));
  } catch (e) {
    return { ok: false, errors: [e.message], warnings, data: null };
  }
  if (!isPlainObject(raw)) return { ok: false, errors: ["A resposta tem que ser um objeto JSON."], warnings, data: null };
  for (const k of Object.keys(raw)) {
    if (!TOP_KEYS.includes(k)) errors.push(`Campo desconhecido no topo: "${k}".`);
  }
  if (raw.schema !== contract.schema) {
    errors.push(`Schema esperado "${contract.schema}" e veio "${raw.schema ?? "ausente"}".`);
  }
  if (typeof raw.blockId !== "string" || !raw.blockId.trim()) {
    errors.push("Campo \"blockId\" é obrigatório e tem que ser texto.");
  } else if (expectedBlockId && raw.blockId !== expectedBlockId) {
    errors.push(`blockId "${raw.blockId}" não é o bloco esperado "${expectedBlockId}".`);
  }
  if (!Array.isArray(raw.suggestions) || raw.suggestions.length === 0) {
    errors.push("Campo \"suggestions\" é obrigatório e tem que ter pelo menos 1 item.");
  } else if (raw.suggestions.length > MAX_SUGGESTIONS) {
    errors.push(`No máximo ${MAX_SUGGESTIONS} sugestões por resposta; vieram ${raw.suggestions.length}.`);
  }
  if (errors.length) return { ok: false, errors, warnings, data: null };

  const seenIds = new Set();
  const suggestions = [];
  for (let i = 0; i < raw.suggestions.length; i++) {
    const s = raw.suggestions[i];
    const where = `suggestions[${i}]`;
    if (!isPlainObject(s)) {
      errors.push(`${where} tem que ser um objeto.`);
      continue;
    }
    for (const k of Object.keys(s)) {
      if (!SUGGESTION_KEYS.includes(k)) errors.push(`${where} tem campo desconhecido: "${k}".`);
    }
    if (typeof s.id !== "string" || !s.id.trim()) errors.push(`${where}.id é obrigatório e tem que ser texto.`);
    else if (seenIds.has(s.id)) errors.push(`${where}.id duplicado: "${s.id}".`);
    else seenIds.add(s.id);
    if (!contract.categories.includes(s.category)) {
      errors.push(`${where}.category tem que ser ${contract.categories.map((c) => `"${c}"`).join(", ")}; veio ${JSON.stringify(s.category)}.`);
    }
    if (typeof s.original !== "string" || !s.original.trim()) errors.push(`${where}.original é obrigatório e tem que ser texto.`);
    if (typeof s.suggested !== "string" || !s.suggested.trim()) errors.push(`${where}.suggested é obrigatório e tem que ser texto.`);
    if (s.reason !== undefined && typeof s.reason !== "string") errors.push(`${where}.reason, quando presente, tem que ser texto.`);
    if (typeof s.suggested === "string" && s.suggested.length > MAX_SUGGESTED_CHARS) {
      errors.push(`${where}.suggested passa de ${MAX_SUGGESTED_CHARS} caracteres.`);
    }
    if (errors.length) continue;
    if (s.suggested === s.original) {
      errors.push(`${where}: "suggested" é igual a "original" — não há o que propor.`);
      continue;
    }
    // O trecho original tem que existir, verbatim, uma única vez no bloco.
    let first = -1;
    let count = 0;
    let idx = src.indexOf(s.original);
    while (idx >= 0) {
      count++;
      if (first < 0) first = idx;
      idx = src.indexOf(s.original, idx + 1);
    }
    if (count === 0) {
      errors.push(`${where}: "original" não foi encontrado no bloco — copie o trecho exatamente como está.`);
      continue;
    }
    if (count > 1) {
      errors.push(`${where}: "original" aparece ${count}x no bloco e é ambíguo — inclua mais contexto para deixá-lo único.`);
      continue;
    }
    // Trava: perda ou invenção de conteúdo protegido bloqueia a sugestão.
    const perdas = preservationLoss(s.original, s.suggested, "style");
    const pres = validateConceptualPreservation(s.original, s.suggested, { strictNumbers: true });
    if (!pres.preserved) {
      if (pres.missingCitations.length) perdas.push("citações (" + pres.missingCitations.join("; ") + ")");
      if (pres.missingDois.length) perdas.push("DOIs (" + pres.missingDois.join("; ") + ")");
      if (pres.missingFormulas.length) perdas.push("fórmulas (" + pres.missingFormulas.join("; ") + ")");
      if (pres.missingMarkers.length) perdas.push("marcadores de fonte (" + pres.missingMarkers.join("; ") + ")");
      if (pres.missingNumbers.length) perdas.push("números (" + pres.missingNumbers.join(", ") + ")");
    }
    const inventados = addedTokens(s.original, s.suggested);
    if (inventados.length) perdas.push("conteúdo inventado: " + inventados.join("; "));
    if (AI_TAG_RE.test(s.suggested) || INVIS_RE.test(s.suggested)) {
      perdas.push("marca de IA ou caractere invisível na sugestão");
    }
    const blocked = perdas.length > 0;
    if (blocked) warnings.push(`Sugestão "${s.id}" bloqueada: ${perdas.join("; ")}.`);
    suggestions.push({
      id: s.id,
      category: s.category,
      original: s.original,
      suggested: s.suggested,
      reason: s.reason || "",
      start: first,
      end: first + s.original.length,
      perdas,
      blocked,
    });
  }
  if (errors.length) return { ok: false, errors, warnings, data: null };
  return {
    ok: true,
    errors,
    warnings,
    data: { schema: contract.schema, blockId: raw.blockId, suggestions },
  };
}

/** Igual a validateAiResponse, mas lança Error com todos os problemas listados. */
export function parseAiResponse(text, body, expectedBlockId, contract = AI_CONTRACT_STYLE) {
  const r = validateAiResponse(text, body, expectedBlockId, contract);
  if (!r.ok) throw new Error("Resposta da IA recusada:\n- " + r.errors.join("\n- "));
  return r.data;
}

/**
 * Converte as sugestões validadas e NÃO bloqueadas em propostas do
 * diffEngine (start/end/before/after/contexto, status "pending").
 * Lança erro se duas sugestões se sobrepõem — o diff não aceita isso.
 */
export function aiSuggestionsToProposals(data, body) {
  const src = String(body ?? "");
  const usable = (data.suggestions || []).filter((s) => !s.blocked);
  const sorted = [...usable].sort((a, b) => a.start - b.start);
  const out = [];
  let cursor = 0;
  for (const s of sorted) {
    if (src.slice(s.start, s.end) !== s.original) {
      throw new Error(`Sugestão "${s.id}": o trecho original não confere com o bloco na posição ${s.start}.`);
    }
    if (s.start < cursor) {
      throw new Error(`Sugestões "${s.id}" e anterior se sobrepõem — peça trechos sem sobreposição.`);
    }
    out.push({
      id: s.id,
      category: s.category === "cliche" ? "style_ai_cliche" : "style_ai_variation",
      label: s.category === "cliche" ? "IA: reformulação de clichê" : "IA: variação de período",
      start: s.start,
      end: s.end,
      before: s.original,
      after: s.suggested,
      contextBefore: src.slice(Math.max(0, s.start - 28), s.start),
      contextAfter: src.slice(s.end, Math.min(src.length, s.end + 28)),
      reason: s.reason || "",
      status: "pending",
    });
    cursor = s.end;
  }
  return out;
}

/** Cria a sessão de revisão (diff item a item) a partir da resposta validada. */
export function createAiReviewSession(data, body) {
  return createReviewSession(String(body ?? ""), aiSuggestionsToProposals(data, body));
}

/**
 * Converte a sessão revisada em proposta no formato antigo da ponte
 * (o mesmo que proposeForBlocks devolve), para alimentar buildReview.
 * Só o que foi ACEITO entra no `after`; pendente e rejeitado não
 * alteram nada. Se o texto aceito quebrar a trava, a proposta nasce
 * bloqueada e o buildReview a exclui.
 * `block` = { blockId, body, title?, beforeHash? }.
 */
export function aiSessionToBlockProposal(block, session) {
  const before = String(block.body ?? "");
  const after = renderSessionText(session);
  const accepted = session.proposals.filter((p) => p.status === "accepted");
  const perdas = after === before ? [] : preservationLoss(before, after, "style");
  const beforeHash = blockHash(before);
  return {
    blockId: block.blockId,
    title: block.title || block.blockId,
    category: "style_human_approved",
    beforeHash,
    before,
    after,
    changed: after !== before,
    counts: { suggestions: session.proposals.length, accepted: accepted.length },
    perdas,
    blocked: perdas.length > 0,
    hashMatchesSource: !block.beforeHash || block.beforeHash === beforeHash,
  };
}
