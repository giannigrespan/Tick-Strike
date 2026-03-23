/**
 * tick-aggregator/index.ts
 *
 * Aggregates raw RawTick events into TickBucket snapshots.
 * Each bucket covers `bucketMs` milliseconds.
 * Side detection: tick at ask or above = BUY; tick at bid or below = SELL; mid = NEUTRAL.
 */

import { EventEmitter } from 'node:events';
import type { RawTick, TickBucket } from '../types.js';

export interface AggregatorOptions {
  bucketMs?: number; // default 100
}

export class TickAggregator extends EventEmitter {
  private readonly bucketMs: number;
  // keyed by symbol → current open bucket
  private readonly openBuckets: Map<string, OpenBucket> = new Map();
  private flushTimerId: ReturnType<typeof setInterval> | null = null;

  constructor(options: AggregatorOptions = {}) {
    super();
    this.bucketMs = options.bucketMs ?? 100;
  }

  start(): void {
    if (this.flushTimerId !== null) return;
    this.flushTimerId = setInterval(() => this.flushAll(), this.bucketMs);
  }

  stop(): void {
    if (this.flushTimerId !== null) {
      clearInterval(this.flushTimerId);
      this.flushTimerId = null;
    }
  }

  ingest(tick: RawTick): void {
    let bucket = this.openBuckets.get(tick.symbol);
    if (!bucket) {
      bucket = newBucket(tick.symbol, tick.timestamp);
      this.openBuckets.set(tick.symbol, bucket);
    }

    const mid = (tick.bid + tick.ask) / 2;
    const vol = tick.volume;

    if (tick.side === 'BUY') {
      bucket.buyVol += vol;
    } else if (tick.side === 'SELL') {
      bucket.sellVol += vol;
    }

    bucket.tradeCount++;
    bucket.vwapNumerator += mid * vol;
    bucket.totalVol += vol;
    bucket.high = Math.max(bucket.high, mid);
    bucket.low = Math.min(bucket.low, mid);
  }

  private flushAll(): void {
    const now = Date.now();
    for (const [symbol, bucket] of this.openBuckets) {
      const closed = closeBucket(bucket, now);
      this.openBuckets.delete(symbol);
      this.emit('bucket', closed);
    }
  }
}

interface OpenBucket {
  symbol: string;
  ts: number;
  buyVol: number;
  sellVol: number;
  tradeCount: number;
  vwapNumerator: number;
  totalVol: number;
  high: number;
  low: number;
}

function newBucket(symbol: string, ts: number): OpenBucket {
  return {
    symbol,
    ts,
    buyVol: 0,
    sellVol: 0,
    tradeCount: 0,
    vwapNumerator: 0,
    totalVol: 0,
    high: -Infinity,
    low: Infinity,
  };
}

function closeBucket(b: OpenBucket, now: number): TickBucket {
  const vwap = b.totalVol > 0 ? b.vwapNumerator / b.totalVol : 0;
  return {
    ts: b.ts,
    symbol: b.symbol,
    buyVol: round4(b.buyVol),
    sellVol: round4(b.sellVol),
    delta: round4(b.buyVol - b.sellVol),
    tradeCount: b.tradeCount,
    vwap: round4(vwap),
    high: b.high === -Infinity ? 0 : round4(b.high),
    low: b.low === Infinity ? 0 : round4(b.low),
  };
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
