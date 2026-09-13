import { GameSceneManager } from '../core/scene/GameSceneManager';
import { PoseTracker } from '../core/motion/PoseTracker';
import { SoundSynthesizer } from '../core/audio/SoundSynthesizer';
import { GameModeId, OpponentMode, DifficultyLevel } from '../core/motion/Types';

export class MenuUI {
  private container: HTMLElement;
  private sceneManager: GameSceneManager;
  private tracker: PoseTracker;
  private audio: SoundSynthesizer;

  private tabButtons: Map<GameModeId, HTMLElement> = new Map();
  private cameraBtn!: HTMLButtonElement;
  private soundBtn!: HTMLButtonElement;
  private navEl!: HTMLElement;
  private currentSportPill!: HTMLElement;
  private chipMode!: HTMLElement;
  private chipTarget!: HTMLElement;
  private chipTier!: HTMLElement;

  private isPaused = false;
  private isGameOver = false;
  private isMainMenuOpen = false;

  constructor(
    container: HTMLElement,
    sceneManager: GameSceneManager,
    tracker: PoseTracker,
    audio: SoundSynthesizer
  ) {
    this.container = container;
    this.sceneManager = sceneManager;
    this.tracker = tracker;
    this.audio = audio;

    this.buildDOM();
    this.bindStateListeners();
  }

  private buildDOM(): void {
    const nav = document.createElement('nav');
    nav.className = 'top-nav glass-panel';
    this.navEl = nav;

    // 1. Left Cluster (Brand + Main Menu Launcher)
    const leftCluster = document.createElement('div');
    leftCluster.className = 'nav-left-cluster';

    const brand = document.createElement('div');
    brand.className = 'brand-section';
    const badge = document.createElement('span');
    badge.className = 'brand-badge';
    badge.textContent = 'MOTION 3D';
    const title = document.createElement('h1');
    title.className = 'brand-title';
    title.textContent = 'CamArena';
    brand.appendChild(badge);
    brand.appendChild(title);
    leftCluster.appendChild(brand);

    const mainMenuBtn = document.createElement('button');
    mainMenuBtn.className = 'icon-btn menu-launcher-btn';
    mainMenuBtn.id = 'btn-nav-main-menu';
    mainMenuBtn.innerHTML = '<span>🏠</span><span>Main Menu</span>';
    mainMenuBtn.title = 'Open Game & Sport Selection Menu';
    mainMenuBtn.onclick = () => {
      window.dispatchEvent(new CustomEvent('open-main-menu'));
    };
    leftCluster.appendChild(mainMenuBtn);
    nav.appendChild(leftCluster);

    // 1c. Current Sport Pill (shown in active match)
    this.currentSportPill = document.createElement('div');
    this.currentSportPill.className = 'current-sport-pill';
    this.currentSportPill.innerHTML = '<span class="sport-icon">🏸</span><span class="sport-name">BADMINTON 3D</span>';
    nav.appendChild(this.currentSportPill);

    // 2. Game Mode Tabs
    const tabs = document.createElement('div');
    tabs.className = 'game-tabs';

    const gameOptions: { id: GameModeId; label: string; icon: string }[] = [
      { id: 'badminton', label: 'Badminton 3D', icon: '🏸' },
      { id: 'tabletennis', label: 'Table Tennis 3D', icon: '🏓' },
      { id: 'sandbox', label: 'Motion Mirror', icon: '🪞' }
    ];

    for (const opt of gameOptions) {
      const btn = document.createElement('button');
      btn.className = `game-tab-btn ${opt.id === 'badminton' ? 'active' : ''}`;
      btn.innerHTML = `<span>${opt.icon}</span><span>${opt.label}</span>`;
      btn.onclick = () => {
        this.selectGame(opt.id);
      };
      tabs.appendChild(btn);
      this.tabButtons.set(opt.id, btn);
    }
    nav.appendChild(tabs);

    // 3. Opponent & Difficulty Controls
    const controls = document.createElement('div');
    controls.className = 'nav-controls';

    // Opponent Mode Selector (PvS, PvP, Practice)
    const oppSelect = document.createElement('select');
    oppSelect.className = 'control-select';
    oppSelect.innerHTML = `
      <option value="system">🤖 Player vs. System (AI)</option>
      <option value="pvp">👥 Player vs. Player (PvP)</option>
      <option value="practice">🎯 Free Practice</option>
    `;
    oppSelect.onchange = (e) => {
      const mode = (e.target as HTMLSelectElement).value as OpponentMode;
      this.sceneManager.setOpponentMode(mode);
      this.updateMetaChips();
    };
    controls.appendChild(oppSelect);

    // Match Length / Target Score Selector
    const targetSelect = document.createElement('select');
    targetSelect.className = 'control-select';
    targetSelect.innerHTML = `
      <option value="5">Target: 5 Pts (Blitz Match)</option>
      <option value="11">Target: 11 Pts (Quick Match)</option>
      <option value="21">Target: 21 Pts (Official BWF/ITTF)</option>
    `;
    targetSelect.onchange = (e) => {
      const target = parseInt((e.target as HTMLSelectElement).value, 10);
      this.sceneManager.setTargetScore(target);
      this.updateMetaChips();
    };
    controls.appendChild(targetSelect);

    // AI Difficulty Selector
    const diffSelect = document.createElement('select');
    diffSelect.className = 'control-select';
    diffSelect.innerHTML = `
      <option value="casual">Tier: Casual</option>
      <option value="pro">Tier: Pro</option>
      <option value="legend">Tier: Legend 🔥</option>
    `;
    diffSelect.onchange = (e) => {
      const diff = (e.target as HTMLSelectElement).value as DifficultyLevel;
      this.sceneManager.setDifficulty(diff);
      this.updateMetaChips();
    };
    // Dominant Hand Selector (Right-Handed default / Left-Handed)
    const handSelect = document.createElement('select');
    handSelect.className = 'control-select';
    handSelect.innerHTML = `
      <option value="right">🏸 Hand: Right (Default)</option>
      <option value="left">🏸 Hand: Left</option>
    `;
    handSelect.value = this.sceneManager.getDominantHand();
    handSelect.onchange = (e) => {
      const hand = (e.target as HTMLSelectElement).value as 'right' | 'left';
      this.sceneManager.setDominantHand(hand);
      this.tracker.setDominantHand(hand);
      this.updateMetaChips();
    };
    controls.appendChild(handSelect);

    // In-Match Metadata Chips (Compact display in top-right)
    const metaChips = document.createElement('div');
    metaChips.className = 'match-meta-chips';

    this.chipMode = document.createElement('span');
    this.chipMode.className = 'meta-chip highlight';
    this.chipMode.textContent = 'VS. AI';

    this.chipTarget = document.createElement('span');
    this.chipTarget.className = 'meta-chip';
    this.chipTarget.textContent = '11 PTS';

    this.chipTier = document.createElement('span');
    this.chipTier.className = 'meta-chip';
    this.chipTier.textContent = 'CASUAL';

    metaChips.appendChild(this.chipMode);
    metaChips.appendChild(this.chipTarget);
    metaChips.appendChild(this.chipTier);
    controls.appendChild(metaChips);

    // Dedicated Game Pause Button
    const pauseBtn = document.createElement('button');
    pauseBtn.className = 'icon-btn pause-nav-btn';
    pauseBtn.id = 'btn-nav-pause';
    pauseBtn.innerHTML = '<span>⏸</span><span>Pause [Esc]</span>';
    pauseBtn.onclick = () => {
      this.sceneManager.togglePause();
    };
    this.sceneManager.onPauseChange((isPaused) => {
      this.isPaused = isPaused;
      if (isPaused) {
        pauseBtn.innerHTML = '<span>▶</span><span>Resume [Esc]</span>';
        pauseBtn.classList.add('paused-active');
      } else {
        pauseBtn.innerHTML = '<span>⏸</span><span>Pause [Esc]</span>';
        pauseBtn.classList.remove('paused-active');
      }
      this.updateInMatchState();
    });
    controls.appendChild(pauseBtn);

    // Rules Guide Trigger Button
    const rulesNavBtn = document.createElement('button');
    rulesNavBtn.className = 'icon-btn';
    rulesNavBtn.innerHTML = '<span>📖</span><span>Rules</span>';
    rulesNavBtn.onclick = () => {
      const rulesModal = document.querySelector('.rules-overlay') as HTMLElement;
      if (rulesModal) {
        rulesModal.style.display = 'flex';
      }
    };
    controls.appendChild(rulesNavBtn);

    // Camera / Simulator Switcher
    this.cameraBtn = document.createElement('button');
    this.cameraBtn.className = 'icon-btn primary';
    this.cameraBtn.innerHTML = '<span>📹</span><span>Enable Camera</span>';
    this.cameraBtn.onclick = async () => {
      if (this.tracker.getTrackingMode() === 'webcam') {
        this.tracker.setTrackingMode('synthetic');
        this.cameraBtn.innerHTML = '<span>🤖</span><span>Simulator Active</span>';
        this.cameraBtn.classList.remove('primary');
      } else {
        const success = await this.tracker.startWebcam();
        if (success) {
          this.cameraBtn.innerHTML = '<span>📹</span><span>Camera Active</span>';
          this.cameraBtn.classList.add('primary');
        } else {
          this.cameraBtn.innerHTML = '<span>🤖</span><span>Simulator Active</span>';
          this.cameraBtn.classList.remove('primary');
        }
      }
    };
    controls.appendChild(this.cameraBtn);

    // Audio Mute Toggle
    this.soundBtn = document.createElement('button');
    this.soundBtn.className = 'icon-btn';
    this.soundBtn.innerHTML = '<span>🔊</span>';
    this.soundBtn.onclick = () => {
      const isMuted = !this.audio.getIsMuted();
      this.audio.setMuted(isMuted);
      this.soundBtn.innerHTML = isMuted ? '<span>🔇</span>' : '<span>🔊</span>';
    };
    controls.appendChild(this.soundBtn);

    // Match Reset Button
    const resetBtn = document.createElement('button');
    resetBtn.className = 'icon-btn';
    resetBtn.innerHTML = '<span>🔄</span><span>Reset</span>';
    resetBtn.onclick = () => {
      this.isGameOver = false;
      this.sceneManager.resetCurrentGame();
      this.updateInMatchState();
    };
    controls.appendChild(resetBtn);

    nav.appendChild(controls);
    this.container.appendChild(nav);
  }

  private bindStateListeners(): void {
    // Listen to scene switches to update sport pill and tabs
    this.sceneManager.onSceneChange((sceneId) => {
      this.isGameOver = false;
      this.updateSportPill(sceneId);
      this.updateInMatchState();
    });

    // Listen to score changes to detect match end
    this.sceneManager.onScoreChange((score) => {
      this.isGameOver = Boolean(score.isGameOver);
      this.updateInMatchState();
    });

    // Listen to main menu dialog open/close events
    window.addEventListener('open-main-menu', () => {
      this.isMainMenuOpen = true;
      this.updateInMatchState();
    });

    window.addEventListener('close-main-menu', () => {
      this.isMainMenuOpen = false;
      this.updateInMatchState();
    });

    this.updateMetaChips();
    this.updateInMatchState();
  }

  private updateSportPill(sceneId: GameModeId): void {
    if (!this.currentSportPill) return;
    if (sceneId === 'badminton') {
      this.currentSportPill.innerHTML = '<span class="sport-icon">🏸</span><span class="sport-name">BADMINTON 3D</span>';
    } else if (sceneId === 'tabletennis') {
      this.currentSportPill.innerHTML = '<span class="sport-icon">🏓</span><span class="sport-name">TABLE TENNIS 3D</span>';
    } else {
      this.currentSportPill.innerHTML = '<span class="sport-icon">🪞</span><span class="sport-name">MOTION MIRROR</span>';
    }
  }

  private updateMetaChips(): void {
    if (!this.chipMode) return;
    const mode = this.sceneManager.getOpponentMode();
    this.chipMode.textContent = mode === 'system' ? 'VS. AI' : mode === 'pvp' ? 'PVP' : 'PRACTICE';

    const target = this.sceneManager.getTargetScore();
    this.chipTarget.textContent = `${target} PTS`;

    const diff = this.sceneManager.getDifficulty();
    this.chipTier.textContent = diff.toUpperCase();
  }

  /**
   * Toggles the clean in-match broadcast bar vs. the full navigation/controls bar.
   * When match ends or when pressing Esc to pause, game-tabs and navigation buttons
   * cleanly restore their visibility so the player is never trapped.
   */
  private updateInMatchState(): void {
    if (!this.navEl) return;
    const activeId = this.sceneManager.getActiveSceneId();
    const isCompetitive = activeId === 'badminton' || activeId === 'tabletennis';

    const shouldBeInMatch = isCompetitive && !this.isPaused && !this.isGameOver && !this.isMainMenuOpen;

    if (shouldBeInMatch) {
      this.navEl.classList.add('in-match');
    } else {
      this.navEl.classList.remove('in-match');
    }
  }

  public selectGame(gameId: GameModeId): void {
    for (const [id, btn] of this.tabButtons) {
      if (id === gameId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    }
    this.sceneManager.switchScene(gameId);
  }
}

