/**
 * CorrelationGrid/index.tsx
 *
 * NxN heatmap of rolling Pearson correlation between tracked symbols.
 * - Colour: blue (-1) → grey (0) → amber (+1)
 * - Cell opacity scales with |r|
 * - Diagonal cells show symbol ticker
 * - Flashes on new update (300ms)
 *
 * PRD Section 7.1
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CorrelationUpdate } from '../../types/correlation.js';

export interface CorrelationGridProps {
  symbols: string[];
}

type Matrix = Record<string, Record<string, number>>;

function buildEmpty(symbols: string[]): Matrix {
  const m: Matrix = {};
  for (const a of symbols) {
    m[a] = {};
    for (const b of symbols) {
      m[a][b] = a === b ? 1 : 0;
    }
  }
  return m;
}

function rToColor(r: number): string {
  // -1 → blue (#3b82f6), 0 → transparent, +1 → amber (#f59e0b)
  const abs = Math.abs(r);
  const alpha = (abs * 0.85 + 0.1).toFixed(2);
  if (r > 0.05) return `rgba(245,158,11,${alpha})`;
  if (r < -0.05) return `rgba(59,130,246,${alpha})`;
  return `rgba(107,114,128,0.15)`;
}

export default function CorrelationGrid({ symbols }: CorrelationGridProps): React.ReactElement {
  const [matrix, setMatrix] = useState<Matrix>(() => buildEmpty(symbols));
  const [flashCell, setFlashCell] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Listen for correlation_update SSE events via raw EventSource
  // (useSSE doesn't yet expose correlation_update callback — wire directly)
  useEffect(() => {
    const es = new EventSource('/api/events');

    es.addEventListener('correlation_update', (e: MessageEvent) => {
      try {
        const update = JSON.parse(e.data as string) as CorrelationUpdate;
        setMatrix((prev) => {
          const next = { ...prev };
          if (!next[update.symbolA]) next[update.symbolA] = {};
          if (!next[update.symbolB]) next[update.symbolB] = {};
          next[update.symbolA][update.symbolB] = update.r;
          next[update.symbolB][update.symbolA] = update.r; // mirror
          return next;
        });

        const key = `${update.symbolA}-${update.symbolB}`;
        if (flashTimer.current) clearTimeout(flashTimer.current);
        setFlashCell(key);
        flashTimer.current = setTimeout(() => setFlashCell(null), 300);
      } catch {
        // ignore malformed
      }
    });

    return () => {
      es.close();
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  return (
    <div className="p-3 overflow-auto h-full">
      <table className="border-collapse text-[10px] font-mono">
        <thead>
          <tr>
            <th className="w-16" />
            {symbols.map((s) => (
              <th key={s} className="text-pit-muted px-1 pb-1 font-normal text-center w-16">
                {s.slice(0, 5)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {symbols.map((rowSym) => (
            <tr key={rowSym}>
              <td className="text-pit-muted pr-2 py-1 text-right">{rowSym.slice(0, 5)}</td>
              {symbols.map((colSym) => {
                const isDiag = rowSym === colSym;
                const r = matrix[rowSym]?.[colSym] ?? 0;
                const key = `${rowSym}-${colSym}`;
                const isFlashing = flashCell === key || flashCell === `${colSym}-${rowSym}`;
                return (
                  <td
                    key={colSym}
                    className={`w-16 h-10 text-center rounded transition-all duration-150 ${
                      isFlashing ? 'ring-1 ring-pit-gold' : ''
                    }`}
                    style={{ backgroundColor: isDiag ? 'transparent' : rToColor(r) }}
                    title={isDiag ? rowSym : `${rowSym}/${colSym}: r=${r.toFixed(3)}`}
                  >
                    {isDiag ? (
                      <span className="text-pit-gold font-semibold">{rowSym.slice(0, 3)}</span>
                    ) : (
                      <span className={r > 0 ? 'text-amber-300' : r < 0 ? 'text-blue-300' : 'text-pit-muted'}>
                        {r.toFixed(2)}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
