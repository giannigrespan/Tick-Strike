/**
 * OfflineBanner.tsx
 *
 * Shown when the SSE connection is in 'error' or 'closed' state.
 * Non-blocking — sits below the status bar without hiding the stale data.
 */

import React from 'react';

export interface OfflineBannerProps {
  status: 'error' | 'closed';
}

export default function OfflineBanner({ status }: OfflineBannerProps): React.ReactElement {
  const message =
    status === 'error'
      ? 'Connection error — reconnecting…'
      : 'Stream closed — waiting for reconnect…';

  return (
    <div
      role="status"
      aria-live="polite"
      className="px-3 py-1.5 bg-pit-sell/10 border-b border-pit-sell/30 flex items-center gap-2 shrink-0"
    >
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-pit-sell animate-pulse" />
      <span className="text-pit-sell text-[10px]">{message}</span>
    </div>
  );
}
