import React, { Suspense } from 'react';
import PitPanel from './components/PitPanel/index.js';
import DeltaBar from './components/DeltaBar/index.js';
import AlertPanel from './components/AlertPanel/index.js';
import CorrelationGrid from './components/CorrelationGrid/index.js';
import { useAudio } from './hooks/useAudio.js';

/**
 * App.tsx — Root layout for PitStrike web application.
 * Dark theme, gold accents. Single-page application.
 */
function AudioControl(): React.ReactElement {
  const { enabled, volume, toggle, setVolume } = useAudio('XAUUSD');
  return (
    <div className="flex items-center gap-2 ml-auto">
      <button
        type="button"
        onClick={toggle}
        title={enabled ? 'Mute audio' : 'Enable audio'}
        className="text-pit-muted hover:text-pit-text transition-colors text-sm"
      >
        {enabled ? '🔊' : '🔇'}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={volume}
        onChange={(e) => setVolume(Number(e.target.value))}
        className="w-16 accent-pit-gold"
        aria-label="Master volume"
      />
      <span className="text-pit-muted text-xs">v1.0 MVP</span>
    </div>
  );
}

export default function App(): React.ReactElement {
  return (
    <div className="min-h-screen bg-pit-bg flex flex-col">
      {/* Top bar */}
      <header className="h-10 bg-pit-surface border-b border-pit-border flex items-center px-4 gap-3 shrink-0">
        <span className="text-pit-gold font-bold text-sm tracking-widest uppercase">▲ PitStrike</span>
        <span className="text-pit-muted text-xs">XAUUSD Order Flow</span>
        <AudioControl />
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
          <DeltaBar symbol="XAUUSD" />
        </aside>

        {/* Main area: CorrelationGrid */}
        <section className="flex-1 bg-pit-surface border border-pit-border rounded-lg overflow-hidden">
          <div className="px-3 py-2 border-b border-pit-border">
            <span className="text-pit-gold text-xs font-semibold uppercase tracking-wider">Correlation</span>
          </div>
          <CorrelationGrid symbols={['XAUUSD', 'XAGUSD', 'EURUSD', 'US500', 'USDX']} />
        </section>

        {/* Right sidebar: AlertPanel */}
        <aside className="w-72 shrink-0 bg-pit-surface border border-pit-border rounded-lg overflow-hidden flex flex-col">
          <div className="px-3 py-2 border-b border-pit-border shrink-0">
            <span className="text-pit-gold text-xs font-semibold uppercase tracking-wider">Alerts</span>
          </div>
          <AlertPanel />
        </aside>
      </main>
    </div>
  );
}
