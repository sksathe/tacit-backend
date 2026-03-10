-- Enable Row Level Security
ALTER TABLE orgs ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_invitees ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE summaries ENABLE ROW LEVEL SECURITY;

-- RLS Policies for orgs (users can read orgs they belong to)
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

-- RLS Policies for projects (users can read projects they are members of)
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

-- RLS Policies for project_members
-- Fix: Use security definer functions to avoid infinite recursion
CREATE OR REPLACE FUNCTION user_is_project_member(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 
        FROM project_members 
        WHERE project_id = p_project_id 
        AND user_id = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION user_is_project_admin(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 
        FROM project_members 
        WHERE project_id = p_project_id 
        AND user_id = auth.uid() 
        AND role IN ('owner', 'admin')
    );
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION user_is_project_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION user_is_project_member(UUID) TO anon;
GRANT EXECUTE ON FUNCTION user_is_project_admin(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION user_is_project_admin(UUID) TO anon;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can read project members" ON project_members;
DROP POLICY IF EXISTS "Users can insert project members" ON project_members;

CREATE POLICY "Users can read project members"
    ON project_members FOR SELECT
    USING (
        user_id = auth.uid() -- Users can always see their own membership
        OR user_is_project_member(project_id) -- Or if they're a member of the project
    );

CREATE POLICY "Users can insert project members"
    ON project_members FOR INSERT
    WITH CHECK (
        user_is_project_admin(project_id) -- User must be owner/admin of the project
    );

-- RLS Policies for meetings
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

-- RLS Policies for meeting_invitees
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

-- RLS Policies for call_sessions
CREATE POLICY "Users can read call sessions in their projects"
    ON call_sessions FOR SELECT
    USING (
        project_id IN (
            SELECT project_id 
            FROM project_members 
            WHERE user_id = auth.uid()
        )
    );

-- RLS Policies for transcripts
CREATE POLICY "Users can read transcripts in their projects"
    ON transcripts FOR SELECT
    USING (
        project_id IN (
            SELECT project_id 
            FROM project_members 
            WHERE user_id = auth.uid()
        )
    );

-- RLS Policies for summaries
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
