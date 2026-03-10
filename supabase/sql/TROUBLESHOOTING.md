# Troubleshooting: auth.users is Empty After Signup

## Where to Check Users

**Important:** `auth.users` is NOT visible in the Table Editor. You must use SQL Editor or Authentication section.

### Option 1: Check in Authentication Section (Easiest)

1. Go to Supabase Dashboard
2. Click **Authentication** in the left sidebar
3. Click **Users** tab
4. You should see all users here

### Option 2: Check via SQL Editor

1. Go to Supabase Dashboard → **SQL Editor**
2. Run this query:

```sql
SELECT id, email, created_at, email_confirmed_at, confirmed_at 
FROM auth.users 
ORDER BY created_at DESC;
```

## Common Issues

### Issue 1: Email Confirmation Still Enabled

**Symptom:** User appears in Authentication → Users but `email_confirmed_at` is NULL

**Solution:**
1. Go to Supabase Dashboard → **Authentication** → **Settings**
2. Find **"Enable email confirmations"**
3. **Turn it OFF** (disable it)
4. Save changes
5. Sign up again (or manually confirm the user)

### Issue 2: User Created But Not Confirmed

If email confirmation was enabled when you signed up:

**Option A: Manually confirm the user**
```sql
-- Confirm a specific user by email
UPDATE auth.users 
SET email_confirmed_at = NOW(), confirmed_at = NOW()
WHERE email = 'your-email@example.com';
```

**Option B: Confirm all unconfirmed users**
```sql
-- Confirm all users (use with caution)
UPDATE auth.users 
SET email_confirmed_at = NOW(), confirmed_at = NOW()
WHERE email_confirmed_at IS NULL;
```

### Issue 3: Signup Error Not Shown

Check browser console for errors:
1. Open browser DevTools (F12)
2. Go to Console tab
3. Try signing up again
4. Look for any red error messages

### Issue 4: Wrong Supabase Project

Make sure you're checking the correct Supabase project:
- Check your `.env` file: `VITE_SUPABASE_URL` should match your project URL
- Verify the project ID matches

## Verify Signup Worked

After signing up, check these:

### 1. Check Authentication → Users
- Should see your email
- Status should be "Active" (if email confirmation disabled)

### 2. Check via SQL
```sql
-- See all users
SELECT 
    id, 
    email, 
    created_at,
    email_confirmed_at,
    confirmed_at,
    last_sign_in_at
FROM auth.users 
ORDER BY created_at DESC;
```

### 3. Check Browser Console
- Open DevTools → Console
- Should see no errors during signup
- Check Network tab for failed requests

## Test Signup Flow

1. **Clear browser data:**
   - Clear localStorage
   - Clear cookies for localhost
   - Or use incognito/private window

2. **Sign up again:**
   - Go to `/login`
   - Click "Don't have an account? Sign up"
   - Enter email and password
   - Submit

3. **Check immediately:**
   - Go to Supabase → Authentication → Users
   - Should see your email appear

4. **If still empty:**
   - Check browser console for errors
   - Check Network tab for failed API calls
   - Verify Supabase URL in `.env` is correct

## Quick Fix: Disable Email Confirmation

If email confirmation is causing issues:

1. **In Supabase Dashboard:**
   - Authentication → Settings
   - Disable "Enable email confirmations"
   - Save

2. **Confirm existing users (if any):**
```sql
-- Confirm all unconfirmed users
UPDATE auth.users 
SET 
    email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
    confirmed_at = COALESCE(confirmed_at, NOW())
WHERE email_confirmed_at IS NULL OR confirmed_at IS NULL;
```

   Or use the provided script: `07_confirm_all_users.sql`

3. **Sign up again** - user should be created immediately

**See `FIX_EMAIL_CONFIRMATION.md` for detailed instructions.**

## Still Not Working?

Check these:

1. **Environment variables:**
   - `VITE_SUPABASE_URL` in `.env` matches your project
   - `VITE_SUPABASE_PUBLISHABLE_KEY` is correct
   - No typos or extra spaces

2. **Supabase project status:**
   - Project is active (not paused)
   - No billing issues

3. **Network issues:**
   - Check browser Network tab
   - Look for failed requests to Supabase
   - Check CORS errors

4. **Try direct Supabase signup:**
   - Go to Supabase Dashboard → Authentication → Users
   - Click "Add user" → "Create new user"
   - This confirms Supabase Auth is working
