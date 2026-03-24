/**
 * Shared TypeScript types for PitStrike backend.
 * Strict mode — no `any` types.
 */

export type TickSide = 'BUY' | 'SELL' | 'NEUTRAL';

export interface RawTick {
  symbol: string;
  timestamp: number; // Unix ms
  bid: number;
  ask: number;
  volume: number;
  side: TickSide;
}

export interface TickBucket {
  ts: number; // bucket start timestamp (Unix ms)
  symbol: string;
  buyVol: number;
  sellVol: number;
  delta: number; // buyVol - sellVol
  tradeCount: number;
  vwap: number;
  high: number;
  low: number;
}

export type SSEEventType =
  | 'tick_bucket'
  | 'delta_update'
  | 'delta_spike'
  | 'momentum_flip'
  | 'correlation_update'
  | 'divergence_alert'
  | 'breakout_detected';

export interface SSEEvent<T = unknown> {
  type: SSEEventType;
  data: T;
}

export interface DeltaUpdate {
  symbol: string;
  ts: number;
  cumulativeDelta: number;
  direction: 'UP' | 'DOWN' | 'FLAT';
  sessionHigh: number;
  sessionLow: number;
}

export interface DeltaSpike {
  symbol: string;
  ts: number;
  delta: number;
  sigma: number; // how many standard deviations above mean
  direction: 'BUY' | 'SELL';
}

export interface MomentumFlip {
  symbol: string;
  ts: number;
  fromDirection: 'POSITIVE' | 'NEGATIVE';
  velocity: number; // delta/sec at flip point
}
