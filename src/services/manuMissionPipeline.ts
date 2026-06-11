import {
  MANU_MISSION_IDS,
  type ManuExtractedFact,
  type ManuGeneratedSection,
  type ManuManualConfig,
  type ManuRegulatoryRow,
  type ManuRiskMapping,
  type ManuTranslationQARow,
  type ManuUploadedDocument,
} from '../types/manu.js';
import {
  buildManuCompliance,
  buildTraceabilityMatrix,
  buildTranslationQAFromDocuments,
  extractManuFacts,
  generateManualRevisionDelta,
  generateManuSections,
  mapManuRisks,
} from './manuLlm.js';

export type MissionPipelineResult = {
  facts: ManuExtractedFact[];
  gaps: string[];
  riskCoverage: ManuRiskMapping[];
  generatedSections: ManuGeneratedSection[];
  regulatoryChecklist: ManuRegulatoryRow[];
  translationQA: ManuTranslationQARow[];
  modelUsed: string;
};

const RISK_SECTION_IDS = new Set([
  'safety-warnings',
  'risk-controls-summary',
  'decontamination',
  'troubleshooting',
]);

const REGULATORY_SECTION_IDS = new Set([
  'regulatory-compliance',
  'country-certification',
  'labeling-requirements',
  'post-market',
  'revision-history',
]);

const TRANSLATION_SOURCE_SECTION_IDS = new Set([
  'safety-warnings',
  'intended-use',
  'regulatory-compliance',
  'operating-instructions',
  'product-overview',
]);

function filterSectionIds(missionId: string, selected: string[]): string[] {
  switch (missionId) {
    case MANU_MISSION_IDS.riskCoverageQa:
      return selected.filter((id) => RISK_SECTION_IDS.has(id));
    case MANU_MISSION_IDS.regulatoryQa:
      return selected.filter((id) => REGULATORY_SECTION_IDS.has(id));
    case MANU_MISSION_IDS.translationQa:
      return selected.filter((id) => TRANSLATION_SOURCE_SECTION_IDS.has(id));
    default:
      return selected;
  }
}

function mergeRevisionHistory(
  sections: ManuGeneratedSection[],
  changeLog: string,
): ManuGeneratedSection[] {
  if (!changeLog.trim()) return sections;
  return sections.map((s) =>
    s.id === 'revision-history'
      ? {
          ...s,
          content: `${s.content}\n\n--- Change log (MANU delta analysis) ---\n${changeLog}`,
          complianceFlags: [...s.complianceFlags, 'Revision delta appended'],
        }
      : s,
  );
}

function appendReportSection(
  sections: ManuGeneratedSection[],
  id: string,
  title: string,
  content: string,
): ManuGeneratedSection[] {
  if (!content.trim()) return sections;
  const existing = sections.find((s) => s.id === id);
  if (existing) {
    return sections.map((s) => (s.id === id ? { ...s, content: `${s.content}\n\n${content}` } : s));
  }
  return [
    ...sections,
    {
      id,
      title,
      content,
      confidence: 0.82,
      sourceReferences: [],
      relatedDocumentIds: [],
      riskFlags: [],
      complianceFlags: [],
      status: 'draft' as const,
      required: true,
    },
  ];
}

/**
 * Mission-specific OpenAI pipeline. Each mission uses distinct prompts and step ordering.
 */
export async function runMissionPipeline(params: {
  missionId: string;
  manualConfig: ManuManualConfig;
  documents: ManuUploadedDocument[];
}): Promise<MissionPipelineResult> {
  const { missionId, documents } = params;
  let manualConfig = params.manualConfig;
  let modelUsed = process.env.MANU_LLM_MODEL || process.env.LLM_MODEL || 'gpt-4o-mini';

  const sectionIds = filterSectionIds(missionId, manualConfig.selectedSectionIds);
  if (sectionIds.length !== manualConfig.selectedSectionIds.length) {
    manualConfig = { ...manualConfig, selectedSectionIds: sectionIds };
  }

  switch (missionId) {
    case MANU_MISSION_IDS.manualUpdate:
      return runManualUpdatePipeline(missionId, manualConfig, documents, modelUsed);
    case MANU_MISSION_IDS.riskCoverageQa:
      return runRiskCoveragePipeline(missionId, manualConfig, documents, modelUsed);
    case MANU_MISSION_IDS.regulatoryQa:
      return runRegulatoryQaPipeline(missionId, manualConfig, documents, modelUsed);
    case MANU_MISSION_IDS.translationQa:
      return runTranslationQaPipeline(missionId, manualConfig, documents, modelUsed);
    default:
      return runProductManualGenPipeline(missionId, manualConfig, documents, modelUsed);
  }
}

async function runProductManualGenPipeline(
  missionId: string,
  manualConfig: ManuManualConfig,
  documents: ManuUploadedDocument[],
  modelUsed: string,
): Promise<MissionPipelineResult> {
  const [{ facts, gaps, model: factsModel }, { riskCoverage, model: riskModel }] = await Promise.all([
    extractManuFacts({ documents, manualConfig, missionId }),
    mapManuRisks({ documents, missionId }),
  ]);
  modelUsed = factsModel || riskModel;

  const { sections: generatedSections, model: sectionModel } = await generateManuSections({
    documents,
    manualConfig,
    missionId,
    extractedFacts: facts,
  });
  modelUsed = sectionModel;

  const compliance = await buildManuCompliance({
    documents,
    manualConfig,
    missionId,
    sections: generatedSections,
    gaps,
  });
  modelUsed = compliance.model;

  return {
    facts,
    gaps: compliance.gaps,
    riskCoverage,
    generatedSections: compliance.sections,
    regulatoryChecklist: compliance.regulatoryChecklist,
    translationQA: [],
    modelUsed,
  };
}

async function runManualUpdatePipeline(
  missionId: string,
  manualConfig: ManuManualConfig,
  documents: ManuUploadedDocument[],
  modelUsed: string,
): Promise<MissionPipelineResult> {
  const [{ facts, gaps, model: factsModel }, { riskCoverage, model: riskModel }] = await Promise.all([
    extractManuFacts({ documents, manualConfig, missionId }),
    mapManuRisks({ documents, missionId }),
  ]);
  modelUsed = factsModel || riskModel;

  const { sections: generatedSections, model: sectionModel } = await generateManuSections({
    documents,
    manualConfig,
    missionId,
    extractedFacts: facts,
  });
  modelUsed = sectionModel;

  const { changeLog, redlineSummary, additionalGaps, model: deltaModel } =
    await generateManualRevisionDelta({
      documents,
      manualConfig,
      missionId,
      generatedSections,
    });
  modelUsed = deltaModel;

  let sections = mergeRevisionHistory(generatedSections, changeLog);
  if (redlineSummary.trim()) {
    sections = appendReportSection(
      sections,
      'manual-update-redline',
      'Redline Delta Summary',
      redlineSummary,
    );
  }

  const compliance = await buildManuCompliance({
    documents,
    manualConfig,
    missionId,
    sections,
    gaps: [...gaps, ...additionalGaps],
  });
  modelUsed = compliance.model;

  return {
    facts,
    gaps: compliance.gaps,
    riskCoverage,
    generatedSections: compliance.sections,
    regulatoryChecklist: compliance.regulatoryChecklist,
    translationQA: [],
    modelUsed,
  };
}

async function runRiskCoveragePipeline(
  missionId: string,
  manualConfig: ManuManualConfig,
  documents: ManuUploadedDocument[],
  modelUsed: string,
): Promise<MissionPipelineResult> {
  const { facts, gaps, model: factsModel } = await extractManuFacts({ documents, manualConfig, missionId });
  modelUsed = factsModel;

  const { riskCoverage, coverageReport, model: riskModel } = await mapManuRisks({
    documents,
    missionId,
    includeCoverageReport: true,
  });
  modelUsed = riskModel;

  const { sections: generatedSections, model: sectionModel } = await generateManuSections({
    documents,
    manualConfig,
    missionId,
    extractedFacts: facts,
  });
  modelUsed = sectionModel;

  let sections = appendReportSection(
    generatedSections,
    'risk-coverage-report',
    'Risk Coverage QA Report',
    coverageReport,
  );

  const compliance = await buildManuCompliance({
    documents,
    manualConfig,
    missionId,
    sections,
    gaps,
  });
  modelUsed = compliance.model;

  return {
    facts,
    gaps: compliance.gaps,
    riskCoverage,
    generatedSections: compliance.sections,
    regulatoryChecklist: compliance.regulatoryChecklist,
    translationQA: [],
    modelUsed,
  };
}

async function runRegulatoryQaPipeline(
  missionId: string,
  manualConfig: ManuManualConfig,
  documents: ManuUploadedDocument[],
  modelUsed: string,
): Promise<MissionPipelineResult> {
  const { facts, gaps, model: factsModel } = await extractManuFacts({ documents, manualConfig, missionId });
  modelUsed = factsModel;

  const { sections: draftSections, model: sectionModel } = await generateManuSections({
    documents,
    manualConfig,
    missionId,
    extractedFacts: facts,
  });
  modelUsed = sectionModel;

  const compliance = await buildManuCompliance({
    documents,
    manualConfig,
    missionId,
    sections: draftSections,
    gaps,
  });
  modelUsed = compliance.model;

  const gapReport = compliance.regulatoryChecklist
    .filter((r) => r.missingInfo?.trim())
    .map((r) => `${r.market} / ${r.standard}: ${r.missingInfo}`)
    .join('\n');

  let sections = compliance.sections;
  if (gapReport) {
    sections = appendReportSection(
      sections,
      'regulatory-gap-report',
      'Regulatory Gap Analysis',
      gapReport,
    );
  }

  return {
    facts,
    gaps: compliance.gaps,
    riskCoverage: [],
    generatedSections: sections,
    regulatoryChecklist: compliance.regulatoryChecklist,
    translationQA: [],
    modelUsed,
  };
}

async function runTranslationQaPipeline(
  missionId: string,
  manualConfig: ManuManualConfig,
  documents: ManuUploadedDocument[],
  modelUsed: string,
): Promise<MissionPipelineResult> {
  const { facts, gaps, model: factsModel } = await extractManuFacts({ documents, manualConfig, missionId });
  modelUsed = factsModel;

  const { sections: generatedSections, model: sectionModel } = await generateManuSections({
    documents,
    manualConfig,
    missionId,
    extractedFacts: facts,
  });
  modelUsed = sectionModel;

  let translationQA: ManuTranslationQARow[] = [];
  if (manualConfig.metadata.targetLanguages.length > 0) {
    const tqa = await buildTranslationQAFromDocuments({
      sections: generatedSections,
      manualConfig,
      missionId,
      documents,
    });
    translationQA = tqa.translationQA;
    modelUsed = tqa.model;
  }

  return {
    facts,
    gaps,
    riskCoverage: [],
    generatedSections,
    regulatoryChecklist: [],
    translationQA,
    modelUsed,
  };
}

export { buildTraceabilityMatrix };
