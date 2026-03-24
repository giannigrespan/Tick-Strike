/**
 * AudioEngine.ts — PitStrike tick sonification engine.
 *
 * Uses Web Audio API exclusively (no external deps).
 *
 * Sound design (PRD Section 8):
 * - tick_bucket: short percussive click; pitch ∝ vwap change; volume ∝ log(totalVol)
 *   · buy-dominant → higher pitch (C5 area), panned slightly right
 *   · sell-dominant → lower pitch (A3 area), panned slightly left
 * - delta_spike: ascending/descending tone sweep (BUY = up glide, SELL = down glide)
 * - momentum_flip: brief gold chime (major third dyad)
 *
 * All sounds respect the master volume from config and scale with bucket size
 * when scaleWithSize = true.
 */

export interface AudioConfig {
  masterVolume: number;   // 0..1
  scaleWithSize: boolean;
  enabled: boolean;
}

const DEFAULT_CONFIG: AudioConfig = {
  masterVolume: 0.7,
  scaleWithSize: true,
  enabled: true,
};

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private config: AudioConfig;

  constructor(config: Partial<AudioConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /** Must be called from a user-gesture handler (browser autoplay policy). */
  resume(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.config.masterVolume;
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  destroy(): void {
    void this.ctx?.close();
    this.ctx = null;
    this.masterGain = null;
  }

  setMasterVolume(v: number): void {
    this.config.masterVolume = Math.max(0, Math.min(1, v));
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(this.config.masterVolume, this.ctx!.currentTime, 0.05);
    }
  }

  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  // ── Sound events ───────────────────────────────────────────────────────────

  /**
   * Play a tick-bucket percussive click.
   * @param delta      bucket delta (positive = buy, negative = sell)
   * @param totalVol   buy + sell volume (used to scale gain)
   * @param maxVol     session max volume (for normalisation)
   */
  playTick(delta: number, totalVol: number, maxVol: number): void {
    if (!this.config.enabled || !this.ctx || !this.masterGain) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Pitch: base around 440 Hz, +/- based on delta pressure
    const ratio = totalVol > 0 ? delta / totalVol : 0; // -1..1
    const baseFreq = 440;
    const freq = baseFreq * Math.pow(2, ratio * 0.5); // ±6 semitones

    // Volume: log scale, optionally scaled with size
    const normVol = Math.min(1, Math.log1p(totalVol) / Math.log1p(maxVol));
    const gain = this.config.scaleWithSize ? normVol * 0.25 : 0.15;

    // Pan: buy = right (+0.3), sell = left (-0.3)
    const pan = ratio * 0.3;

    this.playClick(freq, gain, pan, 0.04, now);
  }

  /**
   * Play a delta-spike alert — gliding tone sweep.
   * @param direction 'BUY' | 'SELL'
   * @param sigma     spike magnitude (clamped, used for volume)
   */
  playDeltaSpike(direction: 'BUY' | 'SELL', sigma: number): void {
    if (!this.config.enabled || !this.ctx || !this.masterGain) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const isBuy = direction === 'BUY';

    const startFreq = isBuy ? 330 : 660;
    const endFreq   = isBuy ? 880 : 220;
    const gainVal   = Math.min(0.6, 0.2 + (sigma / 10) * 0.4);

    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    const panner = ctx.createStereoPanner();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.linearRampToValueAtTime(endFreq, now + 0.3);

    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(gainVal, now + 0.05);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

    panner.pan.value = isBuy ? 0.4 : -0.4;

    osc.connect(env);
    env.connect(panner);
    panner.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.45);
  }

  /**
   * Play a momentum-flip chime — major third dyad.
   */
  playMomentumFlip(): void {
    if (!this.config.enabled || !this.ctx || !this.masterGain) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Major third: root C5 (523.25 Hz) + E5 (659.25 Hz)
    [523.25, 659.25].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      const panner = ctx.createStereoPanner();

      osc.type = 'triangle';
      osc.frequency.value = freq;

      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(0.18, now + 0.02);
      env.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

      panner.pan.value = i === 0 ? -0.2 : 0.2;

      osc.connect(env);
      env.connect(panner);
      panner.connect(this.masterGain!);

      osc.start(now);
      osc.stop(now + 0.55);
    });
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private playClick(
    freq: number,
    gainVal: number,
    pan: number,
    duration: number,
    when: number,
  ): void {
    const ctx = this.ctx!;

    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    const panner = ctx.createStereoPanner();

    osc.type = 'triangle';
    osc.frequency.value = freq;

    env.gain.setValueAtTime(gainVal, when);
    env.gain.exponentialRampToValueAtTime(0.001, when + duration);

    panner.pan.value = pan;

    osc.connect(env);
    env.connect(panner);
    panner.connect(this.masterGain!);

    osc.start(when);
    osc.stop(when + duration + 0.01);
  }
}

// Singleton — created lazily on first user interaction
let _engine: AudioEngine | null = null;

export function getAudioEngine(): AudioEngine {
  if (!_engine) {
    _engine = new AudioEngine();
  }
  return _engine;
}
