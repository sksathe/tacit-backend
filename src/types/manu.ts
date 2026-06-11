import { z } from 'zod';

export const MANU_AGENT_ID = 'manu';
export const MANU_CLIENT = 'LabCorp';

/** Mission IDs aligned with frontend / labcorp/manu-agent-core.js */
export const MANU_MISSION_IDS = {
  productManualGen: 'product-manual-gen',
  manualUpdate: 'manual-update',
  riskCoverageQa: 'risk-coverage-qa',
  regulatoryQa: 'regulatory-qa',
  translationQa: 'translation-qa',
} as const;

export type ManuMissionId = (typeof MANU_MISSION_IDS)[keyof typeof MANU_MISSION_IDS];

export const MANU_PROCESSING_STAGES = [
  'Reading source documents',
  'Extracting requirements and test evidence',
  'Mapping risks to warnings',
  'Applying manual template',
  'Running compliance and completeness checks',
  'Preparing approval workspace',
] as const;

export const MANU_DOCUMENT_CATEGORIES = [
  'prd',
  'engineering_test',
  'fmea',
  'regulatory',
  'existing_manual',
  'translation',
  'quality_validation',
  'labeling',
  'other',
] as const;

export type ManuDocumentCategory = (typeof MANU_DOCUMENT_CATEGORIES)[number];
export type ManuSectionStatus = 'draft' | 'approved' | 'flagged';
export type ManuRunStatus = 'queued' | 'processing' | 'ready' | 'failed';

export const ManuManualMetadataSchema = z.object({
  productName: z.string(),
  modelCode: z.string(),
  manualType: z.string(),
  targetMarkets: z.array(z.string()),
  targetLanguages: z.array(z.string()),
  intendedAudience: z.string(),
  templateType: z.string(),
  revision: z.string(),
  approverRole: z.string(),
});

export const ManuManualConfigSchema = z.object({
  selectedSectionIds: z.array(z.string()),
  metadata: ManuManualMetadataSchema,
});

export const ManuUploadedDocumentSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  fileType: z.string(),
  category: z.enum(MANU_DOCUMENT_CATEGORIES),
  uploadedAt: z.string(),
  extractedText: z.string(),
  extractionStatus: z.enum(['pending', 'processing', 'complete', 'partial', 'simulated', 'failed']),
  parsingConfidence: z.number(),
  notes: z.string().optional(),
});

export const CreateManuRunSchema = z.object({
  projectId: z.string().uuid().nullable().optional(),
  missionId: z.string().min(1),
  mode: z.enum(['discover', 'execute']).default('execute'),
  manualConfig: ManuManualConfigSchema,
  documents: z.array(ManuUploadedDocumentSchema).min(1),
});

export const PatchManuRunSchema = z.object({
  resultJson: z.record(z.unknown()).optional(),
});

export interface ManuUploadedDocument {
  id: string;
  fileName: string;
  fileType: string;
  category: ManuDocumentCategory;
  uploadedAt: string;
  extractedText: string;
  extractionStatus: 'pending' | 'processing' | 'complete' | 'partial' | 'simulated' | 'failed';
  parsingConfidence: number;
  notes?: string;
}

export interface ManuManualConfig {
  selectedSectionIds: string[];
  metadata: z.infer<typeof ManuManualMetadataSchema>;
}

export interface ManuExtractedFact {
  id: string;
  group: string;
  label: string;
  value: string;
  sourceDocumentIds: string[];
  confidence: number;
  uncertain?: boolean;
}

export interface ManuSourceReference {
  documentId: string;
  documentName: string;
  category: ManuDocumentCategory;
  excerpt: string;
}

export interface ManuGeneratedSection {
  id: string;
  title: string;
  content: string;
  confidence: number;
  sourceReferences: ManuSourceReference[];
  relatedDocumentIds: string[];
  riskFlags: string[];
  complianceFlags: string[];
  status: 'draft' | 'approved' | 'flagged';
  flagReason?: string;
  approverNotes?: string;
  required: boolean;
}

export interface ManuTraceabilityRow {
  sectionId: string;
  sectionTitle: string;
  fact: string;
  sourceDocument: string;
  excerpt: string;
  confidence: number;
  status: 'draft' | 'approved' | 'flagged';
}

export interface ManuRiskMapping {
  id: string;
  hazard: string;
  cause: string;
  effect: string;
  mitigation: string;
  manualWarning: string;
  coverageStatus: 'covered' | 'missing' | 'needs_review';
}

export interface ManuRegulatoryRow {
  id: string;
  market: string;
  standard: string;
  certificationStatus: string;
  requiredStatement: string;
  missingInfo: string;
  postMarketObligation?: string;
}

export interface ManuTranslationQARow {
  sectionId: string;
  sectionTitle: string;
  sourceText: string;
  translatedText: string;
  language: string;
  accuracyScore: number;
  terminologyFlags: string[];
  missingWarnings: string[];
  status?: ManuSectionStatus;
  flagReason?: string;
  approverNotes?: string;
}

export type ManuExportKind =
  | 'approved_manual'
  | 'traceability_matrix'
  | 'risk_coverage'
  | 'regulatory_checklist'
  | 'translation_qa'
  | 'audit_package';

export interface ManuRun {
  runId: string;
  agentId: string;
  missionId: string;
  mode: 'discover' | 'execute';
  client: string;
  uploadedDocuments: ManuUploadedDocument[];
  documentClassifications: Record<string, ManuDocumentCategory>;
  extractedFacts: ManuExtractedFact[];
  manualConfig: ManuManualConfig;
  generatedSections: ManuGeneratedSection[];
  traceabilityMatrix: ManuTraceabilityRow[];
  riskCoverage: ManuRiskMapping[];
  regulatoryChecklist: ManuRegulatoryRow[];
  approvalStatus: {
    allRequiredApproved: boolean;
    approvedCount: number;
    flaggedCount: number;
    requiredCount: number;
  };
  translationApprovalStatus?: {
    allRequiredApproved: boolean;
    approvedCount: number;
    flaggedCount: number;
    requiredCount: number;
  };
  translationQA: ManuTranslationQARow[];
  exportStatus: Record<ManuExportKind, 'idle' | 'ready' | 'exported'>;
  gaps: string[];
  missionFocus?: {
    title: string;
    description: string;
    emphasizeRisk: boolean;
    emphasizeRegulatory: boolean;
    emphasizeTranslation: boolean;
    emphasizeRevision: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

export const MANU_SECTION_TITLES: Record<string, { title: string; required: boolean }> = {
  'product-overview': { title: 'Product Overview', required: true },
  'intended-use': { title: 'Intended Use', required: true },
  'system-description': { title: 'System Description', required: true },
  'technical-specifications': { title: 'Technical Specifications', required: true },
  'safety-warnings': { title: 'Safety Warnings and Precautions', required: true },
  'installation-setup': { title: 'Installation / Setup', required: true },
  'operating-instructions': { title: 'Operating Instructions', required: true },
  'performance-characteristics': { title: 'Performance Characteristics', required: false },
  'maintenance-cleaning': { title: 'Maintenance and Cleaning', required: true },
  'troubleshooting': { title: 'Troubleshooting', required: false },
  'regulatory-compliance': { title: 'Regulatory Compliance', required: true },
  'country-certification': { title: 'Country-Specific Certification Notes', required: false },
  'revision-history': { title: 'Revision History', required: true },
  'accessories-rotor': { title: 'Accessories / Rotor Compatibility', required: false },
  'environmental-conditions': { title: 'Environmental Conditions', required: false },
  'storage-transport': { title: 'Storage and Transport', required: false },
  decontamination: { title: 'Decontamination', required: false },
  'service-instructions': { title: 'Service Instructions', required: false },
  'quality-control': { title: 'Quality Control Requirements', required: false },
  'post-market': { title: 'Post-Market / Reporting Obligations', required: false },
  'labeling-requirements': { title: 'Labeling Requirements', required: false },
  'risk-controls-summary': { title: 'Risk Controls Summary', required: false },
};

export function getMissionFocus(missionId: string) {
  switch (missionId) {
    case 'manual-update':
      return {
        title: 'Manual Update & Revision',
        description:
          'Compare new source evidence against prior manual baseline. Change impact is flagged in gaps and export.',
        emphasizeRisk: true,
        emphasizeRegulatory: true,
        emphasizeTranslation: false,
        emphasizeRevision: true,
      };
    case 'risk-coverage-qa':
      return {
        title: 'Risk-to-Manual Coverage QA',
        description:
          'Primary focus: FMEA hazards mapped to manual warnings. Review missing or weak coverage before approval.',
        emphasizeRisk: true,
        emphasizeRegulatory: false,
        emphasizeTranslation: false,
        emphasizeRevision: false,
      };
    case 'regulatory-qa':
      return {
        title: 'Regulatory Compliance QA',
        description:
          'Primary focus: market-specific certification requirements reflected in regulatory and country sections.',
        emphasizeRisk: false,
        emphasizeRegulatory: true,
        emphasizeTranslation: false,
        emphasizeRevision: false,
      };
    case 'translation-qa':
      return {
        title: 'Translation Accuracy QA',
        description: 'Approve English source sections first, then validate translated manuals section by section.',
        emphasizeRisk: false,
        emphasizeRegulatory: false,
        emphasizeTranslation: true,
        emphasizeRevision: false,
      };
    default:
      return {
        title: 'Product Manual Generation',
        description: 'Generate a traceable manual draft from the full source document bundle.',
        emphasizeRisk: true,
        emphasizeRegulatory: true,
        emphasizeTranslation: false,
        emphasizeRevision: false,
      };
  }
}
