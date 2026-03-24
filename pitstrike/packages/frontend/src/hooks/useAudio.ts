/**
 * useAudio.ts — React hook that wires SSE events to the AudioEngine.
 *
 * Activates the AudioContext on the first user interaction (click anywhere).
 * Exposes `enabled`, `toggle`, and `volume` controls.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getAudioEngine } from '../audio/AudioEngine.js';
import { useSSE } from './useSSE.js';
import type { TickBucket, DeltaSpike, MomentumFlip } from '../types/events.js';

export interface UseAudioResult {
  enabled: boolean;
  volume: number;
  toggle: () => void;
  setVolume: (v: number) => void;
}

export function useAudio(symbol: string): UseAudioResult {
  const [enabled, setEnabled] = useState(true);
  const [volume, setVolumeState] = useState(0.7);
  const maxVolRef = useRef(0.01);

  // Activate AudioContext on first click
  useEffect(() => {
    const activate = () => {
      getAudioEngine().resume();
      window.removeEventListener('click', activate);
    };
    window.addEventListener('click', activate);
    return () => window.removeEventListener('click', activate);
  }, []);

  const handleTickBucket = useCallback(
    (bucket: TickBucket) => {
      if (bucket.symbol !== symbol) return;
      const total = bucket.buyVol + bucket.sellVol;
      if (total > maxVolRef.current) maxVolRef.current = total;
      getAudioEngine().playTick(bucket.delta, total, maxVolRef.current);
    },
    [symbol],
  );

  const handleDeltaSpike = useCallback(
    (spike: DeltaSpike) => {
      if (spike.symbol !== symbol) return;
      getAudioEngine().playDeltaSpike(spike.direction, spike.sigma);
    },
    [symbol],
  );

  const handleMomentumFlip = useCallback(
    (flip: MomentumFlip) => {
      if (flip.symbol !== symbol) return;
      getAudioEngine().playMomentumFlip();
    },
    [symbol],
  );

  useSSE({
    onTickBucket: handleTickBucket,
    onDeltaSpike: handleDeltaSpike,
    onMomentumFlip: handleMomentumFlip,
  });

  const toggle = useCallback(() => {
    const next = !enabled;
    setEnabled(next);
    getAudioEngine().setEnabled(next);
  }, [enabled]);

  const setVolume = useCallback((v: number) => {
    setVolumeState(v);
    getAudioEngine().setMasterVolume(v);
  }, []);

  return { enabled, volume, toggle, setVolume };
}
