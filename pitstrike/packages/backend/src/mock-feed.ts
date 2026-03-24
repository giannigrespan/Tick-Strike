/**
 * mock-feed.ts — Realistic XAUUSD tick stream generator.
 *
 * Simulates multi-symbol tick data using geometric Brownian motion.
 * Used during development so frontend and event-bus can work without
 * a live cTrader broker connection.
 *
 * Usage:
 *   import { MockFeed } from './mock-feed.js';
 *   const feed = new MockFeed({ tickRateHz: 100 });
 *   feed.on('tick', (tick) => console.log(tick));
 *   feed.start();
 */

import { EventEmitter } from 'node:events';
import type { RawTick, TickSide } from './types.js';

// ── Symbol configuration ──────────────────────────────────────────────────────

interface SymbolConfig {
  basePrice: number;
  spreadPips: number;
  pipSize: number;
  volatility: number; // annualised vol fraction (e.g. 0.12 = 12%)
  avgTickVolume: number;
  volumeStdDev: number;
}

const SYMBOL_CONFIGS: Record<string, SymbolConfig> = {
  XAUUSD: {
    basePrice: 2340.0,
    spreadPips: 3,
    pipSize: 0.01,
    volatility: 0.16,
    avgTickVolume: 0.5,
    volumeStdDev: 0.8,
  },
  XAGUSD: {
    basePrice: 27.5,
    spreadPips: 4,
    pipSize: 0.001,
    volatility: 0.24,
    avgTickVolume: 1.2,
    volumeStdDev: 1.5,
  },
  EURUSD: {
    basePrice: 1.0845,
    spreadPips: 1,
    pipSize: 0.00001,
    volatility: 0.06,
    avgTickVolume: 2.0,
    volumeStdDev: 2.5,
  },
  US500: {
    basePrice: 5280.0,
    spreadPips: 5,
    pipSize: 0.01,
    volatility: 0.15,
    avgTickVolume: 0.3,
    volumeStdDev: 0.4,
  },
  USDX: {
    basePrice: 104.5,
    spreadPips: 2,
    pipSize: 0.001,
    volatility: 0.05,
    avgTickVolume: 0.8,
    volumeStdDev: 1.0,
  },
  XTIUSD: {
    basePrice: 78.5,
    spreadPips: 4,
    pipSize: 0.01,
    volatility: 0.28,
    avgTickVolume: 0.6,
    volumeStdDev: 0.8,
  },
};

// ── MockFeed options ──────────────────────────────────────────────────────────

export interface MockFeedOptions {
  /** Ticks per second emitted across all symbols. Default: 100 */
  tickRateHz?: number;
  /** Symbols to simulate. Default: all 6. */
  symbols?: string[];
  /** Emit a burst of large ticks every N seconds to test spike detection. Default: 30 */
  spikeBurstIntervalSec?: number;
}

// ── Price state per symbol ────────────────────────────────────────────────────

interface PriceState {
  midPrice: number;
  lastTs: number;
}

// ── MockFeed class ────────────────────────────────────────────────────────────

export class MockFeed extends EventEmitter {
  private readonly tickRateHz: number;
  private readonly symbols: string[];
  private readonly spikeBurstIntervalSec: number;
  private readonly priceStates: Map<string, PriceState> = new Map();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastSpikeTs = 0;

  constructor(options: MockFeedOptions = {}) {
    super();
    this.tickRateHz = options.tickRateHz ?? 100;
    this.symbols = options.symbols ?? Object.keys(SYMBOL_CONFIGS);
    this.spikeBurstIntervalSec = options.spikeBurstIntervalSec ?? 30;

    for (const symbol of this.symbols) {
      const cfg = SYMBOL_CONFIGS[symbol];
      if (!cfg) continue;
      this.priceStates.set(symbol, { midPrice: cfg.basePrice, lastTs: Date.now() });
    }
  }

  start(): void {
    if (this.intervalId !== null) return;
    const intervalMs = Math.floor(1000 / this.tickRateHz);
    this.intervalId = setInterval(() => {
      const now = Date.now();
      const isSpikeTime =
        now - this.lastSpikeTs > this.spikeBurstIntervalSec * 1000;

      // Pick a random symbol each tick interval to distribute load
      const symbol = this.symbols[Math.floor(Math.random() * this.symbols.length)];
      if (!symbol) return;

      const tick = this.generateTick(symbol, now, isSpikeTime);
      if (isSpikeTime) this.lastSpikeTs = now;

      this.emit('tick', tick);
    }, intervalMs);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /** Generate a single realistic tick for the given symbol. */
  private generateTick(symbol: string, now: number, isSpikeTime: boolean): RawTick {
    const cfg = SYMBOL_CONFIGS[symbol];
    const state = this.priceStates.get(symbol);

    // Fallback — should never happen if symbols are validated in constructor
    if (!cfg || !state) {
      return { symbol, timestamp: now, bid: 0, ask: 0, volume: 0, side: 'NEUTRAL' };
    }

    const dtSec = Math.max((now - state.lastTs) / 1000, 0.001);
    state.lastTs = now;

    // Geometric Brownian Motion step: dS = S * vol * sqrt(dt) * Z
    const dtYear = dtSec / (252 * 6.5 * 3600); // trading-time years
    const z = this.sampleNormal();
    const driftFraction = cfg.volatility * Math.sqrt(dtYear) * z;

    // Occasionally inject correlated micro-burst (simulates news impulse)
    const burstMult = isSpikeTime && symbol === 'XAUUSD' ? this.sampleLogNormal(2, 0.5) : 1;
    state.midPrice *= 1 + driftFraction * burstMult;

    // Clamp to ±20% of base price to avoid runaway simulation
    const baseCfg = SYMBOL_CONFIGS[symbol];
    state.midPrice = Math.max(baseCfg.basePrice * 0.8, Math.min(baseCfg.basePrice * 1.2, state.midPrice));

    const halfSpread = (cfg.spreadPips * cfg.pipSize) / 2;
    const bid = state.midPrice - halfSpread;
    const ask = state.midPrice + halfSpread;

    // Volume: log-normal distribution, burst multiplier for spikes
    const rawVol = this.sampleLogNormal(cfg.avgTickVolume, cfg.volumeStdDev);
    const volume = Math.max(0.01, rawVol * (isSpikeTime && symbol === 'XAUUSD' ? burstMult * 3 : 1));

    // Side detection: biased toward direction of price move
    const side: TickSide = this.determineSide(driftFraction);

    return {
      symbol,
      timestamp: now,
      bid: round(bid, decimalPlaces(cfg.pipSize)),
      ask: round(ask, decimalPlaces(cfg.pipSize)),
      volume: round(volume, 4),
      side,
    };
  }

  /** Box-Muller transform — standard normal sample. */
  private sampleNormal(): number {
    const u1 = Math.random();
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(Math.max(u1, 1e-10))) * Math.cos(2 * Math.PI * u2);
  }

  /** Log-normal sample with given mean and stddev. */
  private sampleLogNormal(mean: number, std: number): number {
    const mu = Math.log(mean * mean / Math.sqrt(mean * mean + std * std));
    const sigma = Math.sqrt(Math.log(1 + std * std / (mean * mean)));
    return Math.exp(mu + sigma * this.sampleNormal());
  }

  /** Determine trade side based on price direction with some noise. */
  private determineSide(drift: number): TickSide {
    const r = Math.random();
    if (drift > 0) {
      return r < 0.65 ? 'BUY' : r < 0.85 ? 'NEUTRAL' : 'SELL';
    } else if (drift < 0) {
      return r < 0.65 ? 'SELL' : r < 0.85 ? 'NEUTRAL' : 'BUY';
    }
    return r < 0.45 ? 'BUY' : r < 0.9 ? 'SELL' : 'NEUTRAL';
  }
}

// ── Standalone script mode ────────────────────────────────────────────────────

/** Start the mock feed and print ticks to stdout (for debugging). */
export function startMockFeed(options?: MockFeedOptions): MockFeed {
  const feed = new MockFeed(options);
  feed.start();
  return feed;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function round(value: number, places: number): number {
  const factor = Math.pow(10, places);
  return Math.round(value * factor) / factor;
}

function decimalPlaces(pipSize: number): number {
  const s = pipSize.toString();
  const dotIdx = s.indexOf('.');
  return dotIdx === -1 ? 0 : s.length - dotIdx - 1;
}

// Run standalone: tsx src/mock-feed.ts
if (process.argv[1]?.endsWith('mock-feed.ts') || process.argv[1]?.endsWith('mock-feed.js')) {
  const feed = startMockFeed({ tickRateHz: 20, symbols: ['XAUUSD'] });
  feed.on('tick', (tick: RawTick) => {
    console.log(JSON.stringify(tick));
  });
  process.on('SIGINT', () => {
    feed.stop();
    process.exit(0);
  });
}
