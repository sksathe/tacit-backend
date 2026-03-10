-- Confirm all users (set email_confirmed_at and confirmed_at)
-- Run this to manually confirm all existing users
-- Useful when email confirmation is disabled but users were created before disabling

-- Confirm a specific user by email
-- UPDATE auth.users 
-- SET email_confirmed_at = NOW(), confirmed_at = NOW()
-- WHERE email = 'your-email@example.com';

-- Confirm ALL unconfirmed users (use with caution)
UPDATE auth.users 
SET 
    email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
    confirmed_at = COALESCE(confirmed_at, NOW())
WHERE email_confirmed_at IS NULL OR confirmed_at IS NULL;

-- Verify users are confirmed
SELECT 
    id,
    email,
    email_confirmed_at,
    confirmed_at,
    created_at
FROM auth.users
ORDER BY created_at DESC;
