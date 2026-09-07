import { GameSceneManager } from '../core/scene/GameSceneManager';
import { PoseTracker } from '../core/motion/PoseTracker';
import { SoundSynthesizer } from '../core/audio/SoundSynthesizer';
import { GameModeId, OpponentMode, DifficultyLevel } from '../core/motion/Types';

export interface MatchSelectionConfig {
  sport: GameModeId;
  opponent: OpponentMode;
  difficulty: DifficultyLevel;
  targetScore: number;
  useWebcam: boolean;
}

export class MainMenuUI {
  private container: HTMLElement;
  private sceneManager: GameSceneManager;
  private tracker: PoseTracker;
  private audio: SoundSynthesizer;
  private getVideoElementFn: () => HTMLVideoElement;
  private onMatchStartCallback?: (config: MatchSelectionConfig) => void;

  private overlayEl!: HTMLElement;

  // Selected State
  private selectedSport: GameModeId = 'badminton';
  private selectedOpponent: OpponentMode = 'system';
  private selectedDifficulty: DifficultyLevel = 'casual';
  private selectedTargetScore: number = 11;
  private useWebcam: boolean = true;

  // UI Button Maps
  private sportCards: Map<GameModeId, HTMLElement> = new Map();
  private opponentBtns: Map<OpponentMode, HTMLElement> = new Map();
  private diffBtns: Map<DifficultyLevel, HTMLElement> = new Map();
  private targetBtns: Map<number, HTMLElement> = new Map();
  private trackingBtns: Map<string, HTMLElement> = new Map();

  constructor(
    container: HTMLElement,
    sceneManager: GameSceneManager,
    tracker: PoseTracker,
    audio: SoundSynthesizer,
    getVideoElementFn: () => HTMLVideoElement
  ) {
    this.container = container;
    this.sceneManager = sceneManager;
    this.tracker = tracker;
    this.audio = audio;
    this.getVideoElementFn = getVideoElementFn;

    this.buildDOM();
  }

  public setOnMatchStart(callback: (config: MatchSelectionConfig) => void): void {
    this.onMatchStartCallback = callback;
  }

  public show(): void {
    this.overlayEl.style.display = 'flex';
    this.overlayEl.classList.remove('hiding');
    // Hide in-game score wrapper while main menu is active
    const scoreWrapper = document.querySelector('.score-wrapper') as HTMLElement;
    if (scoreWrapper) scoreWrapper.style.display = 'none';
  }

  public hide(): void {
    this.overlayEl.classList.add('hiding');
    setTimeout(() => {
      this.overlayEl.style.display = 'none';
      this.overlayEl.classList.remove('hiding');
    }, 300);
    // Show in-game score wrapper when leaving main menu
    const scoreWrapper = document.querySelector('.score-wrapper') as HTMLElement;
    if (scoreWrapper) scoreWrapper.style.display = 'flex';
  }

  public isVisible(): boolean {
    return this.overlayEl.style.display !== 'none';
  }

  private buildDOM(): void {
    this.overlayEl = document.createElement('div');
    this.overlayEl.className = 'main-menu-overlay';
    this.overlayEl.id = 'main-menu-overlay';

    this.overlayEl.innerHTML = `
      <div class="menu-particles"></div>
      <div class="menu-modal glass-panel">
        
        <!-- Header & Branding -->
        <header class="menu-header">
          <div class="menu-badge-row">
            <span class="menu-pill-badge">AI SENSOR ENGINE</span>
            <span class="menu-pill-badge cyan">WEBCAM 3D TRACKING</span>
          </div>
          <h1 class="menu-title">CAMARENA</h1>
          <p class="menu-tagline">Step into the court. Your webcam is your controller — swing with real-time racket and paddle physics.</p>
        </header>

        <!-- 1. SPORT SELECTION CARDS -->
        <section class="menu-section">
          <div class="section-label-row">
            <span class="section-number">01</span>
            <span class="section-title">SELECT SPORT</span>
          </div>
          <div class="sport-grid">
            
            <div class="sport-card active" data-sport="badminton">
              <div class="sport-card-glow"></div>
              <div class="sport-icon-wrap">
                <span class="sport-icon">🏸</span>
              </div>
              <div class="sport-info">
                <div class="sport-name-row">
                  <h3 class="sport-name">Badminton 3D</h3>
                  <span class="sport-status-badge">HIGH VELOCITY</span>
                </div>
                <p class="sport-desc">High-altitude smashes, drop shots, court mobility, and realistic 3D shuttlecock drag physics.</p>
                <div class="sport-equipment-preview">
                  <span class="equip-dot"></span> Virtual Isometric Racket on Hand
                </div>
              </div>
            </div>

            <div class="sport-card" data-sport="tabletennis">
              <div class="sport-card-glow"></div>
              <div class="sport-icon-wrap">
                <span class="sport-icon">🏓</span>
              </div>
              <div class="sport-info">
                <div class="sport-name-row">
                  <h3 class="sport-name">Table Tennis 3D</h3>
                  <span class="sport-status-badge pingpong">RAPID VOLLEY</span>
                </div>
                <p class="sport-desc">Lightning-fast table bounces, curved topspin deflections, and precision angle paddle placement.</p>
                <div class="sport-equipment-preview">
                  <span class="equip-dot pingpong"></span> Virtual Rubber Blade Paddle on Hand
                </div>
              </div>
            </div>

            <div class="sport-card" data-sport="sandbox">
              <div class="sport-card-glow"></div>
              <div class="sport-icon-wrap">
                <span class="sport-icon">🪞</span>
              </div>
              <div class="sport-info">
                <div class="sport-name-row">
                  <h3 class="sport-name">Motion Mirror</h3>
                  <span class="sport-status-badge sandbox">CALIBRATION</span>
                </div>
                <p class="sport-desc">Freeform movement calibration chamber with live 3D joint rig and stroke speed telemetry.</p>
                <div class="sport-equipment-preview">
                  <span class="equip-dot sandbox"></span> Full-Body Kinematic Skeleton
                </div>
              </div>
            </div>

          </div>
        </section>

        <!-- 2. GAME MODE & RULES SETTINGS -->
        <section class="menu-section config-section">
          
          <div class="config-column">
            <div class="section-label-row">
              <span class="section-number">02</span>
              <span class="section-title">OPPONENT & FORMAT</span>
            </div>

            <div class="config-group">
              <label class="config-label">MATCH OPPONENT</label>
              <div class="btn-toggle-row opponent-toggles">
                <button class="config-btn active" data-opp="system">
                  <span class="btn-icon">🤖</span>
                  <div class="btn-text">
                    <strong>Vs. System (AI)</strong>
                    <small>Reactive computer opponent</small>
                  </div>
                </button>
                <button class="config-btn" data-opp="pvp">
                  <span class="btn-icon">👥</span>
                  <div class="btn-text">
                    <strong>2-Player (PvP)</strong>
                    <small>Shared webcam duel</small>
                  </div>
                </button>
                <button class="config-btn" data-opp="practice">
                  <span class="btn-icon">🎯</span>
                  <div class="btn-text">
                    <strong>Free Practice</strong>
                    <small>Endless rally trainer</small>
                  </div>
                </button>
              </div>
            </div>

            <div class="config-group">
              <label class="config-label">SCORING TARGET (WIN BY 2)</label>
              <div class="btn-toggle-row target-toggles">
                <button class="config-btn active" data-target="11">
                  <strong>11 Points</strong>
                  <small>Quick Match</small>
                </button>
                <button class="config-btn" data-target="21">
                  <strong>21 Points</strong>
                  <small>Official Tournament</small>
                </button>
              </div>
            </div>
          </div>

          <div class="config-column">
            <div class="section-label-row">
              <span class="section-number">03</span>
              <span class="section-title">DIFFICULTY & TRACKING</span>
            </div>

            <div class="config-group">
              <label class="config-label">AI REACTION LEVEL</label>
              <div class="btn-toggle-row diff-toggles">
                <button class="config-btn active" data-diff="casual">
                  <strong>Casual</strong>
                  <small>Wide hitbox, relaxed pace</small>
                </button>
                <button class="config-btn" data-diff="pro">
                  <strong>Pro</strong>
                  <small>Fast rallies, deeper shots</small>
                </button>
                <button class="config-btn" data-diff="legend">
                  <strong>Legend 🔥</strong>
                  <small>Smash counters & tight angles</small>
                </button>
              </div>
            </div>

            <div class="config-group">
              <label class="config-label">TRACKING CONTROLLER</label>
              <div class="btn-toggle-row tracking-toggles">
                <button class="config-btn active" data-tracking="webcam">
                  <span class="btn-icon">📹</span>
                  <div class="btn-text">
                    <strong>Live Webcam (Recommended)</strong>
                    <small>Full body motion & hand equipment</small>
                  </div>
                </button>
                <button class="config-btn" data-tracking="synthetic">
                  <span class="btn-icon">🤖</span>
                  <div class="btn-text">
                    <strong>Motion Simulator</strong>
                    <small>Automatic 60FPS motion stream</small>
                  </div>
                </button>
              </div>
            </div>
          </div>

        </section>

        <!-- 3. LAUNCH FOOTER -->
        <footer class="menu-footer">
          <div class="menu-rules-reminder" id="menu-rules-summary">
            📋 Selected: <strong>Badminton 3D</strong> • Vs. AI (Casual) • Target: 11 pts (Win by 2)
          </div>
          <button class="launch-btn" id="btn-launch-match">
            <span class="launch-glow"></span>
            <span class="launch-icon">🚀</span>
            <span class="launch-text">START MATCH</span>
          </button>
        </footer>

      </div>
    `;

    this.container.appendChild(this.overlayEl);

    this.bindDOMEvents();
    this.updateSummaryText();
  }

  private bindDOMEvents(): void {
    // 1. Sport Selection Cards
    const sportElements = this.overlayEl.querySelectorAll('.sport-card');
    sportElements.forEach((el) => {
      const sportId = el.getAttribute('data-sport') as GameModeId;
      this.sportCards.set(sportId, el as HTMLElement);
      el.addEventListener('click', () => {
        this.selectSport(sportId);
      });
    });

    // 2. Opponent Mode
    const oppElements = this.overlayEl.querySelectorAll('.opponent-toggles .config-btn');
    oppElements.forEach((el) => {
      const mode = el.getAttribute('data-opp') as OpponentMode;
      this.opponentBtns.set(mode, el as HTMLElement);
      el.addEventListener('click', () => {
        this.selectOpponent(mode);
      });
    });

    // 3. Difficulty
    const diffElements = this.overlayEl.querySelectorAll('.diff-toggles .config-btn');
    diffElements.forEach((el) => {
      const diff = el.getAttribute('data-diff') as DifficultyLevel;
      this.diffBtns.set(diff, el as HTMLElement);
      el.addEventListener('click', () => {
        this.selectDifficulty(diff);
      });
    });

    // 4. Target Score
    const targetElements = this.overlayEl.querySelectorAll('.target-toggles .config-btn');
    targetElements.forEach((el) => {
      const score = parseInt(el.getAttribute('data-target') || '11', 10);
      this.targetBtns.set(score, el as HTMLElement);
      el.addEventListener('click', () => {
        this.selectTargetScore(score);
      });
    });

    // 5. Tracking Mode
    const trackingElements = this.overlayEl.querySelectorAll('.tracking-toggles .config-btn');
    trackingElements.forEach((el) => {
      const mode = el.getAttribute('data-tracking')!;
      this.trackingBtns.set(mode, el as HTMLElement);
      el.addEventListener('click', () => {
        this.selectTracking(mode === 'webcam');
      });
    });

    // 6. Launch Button
    const launchBtn = this.overlayEl.querySelector('#btn-launch-match') as HTMLButtonElement;
    launchBtn.addEventListener('click', async () => {
      await this.launchMatch();
    });
  }

  private selectSport(sport: GameModeId): void {
    this.selectedSport = sport;
    for (const [id, el] of this.sportCards) {
      if (id === sport) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    }
    this.audio.tableTennisBounce(true);
    this.updateSummaryText();
  }

  private selectOpponent(opp: OpponentMode): void {
    this.selectedOpponent = opp;
    for (const [id, el] of this.opponentBtns) {
      if (id === opp) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    }
    this.audio.tableTennisBounce(false);
    this.updateSummaryText();
  }

  private selectDifficulty(diff: DifficultyLevel): void {
    this.selectedDifficulty = diff;
    for (const [id, el] of this.diffBtns) {
      if (id === diff) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    }
    this.audio.tableTennisBounce(false);
    this.updateSummaryText();
  }

  private selectTargetScore(score: number): void {
    this.selectedTargetScore = score;
    for (const [id, el] of this.targetBtns) {
      if (id === score) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    }
    this.audio.tableTennisBounce(true);
    this.updateSummaryText();
  }

  private selectTracking(useWebcam: boolean): void {
    this.useWebcam = useWebcam;
    const modeStr = useWebcam ? 'webcam' : 'synthetic';
    for (const [id, el] of this.trackingBtns) {
      if (id === modeStr) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    }
    this.audio.tableTennisBounce(true);
    this.updateSummaryText();
  }

  private updateSummaryText(): void {
    const summary = this.overlayEl.querySelector('#menu-rules-summary');
    if (!summary) return;

    const sportLabel =
      this.selectedSport === 'badminton'
        ? 'Badminton 3D'
        : this.selectedSport === 'tabletennis'
        ? 'Table Tennis 3D'
        : 'Motion Sandbox';

    const oppLabel =
      this.selectedOpponent === 'system'
        ? `Vs. AI (${this.selectedDifficulty.toUpperCase()})`
        : this.selectedOpponent === 'pvp'
        ? '2-Player (PvP)'
        : 'Free Practice';

    const trackLabel = this.useWebcam ? 'Webcam Pose Tracking' : 'Motion Simulator';

    summary.innerHTML = `
      📋 Selected: <strong>${sportLabel}</strong> • ${oppLabel} • Target: <strong>${this.selectedTargetScore} pts</strong> (Win by 2) • ${trackLabel}
    `;
  }

  public async launchMatch(): Promise<void> {
    const launchBtn = this.overlayEl.querySelector('#btn-launch-match') as HTMLButtonElement;
    if (launchBtn) {
      launchBtn.disabled = true;
      launchBtn.innerHTML = '<span class="launch-icon">⏳</span><span>INITIALIZING MATCH...</span>';
    }

    this.audio.badmintonSmash();

    const config: MatchSelectionConfig = {
      sport: this.selectedSport,
      opponent: this.selectedOpponent,
      difficulty: this.selectedDifficulty,
      targetScore: this.selectedTargetScore,
      useWebcam: this.useWebcam
    };

    // 1. Configure Scene Manager settings
    this.sceneManager.setOpponentMode(config.opponent);
    this.sceneManager.setDifficulty(config.difficulty);
    this.sceneManager.setTargetScore(config.targetScore);

    // 2. Initialize tracking & camera if webcam selected
    const videoEl = this.getVideoElementFn();
    await this.tracker.init(videoEl);

    if (config.useWebcam) {
      await this.tracker.startWebcam();
    } else {
      this.tracker.setTrackingMode('synthetic');
    }

    // 3. Switch to the selected game scene
    await this.sceneManager.switchScene(config.sport);

    // 4. Update top nav tab buttons
    const navTabs = document.querySelectorAll('.game-tab-btn');
    navTabs.forEach((tab) => {
      const isCurrent = tab.textContent?.toLowerCase().includes(
        config.sport === 'badminton' ? 'badminton' : config.sport === 'tabletennis' ? 'table tennis' : 'motion mirror'
      );
      if (isCurrent) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });

    // 5. Hide main menu overlay
    this.hide();

    if (launchBtn) {
      launchBtn.disabled = false;
      launchBtn.innerHTML = `
        <span class="launch-glow"></span>
        <span class="launch-icon">🚀</span>
        <span class="launch-text">START MATCH</span>
      `;
    }

    if (this.onMatchStartCallback) {
      this.onMatchStartCallback(config);
    }
  }
}
