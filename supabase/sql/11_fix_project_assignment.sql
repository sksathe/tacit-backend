-- Fix script: Ensure user is assigned to project
-- Run this AFTER creating org and project
-- Replace 'your-email@example.com' with YOUR email

-- Step 1: Verify your user exists
SELECT id, email FROM auth.users WHERE email = 'your-email@example.com';

-- Step 2: Verify project exists
SELECT id, name FROM projects WHERE name = 'Dummy Project';

-- Step 3: Check current project_members (should show your assignment)
SELECT 
    pm.*,
    u.email as user_email,
    p.name as project_name
FROM project_members pm
LEFT JOIN auth.users u ON pm.user_id = u.id
LEFT JOIN projects p ON pm.project_id = p.id;

-- Step 4: INSERT or UPDATE your project membership
-- This will create the record if it doesn't exist, or update it if it does
INSERT INTO project_members (project_id, user_id, role)
SELECT 
    p.id as project_id,
    u.id as user_id,
    'owner' as role
FROM projects p
CROSS JOIN auth.users u
WHERE p.name = 'Dummy Project'
  AND u.email = 'your-email@example.com'
ON CONFLICT (project_id, user_id) 
DO UPDATE SET role = 'owner'
RETURNING project_id, user_id, role;

-- Step 5: Verify the assignment worked
SELECT 
    u.email,
    o.name as org_name,
    p.name as project_name,
    pm.role,
    pm.created_at
FROM auth.users u
JOIN project_members pm ON u.id = pm.user_id
JOIN projects p ON pm.project_id = p.id
JOIN orgs o ON p.org_id = o.id
WHERE u.email = 'your-email@example.com';
