# Organization & Project Creation Flow

## Development/Testing (Current Setup)

### Manual Creation via SQL
1. User signs up via frontend
2. Admin runs SQL script to create org/project and assign user
3. User can now access projects

**Script:** `09_create_dummy_org_project.sql`

---

## Production Flow Options

### Option 1: Admin-Managed (Recommended for Enterprise)

**Flow:**
1. User signs up → Account created but no access
2. Admin receives notification or reviews new users
3. Admin creates org/project via:
   - **Admin Dashboard UI** (to be built)
   - **SQL Scripts** (for initial setup)
   - **Admin API** (for automation)
4. Admin assigns user to project with appropriate role
5. User receives email notification with access

**Benefits:**
- Full control over org/project structure
- Prevents unauthorized org creation
- Better for compliance/security
- Clear audit trail

**Implementation:**
- Build admin dashboard with org/project management
- Add admin role checking middleware
- Create admin API endpoints

---

### Option 2: Self-Service (Recommended for SaaS)

**Flow:**
1. User signs up → Account created
2. User creates their first organization (auto-assigned as owner)
3. User creates projects within their org
4. User invites team members to projects

**Benefits:**
- Faster onboarding
- No admin bottleneck
- Better UX for small teams
- Scales automatically

**Implementation:**
- Add "Create Organization" API endpoint
- Auto-create org on first project creation
- Add org creation UI in frontend

---

### Option 3: Hybrid (Best of Both Worlds)

**Flow:**
1. User signs up → Account created
2. **First user** can create org (becomes org owner)
3. Subsequent users must be invited by org owner/admin
4. Org owners/admins can create projects
5. Project owners/admins can invite members

**Benefits:**
- Flexible for different use cases
- Prevents org spam
- Allows team collaboration
- Scales well

**Implementation:**
- Add org creation endpoint (check if user already has org)
- Add invitation system
- Add role-based permissions

---

## Recommended Production Implementation

### Phase 1: Basic Self-Service (MVP)
```typescript
// New endpoint: POST /api/orgs
// Creates org and first project, assigns user as owner
POST /api/orgs
{
  "name": "My Company",
  "first_project_name": "Default Project"
}

// Response:
{
  "org": { id, name },
  "project": { id, name, org_id },
  "membership": { role: "owner" }
}
```

### Phase 2: Team Invitations
```typescript
// Invite user to project
POST /api/projects/:id/invite
{
  "email": "teammate@example.com",
  "role": "member"
}

// User accepts invitation
POST /api/invitations/:token/accept
```

### Phase 3: Admin Dashboard
- Admin UI for org/project management
- User management
- Bulk operations
- Analytics

---

## Current API Endpoints

### Create Project (requires existing org_id)
```bash
POST /api/projects
Authorization: Bearer <token>
Content-Type: application/json

{
  "org_id": "uuid-of-existing-org",
  "name": "My Project"
}
```

**Limitation:** User must already belong to an org (via project membership)

---

## Quick Start for Testing

1. **Sign up** via frontend (`/login`)
2. **Run SQL script** (`09_create_dummy_org_project.sql`) in Supabase SQL Editor
   - Replace `'your-email@example.com'` with your actual email
3. **Refresh frontend** - you should now see the project
4. **Schedule a session** - it will use this project

---

## Production Checklist

- [ ] Decide on org/project creation flow (Option 1, 2, or 3)
- [ ] Implement org creation endpoint (if self-service)
- [ ] Build admin dashboard (if admin-managed)
- [ ] Add invitation system
- [ ] Add email notifications for invitations
- [ ] Add role-based access control UI
- [ ] Add org/project settings pages
- [ ] Add billing integration (if multi-tenant)
- [ ] Add usage limits per org/project
- [ ] Add audit logging
