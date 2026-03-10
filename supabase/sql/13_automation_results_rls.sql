ALTER TABLE automation_results ENABLE ROW LEVEL SECURITY;

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

