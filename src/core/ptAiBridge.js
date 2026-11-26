/**
 * Ponte de IA (copiar e colar) para REVISÃO DE PORTUGUÊS.
 *
 * Mesma filosofia do aiBridge.js: nenhum texto sai do navegador pelo ScriptaLab.
 * O usuário copia o prompt, cola no LLM que já usa e cola a resposta de volta.
 * Contrato próprio: "scriptalab.pt-suggestion/1" (o contrato scriptalab.ai-suggestion/1
 * e o scriptalab.review/1 não mudam). A validação, a trava de preservação
 * (números, citações, DOIs, fórmulas, [F#]) e o diff item a item são os mesmos.
 *
 * A IA entra onde regra local não alcança com segurança: crase em casos
 * dependentes de contexto, concordância à distância, regência, pontuação de
 * orações, ortografia de termos fora do dicionário. Corrige; não reescreve.
 */
import { validateAiResponse, parseAiResponse, extractJsonObject } from "./aiBridge.js";
import { createReviewSession } from "./diffEngine.js";
import { PT_REGISTROS } from "./ptRevisor.js";

export const PT_SUGGESTION_SCHEMA = "scriptalab.pt-suggestion/1";
export const PT_CATEGORIES = ["ortografia", "pontuacao", "crase", "concordancia", "regencia", "clareza"];
export const PT_CONTRACT = Object.freeze({ schema: PT_SUGGESTION_SCHEMA, categories: PT_CATEGORIES });
export { extractJsonObject };

const CAT_LABEL = {
  ortografia: "Ortografia",
  pontuacao: "Pontuação",
  crase: "Crase",
  concordancia: "Concordância",
  regencia: "Regência",
  clareza: "Clareza",
};

/**
 * Prompt para o LLM do usuário. `block` = { blockId, body, title? }.
 * `opts.registro` define o tom; `opts.achados` (opcional) lista o que o revisor local
 * já sinalizou para a IA confirmar ou descartar.
 */
export function buildPtPrompt(block, opts = {}) {
  const b = block || {};
  const body = String(b.body ?? "");
  const blockId = String(b.blockId ?? "bloco-1");
  const registro = PT_REGISTROS[opts.registro] || PT_REGISTROS.academico;
  const achados = (opts.achados || []).slice(0, 25);
  const lista = achados.length
    ? achados.map((a, i) => `${i + 1}. [${a.categoria}] “${a.trecho}” — ${a.msg}`).join("\n")
    : "Nenhum achado local. Verifique ortografia, crase, concordância, regência e pontuação.";
  return [
    "# Revisão de português — ScriptaLab (copiar e colar)",
    "",
    `Você é um revisor de português (norma-padrão, Brasil). Registro do texto: ${registro.label}.`,
    "Corrija SÓ erros de norma. Não reescreva, não melhore o estilo, não mude o sentido.",
    "",
    "## Regras obrigatórias",
    "1. NÃO remova, invente nem altere números, citações (Autor, ano), DOIs, fórmulas/LaTeX ou marcadores [F1], [Fonte 1].",
    "2. NÃO mexa em trechos entre aspas (são citações do autor) nem em nomes próprios, siglas e termos técnicos.",
    "3. NÃO invente dados, autores ou referências.",
    "4. Proponha no máximo 10 correções, cada uma com o MENOR trecho possível (a palavra errada e o necessário em volta).",
    "5. Cada \"original\" tem que ser copiado EXATAMENTE como está no trecho e aparecer uma única vez nele (inclua uma palavra de contexto se precisar).",
    "6. Na dúvida entre erro e escolha do autor, NÃO proponha.",
    "7. Responda SOMENTE com o JSON abaixo, sem texto antes ou depois, sem bloco de código.",
    "",
    `## Trecho (bloco ${blockId}${b.title ? " — " + b.title : ""})`,
    body,
    "",
    "## O que o revisor local já sinalizou (confirme ou descarte)",
    lista,
    "",
    "## Formato exato da resposta",
    "{",
    `  "schema": "${PT_SUGGESTION_SCHEMA}",`,
    `  "blockId": "${blockId}",`,
    "  \"suggestions\": [",
    "    { \"id\": \"p1\", \"category\": \"crase\", \"original\": \"trecho exato\", \"suggested\": \"trecho corrigido\", \"reason\": \"regra aplicada, em uma frase\" }",
    "  ]",
    "}",
    "",
    `Categorias permitidas: ${PT_CATEGORIES.map((c) => `"${c}"`).join(", ")}.`,
  ].join("\n");
}

export const validatePtResponse = (text, body, expectedBlockId) => validateAiResponse(text, body, expectedBlockId, PT_CONTRACT);
export const parsePtResponse = (text, body, expectedBlockId) => parseAiResponse(text, body, expectedBlockId, PT_CONTRACT);

/** Propostas do diffEngine (status "pending") a partir da resposta validada; ignora as bloqueadas. */
export function ptSuggestionsToProposals(data, body) {
  const src = String(body ?? "");
  const usable = (data.suggestions || []).filter((s) => !s.blocked).sort((a, b) => a.start - b.start);
  const out = [];
  let cursor = 0;
  for (const s of usable) {
    if (src.slice(s.start, s.end) !== s.original) throw new Error(`Sugestão "${s.id}": o trecho original não confere com o texto na posição ${s.start}.`);
    if (s.start < cursor) throw new Error(`Sugestão "${s.id}" se sobrepõe à anterior — peça trechos sem sobreposição.`);
    out.push({
      id: s.id,
      category: `pt_ai_${s.category}`,
      label: `IA — ${CAT_LABEL[s.category] || s.category}${s.reason ? ": " + s.reason : ""}`,
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

export function createPtReviewSession(data, body) {
  return createReviewSession(String(body ?? ""), ptSuggestionsToProposals(data, body));
}
