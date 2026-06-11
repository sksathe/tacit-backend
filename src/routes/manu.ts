import { Router, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { resolveProjectId } from '../services/defaultProject.js';
import { ingestUploadedFile } from '../services/manuIngest.js';
import { buildTranslationQA } from '../services/manuLlm.js';
import { buildManuRunFromInput, kickManuPipeline } from '../services/manuPipeline.js';
import {
  CreateManuRunSchema,
  PatchManuRunSchema,
  ManuUploadedDocumentSchema,
  MANU_PROCESSING_STAGES,
  type ManuDocumentCategory,
  type ManuRun,
} from '../types/manu.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const TranslationQAGenerateSchema = z.object({
  missionId: z.string().min(1),
  manualConfig: z.object({
    selectedSectionIds: z.array(z.string()),
    metadata: z.object({
      targetLanguages: z.array(z.string()).default([]),
    }).passthrough(),
  }),
  sections: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      content: z.string(),
      required: z.boolean().optional(),
    }),
  ),
  documents: z.array(ManuUploadedDocumentSchema).optional(),
  language: z.string().optional(),
});

async function assertProjectAccess(req: AuthenticatedRequest, _projectId: string): Promise<boolean> {
  return Boolean(req.userId);
}

async function getProjectOrgId(req: AuthenticatedRequest, projectId: string): Promise<string | null> {
  const { data, error } = await req.supabaseClient!
    .from('projects')
    .select('org_id')
    .eq('id', projectId)
    .maybeSingle();

  if (error) throw error;
  return data?.org_id ?? null;
}

// POST /api/manu/documents/extract
router.post(
  '/documents/extract',
  authMiddleware,
  upload.single('file'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ ok: false, error: 'No file uploaded' });
        return;
      }

      const categoryOverride = req.body?.category as ManuDocumentCategory | undefined;
      const document = await ingestUploadedFile(req.file, categoryOverride);

      res.json({ ok: true, document });
    } catch (err: any) {
      console.error('MANU document extract error:', err);
      res.status(500).json({ ok: false, error: err?.message || 'Document extraction failed' });
    }
  },
);

// POST /api/manu/runs
router.post('/runs', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = CreateManuRunSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.flatten() });
      return;
    }

    const { missionId, mode, manualConfig, documents } = parsed.data;
    const resolvedProjectId = await resolveProjectId(req.supabaseClient!, parsed.data.projectId);
    if (!resolvedProjectId) {
      res.status(404).json({ ok: false, error: 'Default project not found. Run 16_flat_access.sql migration.' });
      return;
    }

    const hasAccess = await assertProjectAccess(req, resolvedProjectId);
    if (!hasAccess) {
      res.status(403).json({ ok: false, error: 'Project access denied' });
      return;
    }

    const orgId = await getProjectOrgId(req, resolvedProjectId);
    if (!orgId) {
      res.status(404).json({ ok: false, error: 'Project not found' });
      return;
    }

    const { data, error } = await req.supabaseClient!
      .from('manu_runs')
      .insert({
        org_id: orgId,
        project_id: resolvedProjectId,
        created_by: req.userId,
        mission_id: missionId,
        mode,
        status: 'queued',
        stage: MANU_PROCESSING_STAGES[0],
        stage_index: 0,
        progress: 0,
        manual_config: manualConfig,
        uploaded_documents: documents,
      })
      .select('id')
      .single();

    if (error) throw error;

    kickManuPipeline(data.id, req.supabaseClient);

    res.status(202).json({ ok: true, runId: data.id, status: 'queued' });
  } catch (err: any) {
    console.error('MANU create run error:', err);
    res.status(500).json({ ok: false, error: err?.message || 'Failed to create run' });
  }
});

// POST /api/manu/runs/generate
// Generate with OpenAI but do not persist to Supabase tables.
router.post('/runs/generate', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = CreateManuRunSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.flatten() });
      return;
    }

    const { projectId, missionId, mode, manualConfig, documents } = parsed.data;
    if (projectId) {
      const hasAccess = await assertProjectAccess(req, projectId);
      if (!hasAccess) {
        res.status(403).json({ ok: false, error: 'Project access denied' });
        return;
      }
    }

    const { run, modelUsed } = await buildManuRunFromInput({
      missionId,
      mode,
      manualConfig,
      documents,
    });

    res.json({
      ok: true,
      run,
      model: modelUsed,
      storage: 'transient',
    });
  } catch (err: any) {
    console.error('MANU generate run error:', err);
    res.status(500).json({ ok: false, error: err?.message || 'Failed to generate run' });
  }
});

// POST /api/manu/translation-qa/generate
router.post('/translation-qa/generate', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = TranslationQAGenerateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.flatten() });
      return;
    }

    const { missionId, manualConfig, sections, documents, language } = parsed.data;
    const { translationQA, model } = await buildTranslationQA({
      missionId,
      manualConfig: manualConfig as any,
      sections: sections as any,
      documents: documents as any,
      language,
    });

    res.json({ ok: true, translationQA, model });
  } catch (err: any) {
    console.error('MANU translation QA error:', err);
    res.status(500).json({ ok: false, error: err?.message || 'Failed to generate translation QA' });
  }
});

// GET /api/manu/runs/:id/status
router.get('/runs/:id/status', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data, error } = await req.supabaseClient!
      .from('manu_runs')
      .select('id, status, stage, stage_index, progress, error_message')
      .eq('id', req.params.id)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      res.status(404).json({ ok: false, error: 'Run not found' });
      return;
    }

    res.json({
      ok: true,
      runId: data.id,
      status: data.status,
      stageIndex: data.stage_index ?? 0,
      stageLabel: data.stage || MANU_PROCESSING_STAGES[0],
      progress: data.progress ?? 0,
      error: data.error_message || undefined,
    });
  } catch (err: any) {
    console.error('MANU status error:', err);
    res.status(500).json({ ok: false, error: err?.message || 'Failed to fetch status' });
  }
});

// GET /api/manu/runs/:id
router.get('/runs/:id', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { data, error } = await req.supabaseClient!
      .from('manu_runs')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      res.status(404).json({ ok: false, error: 'Run not found' });
      return;
    }

    if (data.status !== 'ready' || !data.result_json) {
      res.status(409).json({
        ok: false,
        error: 'Run not ready',
        status: data.status,
      });
      return;
    }

    res.json({ ok: true, run: data.result_json as ManuRun });
  } catch (err: any) {
    console.error('MANU get run error:', err);
    res.status(500).json({ ok: false, error: err?.message || 'Failed to fetch run' });
  }
});

// GET /api/manu/runs/project/:projectId
router.get('/runs/project/:projectId', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const projectId = String(req.params.projectId);
    const hasAccess = await assertProjectAccess(req, projectId);
    if (!hasAccess) {
      res.status(403).json({ ok: false, error: 'Project access denied' });
      return;
    }

    const { data, error } = await req.supabaseClient!
      .from('manu_runs')
      .select('id, mission_id, status, stage, progress, created_at, updated_at, manual_config')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw error;

    res.json({ ok: true, runs: data ?? [] });
  } catch (err: any) {
    console.error('MANU list runs error:', err);
    res.status(500).json({ ok: false, error: err?.message || 'Failed to list runs' });
  }
});

// PATCH /api/manu/runs/:id
router.patch('/runs/:id', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = PatchManuRunSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.flatten() });
      return;
    }

    const { data: existing, error: loadError } = await req.supabaseClient!
      .from('manu_runs')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();

    if (loadError) throw loadError;
    if (!existing) {
      res.status(404).json({ ok: false, error: 'Run not found' });
      return;
    }

    if (existing.status !== 'ready') {
      res.status(409).json({ ok: false, error: 'Run not ready for updates' });
      return;
    }

    const resultJson = parsed.data.resultJson ?? existing.result_json;
    const { data, error } = await req.supabaseClient!
      .from('manu_runs')
      .update({
        result_json: resultJson,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select('result_json')
      .single();

    if (error) throw error;

    res.json({ ok: true, run: data.result_json as ManuRun });
  } catch (err: any) {
    console.error('MANU patch run error:', err);
    res.status(500).json({ ok: false, error: err?.message || 'Failed to update run' });
  }
});

export default router;
