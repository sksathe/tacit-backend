## tacit-backend: server-api

Express REST API for Tacit.

### Run locally

```bash
cd server-api
npm install
cp .env.example .env
npm run dev
```

### Key environment variables
- **Supabase**: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- **Default project (flat access)**: `DEFAULT_PROJECT_ID` — UUID of the `Default` project created by `16_flat_access.sql` (optional; backend resolves by name if unset)
- **CORS**: `FRONTEND_ORIGINS` (comma-separated), optional `CORS_ALLOW_NGROK`
- **Email**: `RESEND_API_KEY`, optional `EMAIL_FROM`
- **Telephony**: `TWILIO_NUMBER`

### Flat access mode (demo)

Flat access lets **any authenticated user read and write all tenant data**. Login is still required; anonymous users see nothing.

**Enable (run once in Supabase SQL Editor):**

1. Apply migrations `01`–`15` if not already applied.
2. Run [`supabase/sql/16_flat_access.sql`](supabase/sql/16_flat_access.sql).
3. Copy the `default_project_id` from the script output into backend `.env`:

```text
DEFAULT_PROJECT_ID=<uuid-from-migration-output>
```

4. Optionally set the same UUID in frontend `.env`:

```text
VITE_DEFAULT_PROJECT_ID=<uuid-from-migration-output>
```

**What changes:**

- RLS policies allow any authenticated user full CRUD on tenant tables.
- New signups are auto-added to the `Default` project (`Tacit Demo` org).
- `GET /api/sessions` and `GET /api/meetings` return all records (not scoped to one project).
- Meeting/MANU creates default `project_id` when omitted.

**Revert to tenant isolation:**

Run [`supabase/sql/17_restore_tenant_rls.sql`](supabase/sql/17_restore_tenant_rls.sql) in the Supabase SQL Editor.

### CORS / multi-domain deployments
Set `FRONTEND_ORIGINS` to include your deployed frontend domain(s), for example:

```text
FRONTEND_ORIGINS=https://app.example.com,https://preview--tacit-frontend.vercel.app
```
