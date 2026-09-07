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
  }

  private buildDOM(): void {
    const nav = document.createElement('nav');
    nav.className = 'top-nav glass-panel';

    // 1. Brand Section
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
    nav.appendChild(brand);

    // 1b. Main Menu Launcher Button
    const mainMenuBtn = document.createElement('button');
    mainMenuBtn.className = 'icon-btn menu-launcher-btn';
    mainMenuBtn.id = 'btn-nav-main-menu';
    mainMenuBtn.innerHTML = '<span>🏠</span><span>Main Menu</span>';
    mainMenuBtn.title = 'Open Game & Sport Selection Menu';
    mainMenuBtn.onclick = () => {
      window.dispatchEvent(new CustomEvent('open-main-menu'));
    };
    nav.appendChild(mainMenuBtn);

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
    };
    controls.appendChild(oppSelect);

    // Match Length / Target Score Selector
    const targetSelect = document.createElement('select');
    targetSelect.className = 'control-select';
    targetSelect.innerHTML = `
      <option value="11">Target: 11 Pts (Quick Match)</option>
      <option value="21">Target: 21 Pts (Official BWF/ITTF)</option>
    `;
    targetSelect.onchange = (e) => {
      const target = parseInt((e.target as HTMLSelectElement).value, 10);
      this.sceneManager.setTargetScore(target);
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
    };
    controls.appendChild(diffSelect);

    // Dedicated Game Pause Button
    const pauseBtn = document.createElement('button');
    pauseBtn.className = 'icon-btn pause-nav-btn';
    pauseBtn.id = 'btn-nav-pause';
    pauseBtn.innerHTML = '<span>⏸</span><span>Pause [Esc]</span>';
    pauseBtn.onclick = () => {
      this.sceneManager.togglePause();
    };
    this.sceneManager.onPauseChange((isPaused) => {
      if (isPaused) {
        pauseBtn.innerHTML = '<span>▶</span><span>Resume [Esc]</span>';
        pauseBtn.classList.add('paused-active');
      } else {
        pauseBtn.innerHTML = '<span>⏸</span><span>Pause [Esc]</span>';
        pauseBtn.classList.remove('paused-active');
      }
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
      this.sceneManager.resetCurrentGame();
    };
    controls.appendChild(resetBtn);

    nav.appendChild(controls);
    this.container.appendChild(nav);
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

