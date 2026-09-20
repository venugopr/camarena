import * as THREE from 'three';
import { IGameScene, GameScoreState } from '../common/IGameScene';
import { GameModeId, OpponentMode, DifficultyLevel, MotionFrame, ActionEvent } from '../common/Types';
import { SoundSynthesizer } from '../util/audio/SoundSynthesizer';

export class TennisScene implements IGameScene {
  public readonly id: GameModeId = 'tennis';
  public readonly title = 'Tennis 3D';

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
    gameModeTitle: 'Tennis 3D',
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
    this.scene.background = new THREE.Color(0x001a0a);
    this.scene.fog = new THREE.FogExp2(0x001a0a, 0.03);

    this.camera = new THREE.PerspectiveCamera(60, this.container.clientWidth / this.container.clientHeight, 0.1, 300);
    this.camera.position.set(0, 3, 12);
    this.camera.lookAt(0, 0, 0);

    // Ambient light
    this.scene.add(new THREE.AmbientLight(0x88ffaa, 0.4));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(10, 20, 5);
    this.scene.add(sun);

    // Hardcourt floor (blue court)
    const courtGeo = new THREE.PlaneGeometry(10.97, 23.77);
    const courtMat = new THREE.MeshStandardMaterial({ color: 0x1a4a8a });
    const court = new THREE.Mesh(courtGeo, courtMat);
    court.rotation.x = -Math.PI / 2;
    this.scene.add(court);

    // Net
    const netGeo = new THREE.BoxGeometry(10.97, 0.9, 0.05);
    const netMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 });
    const net = new THREE.Mesh(netGeo, netMat);
    net.position.y = 0.45;
    this.scene.add(net);

    // Coming Soon overlay
    this.buildComingSoonOverlay('🎾', 'Tennis 3D', 'Courtside — Coming Soon', 'Full-court rallies, serve mechanics,\ntopspin physics & reactive AI opponent');
  }

  private buildComingSoonOverlay(icon: string, title: string, phase: string, desc: string): void {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center;
      justify-content: center; z-index: 10; background: rgba(0, 15, 5, 0.75); backdrop-filter: blur(8px);
      font-family: 'Outfit', 'Inter', sans-serif; color: #fff; text-align: center; padding: 2rem;
    `;
    overlay.innerHTML = `
      <div style="font-size: 5rem; margin-bottom: 1rem; animation: pulse 2s ease-in-out infinite;">${icon}</div>
      <h2 style="font-size: 2.5rem; font-weight: 800; background: linear-gradient(135deg, #44ff88, #44ffcc); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin: 0 0 0.5rem;">${title}</h2>
      <div style="font-size: 0.85rem; letter-spacing: 3px; color: #44ffaa; margin-bottom: 1.5rem; font-weight: 600;">${phase}</div>
      <p style="max-width: 420px; line-height: 1.7; color: rgba(255,255,255,0.7); font-size: 1rem; white-space: pre-line;">${desc}</p>
      <div style="margin-top: 2rem; padding: 0.6rem 2rem; border: 1px solid rgba(68,255,136,0.4); border-radius: 999px; color: #44ffaa; font-size: 0.8rem; letter-spacing: 2px;">🚧 COMING SOON</div>
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
