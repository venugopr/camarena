/**
 * CamArena Procedural Web Audio API Sound Synthesizer
 * Multi-layered signal chains via Web Audio API nodes — zero external audio assets required.
 *
 * Architecture:
 * - badmintonHit()    → 3-layer sweet-spot crack  (noise burst + resonant ping + sub-bass thump)
 * - badmintonSmash()  → 4-layer explosion          (sub-rumble + crunch + high snap + reverb tail)
 * - badmintonWhoosh() → dynamic pre-hit swing      (bandpass white-noise, velocity-mapped)
 * - racketSwish()     → kept for compatibility, delegates to badmintonWhoosh
 */
export class SoundSynthesizer {
  private ctx: AudioContext | null = null;
  private isMuted = false;

  constructor() {
    // Lazy initialize on first user interaction to comply with browser autoplay policies
  }

  private getContext(): AudioContext | null {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtxClass) {
        this.ctx = new AudioCtxClass();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public setMuted(muted: boolean): void { this.isMuted = muted; }
  public getIsMuted(): boolean { return this.isMuted; }

  // ─── Shared Utility ────────────────────────────────────────────────────────

  /** Create a white-noise buffer source of the given duration (seconds). */
  private makeNoiseSource(ctx: AudioContext, durationSec: number): AudioBufferSourceNode {
    const bufferSize = Math.ceil(ctx.sampleRate * durationSec);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    return src;
  }

  /** Create a DynamicsCompressorNode with standard limiter settings. */
  private makeCompressor(ctx: AudioContext): DynamicsCompressorNode {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -6;
    comp.knee.value = 4;
    comp.ratio.value = 8;
    comp.attack.value = 0.001;
    comp.release.value = 0.12;
    return comp;
  }

  // ─── Section 1: Sweet-Spot Badminton String Crack ─────────────────────────

  /**
   * Three-layer sweet-spot hit sound:
   * Layer 1 — High-pass noise burst  (string snap crack, decay 0.04s)
   * Layer 2 — Resonant ping          (2200 Hz → 680 Hz sine, decay 0.08s)
   * Layer 3 — Sub-bass thump         (65 Hz → 30 Hz sine, rapid decay 0.06s)
   * All three routed through a shared DynamicsCompressor.
   */
  public badmintonHit(power = 60): void {
    if (this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const vol = Math.min(0.9, 0.22 + power * 0.006);
    const comp = this.makeCompressor(ctx);
    comp.connect(ctx.destination);

    // Layer 1: High-pass noise burst — string snap
    const crackDur = 0.042;
    const crackSrc = this.makeNoiseSource(ctx, crackDur);
    const crackHP = ctx.createBiquadFilter();
    crackHP.type = 'highpass';
    crackHP.frequency.setValueAtTime(1800, t);
    crackHP.Q.value = 0.5;
    const crackGain = ctx.createGain();
    crackGain.gain.setValueAtTime(vol * 1.1, t);
    crackGain.gain.exponentialRampToValueAtTime(0.0001, t + crackDur);
    crackSrc.connect(crackHP);
    crackHP.connect(crackGain);
    crackGain.connect(comp);
    crackSrc.start(t);
    crackSrc.stop(t + crackDur);

    // Layer 2: 2.2 kHz resonant ping — frame / string resonance
    const pingOsc = ctx.createOscillator();
    pingOsc.type = 'sine';
    pingOsc.frequency.setValueAtTime(2200, t);
    pingOsc.frequency.exponentialRampToValueAtTime(680, t + 0.08);
    const pingGain = ctx.createGain();
    pingGain.gain.setValueAtTime(vol * 0.65, t);
    pingGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    pingOsc.connect(pingGain);
    pingGain.connect(comp);
    pingOsc.start(t);
    pingOsc.stop(t + 0.10);

    // Layer 3: Sub-bass thump — cork mass impact
    const thumpOsc = ctx.createOscillator();
    thumpOsc.type = 'sine';
    thumpOsc.frequency.setValueAtTime(65, t);
    thumpOsc.frequency.exponentialRampToValueAtTime(30, t + 0.06);
    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(vol * 0.8, t);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    thumpOsc.connect(thumpGain);
    thumpGain.connect(comp);
    thumpOsc.start(t);
    thumpOsc.stop(t + 0.08);
  }

  // ─── Section 1: Power Smash Explosion ──────────────────────────────────────

  /**
   * Four-layer power smash explosion:
   * Layer 1 — Sub-rumble    (40 Hz sine, gain 0.95, decay 0.22s) — floor-shaking transient
   * Layer 2 — Mid crunch    (noise burst HPF 600 Hz, decay 0.09s)
   * Layer 3 — High snap     (triangle 3200→400 Hz, decay 0.07s)
   * Layer 4 — Reverb tail   (2-reflection Schroeder delay: 35 ms + 68 ms, models indoor arena)
   */
  public badmintonSmash(): void {
    if (this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const comp = this.makeCompressor(ctx);
    comp.connect(ctx.destination);

    // Layer 1: 40 Hz sub-rumble — explosive low-end floor shake
    const rumbleOsc = ctx.createOscillator();
    rumbleOsc.type = 'sine';
    rumbleOsc.frequency.setValueAtTime(40, t);
    rumbleOsc.frequency.linearRampToValueAtTime(22, t + 0.22);
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.setValueAtTime(0.95, t);
    rumbleGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    rumbleOsc.connect(rumbleGain);
    rumbleGain.connect(comp);
    rumbleOsc.start(t);
    rumbleOsc.stop(t + 0.28);

    // Layer 2: Mid crunch — noise burst through HPF at 600 Hz
    const crunchSrc = this.makeNoiseSource(ctx, 0.10);
    const crunchHP = ctx.createBiquadFilter();
    crunchHP.type = 'highpass';
    crunchHP.frequency.value = 600;
    const crunchGain = ctx.createGain();
    crunchGain.gain.setValueAtTime(0.65, t);
    crunchGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    crunchSrc.connect(crunchHP);
    crunchHP.connect(crunchGain);
    crunchGain.connect(comp);
    crunchSrc.start(t);
    crunchSrc.stop(t + 0.10);

    // Layer 3: High snap — triangle 3200 Hz → 400 Hz pitch sweep
    const snapOsc = ctx.createOscillator();
    snapOsc.type = 'triangle';
    snapOsc.frequency.setValueAtTime(3200, t);
    snapOsc.frequency.exponentialRampToValueAtTime(400, t + 0.07);
    const snapGain = ctx.createGain();
    snapGain.gain.setValueAtTime(0.55, t);
    snapGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    snapOsc.connect(snapGain);
    snapGain.connect(comp);
    snapOsc.start(t);
    snapOsc.stop(t + 0.09);

    // Layer 4: Indoor arena reverb tail — two Schroeder delay reflections
    const reverbSrc = this.makeNoiseSource(ctx, 0.18);
    const reverbLP = ctx.createBiquadFilter();
    reverbLP.type = 'lowpass';
    reverbLP.frequency.value = 1800;

    // First early reflection at 35 ms
    const delay1 = ctx.createDelay(0.5);
    delay1.delayTime.value = 0.035;
    const echo1Gain = ctx.createGain();
    echo1Gain.gain.value = 0.28;

    // Second early reflection at 68 ms
    const delay2 = ctx.createDelay(0.5);
    delay2.delayTime.value = 0.068;
    const echo2Gain = ctx.createGain();
    echo2Gain.gain.value = 0.16;

    const reverbMasterGain = ctx.createGain();
    reverbMasterGain.gain.setValueAtTime(0.45, t);
    reverbMasterGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);

    reverbSrc.connect(reverbLP);
    reverbLP.connect(delay1);
    reverbLP.connect(delay2);
    delay1.connect(echo1Gain);
    delay2.connect(echo2Gain);
    echo1Gain.connect(reverbMasterGain);
    echo2Gain.connect(reverbMasterGain);
    reverbMasterGain.connect(comp);
    reverbSrc.start(t);
    reverbSrc.stop(t + 0.18);
  }

  // ─── Section 1: Pre-Hit Swing Whoosh ───────────────────────────────────────

  /**
   * Velocity-mapped dynamic bandpass white-noise swoosh.
   * @param angVel  Racket angular velocity in rad/s (or equivalent normalized [0..1] scale × 8)
   */
  public badmintonWhoosh(angVel = 3.0): void {
    if (this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const clampedVel = Math.max(0.5, Math.min(12, angVel));

    // Center frequency rises proportionally with swing speed
    const centerFreq = 180 + clampedVel * 140;
    const duration = Math.max(0.10, Math.min(0.28, 0.30 - clampedVel * 0.012));

    const bufferSize = Math.ceil(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = buffer;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(centerFreq * 0.5, t);
    bp.frequency.linearRampToValueAtTime(centerFreq, t + duration * 0.4);
    bp.frequency.linearRampToValueAtTime(centerFreq * 0.35, t + duration);
    bp.Q.value = 2.8;

    const whooshGain = ctx.createGain();
    const vol = Math.min(0.55, 0.12 + clampedVel * 0.038);
    whooshGain.gain.setValueAtTime(0.001, t);
    whooshGain.gain.linearRampToValueAtTime(vol, t + duration * 0.35);
    whooshGain.gain.exponentialRampToValueAtTime(0.0001, t + duration);

    noiseSrc.connect(bp);
    bp.connect(whooshGain);
    whooshGain.connect(ctx.destination);
    noiseSrc.start(t);
    noiseSrc.stop(t + duration);
  }

  /**
   * Legacy alias for backward-compatibility — delegates to badmintonWhoosh.
   * @param speedKmh  Racket head speed in km/h
   */
  public racketSwish(speedKmh = 50): void {
    this.badmintonWhoosh(speedKmh / 25);
  }

  // ─── Table Tennis (unchanged) ───────────────────────────────────────────────

  public tableTennisBounce(isNearTable = true): void {
    if (this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const freq = isNearTable ? 980 : 840;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.7, t + 0.05);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.07);
  }

  public tableTennisPaddleHit(): void {
    if (this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(620, t);
    osc.frequency.exponentialRampToValueAtTime(180, t + 0.04);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.06);
  }

  public scoreChime(): void {
    if (this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6

    notes.forEach((freq, idx) => {
      const noteTime = t + idx * 0.08;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, noteTime);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.2, noteTime);
      gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(noteTime);
      osc.stop(noteTime + 0.4);
    });
  }

  public whistle(): void {
    if (this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(2600, t);
    osc.frequency.linearRampToValueAtTime(2850, t + 0.12);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.linearRampToValueAtTime(0.3, t + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.22);
  }
}
