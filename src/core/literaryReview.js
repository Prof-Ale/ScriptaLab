import { normStr, paras } from "./textUtils.js";
import { splitSentences, wordsOf, sentenceStats, analyzeStyle } from "./stylometry.js";
import { collectCitations, extractDois } from "./citationAuditor.js";

/**
 * Detecta padrões sintáticos e estruturais frequentemente associados a escrita robótica de IA.
 * Apenas mede e sinaliza (Zero-Tampering); não constitui prova de autoria.
 */
export function detectAiSyntaxPatterns(text) {
  const s = String(text || "");
  const paragraphs = paras(s);

  // 1. Tríades adjetivas/nominais ("X, Y e Z")
  const triadRe = /\b[\p{L}]{4,},\s+[\p{L}]{4,}\s+e\s+[\p{L}]{4,}\b/gu;
  const triads = s.match(triadRe) || [];

  // 2. Listas repetitivas no padrão "- **Rótulo:** texto"
  const boldColonLines = s
    .split(/\r?\n/)
    .filter((line) => /^\s*(?:[-*•]|\d+\.)\s+\*\*[^*]{2,60}:\*\*/.test(line));

  // 3. Parágrafos "gêmeos" (3+ parágrafos consecutivos de prosa com variação < 12% no nº de palavras)
  const proseLengths = paragraphs
    .filter((p) => wordsOf(p).length >= 15)
    .map((p) => wordsOf(p).length);
  let twinRuns = 0;
  for (let i = 0; i <= proseLengths.length - 3; i++) {
    const trio = [proseLengths[i], proseLengths[i + 1], proseLengths[i + 2]];
    const min = Math.min(...trio);
    const max = Math.max(...trio);
    if (min > 0 && (max - min) / max < 0.12) {
      twinRuns++;
      i += 2;
    }
  }

  // 4. Abertura repetida em parágrafos consecutivos (primeiras 2 palavras normalizadas iguais)
  const repeatedOpeners = [];
  for (let i = 1; i < paragraphs.length; i++) {
    const prev = wordsOf(paragraphs[i - 1]).slice(0, 2).map(normStr).join(" ");
    const curr = wordsOf(paragraphs[i]).slice(0, 2).map(normStr).join(" ");
    if (prev && prev === curr) {
      repeatedOpeners.push({ paragraphIndex: i, opener: wordsOf(paragraphs[i]).slice(0, 2).join(" ") });
    }
  }

  // 5. Diversidade lexical em palavras de conteúdo (> 3 letras)
  const contentWords = wordsOf(s).map(normStr).filter((w) => w.length > 3);
  const uniqueContent = new Set(contentWords);
  const ttr = contentWords.length ? uniqueContent.size / contentWords.length : 0;
  const guiraud = contentWords.length ? uniqueContent.size / Math.sqrt(contentWords.length) : 0;

  const alerts = [];
  if (triads.length >= 3) {
    alerts.push({
      code: "EXCESSIVE_TRIADS",
      message: `${triads.length} tríades paralelas ("X, Y e Z") detectadas — avalie variar o ritmo enumerativo.`,
    });
  }
  if (boldColonLines.length >= 3) {
    alerts.push({
      code: "BOLD_COLON_LISTS",
      message: `${boldColonLines.length} itens no padrão "**Rótulo:** explicação" — avalie converter parte em prosa orgânica.`,
    });
  }
  if (twinRuns > 0) {
    alerts.push({
      code: "TWIN_PARAGRAPHS",
      message: `${twinRuns} sequência(s) de 3+ parágrafos com extensão quase idêntica — varie o tamanho dos parágrafos.`,
    });
  }
  if (repeatedOpeners.length > 0) {
    alerts.push({
      code: "REPEATED_OPENERS",
      message: `${repeatedOpeners.length} parágrafo(s) consecutivo(s) iniciando com a mesma abertura ("${repeatedOpeners[0].opener}").`,
    });
  }

  return {
    triadsCount: triads.length,
    triads: triads.slice(0, 10),
    boldColonListCount: boldColonLines.length,
    twinParagraphRuns: twinRuns,
    repeatedOpeners,
    lexicalDiversity: {
      contentWords: contentWords.length,
      uniqueContentWords: uniqueContent.size,
      ttr: Number(ttr.toFixed(3)),
      guiraud: Number(guiraud.toFixed(2)),
    },
    alerts,
  };
}

/**
 * Calibra um Perfil de Voz Autoral (VoiceProfile) a partir de textos autênticos do autor.
 */
export function buildVoiceProfile(sampleTexts, label = "Voz Autoral") {
  const samples = (Array.isArray(sampleTexts) ? sampleTexts : [sampleTexts])
    .map((t) => String(t || "").trim())
    .filter(Boolean);
  const combined = samples.join("\n\n");
  const sentences = splitSentences(combined);
  const stats = sentenceStats(sentences);
  const paragraphs = paras(combined);
  const totalWords = stats.total || 0;
  const avgParagraphWords = paragraphs.length
    ? paragraphs.reduce((acc, p) => acc + wordsOf(p).length, 0) / paragraphs.length
    : 0;
  const questions = (combined.match(/\?/g) || []).length;
  const emDashes = (combined.match(/—/g) || []).length;
  const syntax = detectAiSyntaxPatterns(combined);

  return {
    schema: "scriptalab.voice/1",
    label,
    sampleCount: samples.length,
    totalWords,
    sentenceMean: Number(stats.mean.toFixed(2)),
    sentenceSd: Number(stats.sd.toFixed(2)),
    cvPercent: stats.cv == null ? null : Number(stats.cv.toFixed(2)),
    avgParagraphWords: Number(avgParagraphWords.toFixed(2)),
    questionRatePer1000: totalWords ? Number(((questions / totalWords) * 1000).toFixed(2)) : 0,
    emDashPer1000: totalWords ? Number(((emDashes / totalWords) * 1000).toFixed(2)) : 0,
    lexicalDiversity: syntax.lexicalDiversity,
  };
}

/**
 * Compara um rascunho contra o VoiceProfile do autor (apoio estilístico, nunca punitivo).
 */
export function compareToVoiceProfile(text, profile) {
  if (!profile || profile.schema !== "scriptalab.voice/1") {
    throw new Error("VoiceProfile inválido: esperado schema scriptalab.voice/1");
  }
  const current = buildVoiceProfile([text], "Rascunho atual");
  const observations = [];

  const sentenceMeanDelta = Number((current.sentenceMean - profile.sentenceMean).toFixed(2));
  if (Math.abs(sentenceMeanDelta) >= 6) {
    observations.push(
      sentenceMeanDelta > 0
        ? `Períodos em média ${sentenceMeanDelta} palavras mais longos que o seu perfil autoral (${profile.label}).`
        : `Períodos em média ${Math.abs(sentenceMeanDelta)} palavras mais curtos que o seu perfil autoral (${profile.label}).`
    );
  }

  const cvDelta =
    current.cvPercent != null && profile.cvPercent != null
      ? Number((current.cvPercent - profile.cvPercent).toFixed(2))
      : null;
  if (cvDelta != null && cvDelta <= -12) {
    observations.push(
      `Ritmo mais uniforme que o seu perfil autoral (CV ${current.cvPercent}% vs ${profile.cvPercent}%).`
    );
  }

  const paragraphLengthDelta = Number((current.avgParagraphWords - profile.avgParagraphWords).toFixed(2));
  if (Math.abs(paragraphLengthDelta) >= 25) {
    observations.push(
      paragraphLengthDelta > 0
        ? `Parágrafos mais densos que o habitual no seu perfil (+${paragraphLengthDelta} palavras/parágrafo).`
        : `Parágrafos mais curtos que o habitual no seu perfil (${paragraphLengthDelta} palavras/parágrafo).`
    );
  }

  return {
    profileLabel: profile.label,
    current,
    deltas: {
      sentenceMeanDelta,
      cvDelta,
      paragraphLengthDelta,
    },
    observations,
  };
}

/**
 * Extrai invariantes epistêmicos que NÃO podem ser perdidos em reescrita estilística/humanização.
 */
export function extractProtectedTokens(text) {
  const s = String(text || "");
  const citations = collectCitations(s).map((c) => `${normStr(c.sur)}:${c.year}`);
  const dois = extractDois(s).map((d) => d.toLowerCase());
  const formulas = [
    ...(s.match(/\$\$[\s\S]+?\$\$/g) || []),
    ...(s.match(/(?<!\$)\$(?!\$)[^$\n]+\$(?!\$)/g) || []),
    ...(s.match(/\\\[[\s\S]+?\\\]/g) || []),
    ...(s.match(/\\\([\s\S]+?\\\)/g) || []),
  ].map((f) => f.replace(/\s+/g, " ").trim());
  const sourceMarkers = [...new Set(s.match(/\[(?:F|Fonte\s*)\d+\]/gi) || [])].map((m) => m.toUpperCase());
  const numbers = [...new Set(s.match(/\b\d+(?:[.,]\d+)?%?/g) || [])];
  return { citations, dois, formulas, sourceMarkers, numbers };
}

/**
 * Trava de preservação conceitual: bloqueia reescritas estilísticas que removam ou corrompam
 * citações, DOIs, fórmulas matemáticas/LaTeX ou marcadores de fonte do autor.
 */
export function validateConceptualPreservation(beforeText, afterText, options = {}) {
  const checkNumbers = options.strictNumbers === true;
  const before = extractProtectedTokens(beforeText);
  const after = extractProtectedTokens(afterText);

  const afterCitSet = new Set(after.citations);
  const afterDoiSet = new Set(after.dois);
  const afterFormSet = new Set(after.formulas);
  const afterMarkSet = new Set(after.sourceMarkers);
  const afterNumSet = new Set(after.numbers);

  const missingCitations = before.citations.filter((c) => !afterCitSet.has(c));
  const missingDois = before.dois.filter((d) => !afterDoiSet.has(d));
  const missingFormulas = before.formulas.filter((f) => !afterFormSet.has(f));
  const missingMarkers = before.sourceMarkers.filter((m) => !afterMarkSet.has(m));
  const missingNumbers = checkNumbers ? before.numbers.filter((n) => !afterNumSet.has(n)) : [];

  const preserved =
    missingCitations.length === 0 &&
    missingDois.length === 0 &&
    missingFormulas.length === 0 &&
    missingMarkers.length === 0 &&
    missingNumbers.length === 0;

  return {
    preserved,
    missingCitations,
    missingDois,
    missingFormulas,
    missingMarkers,
    missingNumbers,
  };
}

/**
 * Gera pedido cirúrgico de revisão literária/estilística (opt-in) respeitando Zero-Tampering
 * e proibindo invenção de fontes ou autoaprovação humana.
 */
export function buildLiteraryReviewPrompt(text, options = {}) {
  const style = analyzeStyle(text, options.cliches);
  const syntax = detectAiSyntaxPatterns(text);
  const voiceComparison = options.voiceProfile ? compareToVoiceProfile(text, options.voiceProfile) : null;

  const lines = [
    "# Pedido de Revisão Literária e Estilística (ScriptaLab)",
    "",
    "## Regras obrigatórias (Trava de Preservação Conceitual)",
    "1. NÃO remova, invente nem altere citações (Autor, ano), DOIs, fórmulas matemáticas/LaTeX ou marcadores [F1], [Fonte 1].",
    "2. NÃO invente dados, datas, autores ou referências bibliográficas.",
    "3. NÃO declare o texto como validado ou aprovado por humano.",
    "4. Mantenha rigor conceitual e terminologia da área; melhore apenas fluidez, ritmo, coesão e naturalidade autoral.",
    "",
    "## Diagnóstico estilométrico detectado",
    `- Palavras: ${style.totalWords} | Períodos: ${style.stats.n} | CV rítmico: ${style.stats.cv == null ? "n/a" : style.stats.cv.toFixed(1) + "%"}`,
    `- Clichês PT-BR detectados: ${style.matches.length}`,
  ];

  if (style.groups.length) {
    lines.push("- Expressões a revisar: " + style.groups.slice(0, 6).map((g) => `"${g.label}" (${g.count}x)`).join(", "));
  }
  for (const alert of syntax.alerts) {
    lines.push(`- Padrão estrutural [${alert.code}]: ${alert.message}`);
  }
  if (voiceComparison && voiceComparison.observations.length) {
    lines.push("", `## Calibração de Voz Autoral (${voiceComparison.profileLabel})`);
    for (const obs of voiceComparison.observations) lines.push(`- ${obs}`);
  }

  lines.push("", "## Texto-base para revisão cirúrgica", text);
  return {
    prompt: lines.join("\n"),
    diagnostics: { style, syntax, voiceComparison },
  };
}
