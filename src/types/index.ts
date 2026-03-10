import { z } from 'zod';

// Database types (matching Supabase schema)
export interface Org {
  id: string;
  name: string;
  created_at: string;
}

export interface Project {
  id: string;
  org_id: string;
  name: string;
  created_at: string;
}

export interface ProjectMember {
  project_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member';
  created_at: string;
}

export interface Meeting {
  id: string;
  org_id: string;
  project_id: string;
  created_by: string;
  title: string;
  agenda: string | null;
  scheduled_start_at: string;
  scheduled_end_at: string;
  meeting_code: string;
  meeting_code_norm: string;
  twilio_number: string | null;
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  created_at: string;
}

export interface MeetingInvitee {
  id: string;
  meeting_id: string;
  name: string;
  email: string;
  phone: string | null;
  name_norm: string;
  status: 'pending' | 'joined' | 'declined';
  created_at: string;
}

export interface CallSession {
  id: string;
  org_id: string;
  project_id: string;
  meeting_id: string;
  caller_phone: string | null;
  elevenlabs_conversation_id: string | null;
  verification_status: 'pending' | 'verified' | 'rejected';
  verification_attempts: number;
  verified_invitee_id: string | null;
  started_at: string;
  ended_at: string | null;
  duration_sec: number | null;
  recording_path: string | null;
  transcript_path: string | null;
  summary_path: string | null;
  status: 'in_progress' | 'completed' | 'failed';
  created_at: string;
}

export interface Transcript {
  id: string;
  org_id: string;
  project_id: string;
  call_session_id: string;
  meeting_id?: string | null;
  agent_name?: string | null;
  raw: any;
  normalized: any | null;
  created_at: string;
}

export interface Summary {
  id: string;
  org_id: string;
  project_id: string;
  call_session_id: string;
  model: string;
  summary_text: string;
  key_points: any[] | null;
  action_items: any[] | null;
  created_at: string;
}

// Request/Response schemas
export const CreateProjectSchema = z.object({
  org_id: z.string().uuid(),
  name: z.string().min(1),
});

export const CreateMeetingAgentSchema = z.object({
  name: z.string().min(1),
  tagline: z.string(),
  role: z.string(),
  persona: z.string(),
  description: z.string(),
  descriptionContinued: z.string().optional(),
  specialties: z.array(z.string()),
});

export const CreateMeetingSchema = z.object({
  project_id: z.string().uuid(),
  title: z.string().min(1),
  agenda: z.string().optional(),
  scheduled_start_at: z.string().datetime(),
  scheduled_end_at: z.string().datetime(),
  invitees: z.array(z.object({
    name: z.string().min(1),
    email: z.string().email(),
    phone: z.string().optional(),
  })),
  agent: CreateMeetingAgentSchema.optional(),
});

export const UpdateMeetingSchema = z.object({
  title: z.string().min(1).optional(),
  agenda: z.string().optional(),
  scheduled_start_at: z.string().datetime().optional(),
  scheduled_end_at: z.string().datetime().optional(),
  status: z.enum(['scheduled', 'in_progress', 'completed', 'cancelled']).optional(),
});
