-- Quick script to create a dummy organization and project
-- Run this in Supabase SQL Editor
-- This script uses auth.uid() to automatically use the current authenticated user

-- IMPORTANT: Make sure you're authenticated when running this!
-- In Supabase SQL Editor, you need to run this as a service role or authenticated user

-- Step 1: Create a dummy organization
INSERT INTO orgs (name)
VALUES ('Dummy Organization')
ON CONFLICT DO NOTHING
RETURNING id, name;

-- Step 2: Create a dummy project in that org
INSERT INTO projects (org_id, name)
VALUES (
    (SELECT id FROM orgs WHERE name = 'Dummy Organization' LIMIT 1),
    'Dummy Project'
)
ON CONFLICT DO NOTHING
RETURNING id, name, org_id;

-- Step 3: Assign current user as owner of the project
-- Note: This requires running as authenticated user or using service role
INSERT INTO project_members (project_id, user_id, role)
SELECT 
    (SELECT id FROM projects WHERE name = 'Dummy Project' LIMIT 1),
    auth.uid(),
    'owner'
WHERE auth.uid() IS NOT NULL
ON CONFLICT (project_id, user_id) 
DO UPDATE SET role = 'owner'
RETURNING project_id, user_id, role;

-- Step 4: Verify everything was created correctly
SELECT 
    u.email as user_email,
    o.name as org_name,
    o.id as org_id,
    p.name as project_name,
    p.id as project_id,
    pm.role
FROM auth.users u
JOIN project_members pm ON u.id = pm.user_id
JOIN projects p ON pm.project_id = p.id
JOIN orgs o ON p.org_id = o.id
WHERE u.id = auth.uid();

-- ============================================
-- ALTERNATIVE: Manual version (if auth.uid() doesn't work)
-- ============================================
-- Replace 'your-email@example.com' with YOUR email address

/*
-- Step 1: Create org
INSERT INTO orgs (name)
VALUES ('Dummy Organization')
ON CONFLICT DO NOTHING;

-- Step 2: Create project
INSERT INTO projects (org_id, name)
VALUES (
    (SELECT id FROM orgs WHERE name = 'Dummy Organization' LIMIT 1),
    'Dummy Project'
)
ON CONFLICT DO NOTHING;

-- Step 3: Assign user (replace email)
INSERT INTO project_members (project_id, user_id, role)
VALUES (
    (SELECT id FROM projects WHERE name = 'Dummy Project' LIMIT 1),
    (SELECT id FROM auth.users WHERE email = 'your-email@example.com' LIMIT 1),
    'owner'
)
ON CONFLICT (project_id, user_id) DO UPDATE SET role = 'owner';

-- Step 4: Verify
SELECT 
    u.email,
    o.name as org_name,
    p.name as project_name,
    pm.role
FROM auth.users u
JOIN project_members pm ON u.id = pm.user_id
JOIN projects p ON pm.project_id = p.id
JOIN orgs o ON p.org_id = o.id
WHERE u.email = 'your-email@example.com';
*/
