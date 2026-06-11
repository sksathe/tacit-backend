# Supabase SQL Migrations

Run these migrations in order in your Supabase SQL Editor:

1. `01_extensions.sql` - Enable PostgreSQL extensions (pgcrypto, pg_trgm, unaccent)
2. `02_tables.sql` - Create all tables and indexes
3. `03_rls.sql` - Set up Row Level Security policies (tenant-scoped)
4. `04_functions.sql` - Create database functions (fuzzy name matching)
5. `12_automation_results.sql` - Persist automation outputs per session
6. `13_automation_results_rls.sql` - RLS policies for automation outputs
7. `14_manu_runs.sql` - MANU workflow runs table
8. `15_manu_runs_rls.sql` - RLS policies for MANU runs
9. `18_mission_launches.sql` - Dashboard workspace launch history (per user)
10. `19_mission_launches_rls.sql` - RLS policies for mission launches

### Flat access (demo — optional)

9. `16_flat_access.sql` - Open RLS for authenticated users, default org/project, signup auto-membership
10. `17_restore_tenant_rls.sql` - Rollback script to restore tenant-scoped RLS from step 3

After running `16_flat_access.sql`, set `DEFAULT_PROJECT_ID` in `tacit-backend/.env` and optionally `VITE_DEFAULT_PROJECT_ID` in `tacit-frontend/.env` using the UUID printed by the migration.

## Storage Bucket Setup

After running migrations, create a storage bucket:

1. Go to Supabase Dashboard > Storage
2. Create a new bucket named `tacit-artifacts`
3. Set it to **Private**
4. The MCP agent will upload transcripts and summaries to this bucket

## Notes

- All tables use UUID primary keys
- With `03_rls.sql` only: RLS ensures users access data from projects they belong to
- With `16_flat_access.sql` applied: any authenticated user can access all tenant data (demo mode)
- The `fuzzy_match_invitee` function uses pg_trgm for accurate name matching
- Idempotency keys prevent duplicate operations
