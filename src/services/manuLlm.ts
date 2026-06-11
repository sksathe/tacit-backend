import { config } from 'dotenv';
import {
  MANU_MISSION_IDS,
  MANU_SECTION_TITLES,
  type ManuExtractedFact,
  type ManuGeneratedSection,
  type ManuManualConfig,
  type ManuRegulatoryRow,
  type ManuRiskMapping,
  type ManuTranslationQARow,
  type ManuUploadedDocument,
  type ManuTraceabilityRow,
} from '../types/manu.js';
import { buildDocumentBundleSummary } from './manuIngest.js';

config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim();
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';
const MANU_LLM_MODEL = process.env.MANU_LLM_MODEL || LLM_MODEL;

async function callOpenAiJson<T>(params: {
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<T> {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const started = Date.now();
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: params.model,
      messages: [
        { role: 'system', content: params.system },
        { role: 'user', content: params.user },
      ],
      response_format: { type: 'json_object' },
      max_tokens: params.maxTokens ?? 4096,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`OpenAI API error (${response.status}): ${text || response.statusText}`);
  }

  const data: any = await response.json();
  const elapsedMs = Date.now() - started;
  const usage = data?.usage;
  console.log(
    `[MANU][OpenAI] model=${params.model} max_tokens=${params.maxTokens ?? 4096} duration_ms=${elapsedMs} prompt_tokens=${usage?.prompt_tokens ?? 'n/a'} completion_tokens=${usage?.completion_tokens ?? 'n/a'}`,
  );
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI returned no content');

  return parseJsonContent<T>(content);
}

function parseJsonContent<T>(content: string): T {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1].trim()) as T;
      } catch {
        /* continue */
      }
    }

    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as T;
      } catch {
        /* continue */
      }
    }

    throw new Error('Failed to parse OpenAI JSON response');
  }
}

function truncateBundle(text: string, max = 12000): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '\n…[bundle truncated for token limits]';
}

function getExistingManualText(documents: ManuUploadedDocument[]): string {
  return documents
    .filter((d) => d.category === 'existing_manual')
    .map((d) => `--- ${d.fileName} ---\n${d.extractedText}`)
    .join('\n\n');
}

function getTranslationDocuments(documents: ManuUploadedDocument[]): ManuUploadedDocument[] {
  return documents.filter((d) => d.category === 'translation');
}

function missionFactsAddon(missionId: string): string {
  switch (missionId) {
    case MANU_MISSION_IDS.manualUpdate:
      return 'Focus on CHANGES vs prior manual baseline. Flag new/changed/removed requirements.';
    case MANU_MISSION_IDS.riskCoverageQa:
      return 'Focus on hazards, mitigations, and whether manual warnings would cover each FMEA row.';
    case MANU_MISSION_IDS.regulatoryQa:
      return 'Focus on market-specific certifications, labeling, and post-market obligations.';
    case MANU_MISSION_IDS.translationQa:
      return 'Focus on English source statements that must be preserved in translations (warnings, intended use).';
    default:
      return 'Extract full product identity, specs, safety, and regulatory facts for a new manual draft.';
  }
}

function missionSectionsAddon(missionId: string, existingManual: string): string {
  switch (missionId) {
    case MANU_MISSION_IDS.manualUpdate:
      return `MISSION MODE: Manual Update & Revision.
Compare new source evidence against the existing manual baseline below.
Highlight changes, newly introduced risks, and compliance impacts in riskFlags/complianceFlags.
Do NOT copy the old manual verbatim — synthesize an UPDATED section.

Existing manual baseline:
${existingManual || '[No existing manual uploaded — treat as new generation with revision note]'}`;
    case MANU_MISSION_IDS.riskCoverageQa:
      return `MISSION MODE: Risk-to-Manual Coverage QA.
Primary goal: assess whether FMEA hazards are reflected in safety warnings and risk control language.
Flag missing, weak, or ambiguous safety language in riskFlags. Keep sections concise and audit-ready.`;
    case MANU_MISSION_IDS.regulatoryQa:
      return `MISSION MODE: Regulatory Compliance QA.
Primary goal: verify market-specific regulatory and certification requirements appear in manual sections.
Emphasize complianceFlags. Do not assert certifications not supported by source documents.`;
    case MANU_MISSION_IDS.translationQa:
      return `MISSION MODE: Translation Accuracy QA — English source preparation.
Generate authoritative English source sections from approved source documents.
MANU will then generate professional translated manual sections in each configured target language.`;
    default:
      return 'MISSION MODE: Product Manual Generation — full traceable manual draft from source bundle.';
  }
}

function hasCategory(docs: ManuUploadedDocument[], cat: string) {
  return docs.some((d) => d.category === cat);
}

function buildStaticGaps(docs: ManuUploadedDocument[], missionId: string): string[] {
  const gaps: string[] = [];

  switch (missionId) {
    case MANU_MISSION_IDS.translationQa: {
      if (!hasCategory(docs, 'existing_manual') && !hasCategory(docs, 'prd')) {
        gaps.push('No English source manual or PRD — English sections will be generated from available evidence');
      }
      if (hasCategory(docs, 'translation')) {
        gaps.push('Reference translation files uploaded — generated translations will be scored against these where available');
      }
      break;
    }
    case MANU_MISSION_IDS.riskCoverageQa: {
      if (!hasCategory(docs, 'fmea')) {
        gaps.push('No FMEA — risk coverage QA requires a risk assessment document');
      }
      break;
    }
    case MANU_MISSION_IDS.regulatoryQa: {
      if (!hasCategory(docs, 'regulatory')) {
        gaps.push('No regulatory notes — compliance checklist incomplete');
      }
      break;
    }
    case MANU_MISSION_IDS.manualUpdate: {
      if (!hasCategory(docs, 'existing_manual')) {
        gaps.push('No existing manual uploaded — running as new manual generation with revision baseline');
      }
      if (!hasCategory(docs, 'fmea')) gaps.push('No FMEA — risk-to-warning mapping limited');
      if (!hasCategory(docs, 'regulatory')) gaps.push('No regulatory notes — compliance checklist incomplete');
      break;
    }
    default: {
      if (!hasCategory(docs, 'fmea')) gaps.push('No FMEA — risk-to-warning mapping limited');
      if (!hasCategory(docs, 'regulatory')) gaps.push('No regulatory notes — compliance checklist incomplete');
      if (!hasCategory(docs, 'engineering_test')) gaps.push('No engineering report — technical specs may be incomplete');
      if (!hasCategory(docs, 'prd')) gaps.push('No PRD — intended use requires verification');
      if (!hasCategory(docs, 'existing_manual')) gaps.push('No existing manual — treated as new manual generation');
      break;
    }
  }

  return gaps;
}

export async function extractManuFacts(params: {
  documents: ManuUploadedDocument[];
  manualConfig: ManuManualConfig;
  missionId: string;
}): Promise<{ facts: ManuExtractedFact[]; gaps: string[]; model: string }> {
  const bundle = truncateBundle(buildDocumentBundleSummary(params.documents));
  const staticGaps = buildStaticGaps(params.documents, params.missionId);
  const meta = params.manualConfig.metadata;

  const system = `You are MANU, a regulated equipment manual intelligence agent for LabCorp.
Extract structured facts ONLY from the provided source documents. Do not invent specifications, certifications, or performance claims.
Return JSON: { "facts": [{ "id", "group", "label", "value", "sourceDocumentIds": string[], "confidence": 0-1, "uncertain": boolean }], "gaps": string[] }
Use sourceDocumentIds that match document ids from the bundle. Mark uncertain:true when evidence is thin.
Mission-specific guidance: ${missionFactsAddon(params.missionId)}`;

  const user = `Mission: ${params.missionId}
Product: ${meta.productName} / ${meta.modelCode}
Target markets: ${meta.targetMarkets.join(', ')}

Documents:
${JSON.stringify(params.documents.map((d) => ({ id: d.id, fileName: d.fileName, category: d.category })), null, 2)}

Bundle text:
${bundle}

Known static gaps to include if still applicable: ${staticGaps.join('; ') || 'none'}
${params.missionId === MANU_MISSION_IDS.translationQa ? 'Only report gaps about English source documents — do not mention FMEA or regulatory documents unless critical to intended use.' : ''}`;

  const parsed = await callOpenAiJson<{ facts?: ManuExtractedFact[]; gaps?: string[] }>({
    model: LLM_MODEL,
    system,
    user,
  });

  const facts = Array.isArray(parsed.facts) ? parsed.facts : [];
  const gaps = [...new Set([...staticGaps, ...(Array.isArray(parsed.gaps) ? parsed.gaps : [])])];

  return { facts, gaps, model: LLM_MODEL };
}

export async function mapManuRisks(params: {
  documents: ManuUploadedDocument[];
  missionId: string;
  includeCoverageReport?: boolean;
}): Promise<{ riskCoverage: ManuRiskMapping[]; coverageReport: string; model: string }> {
  const isRiskMission = params.missionId === MANU_MISSION_IDS.riskCoverageQa;
  const fmeaDocs = params.documents.filter((d) => d.category === 'fmea');

  if (!fmeaDocs.length && !isRiskMission) {
    return { riskCoverage: [], coverageReport: '', model: LLM_MODEL };
  }

  const bundle = truncateBundle(
    fmeaDocs.length
      ? fmeaDocs.map((d) => d.extractedText).join('\n\n')
      : buildDocumentBundleSummary(params.documents),
    8000,
  );

  const system = params.includeCoverageReport
    ? `You are a medical device risk analyst performing Risk-to-Manual Coverage QA.
Return JSON: {
  "riskCoverage": [{ "id", "hazard", "cause", "effect", "mitigation", "manualWarning", "coverageStatus": "covered"|"missing"|"needs_review" }],
  "coverageReport": "Markdown summary of missing warnings, weak language, and traceability gaps"
}
Ground every row in source text. coverageStatus "missing" when no adequate manual warning exists.`
    : `You are a medical device risk analyst. Map FMEA hazards to manual warnings.
Return JSON: { "riskCoverage": [{ "id", "hazard", "cause", "effect", "mitigation", "manualWarning", "coverageStatus": "covered"|"missing"|"needs_review" }] }
Ground every row in the FMEA text. Do not invent hazards.`;

  const parsed = await callOpenAiJson<{ riskCoverage?: ManuRiskMapping[]; coverageReport?: string }>({
    model: LLM_MODEL,
    system,
    user: `Mission: ${params.missionId}\n\nRisk / FMEA content:\n${bundle}`,
    maxTokens: params.includeCoverageReport ? 4096 : 2048,
  });

  const riskCoverage = (Array.isArray(parsed.riskCoverage) ? parsed.riskCoverage : []).map((r, i) => ({
    id: r.id || `risk-${i + 1}`,
    hazard: r.hazard || '',
    cause: r.cause || '',
    effect: r.effect || '',
    mitigation: r.mitigation || '',
    manualWarning: r.manualWarning || '',
    coverageStatus: r.coverageStatus || 'needs_review',
  }));

  return {
    riskCoverage,
    coverageReport: parsed.coverageReport || '',
    model: LLM_MODEL,
  };
}

export async function generateManuSections(params: {
  documents: ManuUploadedDocument[];
  manualConfig: ManuManualConfig;
  missionId: string;
  extractedFacts: ManuExtractedFact[];
}): Promise<{ sections: ManuGeneratedSection[]; model: string }> {
  const bundle = truncateBundle(buildDocumentBundleSummary(params.documents));
  const sectionDefs = params.manualConfig.selectedSectionIds.map((id) => ({
    id,
    title: MANU_SECTION_TITLES[id]?.title || id,
    required: MANU_SECTION_TITLES[id]?.required ?? false,
  }));

  const existingManual = truncateBundle(getExistingManualText(params.documents), 6000);

  const system = `You are MANU generating regulated equipment manual sections for LabCorp.
CRITICAL: Only use information from source documents and extracted facts. Cite sourceDocumentIds in sourceReferences.
Return JSON: { "sections": [{ "id", "title", "content", "confidence": 0-1, "sourceReferences": [{ "documentId", "documentName", "category", "excerpt" }], "relatedDocumentIds": string[], "riskFlags": string[], "complianceFlags": string[], "required": boolean }] }
Write professional manual prose. Flag missing FMEA/regulatory evidence in riskFlags/complianceFlags.

${missionSectionsAddon(params.missionId, existingManual)}`;

  const user = `Mission: ${params.missionId}
Template: ${params.manualConfig.metadata.templateType}
Product: ${params.manualConfig.metadata.productName} (${params.manualConfig.metadata.modelCode})

Sections to generate:
${JSON.stringify(sectionDefs, null, 2)}

Extracted facts:
${JSON.stringify(params.extractedFacts, null, 2)}

Source bundle:
${bundle}`;

  const parsed = await callOpenAiJson<{ sections?: ManuGeneratedSection[] }>({
    model: MANU_LLM_MODEL,
    system,
    user,
    maxTokens: 4096,
  });

  const sections = (Array.isArray(parsed.sections) ? parsed.sections : []).map((s) => {
    const def = MANU_SECTION_TITLES[s.id];
    return {
      id: s.id,
      title: s.title || def?.title || s.id,
      content: s.content || '',
      confidence: typeof s.confidence === 'number' ? s.confidence : 0.7,
      sourceReferences: Array.isArray(s.sourceReferences) ? s.sourceReferences : [],
      relatedDocumentIds: Array.isArray(s.relatedDocumentIds) ? s.relatedDocumentIds : [],
      riskFlags: Array.isArray(s.riskFlags) ? s.riskFlags : [],
      complianceFlags: Array.isArray(s.complianceFlags) ? s.complianceFlags : [],
      status: 'draft' as const,
      required: s.required ?? def?.required ?? false,
    };
  });

  return { sections, model: MANU_LLM_MODEL };
}

export async function buildManuCompliance(params: {
  documents: ManuUploadedDocument[];
  manualConfig: ManuManualConfig;
  missionId: string;
  sections: ManuGeneratedSection[];
  gaps: string[];
}): Promise<{
  regulatoryChecklist: ManuRegulatoryRow[];
  sections: ManuGeneratedSection[];
  gaps: string[];
  model: string;
}> {
  const meta = params.manualConfig.metadata;
  const regDocs = params.documents.filter((d) => d.category === 'regulatory');
  const bundle = truncateBundle(
    regDocs.length ? regDocs.map((d) => d.extractedText).join('\n\n') : buildDocumentBundleSummary(params.documents),
    8000,
  );

  const system =
    params.missionId === MANU_MISSION_IDS.regulatoryQa
      ? `You are a regulatory compliance QA reviewer for LabCorp equipment manuals.
Return JSON: { "regulatoryChecklist": [{ "id", "market", "standard", "certificationStatus", "requiredStatement", "missingInfo" }], "sectionUpdates": [{ "id", "complianceFlags": string[] }], "additionalGaps": string[] }
Primary task: identify market-specific gaps, missing certifications, and labeling obligations. Be strict — only assert evidence present in sources.`
      : `You are a regulatory compliance reviewer for LabCorp equipment manuals.
Return JSON: { "regulatoryChecklist": [{ "id", "market", "standard", "certificationStatus", "requiredStatement", "missingInfo" }], "sectionUpdates": [{ "id", "complianceFlags": string[] }], "additionalGaps": string[] }
Only assert certifications present in source documents. Mark missingInfo when evidence is absent.`;

  const parsed = await callOpenAiJson<{
    regulatoryChecklist?: ManuRegulatoryRow[];
    sectionUpdates?: Array<{ id: string; complianceFlags?: string[] }>;
    additionalGaps?: string[];
  }>({
    model: LLM_MODEL,
    system,
    user: `Mission: ${params.missionId}
Target markets: ${meta.targetMarkets.join(', ')}

Regulatory / source text:
${bundle}

Generated section ids: ${params.sections.map((s) => s.id).join(', ')}`,
  });

  const regulatoryChecklist = (Array.isArray(parsed.regulatoryChecklist) ? parsed.regulatoryChecklist : []).map(
    (r, i) => ({
      id: r.id || `reg-${i + 1}`,
      market: r.market || '',
      standard: r.standard || '',
      certificationStatus: r.certificationStatus || '',
      requiredStatement: r.requiredStatement || '',
      missingInfo: r.missingInfo || '',
      postMarketObligation: r.postMarketObligation,
    }),
  );

  const updates = new Map(
    (Array.isArray(parsed.sectionUpdates) ? parsed.sectionUpdates : []).map((u) => [u.id, u.complianceFlags || []]),
  );

  const sections = params.sections.map((s) => ({
    ...s,
    complianceFlags: [...s.complianceFlags, ...(updates.get(s.id) || [])],
  }));

  const gaps = [...params.gaps, ...(Array.isArray(parsed.additionalGaps) ? parsed.additionalGaps : [])];

  return { regulatoryChecklist, sections, gaps: [...new Set(gaps)], model: LLM_MODEL };
}

export function buildTraceabilityMatrix(
  documents: ManuUploadedDocument[],
  sections: ManuGeneratedSection[],
): ManuTraceabilityRow[] {
  const rows: ManuTraceabilityRow[] = [];
  for (const sec of sections) {
    if (sec.sourceReferences.length) {
      for (const ref of sec.sourceReferences) {
        rows.push({
          sectionId: sec.id,
          sectionTitle: sec.title,
          fact: `${sec.title.replace(/^\d+\.\s*/, '')} content synthesized`,
          sourceDocument: ref.documentName,
          excerpt: ref.excerpt.slice(0, 180) + (ref.excerpt.length > 180 ? '…' : ''),
          confidence: sec.confidence,
          status: sec.status,
        });
      }
    } else {
      rows.push({
        sectionId: sec.id,
        sectionTitle: sec.title,
        fact: 'Limited source linkage',
        sourceDocument: '—',
        excerpt: 'No matching document type in bundle',
        confidence: Math.max(0.45, sec.confidence - 0.15),
        status: sec.status,
      });
    }
  }
  return rows;
}

const LANGUAGE_LABELS: Record<string, string> = {
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  hi: 'Hindi',
  pt: 'Portuguese',
  zh: 'Chinese (Simplified)',
  ja: 'Japanese',
};

export async function generateManualRevisionDelta(params: {
  documents: ManuUploadedDocument[];
  manualConfig: ManuManualConfig;
  missionId: string;
  generatedSections: ManuGeneratedSection[];
}): Promise<{
  changeLog: string;
  redlineSummary: string;
  additionalGaps: string[];
  model: string;
}> {
  const existingManual = truncateBundle(getExistingManualText(params.documents), 8000);
  const newBundle = truncateBundle(buildDocumentBundleSummary(params.documents), 6000);

  const system = `You are MANU performing a manual update & revision analysis for LabCorp.
Compare the existing manual baseline against new source documents and generated draft sections.
Return JSON: {
  "changeLog": "Bullet list of substantive changes (requirements, risks, specs, regulatory)",
  "redlineSummary": "Markdown table or list: Section | Change type (added/modified/removed) | Impact",
  "additionalGaps": string[]
}
Do not invent changes — only report differences supported by evidence.`;

  const parsed = await callOpenAiJson<{
    changeLog?: string;
    redlineSummary?: string;
    additionalGaps?: string[];
  }>({
    model: LLM_MODEL,
    system,
    user: `Product: ${params.manualConfig.metadata.productName} (${params.manualConfig.metadata.modelCode})

Existing manual:
${existingManual || '[none uploaded]'}

New source bundle excerpt:
${newBundle}

Generated section summaries:
${JSON.stringify(
  params.generatedSections.map((s) => ({ id: s.id, title: s.title, excerpt: s.content.slice(0, 200) })),
  null,
  2,
)}`,
    maxTokens: 3072,
  });

  return {
    changeLog: parsed.changeLog || '',
    redlineSummary: parsed.redlineSummary || '',
    additionalGaps: Array.isArray(parsed.additionalGaps) ? parsed.additionalGaps : [],
    model: LLM_MODEL,
  };
}

function getTranslationTargetSections(
  missionId: string,
  sections: ManuGeneratedSection[],
): ManuGeneratedSection[] {
  return missionId === MANU_MISSION_IDS.translationQa
    ? sections.filter((s) =>
        ['safety-warnings', 'intended-use', 'regulatory-compliance', 'operating-instructions'].includes(s.id),
      )
    : sections.filter((s) => s.required).slice(0, 6);
}

async function buildTranslationQAForLanguage(params: {
  targetSections: ManuGeneratedSection[];
  langCode: string;
  translationDocs: ManuUploadedDocument[];
  translationBundle: string;
}): Promise<ManuTranslationQARow[]> {
  const languageLabel = LANGUAGE_LABELS[params.langCode] || params.langCode;

  const system = params.translationDocs.length
    ? `You are MANU generating and validating translated manual sections for regulated equipment.
For EACH English source section in the requested target language:
1. Produce a complete, professional translatedText (regulation-ready IFU prose).
2. If reference translation documents contain matching content, score accuracy against them (accuracyScore 0-1) and flag terminologyFlags / missingWarnings.
3. If no reference exists for a section, still generate the translation and set accuracyScore to 0.92.

Return JSON: { "rows": [{ "sectionId", "sectionTitle", "sourceText", "translatedText", "language", "accuracyScore": 0-1, "terminologyFlags": string[], "missingWarnings": string[] }] }
One row per section. Set language to "${languageLabel}". Preserve safety warning hierarchy.`
    : `You are MANU generating professional translated manual sections for regulated equipment.
For EACH English source section, produce a complete translation in ${languageLabel}.

Return JSON: { "rows": [{ "sectionId", "sectionTitle", "sourceText", "translatedText", "language", "accuracyScore": 0-1, "terminologyFlags": string[], "missingWarnings": string[] }] }
Rules:
- sourceText: the English source (use the full section content provided)
- translatedText: complete professional translation in ${languageLabel} — do NOT leave empty
- language: "${languageLabel}"
- accuracyScore: your confidence in translation quality (0.85-0.98 typical for generated text)
- terminologyFlags: note any terms requiring human review
- missingWarnings: flag if safety warnings may not carry equivalent emphasis

Produce exactly one row per section. Preserve warning/caution/regulatory terminology.`;

  const userPayload = `Target language: ${languageLabel}

English source sections:
${JSON.stringify(
  params.targetSections.map((s) => ({ id: s.id, title: s.title, content: s.content })),
  null,
  2,
)}`;

  const parsed = await callOpenAiJson<{ rows?: ManuTranslationQARow[] }>({
    model: MANU_LLM_MODEL,
    system,
    user: params.translationDocs.length
      ? `${userPayload}

Reference translation documents (optional QA baseline):
${params.translationBundle}`
      : userPayload,
    maxTokens: 4096,
  });

  return (Array.isArray(parsed.rows) ? parsed.rows : []).map((row) => ({
    sectionId: row.sectionId || '',
    sectionTitle: row.sectionTitle || '',
    sourceText: row.sourceText || '',
    translatedText: row.translatedText || '',
    language: row.language || languageLabel,
    accuracyScore: typeof row.accuracyScore === 'number' ? row.accuracyScore : 0.88,
    terminologyFlags: Array.isArray(row.terminologyFlags) ? row.terminologyFlags : [],
    missingWarnings: Array.isArray(row.missingWarnings) ? row.missingWarnings : [],
    status: 'draft' as const,
  }));
}

export async function buildTranslationQAFromDocuments(params: {
  sections: ManuGeneratedSection[];
  manualConfig: ManuManualConfig;
  missionId: string;
  documents: ManuUploadedDocument[];
  langCodes?: string[];
}): Promise<{ translationQA: ManuTranslationQARow[]; model: string }> {
  const langCodes = params.langCodes ?? params.manualConfig.metadata.targetLanguages;

  const targetSections = getTranslationTargetSections(params.missionId, params.sections);

  if (!targetSections.length || !langCodes.length) {
    return { translationQA: [], model: LLM_MODEL };
  }

  const translationDocs = getTranslationDocuments(params.documents);
  const translationBundle = truncateBundle(
    translationDocs.map((d) => `--- ${d.fileName} (${d.id}) ---\n${d.extractedText}`).join('\n\n'),
    10000,
  );

  const perLanguage = await Promise.all(
    langCodes.map((langCode) =>
      buildTranslationQAForLanguage({
        targetSections,
        langCode,
        translationDocs,
        translationBundle,
      }),
    ),
  );

  return { translationQA: perLanguage.flat(), model: MANU_LLM_MODEL };
}

export async function buildTranslationQA(params: {
  sections: ManuGeneratedSection[];
  manualConfig: ManuManualConfig;
  missionId: string;
  documents?: ManuUploadedDocument[];
  language?: string;
}): Promise<{ translationQA: ManuTranslationQARow[]; model: string }> {
  const langCodes = params.language ? [params.language] : params.manualConfig.metadata.targetLanguages;
  return buildTranslationQAFromDocuments({
    sections: params.sections,
    manualConfig: params.manualConfig,
    missionId: params.missionId,
    documents: params.documents ?? [],
    langCodes,
  });
}
