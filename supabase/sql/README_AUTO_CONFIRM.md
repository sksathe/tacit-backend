# Auto-Confirm Email on Signup

## Overview

This setup automatically confirms email addresses when users sign up, and sets a default password "dummy@123" for all new users.

## Setup

### Step 1: Run the Trigger Migration

Run `08_auto_confirm_email_trigger.sql` in Supabase SQL Editor:

```sql
-- This creates triggers that automatically confirm email on signup
```

This will:
- Create a trigger that fires BEFORE INSERT on `auth.users`
- Automatically set `email_confirmed_at` and `confirmed_at` to NOW()
- Also handle updates in case a user is created without confirmation

### Step 2: Disable Email Confirmation in Supabase Settings

1. Go to **Supabase Dashboard** → **Authentication** → **Settings**
2. Find **"Enable email confirmations"**
3. **Turn it OFF** (disable it)
4. Save

### Step 3: Frontend Already Updated

The frontend code has been updated to:
- Use default password "dummy@123" for all signups
- Auto-confirm email (handled by trigger)

## How It Works

### Database Trigger

The trigger `on_auth_user_created` automatically:
- Sets `email_confirmed_at = NOW()` when user is created
- Sets `confirmed_at = NOW()` when user is created
- Works for both INSERT and UPDATE operations

### Frontend Signup

When a user signs up:
1. Frontend calls `signUp(email, 'dummy@123')`
2. Supabase creates user in `auth.users`
3. Trigger fires and sets email_confirmed_at and confirmed_at
4. User is automatically logged in (no email verification needed)

### Frontend Login

When a user logs in:
1. Frontend tries user-provided password first
2. If that fails, tries default password "dummy@123"
3. User can log in with either password

## Default Password

**Default Password:** `dummy@123`

- Used for all new signups
- Can be used for login if user doesn't remember their password
- **Security Note:** This is for development/testing. Change in production!

## Testing

### Test Signup

1. Go to `/login` page
2. Click "Don't have an account? Sign up"
3. Enter email (password field is ignored)
4. Submit
5. User should be created and automatically logged in
6. Check Supabase → Authentication → Users
7. User should show as "Active" with email_confirmed_at set

### Test Login

1. Go to `/login` page
2. Enter email
3. Enter password: `dummy@123`
4. Submit
5. Should log in successfully

### Verify in Database

```sql
SELECT 
    email,
    email_confirmed_at,
    confirmed_at,
    created_at
FROM auth.users
ORDER BY created_at DESC;
```

All users should have:
- `email_confirmed_at` = timestamp (not NULL)
- `confirmed_at` = timestamp (not NULL)

## Security Considerations

⚠️ **Important for Production:**

1. **Change Default Password:**
   - Update `src/pages/Login.tsx` to use a secure default or require password input
   - Update `src/contexts/AuthContext.tsx` signUp function

2. **Remove Auto-Login Fallback:**
   - Remove the fallback to default password in login function
   - Users should only log in with their own passwords

3. **Enable Email Confirmation:**
   - For production, consider enabling email confirmation
   - Remove or modify the auto-confirm trigger

## Troubleshooting

### Users Still Not Confirmed

1. **Check trigger exists:**
```sql
SELECT trigger_name, event_manipulation, event_object_table
FROM information_schema.triggers
WHERE event_object_table = 'users' AND trigger_schema = 'auth';
```

2. **Manually confirm existing users:**
```sql
UPDATE auth.users 
SET email_confirmed_at = NOW(), confirmed_at = NOW()
WHERE email_confirmed_at IS NULL;
```

3. **Re-run trigger migration:**
   - Run `08_auto_confirm_email_trigger.sql` again

### Default Password Not Working

1. **Check frontend code:**
   - Verify `src/pages/Login.tsx` uses 'dummy@123'
   - Verify `src/contexts/AuthContext.tsx` signUp uses 'dummy@123'

2. **Check browser console:**
   - Look for errors during signup/login
   - Verify API calls are successful

## Disabling Auto-Confirm

To disable auto-confirm:

```sql
-- Drop the triggers
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;

-- Drop the functions
DROP FUNCTION IF EXISTS auto_confirm_user();
DROP FUNCTION IF EXISTS auto_confirm_user_on_update();
```

Then enable email confirmation in Supabase Dashboard → Authentication → Settings.
