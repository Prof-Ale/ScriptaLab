import { UP, NAME, titleCase, normStr, escapeHtml, paras, isLongQuote, lastSurname } from "./textUtils.js";
import { INVIS, AI_TAGS, UTM, HYPH_BREAK, scanScrubIssues, scrubText } from "./scrubber.js";
import {
  SIGLAS, isSigla, mkCit, LATIN_ITALIC, REF_HEAD, startsRef, splitReferences, checkEtAlUniformity, checkCitationPeriods,
} from "./abnt10520.js";
import {
  ABBR, splitSentences, wordsOf, countWords, sentenceStats, CV_BANDS, cvBand, CLICHES_DEFAULT, compileCliche, findCliches, highlightHtml, analyzeStyle,
} from "./stylometry.js";
import {
  collectCitations, parseEntry, crossCheckRefs, extractDois, refBlockFor, compareRef,
} from "./citationAuditor.js";
import {
  buildProposals, createReviewSession, acceptProposal, rejectProposal, acceptAllProposals, undoLastAction, resetSession, renderSessionText, summarizeSession,
} from "./diffEngine.js";
import {
  classifyReferenceType, referenceSortKey, auditReferenceEntry, sortReferencesAlphabetically, auditReferencesSection, formatReferencesSectionSorted, isCaptionOrNote,
} from "./abnt6023.js";
import {
  detectAiSyntaxPatterns, buildVoiceProfile, compareToVoiceProfile, extractProtectedTokens, validateConceptualPreservation, buildLiteraryReviewPrompt,
} from "./literaryReview.js";
import {
  sha256Hex, blockHash, preservationLoss, normalizeBlock, parseSource, proposeForBlocks, buildReview, SOURCE_SCHEMA, REVIEW_SCHEMA,
} from "./mathlabBridge.js";
import {
  AI_SUGGESTION_SCHEMA, buildAiPrompt, parseAiResponse, validateAiResponse, aiSuggestionsToProposals, createAiReviewSession, aiSessionToBlockProposal,
} from "./aiBridge.js";
import {
  locateCrossCheck, locateMissingCitations, locateUncitedReferences,
} from "./citationLocations.js";
import {
  NETWORK_HOSTS, classifyUrl, describeOutgoing, offlineError, createNetworkLog,
} from "./networkLog.js";
import {
  createAuditWorkerClient, AUDIT_WORKER_PROTOCOL,
} from "./auditWorkerClient.js";

export {
  UP, NAME, titleCase, normStr, escapeHtml, paras, isLongQuote, lastSurname,
  INVIS, AI_TAGS, UTM, HYPH_BREAK, scanScrubIssues, scrubText,
  SIGLAS, isSigla, mkCit, LATIN_ITALIC, REF_HEAD, startsRef, splitReferences, checkEtAlUniformity, checkCitationPeriods,
  ABBR, splitSentences, wordsOf, countWords, sentenceStats, CV_BANDS, cvBand, CLICHES_DEFAULT, compileCliche, findCliches, highlightHtml, analyzeStyle,
  collectCitations, parseEntry, crossCheckRefs, extractDois, refBlockFor, compareRef,
  buildProposals, createReviewSession, acceptProposal, rejectProposal, acceptAllProposals, undoLastAction, resetSession, renderSessionText, summarizeSession,
  classifyReferenceType, referenceSortKey, auditReferenceEntry, sortReferencesAlphabetically, auditReferencesSection, formatReferencesSectionSorted, isCaptionOrNote,
  detectAiSyntaxPatterns, buildVoiceProfile, compareToVoiceProfile, extractProtectedTokens, validateConceptualPreservation, buildLiteraryReviewPrompt,
  sha256Hex, blockHash, preservationLoss, normalizeBlock, parseSource, proposeForBlocks, buildReview, SOURCE_SCHEMA, REVIEW_SCHEMA,
  AI_SUGGESTION_SCHEMA, buildAiPrompt, parseAiResponse, validateAiResponse, aiSuggestionsToProposals, createAiReviewSession, aiSessionToBlockProposal,
  locateCrossCheck, locateMissingCitations, locateUncitedReferences,
  NETWORK_HOSTS, classifyUrl, describeOutgoing, offlineError, createNetworkLog,
  createAuditWorkerClient, AUDIT_WORKER_PROTOCOL,
};

export const ScriptaCore = {
  INVIS, AI_TAGS, UTM, HYPH_BREAK, scanScrubIssues, scrubText,
  mkCit, titleCase, normStr, escapeHtml, paras, isLongQuote,
  SIGLAS, isSigla, LATIN_ITALIC, checkEtAlUniformity, checkCitationPeriods,
  splitSentences, countWords, sentenceStats, cvBand, CV_BANDS,
  CLICHES_DEFAULT, findCliches, highlightHtml, analyzeStyle,
  collectCitations, splitReferences, crossCheckRefs, extractDois, refBlockFor, compareRef,
  buildProposals, createReviewSession, acceptProposal, rejectProposal, acceptAllProposals, undoLastAction, resetSession, renderSessionText, summarizeSession,
  classifyReferenceType, referenceSortKey, auditReferenceEntry, sortReferencesAlphabetically, auditReferencesSection, formatReferencesSectionSorted, isCaptionOrNote,
  detectAiSyntaxPatterns, buildVoiceProfile, compareToVoiceProfile, extractProtectedTokens, validateConceptualPreservation, buildLiteraryReviewPrompt,
  sha256Hex, blockHash, preservationLoss, normalizeBlock, parseSource, proposeForBlocks, buildReview, SOURCE_SCHEMA, REVIEW_SCHEMA,
  AI_SUGGESTION_SCHEMA, buildAiPrompt, parseAiResponse, validateAiResponse, aiSuggestionsToProposals, createAiReviewSession, aiSessionToBlockProposal,
  locateCrossCheck, locateMissingCitations, locateUncitedReferences,
  NETWORK_HOSTS, classifyUrl, describeOutgoing, offlineError, createNetworkLog,
  createAuditWorkerClient, AUDIT_WORKER_PROTOCOL,
};

export default ScriptaCore;
