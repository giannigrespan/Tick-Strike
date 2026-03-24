/**
 * BucketBar.tsx
 *
 * A single vertical bar in the PitPanel waterfall view.
 * - Height: proportional to total volume (log scale)
 * - Colour: green (buy dominant) / red (sell dominant) / gold (neutral)
 * - Intensity: maps abs(delta) / totalVol → colour saturation via opacity
 * - Slides in from the right via CSS animation
 */

import React from 'react';
import type { TickBucket } from '../../types/events.js';

export interface BucketBarProps {
  bucket: TickBucket;
  maxVolume: number;
  minPx: number;
  maxPx: number;
  isSelected: boolean;
  onClick: (bucket: TickBucket) => void;
}

// Log-scale normalise [0..1]
function logNorm(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  return Math.log1p(value) / Math.log1p(max);
}

export default function BucketBar({
  bucket,
  maxVolume,
  minPx,
  maxPx,
  isSelected,
  onClick,
}: BucketBarProps): React.ReactElement {
  const totalVol = bucket.buyVol + bucket.sellVol;
  const norm = logNorm(totalVol, maxVolume);
  const heightPx = Math.max(minPx, Math.round(norm * maxPx));

  // Delta ratio: -1 (full sell) → 0 (neutral) → +1 (full buy)
  const deltaRatio = totalVol > 0 ? bucket.delta / totalVol : 0;
  const intensity = Math.min(1, Math.abs(deltaRatio) * 1.5 + 0.25);

  let barColor: string;
  if (deltaRatio > 0.05) {
    barColor = `rgba(34,197,94,${intensity.toFixed(2)})`; // pit-buy
  } else if (deltaRatio < -0.05) {
    barColor = `rgba(239,68,68,${intensity.toFixed(2)})`; // pit-sell
  } else {
    barColor = `rgba(245,200,66,${intensity.toFixed(2)})`; // pit-gold
  }

  return (
    <button
      type="button"
      aria-label={`Bucket ${new Date(bucket.ts).toISOString()} vol=${totalVol}`}
      onClick={() => onClick(bucket)}
      className={[
        'shrink-0 rounded-sm animate-slide-in transition-opacity',
        isSelected ? 'ring-1 ring-pit-gold opacity-100' : 'opacity-80 hover:opacity-100',
      ].join(' ')}
      style={{
        width: 4,
        height: heightPx,
        minHeight: minPx,
        backgroundColor: barColor,
      }}
    />
  );
}
