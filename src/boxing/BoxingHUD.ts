export interface BoxingHUDState {
  playerHealth: number;
  maxPlayerHealth: number;
  opponentHealth: number;
  maxOpponentHealth: number;
  stamina: number; // 0 - 100
  round: number;
  maxRounds: number;
  roundTimeLeft: number; // seconds
  comboCount: number;
  cameraPreset: 'classic_side' | 'wide_arena' | 'fighter_pov' | 'arcade_ots' | 'ringside' | 'first_person';
  difficulty?: 'starter' | 'medium' | 'hard';
}

export class BoxingHUD {
  private container: HTMLElement;
  private rootEl: HTMLElement;
  private onCameraCycleCallback?: () => void;
  private onDifficultyChangeCallback?: (tier: 'starter' | 'medium' | 'hard') => void;

  // DOM Elements
  private pHealthFill!: HTMLElement;
  private pHealthBuffer!: HTMLElement;
  private pHealthText!: HTMLElement;

  private oHealthFill!: HTMLElement;
  private oHealthBuffer!: HTMLElement;
  private oHealthText!: HTMLElement;

  private staminaFill!: HTMLElement;
  private staminaText!: HTMLElement;

  private roundBadge!: HTMLElement;
  private timerText!: HTMLElement;

  private calloutBadge!: HTMLElement;
  private comboBadge!: HTMLElement;
  private knockdownBanner!: HTMLElement;
  private damageVignette!: HTMLElement;
  private cameraPill!: HTMLElement;
  private cameraPillContainer!: HTMLElement;
  private diffButtons: Map<'starter' | 'medium' | 'hard', HTMLButtonElement> = new Map();

  // Timers
  private calloutTimer: any = null;
  private comboTimer: any = null;
  private pBufferHealth = 100;
  private oBufferHealth = 100;

  constructor(
    container: HTMLElement,
    onCameraCycle?: () => void,
    onDifficultyChange?: (tier: 'starter' | 'medium' | 'hard') => void
  ) {
    this.container = container;
    this.onCameraCycleCallback = onCameraCycle;
    this.onDifficultyChangeCallback = onDifficultyChange;
    this.rootEl = document.createElement('div');
    this.rootEl.className = 'boxing-hud-root';
    this.buildDOM();
    this.container.appendChild(this.rootEl);
  }

  public setOnCameraCycle(cb: () => void): void {
    this.onCameraCycleCallback = cb;
  }

  public setOnDifficultyChange(cb: (tier: 'starter' | 'medium' | 'hard') => void): void {
    this.onDifficultyChangeCallback = cb;
  }

  private buildDOM(): void {
    this.rootEl.innerHTML = `
      <style>
        .boxing-hud-root {
          position: absolute;
          inset: 0;
          pointer-events: none;
          font-family: 'Outfit', 'Inter', -apple-system, sans-serif;
          user-select: none;
          z-index: 125;
          overflow: hidden;
        }

        /* Fullscreen Screen Damage Flash */
        .boxing-vignette {
          position: absolute;
          inset: 0;
          pointer-events: none;
          box-shadow: inset 0 0 100px rgba(255, 0, 50, 0);
          transition: box-shadow 0.08s ease-out;
        }
        .boxing-vignette.hit {
          box-shadow: inset 0 0 140px rgba(255, 0, 50, 0.75);
        }

        /* Top Broadcast Banner */
        .boxing-top-bar {
          position: absolute;
          top: 68px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          align-items: center;
          gap: 16px;
          width: 82%;
          max-width: 880px;
          z-index: 130;
        }

        /* Fighter Health Container */
        .fighter-gauge-card {
          flex: 1;
          background: rgba(15, 18, 28, 0.82);
          backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 12px;
          padding: 8px 14px 10px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
        }
        .fighter-gauge-card.opponent {
          border-color: rgba(255, 60, 60, 0.35);
        }
        .fighter-gauge-card.player {
          border-color: rgba(0, 242, 254, 0.35);
        }

        .fighter-meta-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 5px;
        }
        .fighter-name {
          font-size: 0.85rem;
          font-weight: 800;
          letter-spacing: 1.5px;
          text-transform: uppercase;
        }
        .fighter-name.cyan { color: #00f2fe; text-shadow: 0 0 10px rgba(0, 242, 254, 0.6); }
        .fighter-name.red { color: #ff3344; text-shadow: 0 0 10px rgba(255, 51, 68, 0.6); }

        .fighter-hp-num {
          font-size: 0.8rem;
          font-weight: 700;
          color: rgba(255, 255, 255, 0.85);
          font-variant-numeric: tabular-nums;
        }

        /* LED Segmented Health Bar */
        .health-bar-track {
          position: relative;
          height: 14px;
          background: rgba(0, 0, 0, 0.65);
          border-radius: 6px;
          overflow: hidden;
          border: 1px solid rgba(255, 255, 255, 0.15);
        }
        .health-bar-buffer {
          position: absolute;
          top: 0; bottom: 0; left: 0;
          background: rgba(255, 215, 0, 0.7);
          transition: width 0.35s ease-out;
          border-radius: 6px;
        }
        .health-bar-fill {
          position: absolute;
          top: 0; bottom: 0; left: 0;
          border-radius: 6px;
          transition: width 0.08s ease-out;
        }
        .health-bar-fill.player {
          background: linear-gradient(90deg, #00f2fe, #4facfe);
          box-shadow: 0 0 12px rgba(0, 242, 254, 0.7);
        }
        .health-bar-fill.opponent {
          background: linear-gradient(90deg, #ff0844, #ffb199);
          box-shadow: 0 0 12px rgba(255, 8, 68, 0.7);
        }

        /* Center Round & Clock */
        .round-clock-badge {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: rgba(10, 12, 20, 0.9);
          border: 1px solid rgba(255, 215, 0, 0.4);
          border-radius: 12px;
          padding: 8px 18px;
          box-shadow: 0 0 18px rgba(255, 215, 0, 0.25);
          min-width: 110px;
        }
        .round-text {
          font-size: 0.72rem;
          font-weight: 800;
          color: #ffd700;
          letter-spacing: 2px;
          margin-bottom: 2px;
        }
        .clock-text {
          font-size: 1.4rem;
          font-weight: 900;
          color: #ffffff;
          font-variant-numeric: tabular-nums;
          letter-spacing: 1px;
        }

        /* Stamina Bar (Bottom Center) */
        .stamina-wrap {
          position: absolute;
          bottom: 28px;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(12, 14, 22, 0.85);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 180, 0, 0.3);
          border-radius: 20px;
          padding: 6px 18px 8px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
        }
        .stamina-header {
          display: flex;
          justify-content: space-between;
          width: 220px;
          font-size: 0.7rem;
          font-weight: 800;
          letter-spacing: 1.5px;
          color: #ffaa00;
        }
        .stamina-track {
          width: 220px;
          height: 8px;
          background: rgba(0, 0, 0, 0.7);
          border-radius: 4px;
          overflow: hidden;
          border: 1px solid rgba(255, 180, 0, 0.2);
        }
        .stamina-fill {
          height: 100%;
          background: linear-gradient(90deg, #ff8800, #ffdd00);
          box-shadow: 0 0 10px rgba(255, 180, 0, 0.8);
          border-radius: 4px;
          transition: width 0.08s ease-out;
        }

        /* Floating Callout Badges (Upper Flank) */
        .callout-badge {
          position: absolute;
          top: 154px;
          left: 50%;
          transform: translateX(-50%) scale(0.85);
          background: rgba(10, 12, 22, 0.92);
          border: 1px solid #ffd700;
          border-radius: 999px;
          padding: 8px 24px;
          color: #fff;
          font-weight: 800;
          font-size: 1.05rem;
          letter-spacing: 1.5px;
          box-shadow: 0 0 24px rgba(255, 215, 0, 0.5);
          opacity: 0;
          pointer-events: none;
          transition: all 0.15s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }
        .callout-badge.active {
          opacity: 1;
          transform: translateX(-50%) scale(1.0);
        }

        /* Floating Combo Multiplier */
        .combo-badge {
          position: absolute;
          top: 204px;
          left: 50%;
          transform: translateX(-50%) scale(0.8);
          color: #ff0055;
          font-size: 1.35rem;
          font-weight: 900;
          font-style: italic;
          letter-spacing: 2px;
          text-shadow: 0 0 15px rgba(255, 0, 85, 0.8), 2px 2px 0px #000;
          opacity: 0;
          transition: all 0.12s ease-out;
        }
        .combo-badge.active {
          opacity: 1;
          transform: translateX(-50%) scale(1.1);
        }

        /* Knockdown 10-Count Banner */
        .knockdown-banner {
          position: absolute;
          top: 38%;
          left: 50%;
          transform: translate(-50%, -50%);
          display: none;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: rgba(5, 5, 10, 0.92);
          border: 2px solid #ff0055;
          border-radius: 18px;
          padding: 24px 44px;
          box-shadow: 0 0 45px rgba(255, 0, 85, 0.8);
          text-align: center;
        }
        .knockdown-title {
          font-size: 1.5rem;
          font-weight: 900;
          color: #ff0055;
          letter-spacing: 4px;
          margin-bottom: 8px;
          text-shadow: 0 0 20px rgba(255, 0, 85, 0.8);
        }
        @keyframes pulse {
          0% { transform: scale(1.0); }
          100% { transform: scale(1.08); }
        }

        /* Countdown Banner (3... 2... 1... FIGHT!) */
        .countdown-banner {
          position: absolute;
          top: 42%;
          left: 50%;
          transform: translate(-50%, -50%);
          display: none;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          pointer-events: none;
          z-index: 150;
        }
        .countdown-round-sub {
          font-size: 1.4rem;
          font-weight: 800;
          color: #ffd700;
          letter-spacing: 4px;
          text-shadow: 0 0 15px rgba(255, 215, 0, 0.8);
          margin-bottom: 6px;
        }
        .countdown-main-text {
          font-size: 5.5rem;
          font-weight: 900;
          color: #ffffff;
          line-height: 1;
          letter-spacing: 3px;
          text-shadow: 0 0 35px rgba(0, 242, 254, 0.9), 0 0 70px rgba(0, 242, 254, 0.5);
          animation: pulse 0.5s ease-in-out infinite alternate;
        }

        /* Telegraph Warning Banner */
        .telegraph-warning-banner {
          position: absolute;
          top: 154px;
          left: 50%;
          transform: translateX(-50%);
          display: none;
          align-items: center;
          gap: 10px;
          background: rgba(40, 5, 15, 0.92);
          border: 2px solid #ff0055;
          border-radius: 999px;
          padding: 8px 24px;
          color: #ffffff;
          font-size: 1.05rem;
          font-weight: 800;
          letter-spacing: 2px;
          box-shadow: 0 0 30px rgba(255, 0, 85, 0.8);
          animation: pulse 0.3s ease-in-out infinite alternate;
        }

        /* Top-Left HOW TO PLAY Guide Card */
        .how-to-play-card {
          position: absolute;
          top: 138px;
          left: 18px;
          width: 250px;
          background: rgba(12, 16, 28, 0.92);
          backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 14px;
          padding: 12px 14px;
          color: #fff;
          font-size: 0.75rem;
          line-height: 1.4;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
          pointer-events: auto;
          transition: transform 0.25s ease, opacity 0.25s ease;
          z-index: 20;
        }
        .how-to-play-card.minimized {
          transform: translateX(-215px);
          opacity: 0.5;
        }

        /* Bottom Hint Bar */
        .boxing-controls-legend {
          position: absolute;
          bottom: 24px;
          left: 20px;
          background: rgba(10, 15, 25, 0.8);
          backdrop-filter: blur(8px);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 999px;
          padding: 5px 16px;
          font-size: 0.72rem;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.8);
          letter-spacing: 0.5px;
          pointer-events: none;
          z-index: 20;
        }

        /* Camera Mode Toggle Button (Top Right) */
        .camera-mode-pill {
          position: absolute;
          top: 68px;
          right: 20px;
          background: rgba(10, 15, 25, 0.9);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(0, 242, 254, 0.45);
          border-radius: 999px;
          padding: 8px 16px;
          font-size: 0.75rem;
          font-weight: 800;
          color: #00f2fe;
          letter-spacing: 1px;
          display: flex;
          align-items: center;
          gap: 6px;
          z-index: 140;
          pointer-events: auto;
          cursor: pointer;
          box-shadow: 0 4px 18px rgba(0, 0, 0, 0.45);
          transition: all 0.15s ease;
        }
        .camera-mode-pill:hover {
          background: rgba(0, 242, 254, 0.22);
          border-color: #00f2fe;
          color: #ffffff;
          box-shadow: 0 0 16px rgba(0, 242, 254, 0.5);
        }
        .how-to-play-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.82rem;
          font-weight: 800;
          color: #00f2fe;
          letter-spacing: 1.5px;
          margin-bottom: 8px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          padding-bottom: 6px;
        }
        .guide-toggle-btn {
          background: rgba(255, 255, 255, 0.1);
          border: none;
          border-radius: 4px;
          color: #fff;
          font-size: 0.7rem;
          padding: 2px 6px;
          cursor: pointer;
        }
        .guide-toggle-btn:hover {
          background: rgba(0, 242, 254, 0.3);
        }
        .how-to-play-item {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          margin-bottom: 6px;
        }
        .how-to-play-item .guide-icon {
          font-size: 0.95rem;
          line-height: 1;
        }
        .how-to-play-item strong {
          color: #ffd700;
          font-size: 0.72rem;
          letter-spacing: 0.5px;
        }
        .how-to-play-item p {
          margin: 0;
          color: rgba(255, 255, 255, 0.75);
          font-size: 0.7rem;
        }
        /* Floating 3D-Projected Fighter Markers */
        .fighter-world-marker {
          position: absolute;
          transform: translate(-50%, -100%);
          padding: 4px 12px;
          border-radius: 999px;
          font-size: 0.72rem;
          font-weight: 900;
          letter-spacing: 1.4px;
          white-space: nowrap;
          pointer-events: none;
          z-index: 45;
          transition: opacity 0.15s ease;
        }
        .fighter-world-marker.player-marker {
          background: rgba(6, 20, 36, 0.88);
          border: 1.5px solid #00f2fe;
          color: #00f2fe;
          text-shadow: 0 0 10px rgba(0, 242, 254, 0.9);
          box-shadow: 0 0 18px rgba(0, 242, 254, 0.55);
        }
        .fighter-world-marker.opponent-marker {
          background: rgba(36, 6, 16, 0.88);
          border: 1.5px solid #ff0055;
          color: #ff0055;
          text-shadow: 0 0 10px rgba(255, 0, 85, 0.9);
          box-shadow: 0 0 18px rgba(255, 0, 85, 0.55);
        }

        /* Difficulty Level Selector Bar (Top Right, below Camera Mode button) */
        .boxing-difficulty-selector {
          position: absolute;
          top: 112px;
          right: 20px;
          display: flex;
          align-items: center;
          gap: 4px;
          background: rgba(10, 15, 25, 0.92);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.18);
          border-radius: 999px;
          padding: 4px 6px;
          z-index: 140;
          pointer-events: auto;
          box-shadow: 0 4px 18px rgba(0, 0, 0, 0.45);
        }
        .boxing-diff-label {
          font-size: 0.65rem;
          font-weight: 800;
          color: rgba(255, 255, 255, 0.65);
          letter-spacing: 1px;
          padding: 0 6px 0 8px;
          text-transform: uppercase;
        }
        .boxing-diff-btn {
          background: transparent;
          border: 1px solid transparent;
          border-radius: 999px;
          padding: 4px 11px;
          font-size: 0.7rem;
          font-weight: 800;
          color: rgba(255, 255, 255, 0.72);
          letter-spacing: 0.8px;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .boxing-diff-btn:hover {
          color: #ffffff;
          background: rgba(255, 255, 255, 0.1);
        }
        .boxing-diff-btn.active[data-tier="starter"] {
          background: rgba(57, 255, 20, 0.2);
          border-color: #39ff14;
          color: #39ff14;
          box-shadow: 0 0 12px rgba(57, 255, 20, 0.4);
        }
        .boxing-diff-btn.active[data-tier="medium"] {
          background: rgba(0, 242, 254, 0.22);
          border-color: #00f2fe;
          color: #00f2fe;
          box-shadow: 0 0 12px rgba(0, 242, 254, 0.45);
        }
        .boxing-diff-btn.active[data-tier="hard"] {
          background: rgba(255, 0, 85, 0.25);
          border-color: #ff0055;
          color: #ff0055;
          box-shadow: 0 0 12px rgba(255, 0, 85, 0.5);
        }
      </style>

      <div class="boxing-vignette" id="boxing-vignette"></div>

      <!-- Floating World-Space Fighter Markers -->
      <div class="fighter-world-marker player-marker" id="fighter-marker-player" style="left: 24%; top: 34%;">
        👤 YOU (PLAYER)
      </div>
      <div class="fighter-world-marker opponent-marker" id="fighter-marker-opponent" style="left: 76%; top: 34%;">
        🤖 IRON TITAN (AI)
      </div>

      <button class="camera-mode-pill" id="camera-mode-pill" title="Click or press [C] to cycle Camera View">
        <span>📷</span> <span id="camera-mode-text">Classic Side Cam [C]</span>
      </button>

      <!-- Difficulty Level Selector (Starter / Medium (Default) / Hard) -->
      <div class="boxing-difficulty-selector" id="boxing-difficulty-selector">
        <span class="boxing-diff-label">AI TIER:</span>
        <button class="boxing-diff-btn" data-tier="starter" title="Starter / Easy: AI attacks every 3.5s, 0.65s telegraph, 6-10 HP dmg, 20% block">Starter</button>
        <button class="boxing-diff-btn active" data-tier="medium" title="Medium (Default): AI attacks every 2.2s, 0.40s telegraph, 10-14 HP dmg, 50% block">Medium</button>
        <button class="boxing-diff-btn" data-tier="hard" title="Hard: AI attacks every 1.2s, 0.20s telegraph, 16-22 HP dmg, 80% block/slip">Hard</button>
      </div>

      <!-- Top-Left HOW TO PLAY Card -->
      <div class="how-to-play-card" id="how-to-play-card">
        <div class="how-to-play-header">
          <span>🥊 HOW TO PLAY</span>
          <button class="guide-toggle-btn" id="btn-toggle-guide">Hide</button>
        </div>
        <div class="how-to-play-item">
          <span class="guide-icon">🥊</span>
          <div>
            <strong>JAB / CROSS</strong>
            <p>Punch straight forward</p>
          </div>
        </div>
        <div class="how-to-play-item">
          <span class="guide-icon">💥</span>
          <div>
            <strong>BODY BLOW</strong>
            <p>Punch low beneath opponent's elbows</p>
          </div>
        </div>
        <div class="how-to-play-item">
          <span class="guide-icon">🛡️</span>
          <div>
            <strong>GUARD</strong>
            <p>Hold both gloves in front of your chin</p>
          </div>
        </div>
        <div class="how-to-play-item">
          <span class="guide-icon">⚡</span>
          <div>
            <strong>SLIP / DUCK</strong>
            <p>Lean head left or right</p>
          </div>
        </div>
      </div>

      <!-- Top Broadcast Health Bars -->
      <div class="boxing-top-bar">
        <!-- Player 1 -->
        <div class="fighter-gauge-card player">
          <div class="fighter-meta-row">
            <span class="fighter-name cyan">👤 YOU (PLAYER)</span>
            <span class="fighter-hp-num" id="player-hp-text">200 / 200</span>
          </div>
          <div class="health-bar-track">
            <div class="health-bar-buffer" id="player-hp-buffer" style="width: 100%;"></div>
            <div class="health-bar-fill player" id="player-hp-fill" style="width: 100%;"></div>
          </div>
        </div>

        <!-- Center Round & Timer -->
        <div class="round-clock-badge">
          <span class="round-text" id="round-badge-text">ROUND 1 / 3</span>
          <span class="clock-text" id="clock-badge-text">0:50</span>
        </div>

        <!-- Opponent -->
        <div class="fighter-gauge-card opponent">
          <div class="fighter-meta-row">
            <span class="fighter-name red">🤖 IRON TITAN (AI)</span>
            <span class="fighter-hp-num" id="opp-hp-text">200 / 200</span>
          </div>
          <div class="health-bar-track">
            <div class="health-bar-buffer" id="opp-hp-buffer" style="width: 100%;"></div>
            <div class="health-bar-fill opponent" id="opp-hp-fill" style="width: 100%;"></div>
          </div>
        </div>
      </div>

      <!-- 3-Second Round Countdown Banner -->
      <div class="countdown-banner" id="countdown-banner">
        <div class="countdown-round-sub" id="countdown-round-sub">ROUND 1</div>
        <div class="countdown-main-text" id="countdown-main-text">READY...</div>
      </div>

      <!-- Telegraph Warning Banner -->
      <div class="telegraph-warning-banner" id="telegraph-warning-banner">
        <span>⚠️</span> <span id="telegraph-warning-text">INCOMING HOOK — BLOCK OR SLIP!</span>
      </div>

      <!-- Upper Flank Strike Callouts -->
      <div class="callout-badge" id="callout-badge">⚡ LIGHTNING JAB 42 KM/H</div>
      <div class="combo-badge" id="combo-badge">🔥 3x COMBO!</div>

      <!-- Knockdown 10-Count Banner -->
      <div class="knockdown-banner" id="knockdown-banner">
        <div class="knockdown-title">KNOCKDOWN!</div>
        <div class="knockdown-count" id="knockdown-count-num">1</div>
        <div class="knockdown-sub">REFEREE 10-COUNT IN PROGRESS</div>
      </div>

      <!-- Stamina Meter (Bottom Center) -->
      <div class="stamina-wrap">
        <div class="stamina-header">
          <span>STAMINA</span>
          <span id="stamina-num">100%</span>
        </div>
        <div class="stamina-track">
          <div class="stamina-fill" id="stamina-fill" style="width: 100%;"></div>
        </div>
      </div>

      <!-- Bottom Hint Bar -->
      <div class="boxing-controls-legend">
        [R] Restart Match • [C] Toggle Camera • [M] Motion Simulator
      </div>
    `;

    // Cache References
    this.damageVignette = this.rootEl.querySelector('#boxing-vignette') as HTMLElement;
    this.pHealthFill = this.rootEl.querySelector('#player-hp-fill') as HTMLElement;
    this.pHealthBuffer = this.rootEl.querySelector('#player-hp-buffer') as HTMLElement;
    this.pHealthText = this.rootEl.querySelector('#player-hp-text') as HTMLElement;

    this.oHealthFill = this.rootEl.querySelector('#opp-hp-fill') as HTMLElement;
    this.oHealthBuffer = this.rootEl.querySelector('#opp-hp-buffer') as HTMLElement;
    this.oHealthText = this.rootEl.querySelector('#opp-hp-text') as HTMLElement;

    this.roundBadge = this.rootEl.querySelector('#round-badge-text') as HTMLElement;
    this.timerText = this.rootEl.querySelector('#clock-badge-text') as HTMLElement;

    this.staminaFill = this.rootEl.querySelector('#stamina-fill') as HTMLElement;
    this.staminaText = this.rootEl.querySelector('#stamina-num') as HTMLElement;

    this.calloutBadge = this.rootEl.querySelector('#callout-badge') as HTMLElement;
    this.comboBadge = this.rootEl.querySelector('#combo-badge') as HTMLElement;
    this.knockdownBanner = this.rootEl.querySelector('#knockdown-banner') as HTMLElement;
    this.cameraPill = this.rootEl.querySelector('#camera-mode-text') as HTMLElement;
    this.cameraPillContainer = this.rootEl.querySelector('#camera-mode-pill') as HTMLElement;
    this.playerMarkerEl = this.rootEl.querySelector('#fighter-marker-player') as HTMLElement;
    this.opponentMarkerEl = this.rootEl.querySelector('#fighter-marker-opponent') as HTMLElement;

    if (this.cameraPillContainer) {
      this.cameraPillContainer.onclick = (e) => {
        e.stopPropagation();
        if (this.onCameraCycleCallback) {
          this.onCameraCycleCallback();
        }
      };
    }

    // Bind Difficulty Selector Buttons
    const diffBtnNodes = this.rootEl.querySelectorAll('.boxing-diff-btn');
    diffBtnNodes.forEach((node) => {
      const btn = node as HTMLButtonElement;
      const tier = btn.getAttribute('data-tier') as 'starter' | 'medium' | 'hard';
      if (tier) {
        this.diffButtons.set(tier, btn);
        btn.onclick = (e) => {
          e.stopPropagation();
          this.setActiveDifficultyButton(tier);
          if (this.onDifficultyChangeCallback) {
            this.onDifficultyChangeCallback(tier);
          }
        };
      }
    });

    // Countdown & Telegraph & Guide
    const countdownBanner = this.rootEl.querySelector('#countdown-banner') as HTMLElement;
    const countdownRoundSub = this.rootEl.querySelector('#countdown-round-sub') as HTMLElement;
    const countdownMainText = this.rootEl.querySelector('#countdown-main-text') as HTMLElement;
    const telegraphBanner = this.rootEl.querySelector('#telegraph-warning-banner') as HTMLElement;
    const telegraphText = this.rootEl.querySelector('#telegraph-warning-text') as HTMLElement;
    const guideCard = this.rootEl.querySelector('#how-to-play-card') as HTMLElement;
    const btnToggleGuide = this.rootEl.querySelector('#btn-toggle-guide') as HTMLButtonElement;

    this.countdownBanner = countdownBanner;
    this.countdownRoundSub = countdownRoundSub;
    this.countdownMainText = countdownMainText;
    this.telegraphBanner = telegraphBanner;
    this.telegraphText = telegraphText;
    this.guideCard = guideCard;

    if (btnToggleGuide && guideCard) {
      btnToggleGuide.onclick = (e) => {
        e.stopPropagation();
        guideCard.classList.toggle('minimized');
        btnToggleGuide.textContent = guideCard.classList.contains('minimized') ? 'Show' : 'Hide';
      };
    }
  }

  public setActiveDifficultyButton(tier: 'starter' | 'medium' | 'hard'): void {
    this.diffButtons.forEach((btn, key) => {
      btn.classList.toggle('active', key === tier);
    });
  }

  private countdownBanner!: HTMLElement;
  private countdownRoundSub!: HTMLElement;
  private countdownMainText!: HTMLElement;
  private telegraphBanner!: HTMLElement;
  private telegraphText!: HTMLElement;
  private guideCard!: HTMLElement;
  private playerMarkerEl!: HTMLElement;
  private opponentMarkerEl!: HTMLElement;

  public updateFighterMarkers(
    playerScreen: { xPct: number; yPct: number; visible: boolean },
    oppScreen: { xPct: number; yPct: number; visible: boolean }
  ): void {
    if (this.playerMarkerEl) {
      this.playerMarkerEl.style.left = `${playerScreen.xPct.toFixed(1)}%`;
      this.playerMarkerEl.style.top = `${playerScreen.yPct.toFixed(1)}%`;
      this.playerMarkerEl.style.opacity = playerScreen.visible ? '1' : '0';
    }
    if (this.opponentMarkerEl) {
      this.opponentMarkerEl.style.left = `${oppScreen.xPct.toFixed(1)}%`;
      this.opponentMarkerEl.style.top = `${oppScreen.yPct.toFixed(1)}%`;
      this.opponentMarkerEl.style.opacity = oppScreen.visible ? '1' : '0';
    }
  }

  public showCountdown(round: number, text: string): void {
    if (this.countdownBanner) {
      this.countdownBanner.style.display = 'flex';
      if (this.countdownRoundSub) this.countdownRoundSub.textContent = `ROUND ${round}`;
      if (this.countdownMainText) this.countdownMainText.textContent = text;
    }
  }

  public hideCountdown(): void {
    if (this.countdownBanner) {
      this.countdownBanner.style.display = 'none';
      if (this.countdownMainText) this.countdownMainText.textContent = '';
    }
  }

  public showTelegraph(warningText: string): void {
    if (this.telegraphBanner && this.telegraphText) {
      this.telegraphText.textContent = warningText;
      this.telegraphBanner.style.display = 'flex';
    }
  }

  public hideTelegraph(): void {
    if (this.telegraphBanner) {
      this.telegraphBanner.style.display = 'none';
    }
  }

  public update(state: BoxingHUDState): void {
    // 1. Player Health
    const pPct = Math.max(0, Math.min(100, (state.playerHealth / state.maxPlayerHealth) * 100));
    this.pHealthFill.style.width = `${pPct}%`;
    this.pHealthText.textContent = `${Math.ceil(state.playerHealth)} / ${state.maxPlayerHealth}`;

    if (pPct < this.pBufferHealth) {
      setTimeout(() => {
        this.pBufferHealth = pPct;
        this.pHealthBuffer.style.width = `${pPct}%`;
      }, 350);
    } else {
      this.pBufferHealth = pPct;
      this.pHealthBuffer.style.width = `${pPct}%`;
    }

    // 2. Opponent Health
    const oPct = Math.max(0, Math.min(100, (state.opponentHealth / state.maxOpponentHealth) * 100));
    this.oHealthFill.style.width = `${oPct}%`;
    this.oHealthText.textContent = `${Math.ceil(state.opponentHealth)} / ${state.maxOpponentHealth}`;

    if (oPct < this.oBufferHealth) {
      setTimeout(() => {
        this.oBufferHealth = oPct;
        this.oHealthBuffer.style.width = `${oPct}%`;
      }, 350);
    } else {
      this.oBufferHealth = oPct;
      this.oHealthBuffer.style.width = `${oPct}%`;
    }

    // 3. Stamina
    const sPct = Math.max(0, Math.min(100, state.stamina));
    this.staminaFill.style.width = `${sPct}%`;
    this.staminaText.textContent = `${Math.round(sPct)}%`;

    // 4. Round & Clock
    this.roundBadge.textContent = `ROUND ${state.round} / ${state.maxRounds}`;
    const mins = Math.floor(state.roundTimeLeft / 60);
    const secs = Math.floor(state.roundTimeLeft % 60);
    this.timerText.textContent = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

    // 5. Camera mode pill
    const camLabels: Record<string, string> = {
      classic_side: 'Classic Side Cam [C]',
      wide_arena: 'Wide Arena Cam [C]',
      fighter_pov: 'Fighter POV Cam [C]',
      arcade_ots: 'Classic Side Cam [C]',
      ringside: 'Wide Arena Cam [C]',
      first_person: 'Fighter POV Cam [C]',
    };
    this.cameraPill.textContent = camLabels[state.cameraPreset] || 'Classic Side Cam [C]';

    // 6. Difficulty buttons
    if (state.difficulty) {
      this.setActiveDifficultyButton(state.difficulty);
    }
  }

  public showCallout(badgeText: string, color = '#ffd700'): void {
    if (this.calloutTimer) clearTimeout(this.calloutTimer);
    this.calloutBadge.textContent = badgeText;
    this.calloutBadge.style.borderColor = color;
    this.calloutBadge.style.boxShadow = `0 0 24px ${color}88`;
    this.calloutBadge.classList.add('active');

    this.calloutTimer = setTimeout(() => {
      this.calloutBadge.classList.remove('active');
    }, 1100);
  }

  public showCombo(count: number): void {
    if (count <= 1) {
      this.comboBadge.classList.remove('active');
      return;
    }
    if (this.comboTimer) clearTimeout(this.comboTimer);

    const labels: Record<number, string> = {
      2: '🔥 2x COMBO!',
      3: '💥 3x COMBO!',
      4: '⚡ 4x MEGA COMBO!',
      5: '👑 5x ULTRA COMBO!',
    };
    this.comboBadge.textContent = labels[count] || `👑 ${count}x ULTRA COMBO!`;
    this.comboBadge.classList.add('active');

    this.comboTimer = setTimeout(() => {
      this.comboBadge.classList.remove('active');
    }, 1200);
  }

  public triggerPlayerDamageFlash(): void {
    this.damageVignette.classList.add('hit');
    setTimeout(() => {
      this.damageVignette.classList.remove('hit');
    }, 120);
  }

  public showKnockdownCount(count: number): void {
    this.knockdownBanner.style.display = 'flex';
    const numEl = this.knockdownBanner.querySelector('#knockdown-count-num');
    if (numEl) numEl.textContent = `${count}`;
  }

  public hideKnockdown(): void {
    this.knockdownBanner.style.display = 'none';
  }

  public destroy(): void {
    if (this.calloutTimer) clearTimeout(this.calloutTimer);
    if (this.comboTimer) clearTimeout(this.comboTimer);
    this.rootEl.remove();
  }
}
