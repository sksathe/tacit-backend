import { Router, Response } from 'express';
import { z } from 'zod';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

const CreateMissionLaunchSchema = z.object({
  agentId: z.string().min(1),
  modeId: z.string().nullable().optional(),
  missionTitle: z.string().min(1),
  workspaceStep: z.string().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
});

function isMissionLaunchesTableMissing(err: unknown): boolean {
  const message = String((err as { message?: string })?.message ?? err ?? '').toLowerCase();
  const code = String((err as { code?: string })?.code ?? '').toLowerCase();
  return (
    message.includes('mission_launches') ||
    message.includes('does not exist') ||
    message.includes('schema cache') ||
    message.includes('could not find the table') ||
    code === 'pgrst205' ||
    code === '42p01'
  );
}

// POST /api/mission-launches
router.post('/', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = CreateMissionLaunchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const { agentId, modeId, missionTitle, workspaceStep, metadata } = parsed.data;

    const { data, error } = await req.supabaseClient!
      .from('mission_launches')
      .insert({
        user_id: req.userId!,
        agent_id: agentId,
        mode_id: modeId ?? null,
        mission_title: missionTitle,
        workspace_step: workspaceStep ?? null,
        metadata: metadata ?? {},
      })
      .select('id, agent_id, mode_id, mission_title, workspace_step, metadata, created_at')
      .single();

    if (error) {
      if (isMissionLaunchesTableMissing(error)) {
        res.status(200).json({
          ok: true,
          launch: null,
          storage: 'skipped',
          reason: 'mission_launches table not migrated — run supabase/sql/18_mission_launches.sql',
        });
        return;
      }
      throw error;
    }

    res.status(201).json({ ok: true, launch: data });
  } catch (err: any) {
    if (isMissionLaunchesTableMissing(err)) {
      res.status(200).json({
        ok: true,
        launch: null,
        storage: 'skipped',
        reason: 'mission_launches table not migrated — run supabase/sql/18_mission_launches.sql',
      });
      return;
    }
    console.error('Mission launch record error:', err);
    res.status(500).json({ error: err?.message || 'Failed to record mission launch' });
  }
});

export default router;
