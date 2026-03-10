-- Organizations
CREATE TABLE IF NOT EXISTS orgs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Projects
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Project Members (many-to-many relationship)
CREATE TABLE IF NOT EXISTS project_members (
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL, -- Supabase auth.uid()
    role TEXT NOT NULL DEFAULT 'member', -- 'owner', 'admin', 'member'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (project_id, user_id)
);

-- Meetings
CREATE TABLE IF NOT EXISTS meetings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    created_by UUID NOT NULL, -- Supabase auth.uid()
    title TEXT NOT NULL,
    agenda TEXT,
    scheduled_start_at TIMESTAMPTZ NOT NULL,
    scheduled_end_at TIMESTAMPTZ NOT NULL,
    meeting_code TEXT NOT NULL, -- Human-readable code
    meeting_code_norm TEXT NOT NULL, -- Normalized for matching (lowercase, no spaces)
    twilio_number TEXT,
    status TEXT NOT NULL DEFAULT 'scheduled', -- 'scheduled', 'in_progress', 'completed', 'cancelled'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Optional agent name used for this meeting (e.g., \"Rachel\")
ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS agent_name TEXT;

-- Meeting Invitees
CREATE TABLE IF NOT EXISTS meeting_invitees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    name_norm TEXT NOT NULL, -- Normalized for fuzzy matching
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'joined', 'declined'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Call Sessions (actual call instances)
CREATE TABLE IF NOT EXISTS call_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    caller_phone TEXT,
    elevenlabs_conversation_id TEXT UNIQUE,
    verification_status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'verified', 'rejected'
    verification_attempts INT NOT NULL DEFAULT 0,
    verified_invitee_id UUID REFERENCES meeting_invitees(id),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    duration_sec INT,
    recording_path TEXT, -- Storage path for audio recording
    transcript_path TEXT, -- Storage path for transcript.json
    summary_path TEXT, -- Storage path for summary.json
    status TEXT NOT NULL DEFAULT 'in_progress', -- 'in_progress', 'completed', 'failed'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Transcripts
CREATE TABLE IF NOT EXISTS transcripts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    call_session_id UUID NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
    raw JSONB NOT NULL,
    normalized JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Link transcripts directly to meetings and store agent name for UI grouping
ALTER TABLE transcripts
  ADD COLUMN IF NOT EXISTS meeting_id UUID REFERENCES meetings(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS agent_name TEXT;

-- Summaries
CREATE TABLE IF NOT EXISTS summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    call_session_id UUID NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
    model TEXT NOT NULL, -- e.g., 'gpt-4o-mini', 'claude-3-opus'
    summary_text TEXT NOT NULL,
    key_points JSONB,
    action_items JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotency Keys (for preventing duplicate writes)
CREATE TABLE IF NOT EXISTS idempotency_keys (
    id BIGSERIAL PRIMARY KEY,
    scope TEXT NOT NULL, -- e.g., 'call_session', 'transcript', 'summary'
    key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (scope, key)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_projects_org_id ON projects(org_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user_id ON project_members(user_id);
CREATE INDEX IF NOT EXISTS idx_project_members_project_id ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_meetings_project_id ON meetings(project_id);
CREATE INDEX IF NOT EXISTS idx_meetings_org_id ON meetings(org_id);
CREATE INDEX IF NOT EXISTS idx_meetings_code_norm ON meetings(meeting_code_norm);
CREATE INDEX IF NOT EXISTS idx_meetings_scheduled_start_at ON meetings(scheduled_start_at);
CREATE INDEX IF NOT EXISTS idx_meeting_invitees_meeting_id ON meeting_invitees(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_invitees_name_norm ON meeting_invitees USING gin(name_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_call_sessions_meeting_id ON call_sessions(meeting_id);
CREATE INDEX IF NOT EXISTS idx_call_sessions_project_id ON call_sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_call_sessions_org_id ON call_sessions(org_id);
CREATE INDEX IF NOT EXISTS idx_call_sessions_elevenlabs_conversation_id ON call_sessions(elevenlabs_conversation_id);
CREATE INDEX IF NOT EXISTS idx_transcripts_call_session_id ON transcripts(call_session_id);
CREATE INDEX IF NOT EXISTS idx_summaries_call_session_id ON summaries(call_session_id);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_scope_key ON idempotency_keys(scope, key);
