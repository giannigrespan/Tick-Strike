/**
 * BucketTooltip.tsx
 *
 * Overlay panel shown when a bucket bar is clicked (paused mode).
 * Displays full metadata for the selected bucket.
 */

import React from 'react';
import type { TickBucket } from '../../types/events.js';

export interface BucketTooltipProps {
  bucket: TickBucket;
  onClose: () => void;
}

function fmt(n: number, decimals = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function Row({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-pit-muted">{label}</span>
      <span className="text-pit-text font-mono">{value}</span>
    </div>
  );
}

export default function BucketTooltip({ bucket, onClose }: BucketTooltipProps): React.ReactElement {
  const time = new Date(bucket.ts).toISOString().slice(11, 23); // HH:MM:SS.mmm
  const totalVol = bucket.buyVol + bucket.sellVol;
  const deltaSign = bucket.delta >= 0 ? '+' : '';

  return (
    <div className="absolute bottom-12 left-2 z-20 bg-pit-surface border border-pit-border rounded-lg shadow-xl p-3 min-w-[200px] text-[11px]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-pit-gold text-xs font-semibold">{bucket.symbol}</span>
        <button
          type="button"
          onClick={onClose}
          className="text-pit-muted hover:text-pit-text transition-colors leading-none"
          aria-label="Close tooltip"
        >
          ✕
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <Row label="Time" value={time} />
        <Row label="Buy vol" value={fmt(bucket.buyVol)} />
        <Row label="Sell vol" value={fmt(bucket.sellVol)} />
        <Row label="Total vol" value={fmt(totalVol)} />
        <Row
          label="Delta"
          value={`${deltaSign}${fmt(bucket.delta)}`}
        />
        <Row label="Trades" value={String(bucket.tradeCount)} />
        <Row label="VWAP" value={fmt(bucket.vwap, 5)} />
        <Row label="High" value={fmt(bucket.high, 5)} />
        <Row label="Low" value={fmt(bucket.low, 5)} />
      </div>
    </div>
  );
}
