import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'node:fs';
import express from 'express';

// Get the directory of the current file (server-api/src)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Try multiple possible .env file locations
const possiblePaths = [
  resolve(__dirname, '..', '.env'), // server-api/.env
  resolve(process.cwd(), '.env'), // Current working directory
  resolve(process.cwd(), 'server-api', '.env'), // If running from root
];

let envLoaded = false;
for (const envPath of possiblePaths) {
  if (existsSync(envPath)) {
    const result = config({ path: envPath });
    if (!result.error) {
      envLoaded = true;
      console.log('✅ Loaded .env from:', envPath);
      break;
    }
  }
}

if (!envLoaded) {
  console.error('⚠️ Could not find .env file. Tried:', possiblePaths);
}

import cors from 'cors';
import projectsRouter from './routes/projects.js';
import meetingsRouter from './routes/meetings.js';
import sessionsRouter from './routes/sessions.js';

const app = express();
const PORT = process.env.PORT || 3001;
/**
 * Comma-separated list of allowed frontend origins.
 * Examples:
 * - http://localhost:8080,http://localhost:5173
 * - https://app.tacit.com,https://preview--tacit-frontend.vercel.app
 */
const FRONTEND_ORIGINS = process.env.FRONTEND_ORIGINS || process.env.FRONTEND_ORIGIN || '';
const NODE_ENV = process.env.NODE_ENV || 'development';
const CORS_ALLOW_NGROK = String(process.env.CORS_ALLOW_NGROK || 'true').toLowerCase() !== 'false';

// Middleware - Allow multiple origins in development + ngrok tunnels
const frontendOriginsFromEnv = FRONTEND_ORIGINS
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const devDefaultOrigins =
  NODE_ENV === 'production'
    ? []
    : ['http://localhost:8080', 'http://localhost:5173', 'http://localhost:3000'];

const allowedOrigins = [...frontendOriginsFromEnv, ...devDefaultOrigins].filter(Boolean);
const uniqueAllowedOrigins = Array.from(new Set(allowedOrigins));

const ngrokPatterns = ['.ngrok-free.dev', '.ngrok-free.app', '.ngrok.io'];

// TEMP FIX: loosen CORS to allow all origins (with credentials) while debugging Render config.
// TODO: replace with strict origin list using FRONTEND_ORIGINS once deployment is stable.
app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/projects', projectsRouter);
app.use('/api/meetings', meetingsRouter);
app.use('/api/sessions', sessionsRouter);

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Server API running on port ${PORT}`);
  console.log(`Frontend origins: ${uniqueAllowedOrigins.join(', ')}`);
});
