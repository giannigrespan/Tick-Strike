/**
 * fix-client.ts — Low-level FIX 4.4 TCP/TLS engine.
 *
 * Implements FIX 4.4 framing, checksum, sequencing and session-level handling:
 *   - Logon  (35=A)
 *   - Logout (35=5)
 *   - Heartbeat (35=0) + TestRequest (35=1) / response
 *   - ResendRequest / SequenceReset handling (passive: seq reset accepted)
 *
 * No external FIX library — uses built-in `tls` / `net` only.
 *
 * Usage:
 *   const client = new FixClient({ ... });
 *   client.on('logon', () => { ... });
 *   client.on('message', (msg) => { ... });
 *   client.connect();
 */

import { EventEmitter } from 'node:events';
import tls from 'node:tls';
import net from 'node:net';

// ── Types ──────────────────────────────────────────────────────────────────

/** Parsed FIX message: map of tagNumber → string value */
export type FixMsg = Map<number, string>;

export interface FixClientOptions {
  host: string;
  port: number;
  ssl: boolean;
  senderCompID: string;
  targetCompID: string;
  senderSubID: string;
  password: string;
  heartBtInt?: number;       // seconds, default 30
  reconnectDelaySec?: number; // initial delay, doubles on each failure, default 5
  maxReconnectDelaySec?: number; // cap, default 120
}

// ── Constants ──────────────────────────────────────────────────────────────

const SOH = '\x01';
const FIX_VERSION = 'FIX.4.4';

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Compute FIX checksum: sum of all bytes mod 256, zero-padded to 3 digits.
 */
function checksum(raw: string): string {
  let sum = 0;
  for (let i = 0; i < raw.length; i++) sum += raw.charCodeAt(i);
  return String(sum % 256).padStart(3, '0');
}

/**
 * Format a UTC Date as FIX SendingTime: YYYYMMDD-HH:MM:SS.mmm
 */
function fixTimestamp(d = new Date()): string {
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const pad3 = (n: number) => String(n).padStart(3, '0');
  return (
    `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}-` +
    `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}.` +
    pad3(d.getUTCMilliseconds())
  );
}

/**
 * Parse a raw FIX message string into a Map<tagNumber, value>.
 */
export function parseFixMessage(raw: string): FixMsg {
  const msg: FixMsg = new Map();
  const fields = raw.split(SOH);
  for (const field of fields) {
    const eq = field.indexOf('=');
    if (eq === -1) continue;
    const tag = parseInt(field.slice(0, eq), 10);
    const val = field.slice(eq + 1);
    if (!isNaN(tag)) msg.set(tag, val);
  }
  return msg;
}

// ── FixClient ──────────────────────────────────────────────────────────────

export class FixClient extends EventEmitter {
  private opts: Required<FixClientOptions>;
  private socket: tls.TLSSocket | net.Socket | null = null;
  private seqNum = 1;
  private buffer = '';
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay: number;
  private destroyed = false;

  /** true after successful Logon acknowledgement */
  isLoggedIn = false;

  constructor(opts: FixClientOptions) {
    super();
    this.opts = {
      heartBtInt: 30,
      reconnectDelaySec: 5,
      maxReconnectDelaySec: 120,
      ...opts,
    };
    this.reconnectDelay = this.opts.reconnectDelaySec;
  }

  // ── Public API ───────────────────────────────────────────────────────────

  connect(): void {
    if (this.destroyed) return;
    this._clearTimers();

    const { host, port, ssl } = this.opts;
    console.log(`[fix] Connecting to ${host}:${port} (ssl=${String(ssl)})`);

    const socketOpts = { host, port };

    if (ssl) {
      this.socket = tls.connect({ ...socketOpts, rejectUnauthorized: true }, () => {
        this._onConnect();
      });
    } else {
      const s = net.createConnection(socketOpts, () => this._onConnect());
      this.socket = s;
    }

    this.socket.on('data', (d: Buffer) => this._onData(d));
    this.socket.on('error', (e: Error) => this._onSocketError(e));
    this.socket.on('close', () => this._onClose());
  }

  destroy(): void {
    this.destroyed = true;
    this._clearTimers();
    if (this.isLoggedIn) this.sendLogout();
    this.socket?.destroy();
    this.socket = null;
  }

  /**
   * Send an application-level FIX message.
   * Caller provides body fields as an array of [tag, value] pairs.
   * Header and trailer are added automatically.
   */
  send(msgType: string, bodyFields: [number, unknown][]): void {
    if (!this.socket || !this.socket.writable) {
      console.warn('[fix] send() called but socket not writable');
      return;
    }

    const now = fixTimestamp();
    const bodyParts: string[] = [];

    // Standard header fields (tag 35 onward — tag 8 & 9 added last)
    const headerFields: [number, string][] = [
      [35, msgType],
      [49, this.opts.senderCompID],
      [56, this.opts.targetCompID],
      [50, this.opts.senderSubID],
      [34, String(this.seqNum++)],
      [52, now],
    ];

    for (const [tag, val] of headerFields) {
      bodyParts.push(`${tag}=${String(val)}`);
    }
    for (const [tag, val] of bodyFields) {
      bodyParts.push(`${tag}=${String(val)}`);
    }

    const body = bodyParts.join(SOH) + SOH;
    const header = `8=${FIX_VERSION}${SOH}9=${body.length}${SOH}`;
    const raw = header + body;
    const cs = checksum(raw);
    const fullMsg = `${raw}10=${cs}${SOH}`;

    this.socket.write(fullMsg);
  }

  sendLogout(): void {
    this.send('5', [[58, 'Normal logout']]);
  }

  // ── Connection handlers ──────────────────────────────────────────────────

  private _onConnect(): void {
    console.log('[fix] Connected — sending Logon');
    this.buffer = '';
    this.seqNum = 1;
    this.reconnectDelay = this.opts.reconnectDelaySec; // reset on success
    this._sendLogon();
  }

  private _sendLogon(): void {
    this.send('A', [
      [98, '0'],                          // EncryptMethod = None
      [108, String(this.opts.heartBtInt)], // HeartBtInt
      [554, this.opts.password],           // Password
      [141, 'Y'],                          // ResetOnLogon
    ]);
  }

  private _onData(data: Buffer): void {
    this.buffer += data.toString('latin1');

    // FIX messages are delimited by "10=xxx\x01" (checksum field)
    while (true) {
      const end = this.buffer.indexOf(`10=`);
      if (end === -1) break;
      // The checksum field value is 3 digits + SOH
      const csEnd = end + 7; // "10=xxx\x01"
      if (csEnd > this.buffer.length) break;

      const raw = this.buffer.slice(0, csEnd);
      this.buffer = this.buffer.slice(csEnd);

      try {
        const msg = parseFixMessage(raw);
        this._handleMessage(msg);
      } catch (e) {
        console.error('[fix] Parse error:', (e as Error).message);
      }
    }
  }

  private _handleMessage(msg: FixMsg): void {
    const msgType = msg.get(35) ?? '';

    switch (msgType) {
      case 'A': // Logon
        this.isLoggedIn = true;
        console.log('[fix] Logon accepted');
        this._startHeartbeat();
        this.emit('logon');
        break;

      case '5': // Logout
        console.warn('[fix] Logout received:', msg.get(58) ?? '');
        this.isLoggedIn = false;
        this.emit('logout', msg.get(58));
        break;

      case '0': // Heartbeat
        // no-op; remote is alive
        break;

      case '1': { // TestRequest — must respond with Heartbeat
        const testReqId = msg.get(112) ?? '';
        this.send('0', [[112, testReqId]]);
        break;
      }

      case '2': // ResendRequest
        // Respond with SequenceReset-GapFill
        {
          const beginSeq = parseInt(msg.get(7) ?? '1', 10);
          const endSeq = parseInt(msg.get(16) ?? '0', 10) || this.seqNum;
          this.send('4', [
            [123, 'Y'],              // GapFillFlag
            [36, String(endSeq + 1)], // NewSeqNo
          ]);
          // suppress the requested range by jumping sequence
          this.seqNum = Math.max(this.seqNum, endSeq + 1);
          console.warn(`[fix] ResendRequest ${beginSeq}-${endSeq} — sent GapFill`);
        }
        break;

      case '3': // Reject
        console.warn('[fix] Session-level Reject:', msg.get(58) ?? '', 'tag:', msg.get(371) ?? '');
        this.emit('reject', msg);
        break;

      default:
        // Application messages (W, X, etc.) forwarded to listeners
        this.emit('message', msg);
        break;
    }
  }

  private _onSocketError(err: Error): void {
    console.error('[fix] Socket error:', err.message);
    this.isLoggedIn = false;
    this.emit('error', err);
  }

  private _onClose(): void {
    console.warn('[fix] Socket closed');
    this.isLoggedIn = false;
    this._clearTimers();
    this.emit('disconnect');

    if (!this.destroyed) {
      console.log(`[fix] Reconnecting in ${this.reconnectDelay}s`);
      this.reconnectTimer = setTimeout(() => {
        this.reconnectDelay = Math.min(
          this.reconnectDelay * 2,
          this.opts.maxReconnectDelaySec,
        );
        this.connect();
      }, this.reconnectDelay * 1000);
    }
  }

  // ── Heartbeat ────────────────────────────────────────────────────────────

  private _startHeartbeat(): void {
    this._clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.isLoggedIn) {
        this.send('0', []); // Heartbeat
      }
    }, this.opts.heartBtInt * 1000);
  }

  private _clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private _clearTimers(): void {
    this._clearHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
