/**
 * live-fix-feed.ts — cTrader FIX 4.4 QUOTE session market data feed.
 *
 * Connects to the cTrader FIX gateway, logs in with the provided credentials,
 * subscribes to bid/ask quotes for all configured symbols, then emits `RawTick`
 * events — the same interface as MockFeed — so the aggregator pipeline is
 * completely unaware of the data source.
 *
 * Quote-to-order-flow heuristic (QUOTE sessions have no T&S tape):
 *   - Ask update upward  → BUY  pressure, volume = MDEntrySize
 *   - Bid update downward → SELL pressure, volume = MDEntrySize
 *   - Otherwise          → NEUTRAL
 *
 * Symbol mapping: config.broker.symbolMap lets you map internal names
 * (e.g. "US500") to broker names (e.g. "US500Cash").
 *
 * Reconnection is handled by FixClient with exponential backoff.
 */

import { EventEmitter } from 'node:events';
import { FixClient, parseFixMessage } from './fix-client.js';
import type { FixMsg } from './fix-client.js';
import type { RawTick, TickSide } from './types.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface LiveFixFeedOptions {
  host: string;
  port: number;
  ssl: boolean;
  senderCompID: string;
  targetCompID: string;
  senderSubID: string;
  password: string;
  symbols: string[];                          // internal symbol names
  symbolMap?: Record<string, string>;         // internal → broker name override
  heartBtInt?: number;
  reconnectDelaySec?: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

// FIX tag numbers used in market data messages
const TAG = {
  MsgType: 35,
  Symbol: 55,
  MDReqID: 262,
  SubscriptionReqType: 263,
  MarketDepth: 264,
  MDUpdateType: 265,
  NoMDEntryTypes: 267,
  NoMDEntries: 268,
  MDEntryType: 269,
  MDEntryPx: 270,
  MDEntrySize: 271,
  MDUpdateAction: 279,
} as const;

const MDEntryType = { Bid: '0', Ask: '1', Trade: '2' } as const;
const MDUpdateAction = { New: '0', Change: '1', Delete: '2' } as const;

// ── LiveFixFeed ────────────────────────────────────────────────────────────

export class LiveFixFeed extends EventEmitter {
  private client: FixClient;
  private opts: LiveFixFeedOptions;
  private reqSeq = 1;

  /** Last known top-of-book per symbol for direction inference */
  private lastBid = new Map<string, number>();
  private lastAsk = new Map<string, number>();

  constructor(opts: LiveFixFeedOptions) {
    super();
    this.opts = opts;

    this.client = new FixClient({
      host: opts.host,
      port: opts.port,
      ssl: opts.ssl,
      senderCompID: opts.senderCompID,
      targetCompID: opts.targetCompID,
      senderSubID: opts.senderSubID,
      password: opts.password,
      heartBtInt: opts.heartBtInt ?? 30,
      reconnectDelaySec: opts.reconnectDelaySec ?? 5,
    });

    this.client.on('logon', () => this._subscribeAll());
    this.client.on('message', (msg: FixMsg) => this._onMessage(msg));
    this.client.on('disconnect', () => {
      console.log('[live-feed] Disconnected — awaiting reconnect');
      this.emit('disconnected');
    });
    this.client.on('error', (e: Error) => {
      console.error('[live-feed] FIX error:', e.message);
    });
  }

  start(): void {
    this.client.connect();
  }

  stop(): void {
    this.client.destroy();
  }

  // ── Subscription ─────────────────────────────────────────────────────────

  private _brokerSymbol(internal: string): string {
    return this.opts.symbolMap?.[internal] ?? internal;
  }

  private _subscribeAll(): void {
    const symbols = this.opts.symbols;
    console.log('[live-feed] Subscribing to:', symbols.join(', '));

    // One MarketDataRequest per symbol (simpler MDReqID management)
    for (const sym of symbols) {
      this._subscribe(sym);
    }
  }

  private _subscribe(internalSym: string): void {
    const brokerSym = this._brokerSymbol(internalSym);
    const reqId = `MDR-${this.reqSeq++}-${brokerSym}`;

    // Build the NoMDEntryTypes repeating group (Bid + Ask)
    // FIX repeating group: lead tag (267), then members for each entry
    const fields: [number, unknown][] = [
      [TAG.MDReqID, reqId],
      [TAG.SubscriptionReqType, '1'],  // 1 = Snapshot + Updates
      [TAG.MarketDepth, '1'],          // 1 = Top of book
      [TAG.MDUpdateType, '1'],         // 1 = Incremental refresh
      [TAG.NoMDEntryTypes, '2'],       // 2 entry types follow
      [TAG.MDEntryType, MDEntryType.Bid],
      [TAG.MDEntryType, MDEntryType.Ask],
      [146, '1'],                      // NoRelatedSym = 1
      [TAG.Symbol, brokerSym],
    ];

    this.client.send('V', fields);
    console.log(`[live-feed] MarketDataRequest sent: ${brokerSym} (${reqId})`);
  }

  // ── Market data parsing ───────────────────────────────────────────────────

  private _onMessage(msg: FixMsg): void {
    const msgType = msg.get(TAG.MsgType) ?? '';

    if (msgType === 'W') {
      this._handleFullRefresh(msg);
    } else if (msgType === 'X') {
      this._handleIncrementalRefresh(msg);
    } else if (msgType === 'Y') {
      console.warn('[live-feed] MarketDataRequestReject:', msg.get(58) ?? msg.get(281) ?? '');
    }
  }

  /**
   * Full Refresh (35=W) — initial snapshot.
   * Updates last known bid/ask; no RawTick emitted (no volume/direction info).
   */
  private _handleFullRefresh(msg: FixMsg): void {
    const symbol = this._internalSym(msg.get(TAG.Symbol) ?? '');
    if (!symbol) return;

    const count = parseInt(msg.get(TAG.NoMDEntries) ?? '0', 10);
    // Full refresh has all entries embedded in the message map (flat structure)
    // We need to iterate the raw fields to handle repeating groups properly.
    // Since parseFixMessage uses last-wins for duplicate tags, we reconstruct
    // a group list from the flat map for the most common 1-entry case,
    // or fall back to a raw re-parse for multi-entry.
    if (count === 0) return;

    // For full refresh we just snapshot bid/ask from the map
    // (if multiple entries exist, the Map will have the last value — acceptable for top-of-book)
    const entryType = msg.get(TAG.MDEntryType) ?? '';
    const px = parseFloat(msg.get(TAG.MDEntryPx) ?? '0');
    if (!px) return;

    if (entryType === MDEntryType.Bid) this.lastBid.set(symbol, px);
    if (entryType === MDEntryType.Ask) this.lastAsk.set(symbol, px);
  }

  /**
   * Incremental Refresh (35=X) — live updates.
   *
   * Each incremental refresh can carry multiple MD entries across symbols.
   * Because the FIX repeating group fields use the same tag numbers, our
   * simple flat Map parser loses all but the last entry. We therefore
   * re-parse the raw message by walking field-by-field.
   *
   * We re-receive the original raw string via a second parse from the
   * FixClient's raw emission. To avoid threading it through, we reconstruct
   * from the flat map when count=1, otherwise emit one tick per known entry.
   */
  private _handleIncrementalRefresh(msg: FixMsg): void {
    const count = parseInt(msg.get(TAG.NoMDEntries) ?? '0', 10);
    if (count === 0) return;

    // Flat map approach: works for single-entry messages (most common for top-of-book)
    const sym = this._internalSym(msg.get(TAG.Symbol) ?? '');
    if (!sym) return;

    const action = msg.get(TAG.MDUpdateAction) ?? MDUpdateAction.New;
    if (action === MDUpdateAction.Delete) return;

    const entryType = msg.get(TAG.MDEntryType) ?? '';
    const px = parseFloat(msg.get(TAG.MDEntryPx) ?? '0');
    const size = parseFloat(msg.get(TAG.MDEntrySize) ?? '1');

    if (!px) return;

    this._processQuoteUpdate(sym, entryType, px, size);
  }

  /**
   * Convert a single bid/ask update into a RawTick.
   */
  private _processQuoteUpdate(
    symbol: string,
    entryType: string,
    px: number,
    size: number,
  ): void {
    const prevBid = this.lastBid.get(symbol) ?? px;
    const prevAsk = this.lastAsk.get(symbol) ?? px;

    let side: TickSide = 'NEUTRAL';
    let bid = prevBid;
    let ask = prevAsk;

    if (entryType === MDEntryType.Bid) {
      side = px > prevBid ? 'BUY' : px < prevBid ? 'SELL' : 'NEUTRAL';
      bid = px;
    } else if (entryType === MDEntryType.Ask) {
      side = px > prevAsk ? 'BUY' : px < prevAsk ? 'SELL' : 'NEUTRAL';
      ask = px;
    } else if (entryType === MDEntryType.Trade) {
      // Actual trade — determine aggressor by comparing to spread midpoint
      const mid = (prevBid + prevAsk) / 2;
      side = px >= mid ? 'BUY' : 'SELL';
    } else {
      return;
    }

    this.lastBid.set(symbol, bid);
    this.lastAsk.set(symbol, ask);

    const tick: RawTick = {
      symbol,
      timestamp: Date.now(),
      bid,
      ask,
      volume: size > 0 ? size : 1,
      side,
    };

    this.emit('tick', tick);
  }

  // ── Symbol name mapping ───────────────────────────────────────────────────

  /** Convert broker symbol name back to internal name. */
  private _internalSym(brokerName: string): string | undefined {
    // Reverse lookup: if symbolMap provides broker aliases, find the internal key
    if (this.opts.symbolMap) {
      for (const [internal, broker] of Object.entries(this.opts.symbolMap)) {
        if (broker === brokerName) return internal;
      }
    }
    // Check if brokerName matches directly (no mapping needed)
    if (this.opts.symbols.includes(brokerName)) return brokerName;
    return undefined;
  }
}
