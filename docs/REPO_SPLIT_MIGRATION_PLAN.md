## Goal
Split the current Tacit codebase into **two separately deployable repos** while preserving existing behavior:

- **`tacit-frontend`**: landing + app UI (client-only)
- **`tacit-backend`**: REST API + MCP service (business logic, integrations, auth validation, transcript/finalize flows, invites/email, secrets)

This repo already contains three Node apps:

- Frontend (Vite) at repo root (`src/`, `vite.config.ts`)
- Backend REST API at `server-api/`
- MCP server at `mcp-agent/`

The migration below turns that into a clean 2-repo split, with stable cross-service connectivity.

---

## Current coupling / risks (high signal)
- **Frontend ↔ API base URL**: previously repeated `VITE_API_URL` + hardcoded `localhost` assumptions. Now centralized in `src/lib/apiClient.ts` with env-driven base URL and proxy-friendly default.
- **CORS + multi-domain deployments**: backend must allow multiple frontend origins; cookies are not relied on (JWT is passed via `Authorization` header), but browsers still enforce origin rules.
- **Deep links in emails**: backend uses `FRONTEND_ORIGIN(S)` to decide which domains are allowed; if you later add “open in app” links in emails, they must be built from a single canonical frontend public URL (keep this backend-only).
- **Shared “types”**: frontend doesn’t have a reliable generated Supabase schema (its `Database` type currently has no tables). Avoid overengineering a shared SDK; share only tiny constants/schemas as needed.
- **Two frontends**: `tacit_frontend/` is a standalone Next.js skeleton and appears unrelated to the Vite app. Treat as legacy/archived unless proven otherwise.
- **Secrets in examples**: `.env.example` files previously contained real keys. They are now placeholders; keep secrets backend-only.

---

## Proposed repo split (directory mapping)

### Repo A: `tacit-frontend`
Include:
- `src/`
- `public/`
- `index.html`
- `vite.config.ts`
- `tailwind.config.ts`, `postcss.config.js`
- `eslint.config.js`, `tsconfig*.json`
- `components.json`
- `package.json`, `package-lock.json`
- `vercel.json` (if using Vercel)
- `.env.example` (frontend-only)
- `README.md` (frontend-specific)

Exclude:
- `server-api/`
- `mcp-agent/`
- `supabase/` (optional; can live in backend repo)
- backend-only docs (`ELEVENLABS_MCP_SETUP.md`, etc.)

### Repo B: `tacit-backend`
Include:
- `server-api/`
- `mcp-agent/`
- `supabase/sql/` (migrations)
- `MCP_ARCHITECTURE.md`, `ELEVENLABS_MCP_SETUP.md`, backend docs
- `README.md` (backend-specific)
- `.env.example` files inside each service:
  - `server-api/.env.example`
  - `mcp-agent/.env.example`

---

## Shared types/constants strategy (minimal, non-overengineered)
- Prefer **API as the contract**:
  - Backend: validate with **Zod** and return stable JSON shapes
  - Frontend: define narrow **response types** in the API client layer (or infer from Zod if you later generate an SDK)
- If you need to share a few constants (e.g., automation type names), create a tiny `shared/` folder **copied** into both repos (or published as a small internal npm package only if it truly stays stable).

---

## Environment variables (exact list)

### Frontend (Vite) — `.env`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_API_BASE_URL` (blank for local proxy; set to backend origin in preview/prod)
- `VITE_DEV_API_PROXY_TARGET` (local dev helper; defaults to `http://localhost:3001`)
- `VITE_SUPABASE_ARTIFACTS_BUCKET` (optional; default `tacit-artifacts`)
- `VITE_POWER_AUTOMATE_WEBHOOK_URL` (optional)

### Backend REST API — `server-api/.env`
- `PORT` (default `3001`)
- `NODE_ENV` (`development`/`production`)
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (used to verify JWT via `supabaseAnon.auth.getUser(token)`)
- `SUPABASE_SERVICE_ROLE_KEY` (used for privileged operations; keep secret)
- `RESEND_API_KEY` (invite email sending)
- `EMAIL_FROM` (optional)
- `TWILIO_NUMBER`
- `FRONTEND_ORIGINS` (comma-separated, for CORS)
- `CORS_ALLOW_NGROK` (optional; default true)

### Backend MCP server — `mcp-agent/.env`
- `PORT` (default `3002`)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `LLM_PROVIDER` (`openai` or `anthropic`, etc.)
- `LLM_MODEL`
- `OPENAI_API_KEY` (if `LLM_PROVIDER=openai`)
- `ANTHROPIC_API_KEY` (if `LLM_PROVIDER=anthropic`)

---

## Step-by-step migration plan (safe + reversible)

### Phase 0 — Lock in connectivity (already started)
- Centralize frontend API calls in `src/lib/apiClient.ts`
- Remove hardcoded URLs from frontend code (and move webhook URL to env)
- Make Vite dev proxy target env-driven (`VITE_DEV_API_PROXY_TARGET`)
- Make backend CORS origin list env-driven (`FRONTEND_ORIGINS`)

### Phase 1 — Stabilize public URLs
- Decide final domains:
  - Frontend: `https://app.example.com`
  - API: `https://api.example.com`
  - MCP: `https://mcp.example.com` (or `https://api.example.com/mcp` if you later unify behind a gateway)
- Set `VITE_API_BASE_URL=https://api.example.com` in frontend deployments
- Set `FRONTEND_ORIGINS=https://app.example.com,https://preview...` in API deployments

### Phase 2 — Repo extraction
- Create new git repos (empty) for `tacit-frontend` and `tacit-backend`
- Copy/move files per “Proposed repo split” mapping above
- Ensure each repo has its own README + `.env.example`

### Phase 3 — Deploy independently
- Deploy backend API + MCP separately (Railway/Render/Fly/etc.)
- Deploy frontend (Vercel/Netlify/etc.)
- Validate:
  - Auth works (Supabase login, JWT passed to backend)
  - Meeting create sends invites
  - Invitee join verification and call-session lifecycle works
  - Transcript persistence, finalize flows, and automation endpoints work

---

## Local dev setup (after split)
- Start backend:
  - `cd server-api && npm i && npm run dev`
  - `cd mcp-agent && npm i && npm run dev`
- Start frontend:
  - `npm i && npm run dev`
  - Leave `VITE_API_BASE_URL` blank to use `/api` proxy to `VITE_DEV_API_PROXY_TARGET`
