-- Debug script to check why projects aren't showing up
-- Run this in Supabase SQL Editor
-- Replace 'your-email@example.com' with YOUR email

-- Step 1: Check if user exists
SELECT id, email, created_at 
FROM auth.users 
WHERE email = 'your-email@example.com';

-- Step 2: Check all orgs
SELECT id, name, created_at 
FROM orgs 
ORDER BY created_at DESC;

-- Step 3: Check all projects
SELECT id, org_id, name, created_at 
FROM projects 
ORDER BY created_at DESC;

-- Step 4: Check project_members (this is the critical one!)
SELECT 
    pm.project_id,
    pm.user_id,
    pm.role,
    u.email as user_email,
    p.name as project_name
FROM project_members pm
LEFT JOIN auth.users u ON pm.user_id = u.id
LEFT JOIN projects p ON pm.project_id = p.id
ORDER BY pm.created_at DESC;

-- Step 5: Check if YOUR user is in project_members
SELECT 
    pm.*,
    u.email,
    p.name as project_name,
    o.name as org_name
FROM project_members pm
JOIN auth.users u ON pm.user_id = u.id
JOIN projects p ON pm.project_id = p.id
JOIN orgs o ON p.org_id = o.id
WHERE u.email = 'your-email@example.com';

-- Step 6: Test RLS - what projects would be visible to your user?
-- Replace 'your-user-id-here' with your actual user ID from Step 1
SELECT 
    p.id,
    p.name,
    p.org_id,
    EXISTS (
        SELECT 1 
        FROM project_members pm
        WHERE pm.project_id = p.id 
        AND pm.user_id = 'your-user-id-here'::uuid
    ) as is_member
FROM projects p;

-- Step 7: If project_members is empty, fix it:
-- Replace 'your-email@example.com' and 'Dummy Project' with actual values
INSERT INTO project_members (project_id, user_id, role)
VALUES (
    (SELECT id FROM projects WHERE name = 'Dummy Project' LIMIT 1),
    (SELECT id FROM auth.users WHERE email = 'your-email@example.com' LIMIT 1),
    'owner'
)
ON CONFLICT (project_id, user_id) DO UPDATE SET role = 'owner';
