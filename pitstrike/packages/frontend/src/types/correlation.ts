/**
 * types/correlation.ts — Payload types for correlation and alert SSE events.
 */

export interface CorrelationUpdate {
  ts: number;
  symbolA: string;
  symbolB: string;
  /** Pearson r, -1..1 */
  r: number;
  windowSec: number;
}

export interface DivergenceAlert {
  ts: number;
  symbolA: string;
  symbolB: string;
  expectedR: number;
  actualR: number;
  magnitude: number; // abs deviation from expected
}

export interface BreakoutDetected {
  ts: number;
  symbol: string;
  direction: 'UP' | 'DOWN';
  price: number;
  sigma: number;
}

export type AlertEvent =
  | { type: 'divergence'; data: DivergenceAlert }
  | { type: 'breakout'; data: BreakoutDetected }
  | { type: 'spike'; data: { ts: number; symbol: string; direction: 'BUY' | 'SELL'; sigma: number } };
