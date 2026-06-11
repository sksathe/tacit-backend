ALTER TABLE mission_launches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own mission launches"
    ON mission_launches FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Users can insert own mission launches"
    ON mission_launches FOR INSERT
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own mission launches"
    ON mission_launches FOR UPDATE
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own mission launches"
    ON mission_launches FOR DELETE
    USING (user_id = auth.uid());
