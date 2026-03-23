# PitStrike — Implementation Plan
> Section 15.1: plan written before coding. Updated as tasks complete.

## Sprint S1 — Monorepo Bootstrap (Section 15.4)

### Step 1 — pnpm Workspace Scaffold [ ]
- [ ] Root `package.json` with `"workspaces": ["packages/*"]`
- [ ] `pnpm-workspace.yaml`
- [ ] Root `tsconfig.json` (strict mode, path aliases)
- [ ] Root `.eslintrc.cjs` + `.prettierrc`
- [ ] `.gitignore` (node_modules, dist, .env, *.js maps)
- [ ] `config.json` — shared runtime config (matches Section 9)
- [ ] `packages/backend/package.json` (ts, tsx, express, @types/*)
- [ ] `packages/frontend/package.json` (react, vite, tailwindcss)
- [ ] `packages/desktop/package.json` (electron placeholder)

### Step 2 — mock-feed.ts [ ]
- File: `packages/backend/src/mock-feed.ts`
- Emits `RawTick { symbol, timestamp, bid, ask, volume, side }` via EventEmitter
- Simulates XAUUSD realistic price walk (Brownian motion around base price)
- Also emits correlated symbols: XAGUSD, EURUSD, US500, USDX
- Configurable rate (default 100 ticks/s for dev, 1000 ticks/s stress test)
- Exports `MockFeed` class and `startMockFeed()` function

### Step 3 — event-bus SSE Server [ ]
- File: `packages/backend/src/event-bus/index.ts`
- Express app on `localhost:3001`
- `GET /events` — `text/event-stream` SSE endpoint
- `GET /health` — JSON status per symbol
- `GET /config` — returns current config.json values
- Inline tick-aggregator (50ms/100ms buckets) for MVP
- Emits SSE event types: `tick_bucket | delta_update | delta_spike | momentum_flip`
- CORS headers restricted to localhost origins only

### Step 4 — Frontend Scaffold + useSSE [ ]
- `packages/frontend/` — Vite 5 + React 18 + TypeScript + Tailwind CSS 3
- `src/hooks/useSSE.ts` — connects to `http://localhost:3001/events`, parses events, auto-reconnects on disconnect
- `src/types/events.ts` — shared TypeScript types for all SSE event payloads
- `vite.config.ts` — proxy `/api` → `localhost:3001` for dev
- `tailwind.config.ts` — dark theme, gold accent palette

### Step 5 — PitPanel Component [ ]
- File: `packages/frontend/src/components/PitPanel/index.tsx`
- Renders scrolling horizontal waterfall of tick buckets as colour bars
- Bar width = log(volume), min 2px max 120px
- Colour = green gradient (buy pressure) / red gradient (sell pressure)
- Bars animate in from right, older bars slide left and fade
- Display window: last 30s / 60s / 120s (configurable prop)
- Click bar → inspect metadata tooltip (ts, buyVol, sellVol, delta, vwap)
- Uses `useSSE` hook, subscribes to `tick_bucket` events
- Error boundary: shows offline banner if SSE disconnects

---

## Rules (Section 15.1)
- [x] Plan written in todo.md before coding
- [ ] Subagents used in parallel for independent modules (Steps 3 & 4 run concurrently after Steps 1 & 2)
- [ ] Each module verified before marking done
- [ ] lessons.md updated after any correction

## Build Order (Section 15.2)
1. Scaffold → 2. mock-feed → 3. event-bus → 4. frontend scaffold → 5. PitPanel
> Steps 3 and 4 are partially independent once mock-feed types are defined; subagents launched in parallel.

## Status
| Step | Status |
|------|--------|
| 1. Monorepo scaffold | pending |
| 2. mock-feed.ts | pending |
| 3. event-bus SSE | pending |
| 4. Frontend + useSSE | pending |
| 5. PitPanel | pending |
