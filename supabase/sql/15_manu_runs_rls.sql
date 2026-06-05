ALTER TABLE manu_runs ENABLE ROW LEVEL SECURITY;

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
