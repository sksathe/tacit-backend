-- Admin script to assign a user to an organization and project
-- Run this in Supabase SQL Editor after a user signs up

-- Step 1: Create an organization (if it doesn't exist)
-- Replace 'Your Organization Name' with the actual org name
INSERT INTO orgs (name)
VALUES ('Your Organization Name')
ON CONFLICT DO NOTHING;

-- Step 2: Get the org_id (replace 'Your Organization Name' with actual name)
-- Or use the org_id directly if you know it
-- Let's assume org_id is stored in a variable or you'll replace it manually

-- Step 3: Create a project in that org
-- Replace 'Project Name' and org_id with actual values
INSERT INTO projects (org_id, name)
VALUES (
    (SELECT id FROM orgs WHERE name = 'Your Organization Name' LIMIT 1),
    'Project Name'
)
ON CONFLICT DO NOTHING;

-- Step 4: Add user to project as a member
-- Replace 'user@example.com' with the actual user's email
-- Replace 'Project Name' with the actual project name
-- Replace 'owner' with desired role: 'owner', 'admin', or 'member'
INSERT INTO project_members (project_id, user_id, role)
VALUES (
    (SELECT id FROM projects WHERE name = 'Project Name' LIMIT 1),
    (SELECT id FROM auth.users WHERE email = 'user@example.com' LIMIT 1),
    'owner'
)
ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role;

-- Example: Assign user to multiple projects
-- INSERT INTO project_members (project_id, user_id, role)
-- SELECT 
--     p.id,
--     (SELECT id FROM auth.users WHERE email = 'user@example.com' LIMIT 1),
--     'member'
-- FROM projects p
-- WHERE p.name IN ('Project 1', 'Project 2', 'Project 3');

-- To check which users exist:
-- SELECT id, email, created_at FROM auth.users ORDER BY created_at DESC;

-- To check which orgs exist:
-- SELECT id, name, created_at FROM orgs ORDER BY created_at DESC;

-- To check which projects exist:
-- SELECT id, org_id, name, created_at FROM projects ORDER BY created_at DESC;

-- To check project members:
-- SELECT pm.*, u.email as user_email, p.name as project_name
-- FROM project_members pm
-- JOIN auth.users u ON pm.user_id = u.id
-- JOIN projects p ON pm.project_id = p.id;
