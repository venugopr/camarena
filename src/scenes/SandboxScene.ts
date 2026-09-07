import * as THREE from 'three';
import { IGameScene, GameScoreState } from '../core/scene/IGameScene';
import { GameModeId, MotionFrame, ActionEvent } from '../core/motion/Types';
import { SoundSynthesizer } from '../core/audio/SoundSynthesizer';
import { Avatar3D } from './components/Avatar3D';

interface TargetOrb {
  mesh: THREE.Mesh;
  glowMesh: THREE.Mesh;
  position: THREE.Vector3;
  baseY: number;
  phase: number;
  actionRequired: 'ANY' | 'SMASH' | 'FOREHAND' | 'BACKHAND' | 'LUNGE';
  label: string;
  isHit: boolean;
}

export class SandboxScene implements IGameScene {
  public readonly id: GameModeId = 'sandbox';
  public readonly title = '3D Motion Mirror & Biomechanical Sandbox';

  private container!: HTMLElement;
  private audio!: SoundSynthesizer;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;

  private avatar!: Avatar3D;
  private targets: TargetOrb[] = [];
  private particles: THREE.Points | null = null;
  private particleGeo!: THREE.BufferGeometry;
  private particlePositions!: Float32Array;
  private particleVelocities!: Float32Array;

  private scoreState: GameScoreState = {
    player1Score: 0,
    player2Score: 0,
    currentServer: 1,
    rallyCount: 0,
    isGameOver: false,
    winner: null,
    lastPointWinner: null,
    targetScore: 10,
    winByTwo: false,
    lastPointReason: undefined,
    matchPointText: undefined,
    gameModeTitle: 'Motion Mirror Sandbox'
  };


  private scoreCallbacks: ((score: GameScoreState) => void)[] = [];
  private isRunning = false;
  private clock = new THREE.Clock();

  public init(container: HTMLElement, audio: SoundSynthesizer): void {
    this.container = container;
    this.audio = audio;

    // Setup Three.js scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x060911);
    this.scene.fog = new THREE.FogExp2(0x060911, 0.08);

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    this.camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
    this.camera.position.set(0, 1.2, 3.2);
    this.camera.lookAt(0, 0.9, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    // Ambient and sports directional lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0x00f2fe, 1.5);
    keyLight.position.set(3, 5, 4);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x39ff14, 1.0);
    fillLight.position.set(-3, 3, 2);
    this.scene.add(fillLight);

    const backLight = new THREE.DirectionalLight(0x9333ea, 1.2);
    backLight.position.set(0, 4, -4);
    this.scene.add(backLight);

    // Futuristic floor grid
    const gridHelper = new THREE.GridHelper(16, 32, 0x00f2fe, 0x1e293b);
    gridHelper.position.y = -0.01;
    this.scene.add(gridHelper);

    // Floor reflector plane
    const floorGeo = new THREE.PlaneGeometry(16, 16);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x0a0f1d,
      roughness: 0.1,
      metalness: 0.8
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.receiveShadow = true;
    this.scene.add(floorMesh);

    // 3D Avatar
    this.avatar = new Avatar3D(0x00f2fe, 0x39ff14);
    this.avatar.setEquipment('badminton');
    this.scene.add(this.avatar.group);

    // Target practice orbs
    this.setupTargets();

    // Particle hit burst system
    this.setupParticles();
  }

  private setupTargets(): void {
    const orbGeo = new THREE.SphereGeometry(0.18, 20, 20);
    const configs = [
      { pos: new THREE.Vector3(0.65, 1.1, 0.4), action: 'FOREHAND' as const, color: 0x00f2fe, label: 'Forehand Drive' },
      { pos: new THREE.Vector3(-0.65, 1.1, 0.4), action: 'BACKHAND' as const, color: 0xa855f7, label: 'Backhand Drive' },
      { pos: new THREE.Vector3(0.3, 1.9, 0.1), action: 'SMASH' as const, color: 0xff0055, label: 'Overhead Smash' },
      { pos: new THREE.Vector3(0.85, 0.5, 0.3), action: 'LUNGE' as const, color: 0x39ff14, label: 'Right Lunge' },
      { pos: new THREE.Vector3(-0.85, 0.5, 0.3), action: 'LUNGE' as const, color: 0x39ff14, label: 'Left Lunge' }
    ];

    for (let i = 0; i < configs.length; i++) {
      const cfg = configs[i];
      const mat = new THREE.MeshStandardMaterial({
        color: cfg.color,
        emissive: cfg.color,
        emissiveIntensity: 0.5,
        roughness: 0.2,
        metalness: 0.8
      });
      const mesh = new THREE.Mesh(orbGeo, mat);
      mesh.position.copy(cfg.pos);
      mesh.castShadow = true;
      this.scene.add(mesh);

      // Outer wireframe glow
      const wireGeo = new THREE.SphereGeometry(0.23, 12, 12);
      const wireMat = new THREE.MeshBasicMaterial({
        color: cfg.color,
        wireframe: true,
        transparent: true,
        opacity: 0.4
      });
      const glowMesh = new THREE.Mesh(wireGeo, wireMat);
      mesh.add(glowMesh);

      this.targets.push({
        mesh,
        glowMesh,
        position: cfg.pos.clone(),
        baseY: cfg.pos.y,
        phase: i * 1.2,
        actionRequired: cfg.action,
        label: cfg.label,
        isHit: false
      });
    }
  }

  private setupParticles(): void {
    const count = 150;
    this.particleGeo = new THREE.BufferGeometry();
    this.particlePositions = new Float32Array(count * 3);
    this.particleVelocities = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      this.particlePositions[i * 3] = 0;
      this.particlePositions[i * 3 + 1] = -10; // Hide below
      this.particlePositions[i * 3 + 2] = 0;
    }

    this.particleGeo.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.08,
      color: 0x00f2fe,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending
    });

    this.particles = new THREE.Points(this.particleGeo, mat);
    this.scene.add(this.particles);
  }

  private triggerHitExplosion(pos: THREE.Vector3, colorHex: number): void {
    const count = 50;
    for (let i = 0; i < count; i++) {
      const idx = (Math.floor(Math.random() * 100)) * 3;
      this.particlePositions[idx] = pos.x;
      this.particlePositions[idx + 1] = pos.y;
      this.particlePositions[idx + 2] = pos.z;

      this.particleVelocities[idx] = (Math.random() - 0.5) * 3.5;
      this.particleVelocities[idx + 1] = (Math.random() - 0.2) * 4.0;
      this.particleVelocities[idx + 2] = (Math.random() - 0.5) * 3.5;
    }
    this.particleGeo.attributes.position.needsUpdate = true;
  }

  public start(): void {
    this.isRunning = true;
    this.clock.start();
  }

  public pause(): void {
    this.isRunning = false;
  }

  public resume(): void {
    this.isRunning = true;
  }

  public reset(): void {
    this.scoreState = {
      player1Score: 0,
      player2Score: 0,
      currentServer: 1,
      rallyCount: 0,
      isGameOver: false,
      winner: null,
      lastPointWinner: null,
      targetScore: 10,
      winByTwo: false,
      lastPointReason: undefined,
      matchPointText: undefined,
      gameModeTitle: 'Motion Mirror Sandbox'
    };
    for (const t of this.targets) {
      t.isHit = false;
      t.mesh.scale.set(1, 1, 1);
    }
    this.notifyScore();
  }


  public update(deltaTime: number, motionFrame: MotionFrame | null): void {
    if (!this.isRunning) return;

    const t = this.clock.getElapsedTime();

    // Update 3D avatar from tracked world coordinates
    if (motionFrame && motionFrame.worldLandmarks) {
      this.avatar.update(motionFrame.worldLandmarks, motionFrame.metrics.dominantArm);
    }

    // Animate target practice orbs
    for (const target of this.targets) {
      target.mesh.position.y = target.baseY + Math.sin(t * 2 + target.phase) * 0.08;
      target.glowMesh.rotation.y += deltaTime * 1.5;
      target.glowMesh.rotation.x += deltaTime * 0.8;

      if (target.isHit) {
        target.mesh.scale.multiplyScalar(0.95);
        if (target.mesh.scale.x < 0.2) {
          target.isHit = false;
          target.mesh.scale.set(1, 1, 1);
        }
      }
    }

    // Update particle explosion physics
    if (this.particles) {
      let needsUpdate = false;
      for (let i = 0; i < 150; i++) {
        if (this.particlePositions[i * 3 + 1] > -5) {
          this.particlePositions[i * 3] += this.particleVelocities[i * 3] * deltaTime;
          this.particlePositions[i * 3 + 1] += this.particleVelocities[i * 3 + 1] * deltaTime;
          this.particlePositions[i * 3 + 2] += this.particleVelocities[i * 3 + 2] * deltaTime;
          this.particleVelocities[i * 3 + 1] -= 9.8 * deltaTime; // Gravity
          needsUpdate = true;
        }
      }
      if (needsUpdate) {
        this.particleGeo.attributes.position.needsUpdate = true;
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  public onAction(event: ActionEvent): void {
    // Check if user hit any target orb
    for (const target of this.targets) {
      const matchAction =
        (target.actionRequired === 'SMASH' && (event.type === 'OVERHEAD_SMASH' || event.type === 'OVERHEAD_CLEAR')) ||
        (target.actionRequired === 'FOREHAND' && event.type === 'FOREHAND_DRIVE') ||
        (target.actionRequired === 'BACKHAND' && event.type === 'BACKHAND_DRIVE') ||
        (target.actionRequired === 'LUNGE' && (event.type === 'LUNGE_LEFT' || event.type === 'LUNGE_RIGHT')) ||
        target.actionRequired === 'ANY';

      if (matchAction && !target.isHit) {
        target.isHit = true;
        this.triggerHitExplosion(target.mesh.position, 0x00f2fe);
        this.audio.scoreChime();
        this.scoreState.player1Score += 100;
        this.scoreState.rallyCount++;
        this.notifyScore();
        break;
      }
    }

    if (event.type === 'OVERHEAD_SMASH') {
      this.audio.badmintonSmash();
    } else {
      this.audio.racketSwish(event.speedKmh);
    }
  }

  public onResize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  public getScore(): GameScoreState {
    return this.scoreState;
  }

  public onScoreChange(callback: (score: GameScoreState) => void): () => void {
    this.scoreCallbacks.push(callback);
    return () => {
      this.scoreCallbacks = this.scoreCallbacks.filter(c => c !== callback);
    };
  }

  private notifyScore(): void {
    for (const cb of this.scoreCallbacks) {
      cb(this.scoreState);
    }
  }

  public destroy(): void {
    this.isRunning = false;
    if (this.renderer && this.renderer.domElement) {
      this.renderer.domElement.remove();
      this.renderer.dispose();
    }
  }
}
