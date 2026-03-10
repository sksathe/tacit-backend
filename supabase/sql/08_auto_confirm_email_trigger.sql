-- Trigger to automatically confirm email when a user signs up
-- This ensures email_confirmed_at and confirmed_at are set immediately

CREATE OR REPLACE FUNCTION auto_confirm_user()
RETURNS TRIGGER AS $$
BEGIN
    -- Auto-confirm email for new users
    -- Note: confirmed_at is a generated column in Supabase, so we only set email_confirmed_at
    -- confirmed_at will be automatically set by Supabase based on email_confirmed_at
    NEW.email_confirmed_at = COALESCE(NEW.email_confirmed_at, NOW());
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if it exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Create trigger that fires before insert
CREATE TRIGGER on_auth_user_created
    BEFORE INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION auto_confirm_user();

-- Also handle updates (in case user is created without confirmation)
-- Note: confirmed_at is a generated column, so we only set email_confirmed_at
CREATE OR REPLACE FUNCTION auto_confirm_user_on_update()
RETURNS TRIGGER AS $$
BEGIN
    -- If email_confirmed_at is NULL, set it
    -- confirmed_at will be automatically set by Supabase as it's a generated column
    IF NEW.email_confirmed_at IS NULL THEN
        NEW.email_confirmed_at = NOW();
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop update trigger if it exists
DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;

-- Create trigger that fires before update (only check email_confirmed_at)
CREATE TRIGGER on_auth_user_updated
    BEFORE UPDATE ON auth.users
    FOR EACH ROW
    WHEN (NEW.email_confirmed_at IS NULL)
    EXECUTE FUNCTION auto_confirm_user_on_update();

-- Grant necessary permissions
GRANT USAGE ON SCHEMA auth TO postgres, anon, authenticated, service_role;

-- Verify trigger was created
SELECT 
    trigger_name, 
    event_manipulation, 
    event_object_table,
    action_statement
FROM information_schema.triggers
WHERE event_object_table = 'users' 
  AND trigger_schema = 'auth';
