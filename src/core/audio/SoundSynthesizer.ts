/**
 * CamArena Procedural Web Audio API Sound Synthesizer
 * Zero external audio assets required.
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

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
  }

  public getIsMuted(): boolean {
    return this.isMuted;
  }

  /**
   * Racket aerodynamic swoosh sound modulated by swing velocity
   */
  public racketSwish(speedKmh = 50): void {
    if (this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const duration = Math.max(0.12, Math.min(0.28, 12 / speedKmh));

    // White noise buffer
    const bufferSize = ctx.sampleRate * duration;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    // Sweeping bandpass filter to simulate air displacement
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    const centerFreq = 400 + Math.min(1800, speedKmh * 18);
    filter.frequency.setValueAtTime(centerFreq * 0.5, t);
    filter.frequency.exponentialRampToValueAtTime(centerFreq, t + duration * 0.5);
    filter.frequency.exponentialRampToValueAtTime(centerFreq * 0.3, t + duration);
    filter.Q.setValueAtTime(3.0, t);

    const gain = ctx.createGain();
    const volume = Math.min(0.7, 0.2 + speedKmh * 0.005);
    gain.gain.setValueAtTime(0.01, t);
    gain.gain.linearRampToValueAtTime(volume, t + duration * 0.3);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    noise.start(t);
    noise.stop(t + duration);
  }

  /**
   * Crisp badminton string / shuttlecock impact
   */
  public badmintonHit(power = 60): void {
    if (this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const t = ctx.currentTime;

    // String "ping" tone
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1400, t);
    osc.frequency.exponentialRampToValueAtTime(260, t + 0.08);

    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.4, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);

    // Cork impact thud
    const subOsc = ctx.createOscillator();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(340, t);
    subOsc.frequency.exponentialRampToValueAtTime(90, t + 0.06);

    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.5, t);
    subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);

    osc.connect(oscGain);
    oscGain.connect(ctx.destination);
    subOsc.connect(subGain);
    subGain.connect(ctx.destination);

    osc.start(t);
    subOsc.start(t);
    osc.stop(t + 0.1);
    subOsc.stop(t + 0.1);
  }

  /**
   * Explosive badminton overhead smash impact
   */
  public badmintonSmash(): void {
    if (this.isMuted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const t = ctx.currentTime;

    // Powerful low-end impact
    const bass = ctx.createOscillator();
    bass.type = 'sine';
    bass.frequency.setValueAtTime(220, t);
    bass.frequency.exponentialRampToValueAtTime(45, t + 0.22);

    const bassGain = ctx.createGain();
    bassGain.gain.setValueAtTime(0.8, t);
    bassGain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

    // High tension snap
    const snap = ctx.createOscillator();
    snap.type = 'triangle';
    snap.frequency.setValueAtTime(2800, t);
    snap.frequency.exponentialRampToValueAtTime(300, t + 0.07);

    const snapGain = ctx.createGain();
    snapGain.gain.setValueAtTime(0.6, t);
    snapGain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

    bass.connect(bassGain);
    bassGain.connect(ctx.destination);
    snap.connect(snapGain);
    snapGain.connect(ctx.destination);

    bass.start(t);
    snap.start(t);
    bass.stop(t + 0.3);
    snap.stop(t + 0.3);
  }

  /**
   * Authentic table tennis table bounce ("ping" / "pong")
   */
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

  /**
   * Table tennis rubber paddle strike
   */
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

  /**
   * Celebratory point chime
   */
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

  /**
   * Referee whistle
   */
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
