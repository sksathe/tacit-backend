#!/usr/bin/env node
/**
 * Run MANU (and other) SQL migrations against remote Supabase Postgres.
 *
 * Auth options (first match wins):
 * 1. DATABASE_URL — full Postgres connection string
 * 2. SUPABASE_DB_PASSWORD — builds URL from SUPABASE_URL project ref
 * 3. SUPABASE_ACCESS_TOKEN — Supabase Management API (from `supabase login`)
 *
 * Usage:
 *   npm run db:migrate:manu
 *   node scripts/run-sql-migrations.mjs supabase/sql/14_manu_runs.sql supabase/sql/15_manu_runs_rls.sql
 */
import { config } from 'dotenv';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

for (const p of [resolve(root, '.env'), resolve(process.cwd(), '.env')]) {
  if (existsSync(p)) config({ path: p });
}

function projectRefFromUrl(url) {
  try {
    const host = new URL(url).hostname;
    return host.split('.')[0];
  } catch {
    return null;
  }
}

function buildDatabaseUrl() {
  if (process.env.DATABASE_URL?.trim()) {
    return process.env.DATABASE_URL.trim();
  }

  const password = process.env.SUPABASE_DB_PASSWORD?.trim();
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  if (!password || !supabaseUrl) return null;

  const ref = projectRefFromUrl(supabaseUrl);
  if (!ref) return null;

  const encoded = encodeURIComponent(password);
  // Direct connection (works for migrations; IPv6 on some networks)
  return `postgresql://postgres:${encoded}@db.${ref}.supabase.co:5432/postgres`;
}

async function runViaPostgres(files) {
  const connectionString = buildDatabaseUrl();
  if (!connectionString) {
    throw new Error(
      'Missing DATABASE_URL or SUPABASE_DB_PASSWORD. API keys (anon/service role) cannot run DDL — add the database password to .env.',
    );
  }

  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('Connected to Postgres');

  try {
    for (const file of files) {
      const abs = resolve(root, file);
      const sql = readFileSync(abs, 'utf8');
      console.log(`\n▶ Running ${file}…`);
      await client.query(sql);
      console.log(`✅ ${file}`);
    }
  } finally {
    await client.end();
  }
}

async function runViaManagementApi(files) {
  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  const ref = projectRefFromUrl(process.env.SUPABASE_URL?.trim() || '');
  if (!token || !ref) {
    throw new Error(
      'Missing SUPABASE_ACCESS_TOKEN. Run `supabase login` or create a token at https://supabase.com/dashboard/account/tokens',
    );
  }

  for (const file of files) {
    const abs = resolve(root, file);
    const query = readFileSync(abs, 'utf8');
    console.log(`\n▶ Running ${file} via Management API…`);

    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });

    const body = await res.text();
    if (!res.ok) {
      throw new Error(`Management API ${res.status}: ${body}`);
    }

    console.log(`✅ ${file}`);
    if (body && body !== '[]') console.log(body.slice(0, 500));
  }
}

async function main() {
  const defaultFiles = ['supabase/sql/14_manu_runs.sql', 'supabase/sql/15_manu_runs_rls.sql'];
  const files = process.argv.slice(2).length ? process.argv.slice(2) : defaultFiles;

  console.log('MANU migration runner');
  console.log('Project:', projectRefFromUrl(process.env.SUPABASE_URL || '') || '(unknown)');

  if (buildDatabaseUrl()) {
    await runViaPostgres(files);
    return;
  }

  if (process.env.SUPABASE_ACCESS_TOKEN?.trim()) {
    await runViaManagementApi(files);
    return;
  }

  console.error(`
Cannot run migrations with anon/service-role keys alone.

Add ONE of these to tacit-backend/.env:

  # Option A — database password (Project Settings → Database → Database password)
  SUPABASE_DB_PASSWORD=your_postgres_password

  # Option B — full connection string (Connect → URI)
  DATABASE_URL=postgresql://postgres.[ref]:[password]@...

  # Option C — Supabase CLI personal access token
  SUPABASE_ACCESS_TOKEN=sbp_...

Then run: npm run db:migrate:manu
`);
  process.exit(1);
}

main().catch((err) => {
  console.error('\n❌ Migration failed:', err.message);
  process.exit(1);
});
