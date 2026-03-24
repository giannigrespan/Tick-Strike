import React, { Suspense } from 'react';
import PitPanel from './components/PitPanel/index.js';

/**
 * App.tsx — Root layout for PitStrike web application.
 * Dark theme, gold accents. Single-page application.
 * Layout: top bar + main content area.
 */
export default function App(): React.ReactElement {
  return (
    <div className="min-h-screen bg-pit-bg flex flex-col">
      {/* Top bar */}
      <header className="h-10 bg-pit-surface border-b border-pit-border flex items-center px-4 gap-3 shrink-0">
        <span className="text-pit-gold font-bold text-sm tracking-widest uppercase">▲ PitStrike</span>
        <span className="text-pit-muted text-xs">XAUUSD Order Flow</span>
        <div className="ml-auto text-pit-muted text-xs">v1.0 MVP</div>
      </header>

      {/* Main layout */}
      <main className="flex-1 flex overflow-hidden p-3 gap-3">
        {/* Left sidebar: PitPanel + DeltaBar */}
        <aside className="w-80 shrink-0 flex flex-col gap-3">
          <section className="flex-1 bg-pit-surface border border-pit-border rounded-lg overflow-hidden">
            <div className="px-3 py-2 border-b border-pit-border">
              <span className="text-pit-gold text-xs font-semibold uppercase tracking-wider">Pit Panel</span>
            </div>
            <Suspense fallback={<div className="p-3 text-pit-muted text-xs">Loading...</div>}>
              <PitPanel symbol="XAUUSD" displayWindowSec={60} />
            </Suspense>
          </section>
        </aside>

        {/* Main area — placeholder for CorrelationGrid */}
        <section className="flex-1 bg-pit-surface border border-pit-border rounded-lg flex items-center justify-center">
          <span className="text-pit-muted text-xs">CorrelationGrid — Sprint S4</span>
        </section>

        {/* Right sidebar — placeholder for AlertPanel */}
        <aside className="w-64 shrink-0 bg-pit-surface border border-pit-border rounded-lg flex items-center justify-center">
          <span className="text-pit-muted text-xs">AlertPanel — Sprint S4</span>
        </aside>
      </main>
    </div>
  );
}
