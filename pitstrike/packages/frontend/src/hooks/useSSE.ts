/**
 * useSSE.ts — React hook for consuming the PitStrike SSE event stream.
 *
 * Features:
 * - Auto-reconnects on disconnect (EventSource native behaviour + manual retry)
 * - Typed event callbacks per SSE event type
 * - Connection status tracking
 * - Cleanup on unmount
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type {
  TickBucket,
  DeltaUpdate,
  DeltaSpike,
  MomentumFlip,
  SSEEventType,
} from '../types/events.js';

export type SSEStatus = 'connecting' | 'open' | 'closed' | 'error';

export interface SSEHandlers {
  onTickBucket?: (data: TickBucket) => void;
  onDeltaUpdate?: (data: DeltaUpdate) => void;
  onDeltaSpike?: (data: DeltaSpike) => void;
  onMomentumFlip?: (data: MomentumFlip) => void;
  onError?: (err: Event) => void;
}

export interface UseSSEResult {
  status: SSEStatus;
  reconnect: () => void;
}

const SSE_URL = '/api/events'; // proxied by Vite dev server to localhost:3001

export function useSSE(handlers: SSEHandlers): UseSSEResult {
  const [status, setStatus] = useState<SSEStatus>('connecting');
  const esRef = useRef<EventSource | null>(null);
  const handlersRef = useRef(handlers);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep handlers ref fresh without re-creating the EventSource
  useEffect(() => {
    handlersRef.current = handlers;
  });

  const connect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
    }

    setStatus('connecting');
    const es = new EventSource(SSE_URL);
    esRef.current = es;

    es.onopen = () => {
      setStatus('open');
      retryCountRef.current = 0;
    };

    es.onerror = (err) => {
      setStatus('error');
      handlersRef.current.onError?.(err);

      // Exponential backoff: 1s, 2s, 4s, 8s, cap at 16s
      const backoffMs = Math.min(1000 * Math.pow(2, retryCountRef.current), 16_000);
      retryCountRef.current++;

      retryTimerRef.current = setTimeout(() => {
        connect();
      }, backoffMs);
    };

    // Register typed event listeners
    const addTypedListener = <T>(eventType: SSEEventType, handler: ((data: T) => void) | undefined) => {
      if (!handler) return;
      es.addEventListener(eventType, (e: MessageEvent) => {
        try {
          const parsed = JSON.parse(e.data as string) as T;
          // Read from ref so we always call the latest handler
          const h = handlersRef.current[handlerKey(eventType)] as ((data: T) => void) | undefined;
          h?.(parsed);
        } catch {
          console.warn(`[useSSE] Failed to parse ${eventType} event`, e.data);
        }
      });
    };

    addTypedListener<TickBucket>('tick_bucket', handlers.onTickBucket);
    addTypedListener<DeltaUpdate>('delta_update', handlers.onDeltaUpdate);
    addTypedListener<DeltaSpike>('delta_spike', handlers.onDeltaSpike);
    addTypedListener<MomentumFlip>('momentum_flip', handlers.onMomentumFlip);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    connect();
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      esRef.current?.close();
      setStatus('closed');
    };
  }, [connect]);

  return { status, reconnect: connect };
}

function handlerKey(eventType: SSEEventType): keyof SSEHandlers {
  const map: Record<SSEEventType, keyof SSEHandlers> = {
    tick_bucket: 'onTickBucket',
    delta_update: 'onDeltaUpdate',
    delta_spike: 'onDeltaSpike',
    momentum_flip: 'onMomentumFlip',
    correlation_update: 'onError', // placeholder — not yet handled
    divergence_alert: 'onError',
    breakout_detected: 'onError',
  };
  return map[eventType];
}
