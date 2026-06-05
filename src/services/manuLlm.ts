import { config } from 'dotenv';
import {
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

function hasCategory(docs: ManuUploadedDocument[], cat: string) {
  return docs.some((d) => d.category === cat);
}

function buildStaticGaps(docs: ManuUploadedDocument[], missionId: string): string[] {
  const gaps: string[] = [];
  if (!hasCategory(docs, 'fmea')) gaps.push('No FMEA — risk-to-warning mapping limited');
  if (!hasCategory(docs, 'regulatory')) gaps.push('No regulatory notes — compliance checklist incomplete');
  if (!hasCategory(docs, 'engineering_test')) gaps.push('No engineering report — technical specs may be incomplete');
  if (!hasCategory(docs, 'prd')) gaps.push('No PRD — intended use requires verification');
  if (!hasCategory(docs, 'existing_manual')) gaps.push('No existing manual — treated as new manual generation');
  if (missionId === 'manual-update' && !hasCategory(docs, 'existing_manual')) {
    gaps.push('No existing manual uploaded — running as new manual generation with revision baseline');
  }
  if (missionId === 'translation-qa' && !hasCategory(docs, 'translation')) {
    gaps.push('No translation files uploaded — translation QA will use simulated translated content');
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
Use sourceDocumentIds that match document ids from the bundle. Mark uncertain:true when evidence is thin.`;

  const user = `Mission: ${params.missionId}
Product: ${meta.productName} / ${meta.modelCode}
Target markets: ${meta.targetMarkets.join(', ')}

Documents:
${JSON.stringify(params.documents.map((d) => ({ id: d.id, fileName: d.fileName, category: d.category })), null, 2)}

Bundle text:
${bundle}

Known static gaps to include if still applicable: ${staticGaps.join('; ') || 'none'}`;

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
}): Promise<{ riskCoverage: ManuRiskMapping[]; model: string }> {
  if (!hasCategory(params.documents, 'fmea')) {
    return { riskCoverage: [], model: LLM_MODEL };
  }

  const fmeaDocs = params.documents.filter((d) => d.category === 'fmea');
  const bundle = truncateBundle(fmeaDocs.map((d) => d.extractedText).join('\n\n'), 8000);

  const system = `You are a medical device risk analyst. Map FMEA hazards to manual warnings.
Return JSON: { "riskCoverage": [{ "id", "hazard", "cause", "effect", "mitigation", "manualWarning", "coverageStatus": "covered"|"missing"|"needs_review" }] }
Ground every row in the FMEA text. Do not invent hazards.`;

  const parsed = await callOpenAiJson<{ riskCoverage?: ManuRiskMapping[] }>({
    model: LLM_MODEL,
    system,
    user: `Mission: ${params.missionId}\n\nFMEA content:\n${bundle}`,
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

  return { riskCoverage, model: LLM_MODEL };
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

  const system = `You are MANU generating regulated equipment manual sections for LabCorp.
CRITICAL: Only use information from source documents and extracted facts. Cite sourceDocumentIds in sourceReferences.
Return JSON: { "sections": [{ "id", "title", "content", "confidence": 0-1, "sourceReferences": [{ "documentId", "documentName", "category", "excerpt" }], "relatedDocumentIds": string[], "riskFlags": string[], "complianceFlags": string[], "required": boolean }] }
Write professional manual prose. Flag missing FMEA/regulatory evidence in riskFlags/complianceFlags.`;

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

  const system = `You are a regulatory compliance reviewer for LabCorp equipment manuals.
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

export async function buildTranslationQA(params: {
  sections: ManuGeneratedSection[];
  manualConfig: ManuManualConfig;
  missionId: string;
}): Promise<{ translationQA: ManuTranslationQARow[]; model: string }> {
  const langCodes =
    params.manualConfig.metadata.targetLanguages.length > 0
      ? params.manualConfig.metadata.targetLanguages
      : ['es', 'fr', 'de'];

  const targetSections =
    params.missionId === 'translation-qa'
      ? params.sections.filter((s) =>
          ['safety-warnings', 'intended-use', 'regulatory-compliance', 'operating-instructions'].includes(s.id),
        )
      : params.sections.filter((s) => s.required).slice(0, 6);

  if (!targetSections.length) {
    return { translationQA: [], model: LLM_MODEL };
  }

  const system = `You simulate translation QA for regulated manuals.
Return JSON: { "rows": [{ "sectionId", "sectionTitle", "sourceText", "translatedText", "language", "accuracyScore": 0-1, "terminologyFlags": string[], "missingWarnings": string[] }] }
Produce one row per section per language. Use professional localized phrasing grounded in sourceText.`;

  try {
    const parsed = await callOpenAiJson<{ rows?: ManuTranslationQARow[] }>({
      model: LLM_MODEL,
      system,
      user: `Languages: ${langCodes.map((c) => LANGUAGE_LABELS[c] || c).join(', ')}

Sections:
${JSON.stringify(
  targetSections.slice(0, 4).map((s) => ({ id: s.id, title: s.title, content: s.content.slice(0, 280) })),
  null,
  2,
)}`,
      maxTokens: 4096,
    });

    const translationQA = Array.isArray(parsed.rows) ? parsed.rows : [];
    return { translationQA, model: LLM_MODEL };
  } catch (err) {
    console.warn('MANU translation QA generation failed; continuing with empty rows:', err);
    return { translationQA: [], model: LLM_MODEL };
  }
}
