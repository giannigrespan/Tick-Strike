/**
 * event-bus/index.ts
 *
 * Express SSE server. Endpoints:
 *   GET /events  — text/event-stream, broadcasts all PitStrike events
 *   GET /health  — JSON connection status per symbol
 *   GET /config  — returns config.json values
 *
 * Security: binds to localhost only (127.0.0.1), never 0.0.0.0.
 */

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import express, { type Request, type Response } from 'express';
import { MockFeed } from '../mock-feed.js';
import { LiveFixFeed } from '../live-fix-feed.js';
import { TickAggregator } from '../tick-aggregator/index.js';
import type { RawTick, TickBucket, SSEEventType } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, '../../../../config.json');

// ── Load config ───────────────────────────────────────────────────────────────

interface BrokerConfig {
  host: string;
  port: number;
  ssl?: boolean;
  senderCompID: string;
  targetCompID: string;
  senderSubID: string;
  symbolMap?: Record<string, string>;
}

interface PitStrikeConfig {
  server: { port: number };
  aggregator: { bucketMs: number };
  mock: { enabled: boolean; tickRateHz: number };
  delta: { spikeThreshold: number; flipMinVelocity: number; rollingWindow: number };
  broker?: BrokerConfig;
  symbols?: { primary: string; correlations: string[] };
}

function loadConfig(): PitStrikeConfig {
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw) as PitStrikeConfig;
  } catch {
    console.warn('[event-bus] config.json not found, using defaults');
    return {
      server: { port: 3001 },
      aggregator: { bucketMs: 100 },
      mock: { enabled: true, tickRateHz: 100 },
      delta: { spikeThreshold: 2.5, flipMinVelocity: 500, rollingWindow: 200 },
    };
  }
}

const config = loadConfig();
const PORT = config.server.port;

// ── SSE client registry ───────────────────────────────────────────────────────

interface SSEClient {
  id: string;
  res: Response;
}

const clients: Set<SSEClient> = new Set();

function broadcast(eventType: SSEEventType, data: unknown): void {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      client.res.write(payload);
    } catch {
      clients.delete(client);
    }
  }
}

// ── Delta state per symbol ────────────────────────────────────────────────────

interface DeltaState {
  cumulative: number;
  sessionHigh: number;
  sessionLow: number;
  recentDeltas: number[]; // rolling window for spike detection
  lastDirection: 'POSITIVE' | 'NEGATIVE' | 'FLAT';
  lastFlipTs: number;
}

const deltaStates = new Map<string, DeltaState>();

function getDeltaState(symbol: string): DeltaState {
  let state = deltaStates.get(symbol);
  if (!state) {
    state = {
      cumulative: 0,
      sessionHigh: 0,
      sessionLow: 0,
      recentDeltas: [],
      lastDirection: 'FLAT',
      lastFlipTs: 0,
    };
    deltaStates.set(symbol, state);
  }
  return state;
}

function processBucket(bucket: TickBucket): void {
  const state = getDeltaState(bucket.symbol);
  const { delta } = bucket;

  // Update rolling window
  state.recentDeltas.push(delta);
  if (state.recentDeltas.length > config.delta.rollingWindow) {
    state.recentDeltas.shift();
  }

  // Update cumulative delta
  state.cumulative += delta;
  state.sessionHigh = Math.max(state.sessionHigh, state.cumulative);
  state.sessionLow = Math.min(state.sessionLow, state.cumulative);

  // Determine direction
  const direction: 'POSITIVE' | 'NEGATIVE' | 'FLAT' =
    state.cumulative > 0 ? 'POSITIVE' : state.cumulative < 0 ? 'NEGATIVE' : 'FLAT';

  // Broadcast delta_update
  broadcast('delta_update', {
    symbol: bucket.symbol,
    ts: bucket.ts,
    cumulativeDelta: state.cumulative,
    direction,
    sessionHigh: state.sessionHigh,
    sessionLow: state.sessionLow,
  });

  // Spike detection (requires at least 30 samples for meaningful std dev)
  if (state.recentDeltas.length >= 30) {
    const mean = state.recentDeltas.reduce((a, b) => a + b, 0) / state.recentDeltas.length;
    const variance =
      state.recentDeltas.reduce((acc, v) => acc + (v - mean) ** 2, 0) /
      state.recentDeltas.length;
    const std = Math.sqrt(variance);
    if (std > 0) {
      const sigma = Math.abs(delta - mean) / std;
      if (sigma > config.delta.spikeThreshold) {
        broadcast('delta_spike', {
          symbol: bucket.symbol,
          ts: bucket.ts,
          delta,
          sigma: Math.round(sigma * 100) / 100,
          direction: delta > 0 ? 'BUY' : 'SELL',
        });
      }
    }
  }

  // Momentum flip detection
  if (state.lastDirection !== 'FLAT' && direction !== 'FLAT' && direction !== state.lastDirection) {
    const now = Date.now();
    const dtSec = Math.max((now - state.lastFlipTs) / 1000, 0.001);
    const velocity = Math.abs(state.cumulative) / dtSec;
    if (velocity >= config.delta.flipMinVelocity) {
      broadcast('momentum_flip', {
        symbol: bucket.symbol,
        ts: bucket.ts,
        fromDirection: state.lastDirection,
        velocity: Math.round(velocity),
      });
    }
    state.lastFlipTs = now;
  }

  if (direction !== 'FLAT') state.lastDirection = direction;
}

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();

// Restrict to localhost — security requirement from PRD Section 12.3
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:5173');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  next();
});

// SSE endpoint
app.get('/events', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
  res.flushHeaders();

  // Send a heartbeat comment every 15s to keep connection alive
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, 15_000);

  const client: SSEClient = { id: crypto.randomUUID(), res };
  clients.add(client);

  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(client);
  });
});

// Health endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    clients: clients.size,
    uptime: process.uptime(),
    symbols: Array.from(deltaStates.keys()).map((sym) => ({
      symbol: sym,
      cumulativeDelta: deltaStates.get(sym)?.cumulative ?? 0,
    })),
  });
});

// Config endpoint
app.get('/config', (_req: Request, res: Response) => {
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    res.json(JSON.parse(raw));
  } catch {
    res.status(500).json({ error: 'config.json not readable' });
  }
});

// ── Build feed (live or mock) ─────────────────────────────────────────────────

const aggregator = new TickAggregator({ bucketMs: config.aggregator.bucketMs });

/** EventEmitter with a 'tick' event — satisfied by both MockFeed and LiveFixFeed */
let feed: EventEmitter;

if (config.mock?.enabled !== false) {
  console.log('[event-bus] Using MockFeed');
  const mock = new MockFeed({ tickRateHz: config.mock?.tickRateHz ?? 100 });
  feed = mock;
} else {
  const b = config.broker;
  if (!b) throw new Error('[event-bus] mock.enabled=false but no broker config found');

  const password = process.env['FIX_PASSWORD'] ?? '';
  if (!password) {
    console.warn('[event-bus] WARNING: FIX_PASSWORD env var not set — Logon will fail');
  }

  const allSymbols = [
    config.symbols?.primary ?? 'XAUUSD',
    ...(config.symbols?.correlations ?? []),
  ];

  console.log('[event-bus] Using LiveFixFeed →', `${b.host}:${b.port}`);
  feed = new LiveFixFeed({
    host: b.host,
    port: b.port,
    ssl: b.ssl ?? true,
    senderCompID: b.senderCompID,
    targetCompID: b.targetCompID,
    senderSubID: b.senderSubID,
    symbolMap: b.symbolMap,
    password,
    symbols: allSymbols,
  });
}

feed.on('tick', (tick: RawTick) => {
  aggregator.ingest(tick);
});

aggregator.on('bucket', (bucket: TickBucket) => {
  broadcast('tick_bucket', bucket);
  processBucket(bucket);
});

// ── Start server ──────────────────────────────────────────────────────────────

const server = createServer(app);

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[event-bus] SSE server listening on http://127.0.0.1:${PORT}`);
  console.log(`[event-bus] Endpoints: /events  /health  /config`);

  aggregator.start();

  if (feed instanceof MockFeed) {
    feed.start();
    console.log(`[event-bus] Mock feed started at ${config.mock?.tickRateHz ?? 100} ticks/s`);
  } else {
    (feed as LiveFixFeed).start();
    console.log('[event-bus] Live FIX feed connecting…');
  }
});

server.on('error', (err: NodeJS.ErrnoException) => {
  console.error('[event-bus] Server error:', err.message);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('\n[event-bus] Shutting down...');
  if (feed instanceof MockFeed) feed.stop();
  else (feed as LiveFixFeed).stop();
  aggregator.stop();
  server.close(() => process.exit(0));
});
