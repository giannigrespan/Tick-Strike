/**
 * types/events.ts — Shared TypeScript types for all SSE event payloads.
 * Mirrors the types in packages/backend/src/types.ts for frontend use.
 */

export type TickSide = 'BUY' | 'SELL' | 'NEUTRAL';

export interface TickBucket {
  ts: number;
  symbol: string;
  buyVol: number;
  sellVol: number;
  delta: number;
  tradeCount: number;
  vwap: number;
  high: number;
  low: number;
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
  sigma: number;
  direction: 'BUY' | 'SELL';
}

export interface MomentumFlip {
  symbol: string;
  ts: number;
  fromDirection: 'POSITIVE' | 'NEGATIVE';
  velocity: number;
}

export type SSEEventType =
  | 'tick_bucket'
  | 'delta_update'
  | 'delta_spike'
  | 'momentum_flip'
  | 'correlation_update'
  | 'divergence_alert'
  | 'breakout_detected';
