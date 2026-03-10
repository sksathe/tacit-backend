-- Setup script for the first admin user
-- Run this AFTER you sign up as the first user
-- Replace 'your-email@example.com' with YOUR actual email

-- Step 1: Create your organization
INSERT INTO orgs (name)
VALUES ('My Organization')
ON CONFLICT DO NOTHING;

-- Step 2: Create your first project
INSERT INTO projects (org_id, name)
VALUES (
    (SELECT id FROM orgs WHERE name = 'My Organization' LIMIT 1),
    'My First Project'
)
ON CONFLICT DO NOTHING;

-- Step 3: Assign yourself as owner
-- IMPORTANT: Replace 'your-email@example.com' with YOUR email
INSERT INTO project_members (project_id, user_id, role)
VALUES (
    (SELECT id FROM projects WHERE name = 'My First Project' LIMIT 1),
    (SELECT id FROM auth.users WHERE email = 'your-email@example.com' LIMIT 1),
    'owner'
)
ON CONFLICT (project_id, user_id) DO UPDATE SET role = 'owner';

-- Verify it worked:
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
