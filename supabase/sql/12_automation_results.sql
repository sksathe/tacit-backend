-- Persist generated automation outputs per session.
CREATE TABLE IF NOT EXISTS automation_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    call_session_id UUID NOT NULL REFERENCES call_sessions(id) ON DELETE CASCADE,
    automation_type TEXT NOT NULL, -- e.g. summary, clarity-scorer, visual-concept-map
    title TEXT NOT NULL,
    model TEXT,
    storage_path TEXT, -- path in tacit-artifacts bucket
    mime_type TEXT,
    result_json JSONB,
    preview_text TEXT,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_results_call_session_id
  ON automation_results(call_session_id);

CREATE INDEX IF NOT EXISTS idx_automation_results_session_type_created_at
  ON automation_results(call_session_id, automation_type, created_at DESC);

