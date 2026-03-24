/**
 * DeltaBar/index.tsx
 *
 * Displays cumulative delta as a horizontal bi-directional bar.
 * - Centre = 0; left = negative (sell pressure); right = positive (buy pressure)
 * - Bar width proportional to |cumulativeDelta| / sessionAbsMax (clamped 0..1)
 * - Colour: green (positive) / red (negative)
 * - Session high/low markers rendered as tick lines above the bar
 * - Flashes gold on momentum flip (MomentumFlip event)
 * - Shows current direction arrow + numeric value
 *
 * PRD Section 6.3
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSSE } from '../../hooks/useSSE.js';
import type { DeltaUpdate, MomentumFlip } from '../../types/events.js';

export interface DeltaBarProps {
  symbol?: string;
}

interface DeltaState {
  cumulative: number;
  direction: 'UP' | 'DOWN' | 'FLAT';
  sessionHigh: number;
  sessionLow: number;
  sessionAbsMax: number; // running max of |cumulative| for normalisation
}

const INITIAL: DeltaState = {
  cumulative: 0,
  direction: 'FLAT',
  sessionHigh: 0,
  sessionLow: 0,
  sessionAbsMax: 1,
};

export default function DeltaBar({ symbol = 'XAUUSD' }: DeltaBarProps): React.ReactElement {
  const [delta, setDelta] = useState<DeltaState>(INITIAL);
  const [flashing, setFlashing] = useState(false);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleDeltaUpdate = useCallback(
    (data: DeltaUpdate) => {
      if (data.symbol !== symbol) return;
      setDelta((prev) => ({
        cumulative: data.cumulativeDelta,
        direction: data.direction,
        sessionHigh: data.sessionHigh,
        sessionLow: data.sessionLow,
        sessionAbsMax: Math.max(prev.sessionAbsMax, Math.abs(data.cumulativeDelta), 1),
      }));
    },
    [symbol],
  );

  const handleMomentumFlip = useCallback(
    (data: MomentumFlip) => {
      if (data.symbol !== symbol) return;
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      setFlashing(true);
      flashTimerRef.current = setTimeout(() => setFlashing(false), 500);
    },
    [symbol],
  );

  useSSE({ onDeltaUpdate: handleDeltaUpdate, onMomentumFlip: handleMomentumFlip });

  useEffect(() => () => { if (flashTimerRef.current) clearTimeout(flashTimerRef.current); }, []);

  const ratio = Math.min(1, Math.abs(delta.cumulative) / delta.sessionAbsMax);
  const isPositive = delta.cumulative >= 0;

  // Session marker positions (0..1 relative to centre)
  const highRatio = Math.min(1, Math.abs(delta.sessionHigh) / delta.sessionAbsMax);
  const lowRatio  = Math.min(1, Math.abs(delta.sessionLow)  / delta.sessionAbsMax);

  const dirArrow = delta.direction === 'UP' ? '▲' : delta.direction === 'DOWN' ? '▼' : '●';
  const dirColor = delta.direction === 'UP'
    ? 'text-pit-buy'
    : delta.direction === 'DOWN'
    ? 'text-pit-sell'
    : 'text-pit-muted';

  const sign = delta.cumulative > 0 ? '+' : '';
  const valueStr = `${sign}${delta.cumulative.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

  return (
    <div
      className={[
        'flex flex-col gap-1 px-3 py-2 rounded-lg border',
        flashing
          ? 'border-pit-gold bg-pit-gold/10 animate-flash-gold'
          : 'border-pit-border bg-pit-surface',
      ].join(' ')}
    >
      {/* Header */}
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-pit-muted uppercase tracking-wider">Cumulative Δ</span>
        <span className={`font-mono font-semibold ${dirColor}`}>
          {dirArrow} {valueStr}
        </span>
      </div>

      {/* Bar track */}
      <div className="relative h-3 bg-pit-bg rounded-full overflow-hidden">
        {/* Filled bar — grows from centre */}
        <div
          className={`absolute top-0 h-full rounded-full transition-all duration-100 ${
            isPositive ? 'bg-pit-buy left-1/2' : 'bg-pit-sell right-1/2'
          }`}
          style={{ width: `${ratio * 50}%` }}
        />

        {/* Centre line */}
        <div className="absolute top-0 left-1/2 h-full w-px bg-pit-border" />

        {/* Session high marker (positive side) */}
        <div
          className="absolute top-0 h-full w-px bg-pit-buy opacity-40"
          style={{ left: `calc(50% + ${highRatio * 50}%)` }}
          title={`Session high: ${delta.sessionHigh}`}
        />

        {/* Session low marker (negative side) */}
        <div
          className="absolute top-0 h-full w-px bg-pit-sell opacity-40"
          style={{ left: `calc(50% - ${lowRatio * 50}%)` }}
          title={`Session low: ${delta.sessionLow}`}
        />
      </div>

      {/* Session extremes labels */}
      <div className="flex justify-between text-[9px] text-pit-muted font-mono">
        <span className="text-pit-sell">{delta.sessionLow.toFixed(0)}</span>
        <span className="text-pit-muted">session</span>
        <span className="text-pit-buy">+{delta.sessionHigh.toFixed(0)}</span>
      </div>
    </div>
  );
}
