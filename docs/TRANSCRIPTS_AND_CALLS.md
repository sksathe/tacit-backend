# Transcripts and call sessions: storage and UI

## Why don’t I see any transcripts in the database?

**Transcripts are written when the voice agent calls `finalize_call_session` with `raw_transcript`.** When the agent ends the call, it should call `finalize_call_session(call_session_id, status, raw_transcript)`; the server then saves the transcript to the DB and storage automatically.

- If you’ve had calls but the **agent never passed `raw_transcript` when calling `finalize_call_session`**, the table can stay empty. The agent is instructed to always pass the conversation transcript when finalizing.
- **Check MCP server logs:** look for `Executing tool: finalize_call_session` and `Tool executed successfully: finalize_call_session`. If the agent calls finalize without `raw_transcript`, the transcript won’t be saved (finalize still succeeds).
- **Same Supabase project:** The MCP agent uses `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `mcp-agent/.env`. The `transcripts` table must be in that same project.
- **Quick check:** In Supabase, look at `call_sessions`. If you have rows with `status = 'completed'` but `transcript_path` is null, the agent didn’t pass `raw_transcript` when calling `finalize_call_session` for those sessions.

To get transcripts written:

1. Ensure the agent calls **finalize_call_session** with **raw_transcript** (the conversation transcript) when the call ends. Our tool description and instructions tell it to do this.
2. Run a call that completes verification and has some conversation, then end the call normally so the agent calls finalize with the transcript.
3. Watch MCP logs for `finalize_call_session` and any “Failed to persist transcript on finalize” errors; fix any insert/storage issues (e.g. missing `tacit-artifacts` bucket or schema mismatch).

## How transcripts are stored

1. **When the call ends**  
   The voice agent calls **`finalize_call_session`** with:
   - `call_session_id` (from `verify_user_and_start_session`)
   - `status` (`'completed'` or `'failed'`)
   - **`raw_transcript`** (e.g. `{ messages: [...] }`) — when provided, the transcript is saved automatically.

2. **MCP agent (`mcp-agent`)**  
   On `finalize_call_session` with `raw_transcript`:
   - Updates the **call session** (`ended_at`, `status`, `duration_sec`).
   - Then runs the same persist logic as `persist_transcript`: loads the call session for `org_id`, `project_id`, `meeting_id`; uploads the transcript JSON to **Supabase Storage** (bucket `tacit-artifacts`, path `org/.../sessions/{call_session_id}/transcript.json`); inserts or updates a row in **`transcripts`**; sets **`call_sessions.transcript_path`**.

   Optionally, the agent can also call **`persist_transcript`** during the call to save a mid-call snapshot; the main save is when finalize is called with the transcript.

So transcripts exist in:
- **Database:** `transcripts` (linked to `call_sessions`), and `call_sessions.transcript_path`.
- **Storage:** Supabase bucket `tacit-artifacts` at the path above.

## Call session details

- **`call_sessions`** stores: `meeting_id`, `verified_invitee_id`, `verification_status`, `started_at`, `ended_at`, `status`, `transcript_path`, etc.
- **Sessions API** (`server-api`):
  - `GET /api/sessions/project/:projectId` — list call sessions for a project (with `meeting`, `transcript`, `summary`).
  - `GET /api/sessions/:id` — one call session with meeting, transcript, summary, verified invitee.
  - `GET /api/sessions/:id/transcript` — transcript for that session.
  - `GET /api/sessions/:id/summary` — summary for that session.

## Are they available in the UI?

- **Yes.** The dashboard “Automate Knowledge Assets” flow shows agents (e.g. Rachel, Ross); when you pick an agent you see that agent’s **sessions** in the main content. Clicking a session opens the **session detail** view (session info, playback placeholder, generated assets, automation options).
- Session list is backed by **real data** when the app is configured with `VITE_API_URL` and the user is authenticated: the UI fetches `GET /api/sessions/project/:projectId` and displays call sessions (with meeting title, date, etc.). If no project or API is available, the UI can show placeholder/mock sessions.
- **Transcript content** can be shown in the session detail view by calling `GET /api/sessions/:id/transcript` and rendering the returned transcript (e.g. messages list). The current session detail view focuses on playback and automations; transcript display can be added there if desired.
