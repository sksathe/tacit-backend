-- Workspace launch history (Eagle / Clara / generic brief - not call_sessions or manu_runs)
CREATE TABLE IF NOT EXISTS mission_launches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    mode_id TEXT,
    mission_title TEXT NOT NULL,
    workspace_step TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mission_launches_user_created
    ON mission_launches(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mission_launches_agent_id
    ON mission_launches(agent_id);
