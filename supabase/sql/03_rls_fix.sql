-- Fix infinite recursion in project_members RLS policy
-- Drop existing policies first
DROP POLICY IF EXISTS "Users can read project members" ON project_members;
DROP POLICY IF EXISTS "Users can insert project members" ON project_members;

-- Create a security definer function to check membership without RLS recursion
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

-- Grant execute permission
GRANT EXECUTE ON FUNCTION user_is_project_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION user_is_project_member(UUID) TO anon;

-- Recreate the SELECT policy using the function (avoids recursion)
CREATE POLICY "Users can read project members"
    ON project_members FOR SELECT
    USING (
        user_id = auth.uid() -- Users can always see their own membership
        OR user_is_project_member(project_id) -- Or if they're a member of the project
    );

-- Recreate the INSERT policy using the function
CREATE POLICY "Users can insert project members"
    ON project_members FOR INSERT
    WITH CHECK (
        user_is_project_member(project_id) 
        AND EXISTS (
            SELECT 1 
            FROM project_members 
            WHERE project_id = project_members.project_id 
            AND user_id = auth.uid() 
            AND role IN ('owner', 'admin')
        )
    );
