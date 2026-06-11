import { Router, Response } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { getDefaultProjectId } from '../services/defaultProject.js';
import { resolveAgentId } from '../utils/agentIdMap.js';

const router = Router();

const MANU_MISSION_LABELS: Record<string, string> = {
  'product-manual-gen': 'Product Manual Generation',
  'manual-update': 'Manual Update & Revision',
  'risk-coverage-qa': 'Risk-to-Manual Coverage QA',
  'regulatory-qa': 'Regulatory Compliance QA',
  'translation-qa': 'Translation Accuracy QA',
};

export type RecentActivityResume =
  | { kind: 'call_session'; sessionId: string; agentName: string }
  | { kind: 'manu_run'; runId: string; missionId: string }
  | {
      kind: 'workspace_launch';
      agentId: string;
      modeId: string | null;
      missionTitle: string;
      workspaceStep?: string | null;
      metadata?: Record<string, unknown>;
    };

export type RecentAgentActivity = {
  id: string;
  agentId: string;
  kind: 'call_session' | 'manu_run' | 'workspace_launch';
  title: string;
  subtitle: string;
  status: string;
  createdAt: string;
  resume: RecentActivityResume;
};

function sessionStatusLabel(status: string | null | undefined): string {
  const s = String(status || '').toLowerCase();
  if (s === 'completed') return 'Output ready';
  if (s === 'failed') return 'Failed';
  return 'In progress';
}

function manuStatusLabel(status: string | null | undefined): string {
  const s = String(status || '').toLowerCase();
  if (s === 'ready') return 'Output ready';
  if (s === 'failed') return 'Failed';
  return 'In progress';
}

function workspaceStatusLabel(): string {
  return 'In progress';
}

function matchesSearch(activity: RecentAgentActivity, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return (
    activity.title.toLowerCase().includes(needle) ||
    activity.subtitle.toLowerCase().includes(needle)
  );
}

// GET /api/dashboard/recent-activity
router.get('/recent-activity', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const agentFilter = String(req.query.agentId || '').trim().toLowerCase();
    const searchQ = String(req.query.q || '').trim();

    const activities: RecentAgentActivity[] = [];

    const { data: sessions, error: sessionsError } = await req.supabaseClient!
      .from('call_sessions')
      .select('id, status, started_at, meeting:meetings(title, agent_name), transcript:transcripts(agent_name)')
      .order('started_at', { ascending: false })
      .limit(40);

    if (sessionsError) throw sessionsError;

    for (const row of sessions ?? []) {
      const meeting = row.meeting as { title?: string; agent_name?: string } | null;
      const transcript = row.transcript as { agent_name?: string } | Array<{ agent_name?: string }> | null;
      const transcriptAgent = Array.isArray(transcript)
        ? transcript[0]?.agent_name
        : transcript?.agent_name;
      const agentName = meeting?.agent_name || transcriptAgent || '';
      const agentId = resolveAgentId(agentName);
      const title = meeting?.title?.trim() || `Session ${String(row.id).slice(0, 8)}`;
      const createdAt = row.started_at || new Date().toISOString();

      activities.push({
        id: `session-${row.id}`,
        agentId,
        kind: 'call_session',
        title,
        subtitle: agentName ? `${agentName} � Call session` : 'Call session',
        status: sessionStatusLabel(row.status),
        createdAt,
        resume: {
          kind: 'call_session',
          sessionId: String(row.id),
          agentName: agentName || agentId,
        },
      });
    }

    const projectId = await getDefaultProjectId(req.supabaseClient!);
    if (projectId) {
      const { data: runs, error: runsError } = await req.supabaseClient!
        .from('manu_runs')
        .select('id, mission_id, status, stage, created_at, manual_config')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(24);

      if (runsError) throw runsError;

      for (const run of runs ?? []) {
        const manualConfig = run.manual_config as { metadata?: { productName?: string } } | null;
        const productName = manualConfig?.metadata?.productName?.trim();
        const missionId = String(run.mission_id || '');
        const missionLabel = MANU_MISSION_LABELS[missionId] || missionId || 'MANU run';
        const title = productName || missionLabel;

        activities.push({
          id: `manu-${run.id}`,
          agentId: 'manu',
          kind: 'manu_run',
          title,
          subtitle: missionLabel,
          status: manuStatusLabel(run.status),
          createdAt: run.created_at || new Date().toISOString(),
          resume: {
            kind: 'manu_run',
            runId: String(run.id),
            missionId,
          },
        });
      }
    }

    const { data: launches, error: launchesError } = await req.supabaseClient!
      .from('mission_launches')
      .select('id, agent_id, mode_id, mission_title, workspace_step, metadata, created_at')
      .eq('user_id', req.userId!)
      .order('created_at', { ascending: false })
      .limit(24);

    if (launchesError) {
      const msg = launchesError.message || '';
      if (!msg.toLowerCase().includes('mission_launches')) {
        throw launchesError;
      }
    } else {
      for (const launch of launches ?? []) {
        const agentId = String(launch.agent_id || 'unknown');
        activities.push({
          id: `launch-${launch.id}`,
          agentId,
          kind: 'workspace_launch',
          title: String(launch.mission_title || 'Workspace'),
          subtitle: launch.workspace_step
            ? String(launch.workspace_step)
            : launch.mode_id
              ? String(launch.mode_id)
              : 'Workspace',
          status: workspaceStatusLabel(),
          createdAt: launch.created_at || new Date().toISOString(),
          resume: {
            kind: 'workspace_launch',
            agentId,
            modeId: launch.mode_id ? String(launch.mode_id) : null,
            missionTitle: String(launch.mission_title || ''),
            workspaceStep: launch.workspace_step ? String(launch.workspace_step) : null,
            metadata: (launch.metadata as Record<string, unknown>) ?? {},
          },
        });
      }
    }

    activities.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    let filtered = activities;
    if (agentFilter && agentFilter !== 'all') {
      filtered = filtered.filter((a) => a.agentId === agentFilter);
    }
    if (searchQ) {
      filtered = filtered.filter((a) => matchesSearch(a, searchQ));
    }

    res.json({ activities: filtered.slice(0, 24) });
  } catch (err: any) {
    console.error('Recent activity error:', err);
    res.status(500).json({ error: err?.message || 'Failed to fetch recent activity' });
  }
});

export default router;
