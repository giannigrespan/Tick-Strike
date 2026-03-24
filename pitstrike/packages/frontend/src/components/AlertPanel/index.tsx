/**
 * AlertPanel/index.tsx
 *
 * Scrollable feed of real-time alerts:
 * - delta_spike   → ▲/▼ spike with sigma
 * - momentum_flip → ↩ flip from direction
 * - divergence_alert → correlation breakdown warning
 * - breakout_detected → price breakout
 *
 * Max 200 entries (config.ui.alertMaxEntries). Newest at top.
 * Each entry fades to 20% after 30s.
 *
 * PRD Section 7.2
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSSE } from '../../hooks/useSSE.js';
import type { DeltaSpike, MomentumFlip } from '../../types/events.js';
import type { DivergenceAlert, BreakoutDetected } from '../../types/correlation.js';

const MAX_ENTRIES = 200;

interface AlertEntry {
  id: number;
  ts: number;
  label: React.ReactNode;
  color: string; // Tailwind text colour class
}

let _seq = 0;

function makeId(): number {
  return ++_seq;
}

function timeStr(ts: number): string {
  return new Date(ts).toISOString().slice(11, 19);
}

export default function AlertPanel(): React.ReactElement {
  const [alerts, setAlerts] = useState<AlertEntry[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  const push = useCallback((entry: Omit<AlertEntry, 'id'>) => {
    setAlerts((prev) => {
      const next = [{ ...entry, id: makeId() }, ...prev];
      return next.length > MAX_ENTRIES ? next.slice(0, MAX_ENTRIES) : next;
    });
  }, []);

  const handleDeltaSpike = useCallback(
    (spike: DeltaSpike) => {
      const arrow = spike.direction === 'BUY' ? '▲' : '▼';
      push({
        ts: spike.ts,
        label: (
          <>
            <span>{arrow} SPIKE</span>
            <span className="text-pit-muted ml-1">{spike.symbol}</span>
            <span className="text-pit-muted ml-1">σ={spike.sigma.toFixed(1)}</span>
          </>
        ),
        color: spike.direction === 'BUY' ? 'text-pit-buy' : 'text-pit-sell',
      });
    },
    [push],
  );

  const handleMomentumFlip = useCallback(
    (flip: MomentumFlip) => {
      push({
        ts: flip.ts,
        label: (
          <>
            <span>↩ FLIP</span>
            <span className="text-pit-muted ml-1">{flip.symbol}</span>
            <span className="text-pit-muted ml-1">from {flip.fromDirection}</span>
          </>
        ),
        color: 'text-pit-gold',
      });
    },
    [push],
  );

  useSSE({ onDeltaSpike: handleDeltaSpike, onMomentumFlip: handleMomentumFlip });

  // Listen for divergence_alert and breakout_detected via raw EventSource
  useEffect(() => {
    const es = new EventSource('/api/events');

    es.addEventListener('divergence_alert', (e: MessageEvent) => {
      try {
        const d = JSON.parse(e.data as string) as DivergenceAlert;
        push({
          ts: d.ts,
          label: (
            <>
              <span>⚡ DIV</span>
              <span className="text-pit-muted ml-1">{d.symbolA}/{d.symbolB}</span>
              <span className="text-pit-muted ml-1">Δr={d.magnitude.toFixed(2)}</span>
            </>
          ),
          color: 'text-amber-400',
        });
      } catch { /* ignore */ }
    });

    es.addEventListener('breakout_detected', (e: MessageEvent) => {
      try {
        const b = JSON.parse(e.data as string) as BreakoutDetected;
        push({
          ts: b.ts,
          label: (
            <>
              <span>{b.direction === 'UP' ? '⬆' : '⬇'} BREAK</span>
              <span className="text-pit-muted ml-1">{b.symbol}</span>
              <span className="text-pit-muted ml-1">@{b.price.toFixed(2)}</span>
            </>
          ),
          color: b.direction === 'UP' ? 'text-pit-buy' : 'text-pit-sell',
        });
      } catch { /* ignore */ }
    });

    return () => es.close();
  }, [push]);

  return (
    <div
      ref={listRef}
      className="flex-1 overflow-y-auto px-2 py-1 flex flex-col gap-0.5"
    >
      {alerts.length === 0 && (
        <div className="text-pit-muted text-[10px] text-center mt-4">Awaiting alerts…</div>
      )}
      {alerts.map((a) => (
        <AlertRow key={a.id} entry={a} />
      ))}
    </div>
  );
}

function AlertRow({ entry }: { entry: AlertEntry }): React.ReactElement {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setStale(true), 30_000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      className={`flex items-center gap-1.5 text-[10px] font-mono px-1.5 py-0.5 rounded transition-opacity duration-1000 ${
        stale ? 'opacity-20' : 'opacity-100'
      } ${entry.color}`}
    >
      <span className="text-pit-muted shrink-0">{timeStr(entry.ts)}</span>
      {entry.label}
    </div>
  );
}
