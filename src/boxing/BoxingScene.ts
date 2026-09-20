import * as THREE from 'three';
import { IGameScene, GameScoreState } from '../common/IGameScene';
import { GameModeId, OpponentMode, DifficultyLevel, MotionFrame, ActionEvent } from '../common/Types';
import { SoundSynthesizer } from '../util/audio/SoundSynthesizer';

export class BoxingScene implements IGameScene {
  public readonly id: GameModeId = 'boxing';
  public readonly title = 'Fitness Boxing';

  private container!: HTMLElement;
  private audio!: SoundSynthesizer;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private animFrameId = 0;

  private scoreState: GameScoreState = {
    player1Score: 0,
    player2Score: 0,
    currentServer: 1,
    rallyCount: 0,
    isGameOver: false,
    winner: null,
    lastPointWinner: null,
    targetScore: 11,
    winByTwo: true,
    gameModeTitle: 'Fitness Boxing',
  };
  private scoreCallbacks: ((s: GameScoreState) => void)[] = [];

  init(container: HTMLElement, audio: SoundSynthesizer): void {
    this.container = container;
    this.audio = audio;
    this.buildScene();
  }

  private buildScene(): void {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a0000);
    this.scene.fog = new THREE.FogExp2(0x1a0000, 0.06);

    this.camera = new THREE.PerspectiveCamera(60, this.container.clientWidth / this.container.clientHeight, 0.1, 200);
    this.camera.position.set(0, 1.6, 5);

    // Ambient + Ring lights
    this.scene.add(new THREE.AmbientLight(0xff4444, 0.3));
    const spotL = new THREE.SpotLight(0xffffff, 3, 20, Math.PI / 6);
    spotL.position.set(0, 8, 0);
    this.scene.add(spotL);

    // Ring floor
    const ringGeo = new THREE.PlaneGeometry(8, 8);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0xcc2222 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    this.scene.add(ring);

    // Coming Soon overlay
    this.buildComingSoonOverlay('🥊', 'Fitness Boxing', 'Phase 2 — Target-Pad Combos', 'Track your jabs, crosses, hooks & uppercuts\nwith full-body pose detection');
  }

  private buildComingSoonOverlay(icon: string, title: string, phase: string, desc: string): void {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center;
      justify-content: center; z-index: 10; background: rgba(15, 0, 0, 0.75); backdrop-filter: blur(8px);
      font-family: 'Outfit', 'Inter', sans-serif; color: #fff; text-align: center; padding: 2rem;
    `;
    overlay.innerHTML = `
      <div style="font-size: 5rem; margin-bottom: 1rem; animation: pulse 2s ease-in-out infinite;">${icon}</div>
      <h2 style="font-size: 2.5rem; font-weight: 800; background: linear-gradient(135deg, #ff4444, #ff8844); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin: 0 0 0.5rem;">${title}</h2>
      <div style="font-size: 0.85rem; letter-spacing: 3px; color: #ff6644; margin-bottom: 1.5rem; font-weight: 600;">${phase}</div>
      <p style="max-width: 420px; line-height: 1.7; color: rgba(255,255,255,0.7); font-size: 1rem; white-space: pre-line;">${desc}</p>
      <div style="margin-top: 2rem; padding: 0.6rem 2rem; border: 1px solid rgba(255,68,68,0.4); border-radius: 999px; color: #ff6644; font-size: 0.8rem; letter-spacing: 2px;">🚧 COMING IN PHASE 2</div>
    `;
    this.container.appendChild(overlay);
  }

  start(): void {}
  pause(): void {}
  resume(): void {}
  reset(): void {}

  update(_dt: number, _frame: MotionFrame | null): void {
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  onAction(_event: ActionEvent): void {}

  onResize(width: number, height: number): void {
    if (this.renderer) this.renderer.setSize(width, height);
    if (this.camera) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
  }

  getScore(): GameScoreState { return { ...this.scoreState }; }

  onScoreChange(callback: (score: GameScoreState) => void): () => void {
    this.scoreCallbacks.push(callback);
    return () => { this.scoreCallbacks = this.scoreCallbacks.filter(c => c !== callback); };
  }

  destroy(): void {
    cancelAnimationFrame(this.animFrameId);
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.domElement.remove();
    }
  }
}
