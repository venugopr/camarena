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

  public tableTennisPaddleHit(power = 1.0): void {
    if (this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const vol = Math.min(0.65, 0.32 + Math.min(power, 3.0) * 0.10);

    // Layer 1: Wood core resonant pop
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(680 + Math.min(power, 3.0) * 60, t);
    osc.frequency.exponentialRampToValueAtTime(200, t + 0.04);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.06);

    // Layer 2: Rubber impact surface snap
    const dur = 0.022;
    const noise = this.makeNoiseSource(ctx, dur);
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(2200, t);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(vol * 0.75, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start(t);
    noise.stop(t + dur);
  }

  public tableTennisNetClip(): void {
    if (this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const dur = 0.032;
    const noise = this.makeNoiseSource(ctx, dur);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1600, t);
    filter.Q.value = 2.2;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.28, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start(t);
    noise.stop(t + dur);

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440, t);
    osc.frequency.exponentialRampToValueAtTime(180, t + 0.04);
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.22, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
    osc.connect(oscGain);
    oscGain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.05);
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

  public bowlingPinHit(intensity = 1.0): void {
    if (this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520 + Math.random() * 80, t);
    osc.frequency.exponentialRampToValueAtTime(140, t + 0.06);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.38 * Math.min(1.5, Math.max(0.2, intensity)), t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.09);
  }

  public bowlingStrikeShatter(): void {
    if (this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;
    const t = ctx.currentTime;

    // 1. Initial powerful explosive impact crack
    this.badmintonSmash();

    // 2. Multi-pin staggered clatter (5 rapid pin collisions over 180ms)
    for (let i = 0; i < 5; i++) {
      const pinTime = t + 0.02 + i * 0.035;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      const f0 = 460 + Math.random() * 220;
      osc.frequency.setValueAtTime(f0, pinTime);
      osc.frequency.exponentialRampToValueAtTime(150, pinTime + 0.06);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.35 - i * 0.04, pinTime);
      gain.gain.exponentialRampToValueAtTime(0.001, pinTime + 0.07);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(pinTime);
      osc.stop(pinTime + 0.08);
    }

    // 3. Low-end resonant lane thud
    const subOsc = ctx.createOscillator();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(110, t);
    subOsc.frequency.exponentialRampToValueAtTime(36, t + 0.26);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.65, t);
    subGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    subOsc.connect(subGain);
    subGain.connect(ctx.destination);
    subOsc.start(t);
    subOsc.stop(t + 0.34);

    // 4. Celebratory victory chime after 0.28s
    setTimeout(() => {
      this.scoreChime();
    }, 280);
  }

  // ─── Lawn Tennis Sound Synthesis ──────────────────────────────────────────

  /**
   * Crisp high-tension outdoor tennis string pop:
   * Layer 1 — Fast high-pass string snap (1600-2400 Hz noise burst)
   * Layer 2 — Resonant sweet-spot ping (780 Hz -> 260 Hz sine wave)
   * Layer 3 — Graphite frame punch (140 Hz body thump)
   */
  public tennisRacketHit(power = 1.0, isSmash = false): void {
    if (this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const vol = Math.min(1.0, 0.45 + power * 0.45);
    const comp = this.makeCompressor(ctx);
    comp.connect(ctx.destination);

    // Layer 1: Sharp String Snap
    const snapDur = isSmash ? 0.05 : 0.038;
    const snapSrc = this.makeNoiseSource(ctx, snapDur);
    const snapFilter = ctx.createBiquadFilter();
    snapFilter.type = 'bandpass';
    snapFilter.frequency.setValueAtTime(isSmash ? 2400 : 1900, t);
    snapFilter.Q.value = 1.2;
    const snapGain = ctx.createGain();
    snapGain.gain.setValueAtTime(vol * 1.2, t);
    snapGain.gain.exponentialRampToValueAtTime(0.0001, t + snapDur);
    snapSrc.connect(snapFilter);
    snapFilter.connect(snapGain);
    snapGain.connect(comp);
    snapSrc.start(t);
    snapSrc.stop(t + snapDur);

    // Layer 2: Resonant Sweet-spot Tone
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(isSmash ? 950 : 780, t);
    osc.frequency.exponentialRampToValueAtTime(isSmash ? 220 : 280, t + 0.09);
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(vol * 0.7, t);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.connect(oscGain);
    oscGain.connect(comp);
    osc.start(t);
    osc.stop(t + 0.10);

    // Layer 3: Graphite frame punch
    const punch = ctx.createOscillator();
    punch.type = 'triangle';
    punch.frequency.setValueAtTime(140, t);
    punch.frequency.exponentialRampToValueAtTime(45, t + 0.06);
    const punchGain = ctx.createGain();
    punchGain.gain.setValueAtTime(vol * 0.5, t);
    punchGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    punch.connect(punchGain);
    punchGain.connect(comp);
    punch.start(t);
    punch.stop(t + 0.07);
  }

  public playRacketHit(power = 1.0, type: 'serve' | 'smash' | 'hit' = 'hit'): void {
    this.tennisRacketHit(power, type === 'smash' || type === 'serve');
  }

  /**
   * Heavy felt tennis ball hardcourt turf impact:
   * Layer 1 — Low-end resonant turf impact thump (160 Hz -> 42 Hz)
   * Layer 2 — Felt friction crunch (lowpass filtered noise, 0.04s)
   */
  public tennisBallBounce(speedRatio = 1.0): void {
    if (this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const vol = Math.min(0.9, 0.35 + speedRatio * 0.45);

    // Layer 1: Felt Ball Thud
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.075);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.085);

    // Layer 2: Surface friction burst
    const noiseDur = 0.035;
    const noise = this.makeNoiseSource(ctx, noiseDur);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, t);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(vol * 0.4, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + noiseDur);
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start(t);
    noise.stop(t + noiseDur);
  }

  public playPingPongBounce(power = 1.0): void {
    this.tennisBallBounce(power);
  }

  public playPingPongNet(): void {
    this.tableTennisNetClip();
  }

  public tennisNetHit(): void {
    this.tableTennisNetClip();
  }

  public playCheer(): void {
    this.whistle();
    setTimeout(() => {
      this.scoreChime();
    }, 180);
  }

  public playPointWon(): void {
    this.scoreChime();
  }

  // ─── Section 5: Arcade Boxing 3D Pro Procedural Sound Synthesis ─────────

  /**
   * Heavy leather boxing glove impact:
   * Layer 1 — Sub-bass punch thump (90 Hz -> 28 Hz sine, 0.09s decay)
   * Layer 2 — Leather slap friction crack (bandpass white noise burst, 0.045s)
   * Layer 3 — Critical counter / jaw crack (resonant high spike 2200 Hz -> 750 Hz, 0.07s)
   */
  public boxingPunchImpact(power = 1.0, isHeavy = false, isCounter = false): void {
    if (this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const clampedPower = Math.max(0.3, Math.min(2.0, power));
    const vol = Math.min(1.0, 0.45 * clampedPower);
    const comp = this.makeCompressor(ctx);
    comp.connect(ctx.destination);

    // Layer 1: Sub-bass punch thump
    const subOsc = ctx.createOscillator();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(isHeavy ? 110 : 85, t);
    subOsc.frequency.exponentialRampToValueAtTime(26, t + (isHeavy ? 0.11 : 0.075));
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(vol * 1.3, t);
    subGain.gain.exponentialRampToValueAtTime(0.0001, t + (isHeavy ? 0.12 : 0.085));
    subOsc.connect(subGain);
    subGain.connect(comp);
    subOsc.start(t);
    subOsc.stop(t + (isHeavy ? 0.13 : 0.09));

    // Layer 2: Leather slap friction crack
    const crackDur = isHeavy ? 0.055 : 0.038;
    const noiseSrc = this.makeNoiseSource(ctx, crackDur);
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(isHeavy ? 1400 : 1800, t);
    noiseFilter.Q.value = 1.1;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(vol * 0.9, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + crackDur);
    noiseSrc.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(comp);
    noiseSrc.start(t);
    noiseSrc.stop(t + crackDur);

    // Layer 3: Critical Counter crack
    if (isCounter || isHeavy) {
      const crackOsc = ctx.createOscillator();
      crackOsc.type = 'triangle';
      crackOsc.frequency.setValueAtTime(isCounter ? 2400 : 1600, t);
      crackOsc.frequency.exponentialRampToValueAtTime(isCounter ? 650 : 450, t + 0.07);
      const crackGain = ctx.createGain();
      crackGain.gain.setValueAtTime(vol * (isCounter ? 1.1 : 0.6), t);
      crackGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.075);
      crackOsc.connect(crackGain);
      crackGain.connect(comp);
      crackOsc.start(t);
      crackOsc.stop(t + 0.08);
    }
  }

  /**
   * Padded leather-on-leather guard block:
   * Layer 1 — Absorbed muffled thud (120 Hz -> 50 Hz, 0.06s)
   * Layer 2 — Lowpass leather impact burst (650 Hz, 0.03s)
   */
  public boxingGloveBlock(): void {
    if (this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const comp = this.makeCompressor(ctx);
    comp.connect(ctx.destination);

    // Muffled thump
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(130, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.06);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.55, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.065);
    osc.connect(gain);
    gain.connect(comp);
    osc.start(t);
    osc.stop(t + 0.07);

    // Padded noise
    const noiseDur = 0.035;
    const noise = this.makeNoiseSource(ctx, noiseDur);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(650, t);
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.4, t);
    nGain.gain.exponentialRampToValueAtTime(0.0001, t + noiseDur);
    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(comp);
    noise.start(t);
    noise.stop(t + noiseDur);
  }

  /**
   * Dynamic punch air whoosh for swings and near-misses.
   */
  public boxingWhoosh(velocity = 3.0): void {
    if (this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const dur = 0.11;
    const vol = Math.min(0.65, 0.2 + (velocity / 8.0) * 0.45);

    const noise = this.makeNoiseSource(ctx, dur);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(320, t);
    filter.frequency.exponentialRampToValueAtTime(880, t + dur * 0.5);
    filter.frequency.exponentialRampToValueAtTime(300, t + dur);
    filter.Q.value = 1.8;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.01, t);
    gain.gain.linearRampToValueAtTime(vol, t + dur * 0.4);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(t);
    noise.stop(t + dur);
  }

  public boxingPunchWhoosh(velocity = 3.0): void {
    this.boxingWhoosh(velocity * 3.0);
  }

  /**
   * Brass boxing ring round bell chimes:
   * 880 Hz fundamental + 1760 Hz harmonic + metallic ring overtone with 1.8s decay.
   */
  public boxingBellRing(chimes = 1): void {
    if (this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    for (let c = 0; c < chimes; c++) {
      const t = ctx.currentTime + c * 0.22;

      // Fundamental brass bell
      const osc1 = ctx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(880, t);
      const gain1 = ctx.createGain();
      gain1.gain.setValueAtTime(0.7, t);
      gain1.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(t);
      osc1.stop(t + 1.7);

      // Overtone harmonic
      const osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1760, t);
      const gain2 = ctx.createGain();
      gain2.gain.setValueAtTime(0.35, t);
      gain2.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(t);
      osc2.stop(t + 1.2);

      // Strike transient
      const hitDur = 0.03;
      const noise = this.makeNoiseSource(ctx, hitDur);
      const hitFilter = ctx.createBiquadFilter();
      hitFilter.type = 'highpass';
      hitFilter.frequency.setValueAtTime(3400, t);
      const hitGain = ctx.createGain();
      hitGain.gain.setValueAtTime(0.4, t);
      hitGain.gain.exponentialRampToValueAtTime(0.0001, t + hitDur);
      noise.connect(hitFilter);
      hitFilter.connect(hitGain);
      hitGain.connect(ctx.destination);
      noise.start(t);
      noise.stop(t + hitDur);
    }
  }

  /**
   * Stadium crowd roar swell during heavy hits or knockdowns.
   */
  public boxingCrowdRoar(intensity = 1.0): void {
    if (this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const dur = 1.5;
    const vol = Math.min(0.5, 0.25 * intensity);

    const noise = this.makeNoiseSource(ctx, dur);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(450, t);
    filter.frequency.linearRampToValueAtTime(950, t + 0.5);
    filter.frequency.exponentialRampToValueAtTime(350, t + dur);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.01, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.35);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(t);
    noise.stop(t + dur);
  }

  /**
   * Referee count tone / mallet strike during 10-count.
   */
  public boxingRefCountdown(count: number): void {
    if (this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    // Slightly ascending pitch per count for dramatic tension
    const baseFreq = 480 + (count - 1) * 25;
    osc.frequency.setValueAtTime(baseFreq, t);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.7, t + 0.08);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.55, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.095);
  }
}

