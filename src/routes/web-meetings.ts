import { Router, Response } from "express";
import { z } from "zod";
import { authMiddleware, AuthenticatedRequest } from "../middleware/auth.js";
import { CreateWebMeetingSchema } from "../types/index.js";
import { generateMeetingCode, normalizeMeetingCode, normalizeName } from "../services/meeting-code.js";
import { sendMeetingInviteEmail } from "../services/email.js";
import { embedTacitMetaIntoAgenda } from "../services/meeting-meta.js";
import { resolveProjectId } from "../services/defaultProject.js";

const router = Router();

async function createRecallBot(params: { meetingUrl: string }) {
  const recallApiKey = process.env.RECALL_API_KEY;
  const publicUrl = process.env.PUBLIC_URL;
  if (!recallApiKey) throw new Error("Missing RECALL_API_KEY on backend");
  if (!publicUrl) throw new Error("Missing PUBLIC_URL on backend (must be your backend public https URL)");

  const host = publicUrl.replace("https://", "").replace("http://", "");
  const webpageUrl = `${publicUrl}/agent-minimal.html`;

  const botConfig = {
    meeting_url: params.meetingUrl,
    bot_name: "Tacit AI Agent Bot",
    recording_config: {
      audio_mixed_raw: {},
      realtime_endpoints: [
        {
          type: "websocket",
          url: `wss://${host}/recall-audio-in`,
          events: ["audio_mixed_raw.data"],
        },
      ],
    },
    output_media: {
      camera: {
        kind: "webpage",
        config: {
          url: webpageUrl,
        },
      },
    },
    automatic_audio_output: {
      in_call_recording: {
        data: {
          kind: "mp3",
          // 1 second of silence as base64 (enables Output Audio API)
          b64_data:
            "//uQxAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAADhAC8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLz///////////////////////////////////////////8AAAA5TEFNRTMuMTAwBK8AAAAAAAAAABQgJAUHQQAB4AAAA4SWa8a1AAAAAAD/+xDEAAADmA+gAAAA9wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        },
      },
    },
    automatic_leave: {
      waiting_room_timeout: 600,
      noone_joined_timeout: 600,
    },
  };

  const response = await fetch("https://us-west-2.recall.ai/api/v1/bot/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Token ${recallApiKey}`,
    },
    body: JSON.stringify(botConfig),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Recall.ai bot create failed (${response.status}): ${details}`);
  }

  const botData = (await response.json()) as any;
  return { botId: String(botData?.id || ""), botData };
}

// Create a new WEB meeting (Zoom/Meet link) and provision Recall.ai bot
router.post("/", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = CreateWebMeetingSchema.parse(req.body);
    const userId = req.userId!;

    const projectId = await resolveProjectId(req.supabaseClient!, body.project_id);
    if (!projectId) {
      res.status(404).json({ error: "Default project not found. Run 16_flat_access.sql migration." });
      return;
    }

    // Get project to derive org_id
    const { data: project, error: projectError } = await req.supabaseClient!
      .from("projects")
      .select("org_id")
      .eq("id", projectId)
      .single();

    if (projectError || !project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    // Generate meeting code
    const meetingCode = generateMeetingCode();
    const meetingCodeNorm = normalizeMeetingCode(meetingCode);

    // Embed web-meeting metadata into agenda to avoid requiring schema migrations.
    const agendaWithMeta = embedTacitMetaIntoAgenda(body.agenda || null, {
      meeting_type: "web",
      meeting_url: body.meeting_url,
    });

    // Create meeting
    const { data: meeting, error: meetingError } = await req.supabaseClient!
      .from("meetings")
      .insert({
        org_id: project.org_id,
        project_id: projectId,
        created_by: userId,
        title: body.title,
        agenda: agendaWithMeta,
        scheduled_start_at: body.scheduled_start_at,
        scheduled_end_at: body.scheduled_end_at,
        meeting_code: meetingCode,
        meeting_code_norm: meetingCodeNorm,
        twilio_number: null,
        status: "scheduled",
        agent_name: body.agent?.name || null,
      })
      .select()
      .single();

    if (meetingError) throw meetingError;

    // Create invitees
    const invitees = body.invitees.map((invitee) => ({
      meeting_id: meeting.id,
      name: invitee.name,
      email: invitee.email,
      phone: invitee.phone || null,
      name_norm: normalizeName(invitee.name),
      status: "pending" as const,
    }));

    const { data: createdInvitees, error: inviteesError } = await req.supabaseClient!
      .from("meeting_invitees")
      .insert(invitees)
      .select();
    if (inviteesError) throw inviteesError;

    // Provision Recall.ai bot (best-effort). If it fails, meeting still exists.
    let recallBotId: string | null = null;
    try {
      const { botId } = await createRecallBot({ meetingUrl: body.meeting_url });
      recallBotId = botId || null;

      if (recallBotId) {
        const newAgendaWithBot = embedTacitMetaIntoAgenda(agendaWithMeta, {
          meeting_type: "web",
          meeting_url: body.meeting_url,
          recall_bot_id: recallBotId,
        });
        await req.supabaseClient!.from("meetings").update({ agenda: newAgendaWithBot }).eq("id", meeting.id);
      }
    } catch (e) {
      console.error("Recall.ai provisioning failed:", e);
    }

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
          meetingUrl: body.meeting_url,
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
      }),
    );

    const inviteEmailsSent = emailResults.every((r) => r.ok);
    const inviteEmailErrors = emailResults
      .filter((r) => !r.ok)
      .map((r) => ({ email: r.email, error: (r as { error: string }).error }));

    res.status(201).json({
      meeting: {
        ...meeting,
        invitees: createdInvitees,
      },
      recallBotId,
      inviteEmailsSent,
      inviteEmailErrors: inviteEmailErrors.length ? inviteEmailErrors : undefined,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: "Invalid request body", details: error.errors });
      return;
    }
    console.error("Error creating web meeting:", error);
    res.status(500).json({ error: error.message || "Failed to create web meeting" });
  }
});

export default router;

