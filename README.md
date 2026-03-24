# PitStrike

Real-time order flow correlation tool for XAUUSD scalping.

Streams live tick data, aggregates it into 100ms buckets, computes buy/sell delta, detects spikes and momentum flips, and visualises everything in a dark-theme waterfall UI.

---

## Architecture

```
pitstrike/
├── packages/
│   ├── backend/    # Express SSE server + tick aggregator + mock feed
│   ├── frontend/   # Vite + React 18 + Tailwind waterfall UI
│   └── desktop/    # Electron wrapper (Sprint S5)
├── config.json     # Shared runtime config (symbols, thresholds, ports)
└── pnpm-workspace.yaml
```

### Data flow

```
MockFeed (Brownian motion) → TickAggregator (100ms buckets)
  → EventBus (SSE /api/events)
  → useSSE hook → PitPanel waterfall → BucketBar colours
```

---

## Getting started

### Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9

```bash
corepack enable
corepack prepare pnpm@latest --activate
```

### Install

```bash
cd pitstrike
pnpm install
```

### Run (dev mode)

```bash
pnpm dev
```

This starts both backend (`:3001`) and frontend (`:5173`) concurrently.

Open [http://localhost:5173](http://localhost:5173).

### Build

```bash
pnpm build
```

---

## SSE event types

| Event | Payload | Description |
|---|---|---|
| `tick_bucket` | `TickBucket` | 100ms aggregated OHLC + delta |
| `delta_update` | `DeltaUpdate` | Cumulative delta with session high/low |
| `delta_spike` | `DeltaSpike` | Sigma-threshold crossing |
| `momentum_flip` | `MomentumFlip` | Delta direction reversal |

### Example `tick_bucket` payload

```json
{
  "ts": 1711234567890,
  "symbol": "XAUUSD",
  "buyVol": 142.5,
  "sellVol": 98.3,
  "delta": 44.2,
  "tradeCount": 18,
  "vwap": 2341.35,
  "high": 2341.8,
  "low": 2340.9
}
```

---

## Configuration (`config.json`)

| Key | Default | Description |
|---|---|---|
| `aggregator.bucketMs` | `100` | Bucket size in milliseconds |
| `delta.spikeThreshold` | `2.5` | Sigma multiplier for spike detection |
| `delta.flipMinVelocity` | `500` | Min volume velocity to register a flip |
| `mock.enabled` | `true` | Use mock feed instead of live broker |
| `mock.tickRateHz` | `100` | Simulated tick rate |
| `server.port` | `3001` | Backend SSE server port |

---

## Sprint roadmap

| Sprint | Scope | Status |
|---|---|---|
| S1 | Monorepo scaffold + mock feed + SSE server + PitPanel waterfall | ✅ Done |
| S2 | DeltaBar cumulative delta display | pending |
| S3 | AudioEngine — tick sonification | pending |
| S4 | CorrelationGrid + AlertPanel | pending |
| S5 | Electron desktop wrapper | pending |
| S6 | Live broker integration (cTrader API) | pending |

---

## Development notes

- All SSE event types and payload shapes are defined in `packages/frontend/src/types/events.ts` — the backend mirrors these in `packages/backend/src/types.ts`.
- The `useSSE` hook reconnects with exponential backoff (1 s → 2 s → 4 s → … → 16 s cap).
- PitPanel bars use a **log-scale** height to prevent large-volume candles from dominating the view.
- Tailwind design tokens are in `packages/frontend/tailwind.config.ts` under the `pit` namespace.
