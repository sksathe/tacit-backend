# Supabase SQL Migrations

Run these migrations in order in your Supabase SQL Editor:

1. `01_extensions.sql` - Enable PostgreSQL extensions (pgcrypto, pg_trgm, unaccent)
2. `02_tables.sql` - Create all tables and indexes
3. `03_rls.sql` - Set up Row Level Security policies
4. `04_functions.sql` - Create database functions (fuzzy name matching)
5. `12_automation_results.sql` - Persist automation outputs per session
6. `13_automation_results_rls.sql` - RLS policies for automation outputs

## Storage Bucket Setup

After running migrations, create a storage bucket:

1. Go to Supabase Dashboard > Storage
2. Create a new bucket named `tacit-artifacts`
3. Set it to **Private**
4. The MCP agent will upload transcripts and summaries to this bucket

## Notes

- All tables use UUID primary keys
- RLS policies ensure users can only access data from projects they belong to
- The `fuzzy_match_invitee` function uses pg_trgm for accurate name matching
- Idempotency keys prevent duplicate operations
