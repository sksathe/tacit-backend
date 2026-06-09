-- Restore tenant-scoped RLS (undo 16_flat_access.sql).
-- Run in Supabase SQL Editor when demo flat access should be disabled.

-- ---------------------------------------------------------------------------
-- 1. Remove flat-access signup trigger
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS on_auth_user_created_demo_access ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user_demo_access();

-- ---------------------------------------------------------------------------
-- 2. Drop flat-access policies
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Flat access select orgs" ON orgs;
DROP POLICY IF EXISTS "Flat access insert orgs" ON orgs;
DROP POLICY IF EXISTS "Flat access update orgs" ON orgs;
DROP POLICY IF EXISTS "Flat access delete orgs" ON orgs;
DROP POLICY IF EXISTS "Flat access select projects" ON projects;
DROP POLICY IF EXISTS "Flat access insert projects" ON projects;
DROP POLICY IF EXISTS "Flat access update projects" ON projects;
DROP POLICY IF EXISTS "Flat access delete projects" ON projects;
DROP POLICY IF EXISTS "Flat access select project_members" ON project_members;
DROP POLICY IF EXISTS "Flat access insert project_members" ON project_members;
DROP POLICY IF EXISTS "Flat access update project_members" ON project_members;
DROP POLICY IF EXISTS "Flat access delete project_members" ON project_members;
DROP POLICY IF EXISTS "Flat access select meetings" ON meetings;
DROP POLICY IF EXISTS "Flat access insert meetings" ON meetings;
DROP POLICY IF EXISTS "Flat access update meetings" ON meetings;
DROP POLICY IF EXISTS "Flat access delete meetings" ON meetings;
DROP POLICY IF EXISTS "Flat access select meeting_invitees" ON meeting_invitees;
DROP POLICY IF EXISTS "Flat access insert meeting_invitees" ON meeting_invitees;
DROP POLICY IF EXISTS "Flat access update meeting_invitees" ON meeting_invitees;
DROP POLICY IF EXISTS "Flat access delete meeting_invitees" ON meeting_invitees;
DROP POLICY IF EXISTS "Flat access select call_sessions" ON call_sessions;
DROP POLICY IF EXISTS "Flat access insert call_sessions" ON call_sessions;
DROP POLICY IF EXISTS "Flat access update call_sessions" ON call_sessions;
DROP POLICY IF EXISTS "Flat access delete call_sessions" ON call_sessions;
DROP POLICY IF EXISTS "Flat access select transcripts" ON transcripts;
DROP POLICY IF EXISTS "Flat access insert transcripts" ON transcripts;
DROP POLICY IF EXISTS "Flat access update transcripts" ON transcripts;
DROP POLICY IF EXISTS "Flat access delete transcripts" ON transcripts;
DROP POLICY IF EXISTS "Flat access select summaries" ON summaries;
DROP POLICY IF EXISTS "Flat access insert summaries" ON summaries;
DROP POLICY IF EXISTS "Flat access update summaries" ON summaries;
DROP POLICY IF EXISTS "Flat access delete summaries" ON summaries;
DROP POLICY IF EXISTS "Flat access select automation_results" ON automation_results;
DROP POLICY IF EXISTS "Flat access insert automation_results" ON automation_results;
DROP POLICY IF EXISTS "Flat access update automation_results" ON automation_results;
DROP POLICY IF EXISTS "Flat access delete automation_results" ON automation_results;
DROP POLICY IF EXISTS "Flat access select manu_runs" ON manu_runs;
DROP POLICY IF EXISTS "Flat access insert manu_runs" ON manu_runs;
DROP POLICY IF EXISTS "Flat access update manu_runs" ON manu_runs;
DROP POLICY IF EXISTS "Flat access delete manu_runs" ON manu_runs;
DROP POLICY IF EXISTS "Service role only idempotency_keys" ON idempotency_keys;

ALTER TABLE idempotency_keys DISABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3. Re-apply tenant policies (from 03_rls.sql, 13, 15)
-- ---------------------------------------------------------------------------
CREATE POLICY "Users can read orgs they belong to"
    ON orgs FOR SELECT
    USING (
        id IN (
            SELECT DISTINCT org_id
            FROM projects
            WHERE id IN (
                SELECT project_id
                FROM project_members
                WHERE user_id = auth.uid()
            )
        )
    );

CREATE POLICY "Users can read their projects"
    ON projects FOR SELECT
    USING (
        id IN (
            SELECT project_id
            FROM project_members
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can create projects in orgs they belong to"
    ON projects FOR INSERT
    WITH CHECK (
        org_id IN (
            SELECT DISTINCT org_id
            FROM projects
            WHERE id IN (
                SELECT project_id
                FROM project_members
                WHERE user_id = auth.uid()
            )
        )
    );

CREATE POLICY "Users can read project members"
    ON project_members FOR SELECT
    USING (
        user_id = auth.uid()
        OR user_is_project_member(project_id)
    );

CREATE POLICY "Users can insert project members"
    ON project_members FOR INSERT
    WITH CHECK (
        user_is_project_admin(project_id)
    );

CREATE POLICY "Users can read meetings in their projects"
    ON meetings FOR SELECT
    USING (
        project_id IN (
            SELECT project_id
            FROM project_members
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can create meetings in their projects"
    ON meetings FOR INSERT
    WITH CHECK (
        project_id IN (
            SELECT project_id
            FROM project_members
            WHERE user_id = auth.uid()
        )
        AND created_by = auth.uid()
    );

CREATE POLICY "Users can update meetings in their projects"
    ON meetings FOR UPDATE
    USING (
        project_id IN (
            SELECT project_id
            FROM project_members
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can read invitees for meetings in their projects"
    ON meeting_invitees FOR SELECT
    USING (
        meeting_id IN (
            SELECT id
            FROM meetings
            WHERE project_id IN (
                SELECT project_id
                FROM project_members
                WHERE user_id = auth.uid()
            )
        )
    );

CREATE POLICY "Users can create invitees for meetings in their projects"
    ON meeting_invitees FOR INSERT
    WITH CHECK (
        meeting_id IN (
            SELECT id
            FROM meetings
            WHERE project_id IN (
                SELECT project_id
                FROM project_members
                WHERE user_id = auth.uid()
            )
        )
    );

CREATE POLICY "Users can read call sessions in their projects"
    ON call_sessions FOR SELECT
    USING (
        project_id IN (
            SELECT project_id
            FROM project_members
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can read transcripts in their projects"
    ON transcripts FOR SELECT
    USING (
        project_id IN (
            SELECT project_id
            FROM project_members
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can read summaries in their projects"
    ON summaries FOR SELECT
    USING (
        project_id IN (
            SELECT project_id
            FROM project_members
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert summaries in their projects"
    ON summaries FOR INSERT
    WITH CHECK (
        project_id IN (
            SELECT project_id
            FROM project_members
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update summaries in their projects"
    ON summaries FOR UPDATE
    USING (
        project_id IN (
            SELECT project_id
            FROM project_members
            WHERE user_id = auth.uid()
        )
    )
    WITH CHECK (
        project_id IN (
            SELECT project_id
            FROM project_members
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can read automation results in their projects"
    ON automation_results FOR SELECT
    USING (
        project_id IN (
            SELECT project_id
            FROM project_members
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert automation results in their projects"
    ON automation_results FOR INSERT
    WITH CHECK (
        project_id IN (
            SELECT project_id
            FROM project_members
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update automation results in their projects"
    ON automation_results FOR UPDATE
    USING (
        project_id IN (
            SELECT project_id
            FROM project_members
            WHERE user_id = auth.uid()
        )
    )
    WITH CHECK (
        project_id IN (
            SELECT project_id
            FROM project_members
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can read manu runs in their projects"
    ON manu_runs FOR SELECT
    USING (
        project_id IN (
            SELECT project_id
            FROM project_members
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert manu runs in their projects"
    ON manu_runs FOR INSERT
    WITH CHECK (
        project_id IN (
            SELECT project_id
            FROM project_members
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update manu runs in their projects"
    ON manu_runs FOR UPDATE
    USING (
        project_id IN (
            SELECT project_id
            FROM project_members
            WHERE user_id = auth.uid()
        )
    )
    WITH CHECK (
        project_id IN (
            SELECT project_id
            FROM project_members
            WHERE user_id = auth.uid()
        )
    );
