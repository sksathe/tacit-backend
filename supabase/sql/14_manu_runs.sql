-- MANU manual intelligence runs (LabCorp documentation workflow)
CREATE TABLE IF NOT EXISTS manu_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    created_by UUID REFERENCES auth.users(id),
    mission_id TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'execute',
    status TEXT NOT NULL DEFAULT 'queued',
    stage TEXT,
    stage_index INT NOT NULL DEFAULT 0,
    progress INT NOT NULL DEFAULT 0,
    error_message TEXT,
    manual_config JSONB NOT NULL,
    uploaded_documents JSONB NOT NULL DEFAULT '[]'::jsonb,
    result_json JSONB,
    storage_path TEXT,
    model TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_manu_runs_project_id ON manu_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_manu_runs_project_created_at ON manu_runs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_manu_runs_status ON manu_runs(status);
