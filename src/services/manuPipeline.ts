import { randomUUID } from 'crypto';
import { supabaseService } from './supabase.js';
import {
  MANU_AGENT_ID,
  MANU_CLIENT,
  MANU_PROCESSING_STAGES,
  getMissionFocus,
  type ManuExportKind,
  type ManuRun,
  type ManuUploadedDocument,
  type ManuManualConfig,
} from '../types/manu.js';
import { buildTraceabilityMatrix, runMissionPipeline } from './manuMissionPipeline.js';

const ARTIFACTS_BUCKET = process.env.SUPABASE_ARTIFACTS_BUCKET || 'tacit-artifacts';

async function updateRun(
  supabaseClient: any,
  runId: string,
  patch: Record<string, unknown>,
) {
  const { error } = await supabaseClient
    .from('manu_runs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', runId);
  if (error) throw error;
}

async function uploadResultArtifact(runId: string, payload: ManuRun): Promise<string> {
  const storagePath = `manu-runs/${runId}/result.json`;
  const { error } = await supabaseService.storage
    .from(ARTIFACTS_BUCKET)
    .upload(storagePath, JSON.stringify(payload, null, 2), {
      contentType: 'application/json',
      upsert: true,
    });
  if (error) throw error;
  return storagePath;
}

function defaultExportStatus(): Record<ManuExportKind, 'idle' | 'ready' | 'exported'> {
  return {
    approved_manual: 'idle',
    traceability_matrix: 'idle',
    risk_coverage: 'idle',
    regulatory_checklist: 'idle',
    translation_qa: 'idle',
    audit_package: 'idle',
  };
}

function assembleRun(params: {
  runId: string;
  missionId: string;
  mode: 'discover' | 'execute';
  documents: ManuUploadedDocument[];
  manualConfig: ManuManualConfig;
  pipeline: Awaited<ReturnType<typeof runMissionPipeline>>;
  createdAt: string;
}): ManuRun {
  const { pipeline, documents, manualConfig, missionId, mode, runId, createdAt } = params;
  const now = new Date().toISOString();
  const traceabilityMatrix = buildTraceabilityMatrix(documents, pipeline.generatedSections);
  const totalSections = pipeline.generatedSections.length;
  const translationRequired = pipeline.translationQA.length;

  return {
    runId,
    agentId: MANU_AGENT_ID,
    missionId,
    mode,
    client: MANU_CLIENT,
    uploadedDocuments: documents,
    documentClassifications: Object.fromEntries(documents.map((d) => [d.id, d.category])),
    extractedFacts: pipeline.facts,
    manualConfig,
    generatedSections: pipeline.generatedSections,
    traceabilityMatrix,
    riskCoverage: pipeline.riskCoverage,
    regulatoryChecklist: pipeline.regulatoryChecklist,
    approvalStatus: {
      allRequiredApproved: false,
      approvedCount: 0,
      flaggedCount: 0,
      requiredCount: totalSections,
    },
    translationQA: pipeline.translationQA,
    translationApprovalStatus: translationRequired
      ? {
          allRequiredApproved: false,
          approvedCount: 0,
          flaggedCount: 0,
          requiredCount: translationRequired,
        }
      : undefined,
    exportStatus: defaultExportStatus(),
    gaps: pipeline.gaps,
    missionFocus: getMissionFocus(missionId),
    createdAt,
    updatedAt: now,
  };
}

export async function runManuPipeline(runId: string, supabaseClient: any): Promise<void> {
  const { data: row, error: loadError } = await supabaseClient
    .from('manu_runs')
    .select('*')
    .eq('id', runId)
    .single();

  if (loadError || !row) {
    throw new Error(loadError?.message || 'Run not found');
  }

  const documents = row.uploaded_documents as ManuUploadedDocument[];
  const manualConfig = row.manual_config as ManuManualConfig;
  const missionId = row.mission_id as string;
  const mode = row.mode as 'discover' | 'execute';
  const now = new Date().toISOString();
  let modelUsed = process.env.MANU_LLM_MODEL || process.env.LLM_MODEL || 'gpt-4o-mini';

  try {
    await updateRun(supabaseClient, runId, {
      status: 'processing',
      stage: MANU_PROCESSING_STAGES[0],
      stage_index: 0,
      progress: 5,
      error_message: null,
    });

    await updateRun(supabaseClient, runId, {
      stage: MANU_PROCESSING_STAGES[1],
      stage_index: 1,
      progress: 20,
    });

    const pipeline = await runMissionPipeline({ missionId, manualConfig, documents });
    modelUsed = pipeline.modelUsed;

    await updateRun(supabaseClient, runId, {
      stage: MANU_PROCESSING_STAGES[4],
      stage_index: 4,
      progress: 85,
    });

    const run = assembleRun({
      runId,
      missionId,
      mode,
      documents,
      manualConfig,
      pipeline,
      createdAt: row.created_at || now,
    });

    const storagePath = await uploadResultArtifact(runId, run);

    await updateRun(supabaseClient, runId, {
      status: 'ready',
      stage: MANU_PROCESSING_STAGES[5],
      stage_index: 5,
      progress: 100,
      result_json: run,
      storage_path: storagePath,
      model: modelUsed,
    });
  } catch (err: any) {
    console.error(`MANU pipeline failed for run ${runId}:`, err);
    await updateRun(supabaseClient, runId, {
      status: 'failed',
      error_message: err?.message || 'Pipeline failed',
    });
  }
}

export function kickManuPipeline(runId: string, supabaseClient: any): void {
  setImmediate(() => {
    runManuPipeline(runId, supabaseClient).catch((err) => {
      console.error(`Unhandled MANU pipeline error for ${runId}:`, err);
    });
  });
}

export async function buildManuRunFromInput(params: {
  runId?: string;
  missionId: string;
  mode: 'discover' | 'execute';
  manualConfig: ManuManualConfig;
  documents: ManuUploadedDocument[];
  createdAt?: string;
}): Promise<{ run: ManuRun; modelUsed: string }> {
  const pipelineStarted = Date.now();
  const runId = params.runId ?? `manu-${randomUUID()}`;
  const now = new Date().toISOString();

  const pipeline = await runMissionPipeline({
    missionId: params.missionId,
    manualConfig: params.manualConfig,
    documents: params.documents,
  });

  const run = assembleRun({
    runId,
    missionId: params.missionId,
    mode: params.mode,
    documents: params.documents,
    manualConfig: params.manualConfig,
    pipeline,
    createdAt: params.createdAt || now,
  });

  console.log(`[MANU][Timing] buildManuRunFromInput_total_ms=${Date.now() - pipelineStarted}`);
  return { run, modelUsed: pipeline.modelUsed };
}
