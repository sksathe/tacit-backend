import { Router, Response } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { supabaseService } from '../services/supabase.js';
import {
  generateSummaryFromTranscriptRaw,
  generateClarityScoreFromTranscriptRaw,
  generateFinancialConceptMapFromTranscriptRaw,
  generateSoc2DocumentFromTranscriptRaw,
  generateComplianceGapAnalysisFromTranscriptRaw,
} from '../services/llm.js';

const router = Router();
const ARTIFACTS_BUCKET = process.env.SUPABASE_ARTIFACTS_BUCKET || 'tacit-artifacts';

function normalizeAutomationType(automationType: string): string {
  return String(automationType || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function uploadArtifactToStorage(
  storagePath: string,
  data: Buffer | string,
  contentType: string
): Promise<string> {
  const { error } = await supabaseService.storage
    .from(ARTIFACTS_BUCKET)
    .upload(storagePath, data, {
      contentType,
      upsert: true,
    });

  if (error) throw error;
  return storagePath;
}

async function createSignedUrl(storagePath: string | null | undefined): Promise<string | null> {
  if (!storagePath) return null;
  const { data, error } = await supabaseService.storage
    .from(ARTIFACTS_BUCKET)
    .createSignedUrl(storagePath, 60 * 60);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

type StorageTarget = { bucket: string; path: string } | { externalUrl: string };

function resolveStorageTarget(rawPath: string | null | undefined): StorageTarget | null {
  if (!rawPath) return null;
  const value = String(rawPath).trim();
  if (!value) return null;

  if (/^https?:\/\//i.test(value)) {
    return { externalUrl: value };
  }

  // Support "bucket/path/to/file.ext" format, but avoid mistaking
  // app folder prefixes like "org/..." for bucket names.
  const parts = value.split('/');
  if (
    parts.length > 1 &&
    parts[0] !== ARTIFACTS_BUCKET &&
    parts[0] !== 'org' &&
    /^[a-z0-9._-]+$/i.test(parts[0])
  ) {
    return { bucket: parts[0], path: parts.slice(1).join('/') };
  }

  // Support "tacit-artifacts/path/to/file.ext".
  if (value.startsWith(`${ARTIFACTS_BUCKET}/`)) {
    return { bucket: ARTIFACTS_BUCKET, path: value.slice(ARTIFACTS_BUCKET.length + 1) };
  }

  return { bucket: ARTIFACTS_BUCKET, path: value };
}

async function createSignedUrlForTarget(target: StorageTarget): Promise<string | null> {
  if ("externalUrl" in target) return target.externalUrl;
  const { data, error } = await supabaseService.storage
    .from(target.bucket)
    .createSignedUrl(target.path, 60 * 60);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

async function persistAutomationResult(params: {
  req: AuthenticatedRequest;
  sessionId: string;
  orgId: string;
  projectId: string;
  automationType: string;
  title: string;
  model?: string | null;
  mimeType: string;
  payload: unknown;
  imageDataUrl?: string;
  previewText?: string | null;
  extension: 'json' | 'png' | 'md' | 'txt';
}) {
  const normalizedType = normalizeAutomationType(params.automationType);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const storagePath = `automation-results/${params.sessionId}/${normalizedType}/${timestamp}.${params.extension}`;

  if (params.extension === 'png') {
    const dataUrl = params.imageDataUrl || '';
    const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : '';
    if (!base64) throw new Error('Missing PNG payload for automation result');
    await uploadArtifactToStorage(storagePath, Buffer.from(base64, 'base64'), params.mimeType);
  } else {
    await uploadArtifactToStorage(
      storagePath,
      JSON.stringify(params.payload ?? {}, null, 2),
      params.mimeType
    );
  }

  const { data, error } = await params.req.supabaseClient!
    .from('automation_results')
    .insert({
      org_id: params.orgId,
      project_id: params.projectId,
      call_session_id: params.sessionId,
      automation_type: normalizedType,
      title: params.title,
      model: params.model ?? null,
      storage_path: storagePath,
      mime_type: params.mimeType,
      result_json: params.payload ?? {},
      preview_text: params.previewText ?? null,
      created_by: params.req.userId ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Get all call sessions for a project
router.get('/project/:projectId', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { projectId } = req.params;

    const { data, error } = await req.supabaseClient!
      .from('call_sessions')
      .select(`
        *,
        meeting:meetings(*),
        transcript:transcripts(*),
        summary:summaries(*)
      `)
      .eq('project_id', projectId)
      .order('started_at', { ascending: false });

    if (error) throw error;

    res.json({ sessions: data || [] });
  } catch (error: any) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch sessions' });
  }
});

// Get a specific call session with full details
router.get('/:id', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const { data, error } = await req.supabaseClient!
      .from('call_sessions')
      .select(`
        *,
        meeting:meetings(*, meeting_invitees(*)),
        transcript:transcripts(*),
        summary:summaries(*),
        verified_invitee:meeting_invitees!verified_invitee_id(*)
      `)
      .eq('id', id)
      .single();

    if (error) throw error;
    if (!data) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    res.json({ session: data });
  } catch (error: any) {
    console.error('Error fetching session:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch session' });
  }
});

// Get transcript for a session (with storage path resolution if needed)
router.get('/:id/transcript', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const { data: session, error: sessionError } = await req.supabaseClient!
      .from('call_sessions')
      .select('transcript_path, transcript:transcripts(*)')
      .eq('id', id)
      .single();

    if (sessionError) throw sessionError;
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Supabase one-to-many relation returns array; normalize to single transcript
    const transcript = Array.isArray(session.transcript) ? session.transcript[0] ?? null : session.transcript;
    res.json({ transcript });
  } catch (error: any) {
    console.error('Error fetching transcript:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch transcript' });
  }
});

// Resolve a playable signed URL for the session recording_path.
router.get('/:id/recording-url', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = String(req.params.id);

    const { data: callSession, error } = await req.supabaseClient!
      .from('call_sessions')
      .select('recording_path')
      .eq('id', id)
      .single();

    if (error) throw error;
    if (!callSession) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const target = resolveStorageTarget(callSession.recording_path);
    if (!target) {
      res.json({ recordingUrl: null });
      return;
    }

    const recordingUrl = await createSignedUrlForTarget(target);
    res.json({ recordingUrl, url: recordingUrl });
  } catch (error: any) {
    console.error('Error resolving recording URL:', error);
    res.status(500).json({ error: error.message || 'Failed to resolve recording URL' });
  }
});

// Get latest summary for a session (backwards-compatible single record)
router.get('/:id/summary', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const { data: session, error: sessionError } = await req.supabaseClient!
      .from('call_sessions')
      .select('summary_path, summary:summaries(*)')
      .eq('id', id)
      .single();

    if (sessionError) throw sessionError;
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    res.json({ summary: session.summary });
  } catch (error: any) {
    console.error('Error fetching summary:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch summary' });
  }
});

// Get all summaries for a session (version history)
router.get('/:id/summaries', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const { data, error } = await req.supabaseClient!
      .from('summaries')
      .select('*')
      .eq('call_session_id', id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({ summaries: data || [] });
  } catch (error: any) {
    console.error('Error fetching summaries:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch summaries' });
  }
});

// Get latest saved automation result for this session + automation type.
router.get('/:id/automation-results/:automationType/latest', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const automationType = String(req.params.automationType);
    const normalizedType = normalizeAutomationType(automationType);

    const { data, error } = await req.supabaseClient!
      .from('automation_results')
      .select('*')
      .eq('call_session_id', id)
      .eq('automation_type', normalizedType)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      res.json({ result: null });
      return;
    }

    const signedUrl = await createSignedUrl(data.storage_path);
    res.json({
      result: {
        ...data,
        signed_url: signedUrl,
      },
    });
  } catch (error: any) {
    console.error('Error fetching automation result:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch automation result' });
  }
});

// Get all saved automation results for this session (latest first).
router.get('/:id/automation-results', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = String(req.params.id);

    const { data, error } = await req.supabaseClient!
      .from('automation_results')
      .select('id, automation_type, title, mime_type, created_at, storage_path, preview_text')
      .eq('call_session_id', id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({ results: data || [] });
  } catch (error: any) {
    console.error('Error fetching automation results list:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch automation results list' });
  }
});

// Get a specific saved automation result by result id for this session.
router.get('/:id/automation-results/item/:resultId', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    const resultId = String(req.params.resultId);

    const { data, error } = await req.supabaseClient!
      .from('automation_results')
      .select('*')
      .eq('id', resultId)
      .eq('call_session_id', id)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      res.status(404).json({ error: 'Automation result not found' });
      return;
    }

    const signedUrl = await createSignedUrl(data.storage_path);
    res.json({
      result: {
        ...data,
        signed_url: signedUrl,
      },
    });
  } catch (error: any) {
    console.error('Error fetching automation result by id:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch automation result' });
  }
});

// Generate (or regenerate) a summary for a session based on its transcript
router.post('/:id/summary', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = String(req.params.id);

    // Load session + transcript
    const { data: session, error: sessionError } = await req.supabaseClient!
      .from('call_sessions')
      .select('id, org_id, project_id, transcript:transcripts(*)')
      .eq('id', id)
      .single();

    if (sessionError) throw sessionError;
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Supabase returns one-to-many relation as array; we only need the latest transcript
    const transcriptRecord = Array.isArray(session.transcript)
      ? session.transcript[0]
      : session.transcript;

    if (!transcriptRecord?.raw) {
      res.status(400).json({ error: 'No transcript available for this session. Make sure the call was finalized with a transcript.' });
      return;
    }

    const transcriptRaw = transcriptRecord.raw;

    // Generate summary with LLM, honoring optional tone / audience / instructions from the UI
    const { tone, audience, instructions } = req.body || {};
    const summary = await generateSummaryFromTranscriptRaw(transcriptRaw, {
      tone,
      audience,
      instructions,
    });

    // Upsert into summaries table
    const { data: existing, error: existingError } = await req.supabaseClient!
      .from('summaries')
      .select('id')
      .eq('call_session_id', id)
      .maybeSingle();

    if (existingError) throw existingError;

    let summaryRecord;
    if (existing) {
      const { data, error } = await req.supabaseClient!
        .from('summaries')
        .update({
          model: summary.model,
          summary_text: summary.summary_text,
          key_points: summary.key_points,
          action_items: summary.action_items,
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) throw error;
      summaryRecord = data;
    } else {
      const { data, error } = await req.supabaseClient!
        .from('summaries')
        .insert({
          org_id: session.org_id,
          project_id: session.project_id,
          call_session_id: id,
          model: summary.model,
          summary_text: summary.summary_text,
          key_points: summary.key_points,
          action_items: summary.action_items,
        })
        .select()
        .single();

      if (error) throw error;
      summaryRecord = data;
    }

    const summaryPreview = [
      summary.summary_text,
      ...(Array.isArray(summary.key_points) ? summary.key_points.slice(0, 5).map((x: any) => `- ${String(x)}`) : []),
    ]
      .filter(Boolean)
      .join('\n');

    await persistAutomationResult({
      req,
      sessionId: id,
      orgId: session.org_id,
      projectId: session.project_id,
      automationType: 'summary',
      title: 'Generate Summary',
      model: summary.model,
      mimeType: 'application/json',
      payload: summaryRecord,
      previewText: summaryPreview,
      extension: 'json',
    });

    res.json({ summary: summaryRecord });
  } catch (error: any) {
    console.error('Error generating summary:', error);
    res.status(500).json({ error: error.message || 'Failed to generate summary' });
  }
});

// Generate a "Clarity Scorer" style report for a session based on its transcript.
// This does NOT currently persist anything to the database; it simply returns
// a rich markdown report to the caller.
router.post('/:id/clarity-score', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = String(req.params.id);

    // Load session + transcript
    const { data: session, error: sessionError } = await req.supabaseClient!
      .from('call_sessions')
      .select('id, org_id, project_id, transcript:transcripts(*)')
      .eq('id', id)
      .single();

    if (sessionError) throw sessionError;
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const transcriptRecord = Array.isArray(session.transcript)
      ? session.transcript[0]
      : session.transcript;

    if (!transcriptRecord?.raw) {
      res.status(400).json({
        error:
          'No transcript available for this session. Make sure the call was finalized with a transcript.',
      });
      return;
    }

    const transcriptRaw = transcriptRecord.raw;

    const { instructions } = req.body || {};
    const clarity = await generateClarityScoreFromTranscriptRaw(transcriptRaw, {
      instructions,
    });

    const clarityPreview = [
      clarity.summary,
      `Overall: ${Math.round(clarity.overallScore)}/100`,
      clarity.overallLabel || '',
      ...(Array.isArray(clarity.interpretation) ? clarity.interpretation.map((x) => `- ${x}`) : []),
    ]
      .filter(Boolean)
      .join('\n');

    await persistAutomationResult({
      req,
      sessionId: id,
      orgId: session.org_id,
      projectId: session.project_id,
      automationType: 'clarity-scorer',
      title: 'Clarity Scorer',
      model: clarity.model,
      mimeType: 'application/json',
      payload: clarity,
      previewText: clarityPreview,
      extension: 'json',
    });

    res.json({ clarity });
  } catch (error: any) {
    console.error('Error generating clarity score:', error);
    res.status(500).json({ error: error.message || 'Failed to generate clarity score' });
  }
});

router.post('/:id/soc2-document', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = String(req.params.id);

    const { data: session, error: sessionError } = await req.supabaseClient!
      .from('call_sessions')
      .select('id, org_id, project_id, transcript:transcripts(*)')
      .eq('id', id)
      .single();

    if (sessionError) throw sessionError;
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const transcriptRecord = Array.isArray(session.transcript)
      ? session.transcript[0]
      : session.transcript;

    if (!transcriptRecord?.raw) {
      res.status(400).json({
        error:
          'No transcript available for this session. Make sure the call was finalized with a transcript.',
      });
      return;
    }

    const { instructions, tone, audience } = req.body || {};
    const soc2Document = await generateSoc2DocumentFromTranscriptRaw(transcriptRecord.raw, {
      instructions,
      tone,
      audience,
    });

    const preview = [
      soc2Document.document_title,
      soc2Document.system_description,
      `Trust Services Categories: ${soc2Document.trust_services_categories.join(', ') || 'Not specified'}`,
      ...(Array.isArray(soc2Document.remediation_plan) ? soc2Document.remediation_plan.slice(0, 5).map((x) => `- ${x}`) : []),
    ]
      .filter(Boolean)
      .join('\n');

    await persistAutomationResult({
      req,
      sessionId: id,
      orgId: session.org_id,
      projectId: session.project_id,
      automationType: 'soc2-document',
      title: 'SOC2 Document',
      model: soc2Document.model,
      mimeType: 'application/json',
      payload: soc2Document,
      previewText: preview,
      extension: 'json',
    });

    res.json({ soc2Document });
  } catch (error: any) {
    console.error('Error generating SOC2 document:', error);
    res.status(500).json({ error: error.message || 'Failed to generate SOC2 document' });
  }
});

router.post('/:id/compliance-gap-analysis', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = String(req.params.id);

    const { data: session, error: sessionError } = await req.supabaseClient!
      .from('call_sessions')
      .select('id, org_id, project_id, transcript:transcripts(*)')
      .eq('id', id)
      .single();

    if (sessionError) throw sessionError;
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const transcriptRecord = Array.isArray(session.transcript)
      ? session.transcript[0]
      : session.transcript;

    if (!transcriptRecord?.raw) {
      res.status(400).json({
        error:
          'No transcript available for this session. Make sure the call was finalized with a transcript.',
      });
      return;
    }

    const { instructions, tone, audience } = req.body || {};
    const complianceGapAnalysis = await generateComplianceGapAnalysisFromTranscriptRaw(transcriptRecord.raw, {
      instructions,
      tone,
      audience,
    });

    const preview = [
      complianceGapAnalysis.title,
      complianceGapAnalysis.summary,
      ...(Array.isArray(complianceGapAnalysis.strengths)
        ? complianceGapAnalysis.strengths.slice(0, 3).map((x) => `Good: ${x}`)
        : []),
      ...(Array.isArray(complianceGapAnalysis.gaps)
        ? complianceGapAnalysis.gaps.slice(0, 5).map((x) => `Gap: ${x}`)
        : []),
      ...(Array.isArray(complianceGapAnalysis.future_steps)
        ? complianceGapAnalysis.future_steps.slice(0, 3).map((x) => `Next: ${x}`)
        : []),
    ]
      .filter(Boolean)
      .join('\n');

    await persistAutomationResult({
      req,
      sessionId: id,
      orgId: session.org_id,
      projectId: session.project_id,
      automationType: 'compliance-gap-analysis',
      title: 'Compliance Gap Analysis',
      model: complianceGapAnalysis.model,
      mimeType: 'application/json',
      payload: complianceGapAnalysis,
      previewText: preview,
      extension: 'json',
    });

    res.json({ complianceGapAnalysis });
  } catch (error: any) {
    console.error('Error generating compliance gap analysis:', error);
    res.status(500).json({ error: error.message || 'Failed to generate compliance gap analysis' });
  }
});

const generateVisualConceptMap = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = String(req.params.id);

    const { data: session, error: sessionError } = await req.supabaseClient!
      .from('call_sessions')
      .select('id, org_id, project_id, transcript:transcripts(*)')
      .eq('id', id)
      .single();

    if (sessionError) throw sessionError;
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const transcriptRecord = Array.isArray(session.transcript)
      ? session.transcript[0]
      : session.transcript;

    if (!transcriptRecord?.raw) {
      res.status(400).json({
        error:
          'No transcript available for this session. Make sure the call was finalized with a transcript.',
      });
      return;
    }

    const { instructions, tone, audience, visualMode } = req.body || {};
    const conceptMap = await generateFinancialConceptMapFromTranscriptRaw(transcriptRecord.raw, {
      instructions,
      tone,
      audience,
      visualMode,
    });

    await persistAutomationResult({
      req,
      sessionId: id,
      orgId: session.org_id,
      projectId: session.project_id,
      automationType: 'visual-concept-map',
      title: 'Visual Concept Map',
      model: conceptMap.model,
      mimeType: 'image/png',
      payload: {
        visual_spec: conceptMap.visual_spec,
        prompt_used: conceptMap.prompt_used,
      },
      imageDataUrl: conceptMap.image_data_url,
      previewText: `${conceptMap.visual_spec?.title || 'Visual Concept Map'}\n${conceptMap.visual_spec?.subtitle || ''}`.trim(),
      extension: 'png',
    });

    res.json({ conceptMap });
  } catch (error: any) {
    console.error('Error generating visual concept map:', error);
    res.status(500).json({ error: error.message || 'Failed to generate visual concept map' });
  }
};

// Preferred endpoint
router.post('/:id/visual-concept-map', authMiddleware, generateVisualConceptMap);
// Backward-compatible alias
router.post('/:id/financial-concept-map', authMiddleware, generateVisualConceptMap);

export default router;
