import { Router, Response } from 'express';
import { z } from 'zod';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { CreateMeetingSchema, UpdateMeetingSchema } from '../types/index.js';
import { generateMeetingCode, normalizeMeetingCode, normalizeName } from '../services/meeting-code.js';
import { sendMeetingInviteEmail } from '../services/email.js';

const router = Router();

// Get all meetings for a project
router.get('/project/:projectId', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { projectId } = req.params;

    const { data, error } = await req.supabaseClient!
      .from('meetings')
      .select(`
        *,
        invitees:meeting_invitees(*),
        call_sessions:call_sessions(*)
      `)
      .eq('project_id', projectId)
      .order('scheduled_start_at', { ascending: false });

    if (error) throw error;

    res.json({ meetings: data || [] });
  } catch (error: any) {
    console.error('Error fetching meetings:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch meetings' });
  }
});

// Get a specific meeting
router.get('/:id', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const { data, error } = await req.supabaseClient!
      .from('meetings')
      .select(`
        *,
        invitees:meeting_invitees(*),
        call_sessions:call_sessions(*),
        project:projects(*)
      `)
      .eq('id', id)
      .single();

    if (error) throw error;
    if (!data) {
      res.status(404).json({ error: 'Meeting not found' });
      return;
    }

    res.json({ meeting: data });
  } catch (error: any) {
    console.error('Error fetching meeting:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch meeting' });
  }
});

// Create a new meeting
router.post('/', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = CreateMeetingSchema.parse(req.body);
    const userId = req.userId!;

    // Get project to derive org_id
    const { data: project, error: projectError } = await req.supabaseClient!
      .from('projects')
      .select('org_id')
      .eq('id', body.project_id)
      .single();

    if (projectError || !project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Generate meeting code
    const meetingCode = generateMeetingCode();
    const meetingCodeNorm = normalizeMeetingCode(meetingCode);

    // Create meeting
    const { data: meeting, error: meetingError } = await req.supabaseClient!
      .from('meetings')
      .insert({
        org_id: project.org_id,
        project_id: body.project_id,
        created_by: userId,
        title: body.title,
        agenda: body.agenda || null,
        scheduled_start_at: body.scheduled_start_at,
        scheduled_end_at: body.scheduled_end_at,
        meeting_code: meetingCode,
        meeting_code_norm: meetingCodeNorm,
        twilio_number: process.env.TWILIO_NUMBER || '+1 (980) 499-5308',
        status: 'scheduled',
        agent_name: body.agent?.name || null,
      })
      .select()
      .single();

    if (meetingError) throw meetingError;

    // Create invitees
    const invitees = body.invitees.map(invitee => ({
      meeting_id: meeting.id,
      name: invitee.name,
      email: invitee.email,
      phone: invitee.phone || null,
      name_norm: normalizeName(invitee.name),
      status: 'pending' as const,
    }));

    const { data: createdInvitees, error: inviteesError } = await req.supabaseClient!
      .from('meeting_invitees')
      .insert(invitees)
      .select();

    if (inviteesError) throw inviteesError;

    // Send invite emails and await so we can report success/failure
    const emailResults = await Promise.all(
      body.invitees.map(async (invitee) => {
        const result = await sendMeetingInviteEmail({
          inviteeName: invitee.name,
          inviteeEmail: invitee.email,
          meetingTitle: body.title,
          meetingCode,
          scheduledStartAt: body.scheduled_start_at,
          scheduledEndAt: body.scheduled_end_at,
          agenda: body.agenda,
          agentName: body.agent?.name,
          agentCard: body.agent
            ? {
                name: body.agent.name,
                tagline: body.agent.tagline,
                role: body.agent.role,
                persona: body.agent.persona,
                description: body.agent.description,
                descriptionContinued: body.agent.descriptionContinued,
                specialties: body.agent.specialties,
              }
            : undefined,
        });
        return { email: invitee.email, ...result };
      })
    );
    const inviteEmailsSent = emailResults.every((r) => r.ok);
    const inviteEmailErrors = emailResults.filter((r) => !r.ok).map((r) => ({ email: r.email, error: (r as { error: string }).error }));

    res.status(201).json({
      meeting: {
        ...meeting,
        invitees: createdInvitees,
      },
      inviteEmailsSent,
      inviteEmailErrors: inviteEmailErrors.length ? inviteEmailErrors : undefined,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid request body', details: error.errors });
      return;
    }
    console.error('Error creating meeting:', error);
    res.status(500).json({ error: error.message || 'Failed to create meeting' });
  }
});

// Update a meeting
router.patch('/:id', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const body = UpdateMeetingSchema.parse(req.body);

    const { data, error } = await req.supabaseClient!
      .from('meetings')
      .update(body)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (!data) {
      res.status(404).json({ error: 'Meeting not found' });
      return;
    }

    res.json({ meeting: data });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid request body', details: error.errors });
      return;
    }
    console.error('Error updating meeting:', error);
    res.status(500).json({ error: error.message || 'Failed to update meeting' });
  }
});

export default router;
