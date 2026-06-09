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
import webMeetingsRouter from './routes/web-meetings.js';
import contractsRouter from './routes/contracts.js';
import manuRouter from './routes/manu.js';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { parse } from 'node:url';
import path from 'node:path';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

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

const legacyAllowedOrigins = ['https://tacit-frontend-d0zb.onrender.com'];
const allowedOrigins = Array.from(
  new Set([...frontendOriginsFromEnv, ...legacyAllowedOrigins, ...devDefaultOrigins].filter(Boolean)),
);

const ngrokPatterns = ['.ngrok-free.dev', '.ngrok-free.app', '.ngrok.io'];

app.use(
  cors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      if (CORS_ALLOW_NGROK && ngrokPatterns.some((p) => origin.includes(p))) return callback(null, true);
      console.warn(`⚠️ CORS blocked origin: ${origin} (allowed: ${allowedOrigins.join(', ') || 'none'})`);
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  }),
);
app.use(express.json());

// Static files (for Recall.ai output webpage)
app.use(express.static(path.resolve(__dirname, '..', 'public')));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/projects', projectsRouter);
app.use('/api/meetings', meetingsRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/web-meetings', webMeetingsRouter);
app.use('/api/contracts', contractsRouter);
app.use('/api/manu', manuRouter);

// --- Real-time audio relay (Recall.ai -> ElevenLabs -> agent-minimal.html) ---
const connections = new Map<symbol, WebSocket | null>();
const audioOutClients = new Set<WebSocket>();

const recallAudioInServer = new WebSocketServer({ noServer: true });
const agentAudioOutServer = new WebSocketServer({ noServer: true });

function getRequiredEnv(name: string): string {
  const v = String(process.env[name] || '').trim();
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

async function createElevenLabsConnection(wsId: symbol): Promise<WebSocket> {
  const agentId = getRequiredEnv('ELEVENLABS_AGENT_ID');
  const apiKey = getRequiredEnv('ELEVENLABS_API_KEY');
  const elevenlabsUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${encodeURIComponent(agentId)}`;

  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(elevenlabsUrl, {
      headers: {
        'xi-api-key': apiKey,
      },
    });

    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        try { ws.close(); } catch {}
        reject(new Error('ElevenLabs connection timeout'));
      }
    }, 10000);

    ws.on('open', () => {
      // Wait for conversation_initiation_metadata before resolving.
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.type === 'ping') {
          const delay = message?.ping_event?.ping_ms || 0;
          setTimeout(() => {
            ws.send(JSON.stringify({ type: 'pong', event_id: message?.ping_event?.event_id }));
          }, delay);
          return;
        }

        if (message.type === 'audio' && message.audio_event?.audio_base_64) {
          const audioData = String(message.audio_event.audio_base_64);
          const audioMessage = JSON.stringify({ type: 'audio', data: audioData, timestamp: Date.now() });
          let sent = 0;
          for (const client of audioOutClients) {
            if (client.readyState === WebSocket.OPEN) {
              try {
                client.send(audioMessage);
                sent++;
              } catch {}
            }
          }
          if (sent === 0) {
            // no clients - nothing to do
          }
        }

        if (message.type === 'conversation_initiation_metadata' && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve(ws);
        }
      } catch (e) {
        console.error('ElevenLabs message parse error:', e);
      }
    });

    ws.on('error', (err) => {
      if (!resolved) {
        clearTimeout(timeout);
        reject(err);
      }
    });

    ws.on('close', () => {
      // Allow reconnection by clearing mapping.
      const existing = connections.get(wsId);
      if (existing === ws) connections.set(wsId, null);
    });
  });
}

agentAudioOutServer.on('connection', (ws) => {
  audioOutClients.add(ws);
  ws.on('close', () => audioOutClients.delete(ws));
});

recallAudioInServer.on('connection', (ws) => {
  const wsId = Symbol('recall-ws-id');
  connections.set(wsId, null);

  let audioChunkCount = 0;
  let isConnecting = false;
  let elevenlabsConnectionAttempts = 0;

  ws.on('message', async (raw) => {
    try {
      const message = JSON.parse(raw.toString());
      if (message.event !== 'audio_mixed_raw.data') return;

      const audioData = message?.data?.data?.buffer;
      if (!audioData) return;

      audioChunkCount++;

      const MIN_AUDIO_PACKETS_BEFORE_CONNECT = 5;
      if (audioChunkCount < MIN_AUDIO_PACKETS_BEFORE_CONNECT) return;

      let elevenlabsWs = connections.get(wsId);
      if (!elevenlabsWs || elevenlabsWs.readyState !== WebSocket.OPEN) {
        if (isConnecting) return;
        isConnecting = true;
        elevenlabsConnectionAttempts++;

        try {
          elevenlabsWs = await createElevenLabsConnection(wsId);
          connections.set(wsId, elevenlabsWs);
          isConnecting = false;
        } catch (e: any) {
          isConnecting = false;
          console.error('Failed to connect to ElevenLabs:', e?.message || e);
          return;
        }
      }

      // Forward audio to ElevenLabs
      try {
        const payload = {
          user_audio_chunk: String(audioData),
        };
        elevenlabsWs.send(JSON.stringify(payload));
      } catch (e) {
        console.error('Failed to send audio to ElevenLabs:', e);
      }
    } catch (e) {
      console.error('Recall audio parse error:', e);
    }
  });

  ws.on('close', () => {
    const elevenlabsWs = connections.get(wsId);
    if (elevenlabsWs) {
      try { elevenlabsWs.close(); } catch {}
    }
    connections.delete(wsId);
  });
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const server = createServer(app);

server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
  const { pathname } = parse(request.url || '');

  if (pathname === '/recall-audio-in') {
    recallAudioInServer.handleUpgrade(request, socket, head, (ws: WebSocket) => {
      recallAudioInServer.emit('connection', ws, request);
    });
    return;
  }

  if (pathname === '/agent-audio-out') {
    agentAudioOutServer.handleUpgrade(request, socket, head, (ws: WebSocket) => {
      agentAudioOutServer.emit('connection', ws, request);
    });
    return;
  }

  socket.destroy();
});

server.listen(PORT, () => {
  console.log(`Server API running on port ${PORT}`);
  console.log(`Frontend origins: ${allowedOrigins.join(', ')}`);
});
