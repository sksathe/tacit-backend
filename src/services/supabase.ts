// Load dotenv FIRST before any other imports that might use process.env
import 'dotenv/config';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'node:fs';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Get the directory of the current file (server-api/src/services)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Try multiple possible .env file locations (explicit paths override dotenv/config)
const possiblePaths = [
  resolve(__dirname, '..', '..', '.env'), // server-api/.env
  resolve(process.cwd(), '.env'), // Current working directory
  resolve(process.cwd(), 'server-api', '.env'), // If running from root
];

let envLoaded = false;
let loadedPath = '';

// Try explicit paths first (these override dotenv/config)
for (const envPath of possiblePaths) {
  if (existsSync(envPath)) {
    const result = config({ path: envPath, override: false }); // Don't override if already loaded
    if (!result.error) {
      envLoaded = true;
      loadedPath = envPath;
      console.log('✅ Loaded .env from:', envPath);
      break;
    }
  }
}

if (!envLoaded) {
  // dotenv/config already tried, but log what we attempted
  console.warn('⚠️ Using dotenv/config default behavior (searches from cwd)');
  console.warn('Current working directory:', process.cwd());
  console.warn('Tried explicit paths:', possiblePaths);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing Supabase environment variables');
  console.error('Current working directory:', process.cwd());
  console.error('SUPABASE_URL:', SUPABASE_URL ? '✓' : '✗ Missing');
  console.error('SUPABASE_ANON_KEY:', SUPABASE_ANON_KEY ? '✓' : '✗ Missing');
  console.error('SUPABASE_SERVICE_ROLE_KEY:', SUPABASE_SERVICE_ROLE_KEY ? '✓' : '✗ Missing');
  console.error('All env vars:', Object.keys(process.env).filter(k => k.includes('SUPABASE')));
  console.error('\n💡 Make sure .env file exists in server-api/ directory with all required variables.');
  throw new Error('Missing Supabase environment variables');
}

// Anon client for user endpoints (validates JWT)
export const supabaseAnon = createClient(SUPABASE_URL as string, SUPABASE_ANON_KEY as string);

// Service role client for MCP server (bypasses RLS)
export const supabaseService = createClient(SUPABASE_URL as string, SUPABASE_SERVICE_ROLE_KEY as string, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
  },
});

// Helper to create authenticated client from JWT
export function createAuthenticatedClient(jwt: string): SupabaseClient {
  // Create client with JWT in headers - Supabase will use this for RLS
  return createClient(SUPABASE_URL as string, SUPABASE_ANON_KEY as string, {
    global: {
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
