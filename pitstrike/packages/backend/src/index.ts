/**
 * index.ts — PitStrike backend entry point.
 * Loads .env from monorepo root, then starts the event-bus SSE server.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Minimal .env loader (no external dep required)
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '../../../../.env');
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !(key in process.env)) {
      process.env[key] = val;
    }
  }
  console.log('[bootstrap] Loaded .env');
}

// Side-effect import: starts the Express server + feed
import './event-bus/index.js';
