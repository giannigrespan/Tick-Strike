/**
 * PitPanel/index.tsx
 *
 * Primary visual component. Displays a scrolling feed of tick buckets
 * as colour bars — a horizontal waterfall view of order flow.
 *
 * Design spec (PRD Section 6.2):
 * - Each bar animates in from the right, older bars slide left and fade
 * - Bar width: proportional to bucket volume (log scale, min 2px, max 120px)
 * - Colour intensity: maps delta magnitude to colour saturation
 * - Configurable display window: last 30s / 60s / 120s of buckets
 * - Click on any bar to pause and inspect its metadata
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSSE } from '../../hooks/useSSE.js';
import type { TickBucket } from '../../types/events.js';
import BucketBar from './BucketBar.js';
import BucketTooltip from './BucketTooltip.js';
import OfflineBanner from './OfflineBanner.js';

// ── Props ─────────────────────────────────────────────────────────────────────

export interface PitPanelProps {
  symbol?: string;
  displayWindowSec?: 30 | 60 | 120;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_BUCKETS = 600; // 60s × 100ms = 600 max buckets for 60s window
const BAR_MIN_PX = 2;
const BAR_MAX_PX = 120;

// ── PitPanel ──────────────────────────────────────────────────────────────────

export default function PitPanel({
  symbol = 'XAUUSD',
  displayWindowSec = 60,
}: PitPanelProps): React.ReactElement {
  const [buckets, setBuckets] = useState<TickBucket[]>([]);
  const [paused, setPaused] = useState(false);
  const [selectedBucket, setSelectedBucket] = useState<TickBucket | null>(null);
  const pausedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep pausedRef in sync (avoids stale closure in SSE callback)
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  // Max buckets to display based on window setting
  const maxDisplay = displayWindowSec * 10; // 100ms buckets per second

  const handleTickBucket = useCallback(
    (bucket: TickBucket) => {
      if (pausedRef.current) return;
      if (bucket.symbol !== symbol) return;

      setBuckets((prev) => {
        const next = [...prev, bucket];
        return next.length > MAX_BUCKETS ? next.slice(next.length - MAX_BUCKETS) : next;
      });
    },
    [symbol],
  );

  const { status } = useSSE({ onTickBucket: handleTickBucket });

  // Auto-scroll to newest bucket (rightmost) when not paused
  useEffect(() => {
    if (!paused && scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [buckets, paused]);

  const visibleBuckets = buckets.slice(-maxDisplay);

  // Compute max total volume in visible window (for normalising bar widths)
  const maxVolume = visibleBuckets.reduce(
    (m, b) => Math.max(m, b.buyVol + b.sellVol),
    0.01,
  );

  const handleBarClick = (bucket: TickBucket) => {
    if (!paused) {
      setPaused(true);
    }
    setSelectedBucket(bucket);
  };

  const handleResume = () => {
    setPaused(false);
    setSelectedBucket(null);
  };

  return (
    <div className="flex flex-col h-full relative select-none">
      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-pit-border shrink-0">
        <span className="text-pit-muted text-[10px]">
          {symbol} · {visibleBuckets.length} buckets · {displayWindowSec}s
        </span>
        <div className="flex items-center gap-2">
          <StatusDot status={status} />
          {paused && (
            <button
              onClick={handleResume}
              className="text-[10px] text-pit-gold border border-pit-gold rounded px-1.5 py-0.5 hover:bg-pit-gold hover:text-pit-bg transition-colors"
            >
              Resume
            </button>
          )}
        </div>
      </div>

      {/* Offline banner (error boundary equivalent) */}
      {(status === 'error' || status === 'closed') && <OfflineBanner status={status} />}

      {/* Waterfall scroll container */}
      <div
        ref={scrollRef}
        className="flex-1 flex items-end overflow-x-auto overflow-y-hidden px-2 py-2 gap-[2px]"
        style={{ scrollBehavior: 'auto' }}
      >
        {visibleBuckets.map((bucket) => (
          <BucketBar
            key={bucket.ts}
            bucket={bucket}
            maxVolume={maxVolume}
            minPx={BAR_MIN_PX}
            maxPx={BAR_MAX_PX}
            isSelected={selectedBucket?.ts === bucket.ts}
            onClick={handleBarClick}
          />
        ))}
      </div>

      {/* Metadata tooltip for selected bucket */}
      {selectedBucket && (
        <BucketTooltip bucket={selectedBucket} onClose={handleResume} />
      )}
    </div>
  );
}

// ── StatusDot ─────────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: string }): React.ReactElement {
  const colours: Record<string, string> = {
    open: 'bg-pit-buy',
    connecting: 'bg-pit-gold animate-pulse',
    error: 'bg-pit-sell',
    closed: 'bg-pit-muted',
  };
  return (
    <span
      className={`inline-block w-1.5 h-1.5 rounded-full ${colours[status] ?? 'bg-pit-muted'}`}
      title={`SSE: ${status}`}
    />
  );
}
