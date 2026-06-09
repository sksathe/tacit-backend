-- Flat access mode: any authenticated user can read/write all tenant data.
-- Run in Supabase SQL Editor after 01-15 migrations.
-- Revert with 17_restore_tenant_rls.sql

-- ---------------------------------------------------------------------------
-- 1. Default org + project for new writes
-- ---------------------------------------------------------------------------
INSERT INTO orgs (name)
SELECT 'Tacit Demo'
WHERE NOT EXISTS (SELECT 1 FROM orgs WHERE name = 'Tacit Demo');

INSERT INTO projects (org_id, name)
SELECT o.id, 'Default'
FROM orgs o
WHERE o.name = 'Tacit Demo'
  AND NOT EXISTS (
    SELECT 1 FROM projects p WHERE p.org_id = o.id AND p.name = 'Default'
  );

-- ---------------------------------------------------------------------------
-- 2. Auto-provision membership for new signups
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user_demo_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO project_members (project_id, user_id, role)
  SELECT p.id, NEW.id, 'member'
  FROM projects p
  WHERE p.name = 'Default'
  ORDER BY p.created_at ASC
  LIMIT 1
  ON CONFLICT (project_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_demo_access ON auth.users;
CREATE TRIGGER on_auth_user_created_demo_access
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_demo_access();

-- Backfill existing users into Default project
INSERT INTO project_members (project_id, user_id, role)
SELECT p.id, u.id, 'member'
FROM auth.users u
CROSS JOIN projects p
WHERE p.name = 'Default'
ON CONFLICT (project_id, user_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Drop tenant-scoped policies
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can read orgs they belong to" ON orgs;
DROP POLICY IF EXISTS "Users can read their projects" ON projects;
DROP POLICY IF EXISTS "Users can create projects in orgs they belong to" ON projects;
DROP POLICY IF EXISTS "Users can read project members" ON project_members;
DROP POLICY IF EXISTS "Users can insert project members" ON project_members;
DROP POLICY IF EXISTS "Users can read meetings in their projects" ON meetings;
DROP POLICY IF EXISTS "Users can create meetings in their projects" ON meetings;
DROP POLICY IF EXISTS "Users can update meetings in their projects" ON meetings;
DROP POLICY IF EXISTS "Users can read invitees for meetings in their projects" ON meeting_invitees;
DROP POLICY IF EXISTS "Users can create invitees for meetings in their projects" ON meeting_invitees;
DROP POLICY IF EXISTS "Users can read call sessions in their projects" ON call_sessions;
DROP POLICY IF EXISTS "Users can read transcripts in their projects" ON transcripts;
DROP POLICY IF EXISTS "Users can read summaries in their projects" ON summaries;
DROP POLICY IF EXISTS "Users can insert summaries in their projects" ON summaries;
DROP POLICY IF EXISTS "Users can update summaries in their projects" ON summaries;
DROP POLICY IF EXISTS "Users can read automation results in their projects" ON automation_results;
DROP POLICY IF EXISTS "Users can insert automation results in their projects" ON automation_results;
DROP POLICY IF EXISTS "Users can update automation results in their projects" ON automation_results;
DROP POLICY IF EXISTS "Users can read manu runs in their projects" ON manu_runs;
DROP POLICY IF EXISTS "Users can insert manu runs in their projects" ON manu_runs;
DROP POLICY IF EXISTS "Users can update manu runs in their projects" ON manu_runs;

-- ---------------------------------------------------------------------------
-- 4. Open policies for authenticated users
-- ---------------------------------------------------------------------------
CREATE POLICY "Flat access select orgs"
    ON orgs FOR SELECT
    USING (auth.uid() IS NOT NULL);

CREATE POLICY "Flat access insert orgs"
    ON orgs FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Flat access update orgs"
    ON orgs FOR UPDATE
    USING (auth.uid() IS NOT NULL)
    WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Flat access delete orgs"
    ON orgs FOR DELETE
    USING (auth.uid() IS NOT NULL);

CREATE POLICY "Flat access select projects"
    ON projects FOR SELECT
    USING (auth.uid() IS NOT NULL);

CREATE POLICY "Flat access insert projects"
    ON projects FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Flat access update projects"
    ON projects FOR UPDATE
    USING (auth.uid() IS NOT NULL)
    WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Flat access delete projects"
    ON projects FOR DELETE
    USING (auth.uid() IS NOT NULL);

CREATE POLICY "Flat access select project_members"
    ON project_members FOR SELECT
    USING (auth.uid() IS NOT NULL);

CREATE POLICY "Flat access insert project_members"
    ON project_members FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Flat access update project_members"
    ON project_members FOR UPDATE
    USING (auth.uid() IS NOT NULL)
    WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Flat access delete project_members"
    ON project_members FOR DELETE
    USING (auth.uid() IS NOT NULL);

CREATE POLICY "Flat access select meetings"
    ON meetings FOR SELECT
    USING (auth.uid() IS NOT NULL);

CREATE POLICY "Flat access insert meetings"
    ON meetings FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Flat access update meetings"
    ON meetings FOR UPDATE
    USING (auth.uid() IS NOT NULL)
    WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Flat access delete meetings"
    ON meetings FOR DELETE
    USING (auth.uid() IS NOT NULL);

CREATE POLICY "Flat access select meeting_invitees"
    ON meeting_invitees FOR SELECT
    USING (auth.uid() IS NOT NULL);

CREATE POLICY "Flat access insert meeting_invitees"
    ON meeting_invitees FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Flat access update meeting_invitees"
    ON meeting_invitees FOR UPDATE
    USING (auth.uid() IS NOT NULL)
    WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Flat access delete meeting_invitees"
    ON meeting_invitees FOR DELETE
    USING (auth.uid() IS NOT NULL);

CREATE POLICY "Flat access select call_sessions"
    ON call_sessions FOR SELECT
    USING (auth.uid() IS NOT NULL);

CREATE POLICY "Flat access insert call_sessions"
    ON call_sessions FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Flat access update call_sessions"
    ON call_sessions FOR UPDATE
    USING (auth.uid() IS NOT NULL)
    WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Flat access delete call_sessions"
    ON call_sessions FOR DELETE
    USING (auth.uid() IS NOT NULL);

CREATE POLICY "Flat access select transcripts"
    ON transcripts FOR SELECT
    USING (auth.uid() IS NOT NULL);

CREATE POLICY "Flat access insert transcripts"
    ON transcripts FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Flat access update transcripts"
    ON transcripts FOR UPDATE
    USING (auth.uid() IS NOT NULL)
    WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Flat access delete transcripts"
    ON transcripts FOR DELETE
    USING (auth.uid() IS NOT NULL);

CREATE POLICY "Flat access select summaries"
    ON summaries FOR SELECT
    USING (auth.uid() IS NOT NULL);

CREATE POLICY "Flat access insert summaries"
    ON summaries FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Flat access update summaries"
    ON summaries FOR UPDATE
    USING (auth.uid() IS NOT NULL)
    WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Flat access delete summaries"
    ON summaries FOR DELETE
    USING (auth.uid() IS NOT NULL);

CREATE POLICY "Flat access select automation_results"
    ON automation_results FOR SELECT
    USING (auth.uid() IS NOT NULL);

CREATE POLICY "Flat access insert automation_results"
    ON automation_results FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Flat access update automation_results"
    ON automation_results FOR UPDATE
    USING (auth.uid() IS NOT NULL)
    WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Flat access delete automation_results"
    ON automation_results FOR DELETE
    USING (auth.uid() IS NOT NULL);

CREATE POLICY "Flat access select manu_runs"
    ON manu_runs FOR SELECT
    USING (auth.uid() IS NOT NULL);

CREATE POLICY "Flat access insert manu_runs"
    ON manu_runs FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Flat access update manu_runs"
    ON manu_runs FOR UPDATE
    USING (auth.uid() IS NOT NULL)
    WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Flat access delete manu_runs"
    ON manu_runs FOR DELETE
    USING (auth.uid() IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 5. Lock down idempotency_keys (service role / MCP only)
-- ---------------------------------------------------------------------------
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role only idempotency_keys" ON idempotency_keys;
CREATE POLICY "Service role only idempotency_keys"
    ON idempotency_keys
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- 6. Helpful: print Default project id for .env
-- ---------------------------------------------------------------------------
SELECT p.id AS default_project_id, o.name AS org_name, p.name AS project_name
FROM projects p
JOIN orgs o ON o.id = p.org_id
WHERE p.name = 'Default'
ORDER BY p.created_at ASC
LIMIT 1;
