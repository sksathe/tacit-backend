-- Function for fuzzy name matching using pg_trgm similarity
CREATE OR REPLACE FUNCTION fuzzy_match_invitee(
    p_meeting_id UUID,
    p_spoken_name TEXT,
    p_caller_phone TEXT DEFAULT NULL
)
RETURNS TABLE (
    invitee_id UUID,
    name TEXT,
    similarity REAL
) AS $$
DECLARE
    normalized_spoken TEXT;
BEGIN
    -- Normalize spoken name
    normalized_spoken := lower(trim(regexp_replace(p_spoken_name, '[^\w\s]', '', 'g')));
    normalized_spoken := regexp_replace(normalized_spoken, '\s+', ' ', 'g');

    -- First, try exact match on normalized name
    RETURN QUERY
    SELECT
        mi.id,
        mi.name,
        1.0::REAL as similarity
    FROM meeting_invitees mi
    WHERE mi.meeting_id = p_meeting_id
      AND mi.name_norm = normalized_spoken
    LIMIT 1;

    -- If exact match found, return early
    IF FOUND THEN
        RETURN;
    END IF;

    -- Try phone match if caller phone provided
    IF p_caller_phone IS NOT NULL THEN
        RETURN QUERY
        SELECT
            mi.id,
            mi.name,
            0.9::REAL as similarity
        FROM meeting_invitees mi
        WHERE mi.meeting_id = p_meeting_id
          AND mi.phone = p_caller_phone
        LIMIT 1;

        -- If phone match found, return early
        IF FOUND THEN
            RETURN;
        END IF;
    END IF;

    -- Use pg_trgm similarity for fuzzy matching
    RETURN QUERY
    SELECT
        mi.id,
        mi.name,
        similarity(mi.name_norm, normalized_spoken) as similarity
    FROM meeting_invitees mi
    WHERE mi.meeting_id = p_meeting_id
      AND similarity(mi.name_norm, normalized_spoken) > 0.5
    ORDER BY similarity DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION fuzzy_match_invitee(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION fuzzy_match_invitee(UUID, TEXT, TEXT) TO service_role;
