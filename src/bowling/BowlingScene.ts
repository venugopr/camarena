/**
 * CamArena Phase 1 — Arcade Bowling 3D Pro
 * ─────────────────────────────────────────
 * Pure Motion-Driven Seated Upper-Body Webcam Bowling Kinematics:
 * - Seated-Safe Pose Detector: Tracks dominant shoulder, elbow, and wrist.
 * - Windup Phase: Pullback depth & arm cocking charges live vertical Power Meter.
 * - Release Threshold: Sudden forward acceleration (> 4.5 m/s) triggers ball release.
 * - Hook Spin Mapping: Lateral release offset (deltaX) translates into authentic hook (hookAccelX).
 * - Chase-Cam / Pin-Cam: Dynamic speed tracking cam past mid-lane.
 * - Strike Juice: 0.08s hit-stop, screen shake, radial flash, and multi-pin shatter audio.
 * - Zero Mouse/Keyboard Bowling: Keyboard R resets match only; C cycles camera views.
 */

import * as THREE from 'three';
import { IGameScene, GameScoreState } from '../common/IGameScene';
import { GameModeId, OpponentMode, DifficultyLevel, MotionFrame, ActionEvent, PoseLandmark } from '../common/Types';
import { SoundSynthesizer } from '../util/audio/SoundSynthesizer';
import { Avatar3D } from '../badminton/Avatar3D';

// ─── Constants ───────────────────────────────────────────────────────────────
const LANE_HALF_WIDTH = 0.85;     // Widened 1.7m arcade lane
const LANE_LENGTH = 18.0;          // foul line to pin deck
const PIN_DECK_Z = 8.0;            // pin-deck centre z in world
const APPROACH_Z = -10.0;          // foul line z
const APPROACH_START_Z = -15.5;    // approach court rear boundary
const GRAVITY = 9.81;              // m/s²
const LANE_FRICTION = 0.02;        // rolling friction coefficient
const PIN_RADIUS = 0.06;           // pin hitbox cylinder radius (metres)
const PIN_HEIGHT = 0.38;           // standard pin height (metres)
const BALL_RADIUS = 0.109;         // 10-pin bowling ball radius (metres)

// Standard 10-pin triangular layout (Pin 1 Headpin at front apex facing bowler)
const PIN_POSITIONS: [number, number][] = [
  // Pin 1 (Head pin - apex facing bowler at smallest Z)
  [0.0, -0.45],
  // Pins 2, 3 (Row 2)
  [-0.15, -0.15], [0.15, -0.15],
  // Pins 4, 5, 6 (Row 3)
  [-0.30, 0.15], [0.0, 0.15], [0.30, 0.15],
  // Pins 7, 8, 9, 10 (Row 4 - back row)
  [-0.45, 0.45], [-0.15, 0.45], [0.15, 0.45], [0.45, 0.45],
];

// ─── Types ───────────────────────────────────────────────────────────────────
interface BallState {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  active: boolean;
  mesh: THREE.Mesh;
  /** Lateral hook acceleration applied each physics step (m/s² in X) — 0 = straight */
  hookAccelX: number;
  isAI: boolean;
}

interface PinState {
  mesh: THREE.Group;
  standingPos: THREE.Vector3;
  isDown: boolean;
  fallVel: THREE.Vector3;
  fallAngVel: number;
  pinNumber: number; // 1 to 10
  beaconMesh: THREE.Mesh; // glowing ground target ring
}

// Frame: up to 3 rolls (only 3rd roll in 10th frame bonus)
type FrameRolls = number[]; // -1 = not yet rolled

/** 10-frame bowling score calculator */
function calcFrameScore(frames: FrameRolls[]): { frameScores: number[]; runningTotal: number[] } {
  const frameScores: number[] = [];
  const runningTotal: number[] = [];
  let total = 0;
  for (let f = 0; f < frames.length; f++) {
    const rolls = frames[f];
    const r0 = rolls[0] ?? 0;
    const r1 = rolls[1] ?? 0;
    const isStrike = r0 === 10;
    const isSpare = !isStrike && (r0 + r1 === 10);
    let score = r0 + r1;
    if (f < 9) {
      if (isStrike) {
        // bonus: next 2 deliveries
        const next1 = frames[f + 1]?.[0] ?? 0;
        const next2 = frames[f + 1]?.[1] ?? frames[f + 2]?.[0] ?? 0;
        score = 10 + next1 + next2;
      } else if (isSpare) {
        const next1 = frames[f + 1]?.[0] ?? 0;
        score = 10 + next1;
      }
    } else {
      // 10th frame — all 3 rolls count as-is
      score = r0 + r1 + (rolls[2] ?? 0);
    }
    total += score;
    frameScores.push(score);
    runningTotal.push(total);
  }
  return { frameScores, runningTotal };
}

// ─── BowlingScene ─────────────────────────────────────────────────────────────
export class BowlingScene implements IGameScene {
  public readonly id: GameModeId = 'bowling';
  public readonly title = 'Arcade Bowling 3D Pro';

  private container!: HTMLElement;
  private audio!: SoundSynthesizer;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private animFrameId = 0;

  private difficulty: DifficultyLevel = 'casual';
  private opponentMode: OpponentMode = 'system';

  // ── Physics objects ──
  private ball: BallState | null = null;
  private pins: PinState[] = [];
  private pinBeacons: THREE.Mesh[] = [];
  private laneGroup!: THREE.Group;
  private ballTemplate!: THREE.Mesh;

  // ── Player Approach Stance & Ready Ball ──
  private playerStanceX = 0; // Lateral position [-0.65, 0.65]
  private stanceReticleGroup!: THREE.Group;
  private readyBallMesh!: THREE.Mesh;

  // ── Camera Presets & Dynamic Chase Cam ──
  private currentCameraPreset: 'broadcast' | 'over_shoulder' | 'court_level' = 'broadcast';
  private cameraViewBtn?: HTMLButtonElement;
  private isChaseCamActive = false;
  private cameraShakeTrauma = 0;
  private hitStopTimer = 0; // 0.08s hit-stop freeze on strike

  // ── AI Aim Visualizer ──
  private aiAimGroup: THREE.Group | null = null;
  private aiAimTimer = 0;        // countdown while aim arc is shown before AI releases
  private aiTargetStartX = 0;    // lateral start of AI hook path
  private aiHookAccelX = 0;      // hook acceleration queued for next AI ball

  // ── Two-Phase Bowling Delivery State Machine ──
  private bowlingPhase: 'IDLE' | 'COCKED' | 'SWEEPING' = 'IDLE';
  private cockingDuration = 0;
  private liveWindupPower = 0;   // 0.0 - 1.0 for HUD power meter
  private gestureCooldown = 0.8;
  private startGraceTimer = 0.35; // Warmup grace timer to kill ghost rolls on start
  private readyWaitTimer = 0;     // Inter-play 2.0s Get Ready wait timer
  private hipBaselineX: number | null = null; // Tared standing baseline X

  // ── Scoring / Game State ──
  private playerFrames: FrameRolls[] = [];   // 10 frames
  private aiFrames: FrameRolls[] = [];
  private currentFrame = 0;       // 0-9
  private rollInFrame = 0;        // 0 or 1 (or 0/1/2 in 10th)
  private isPlayerTurn = true;
  private waitingForReset = false;// after ball reaches pins, wait for user to bowl again
  private aiRollTimer = 0;        // seconds until AI auto-rolls
  private pinsUpCount = 10;
  private matchOver = false;
  private animT = 0;              // global time accumulator

  // ── HUD Elements ──
  private scorecardEl!: HTMLElement;
  private turnIndicatorEl!: HTMLElement;
  private aimGuideEl!: HTMLElement;
  private pinRackEl!: HTMLElement;
  private pinDots: Map<number, HTMLElement> = new Map();
  private pinRackStatusEl!: HTMLElement;
  private powerMeterEl!: HTMLElement;
  private powerFillEl!: HTMLElement;
  private powerValEl!: HTMLElement;
  private impactFlashEl!: HTMLElement;
  private strikeBannerEl!: HTMLElement;

  // ── Score state ──
  private scoreState: GameScoreState = {
    player1Score: 0,
    player2Score: 0,
    currentServer: 1,
    rallyCount: 0,
    isGameOver: false,
    winner: null,
    lastPointWinner: null,
    targetScore: 300,
    winByTwo: false,
    gameModeTitle: 'Arcade Bowling 3D Pro',
  };
  private scoreCallbacks: ((s: GameScoreState) => void)[] = [];

  // ─────────────────────────────────────────────────────────────────────────
  // IGameScene Implementation
  // ─────────────────────────────────────────────────────────────────────────

  public init(container: HTMLElement, audio: SoundSynthesizer, config?: {
    opponentMode: OpponentMode; difficulty: DifficultyLevel;
  }): void {
    this.container = container;
    this.audio = audio;
    if (config) {
      this.opponentMode = config.opponentMode;
      this.difficulty = config.difficulty;
    }
    this.startGraceTimer = 0.35;
    this.gestureCooldown = 0.8;
    this.initFrames();
    this.buildThreeScene();
    this.buildHUD();
    this.bindKeyboardEvents();
  }

  private initFrames(): void {
    this.playerFrames = Array.from({ length: 10 }, () => []);
    this.aiFrames = Array.from({ length: 10 }, () => []);
    this.currentFrame = 0;
    this.rollInFrame = 0;
    this.isPlayerTurn = true;
    this.waitingForReset = false;
    this.matchOver = false;
    this.pinsUpCount = 10;
    this.hipBaselineX = null;
  }

  public start(): void {
    this.startGraceTimer = 0.35;
    this.gestureCooldown = 0.8;
    this.setAllPinsUp();
    this.updateHUD();
    this.applyCameraPreset('broadcast');
  }

  public pause(): void { }
  public resume(): void { }

  public reset(): void {
    this.initFrames();
    this.bowlingPhase = 'IDLE';
    this.cockingDuration = 0;
    this.liveWindupPower = 0;
    this.updatePowerMeter(0);
    this.aiRollTimer = 0;
    this.startGraceTimer = 0.35;
    this.gestureCooldown = 0.8;
    this.readyWaitTimer = 0;
    this.hipBaselineX = null;
    this.playerStanceX = 0;
    this.isChaseCamActive = false;
    this.cameraShakeTrauma = 0;
    this.hitStopTimer = 0;
    if (this.stanceReticleGroup) {
      this.stanceReticleGroup.position.x = 0;
    }
    this.setAllPinsUp();
    this.updateScoreState();
    this.updateHUD();
    this.applyCameraPreset(this.currentCameraPreset);
  }

  public update(dt: number, motionFrame: MotionFrame | null): void {
    if (!this.renderer) return;

    // Hit-stop slow-mo freeze on strike (0.08s)
    if (this.hitStopTimer > 0) {
      this.hitStopTimer -= dt;
      this.renderer.render(this.scene, this.camera);
      return;
    }

    this.animT += dt;

    // Warmup grace & cooldown timers
    if (this.startGraceTimer > 0) this.startGraceTimer -= dt;
    if (this.gestureCooldown > 0) this.gestureCooldown -= dt;
    if (this.readyWaitTimer > 0) {
      this.readyWaitTimer -= dt;
      if (this.readyWaitTimer <= 0) {
        this.updateHUD();
      }
    }

    // Universal screen-space torso tracking for responsive lateral approach control
    if (motionFrame && motionFrame.rawLandmarks && motionFrame.rawLandmarks.length > 24) {
      const lSh = motionFrame.rawLandmarks[PoseLandmark.LEFT_SHOULDER];
      const rSh = motionFrame.rawLandmarks[PoseLandmark.RIGHT_SHOULDER];
      const lHip = motionFrame.rawLandmarks[PoseLandmark.LEFT_HIP];
      const rHip = motionFrame.rawLandmarks[PoseLandmark.RIGHT_HIP];
      
      const hasShoulders = lSh && rSh && (lSh.visibility ?? 1) > 0.3 && (rSh.visibility ?? 1) > 0.3;
      const hasHips = lHip && rHip && (lHip.visibility ?? 1) > 0.3 && (rHip.visibility ?? 1) > 0.3;
      
      if (hasShoulders || hasHips) {
        const topX = hasShoulders ? (lSh.x + rSh.x) * 0.5 : 0.5;
        const botX = hasHips ? (lHip.x + rHip.x) * 0.5 : 0.5;
        const screenTorsoX = hasShoulders && hasHips ? (topX * 0.6 + botX * 0.4) : (hasShoulders ? topX : botX);
        
        // Direct linear mapping: screen > 0.5 (right side of camera view) -> positive lane X (+X right)
        // If movement feels inverted relative to your room setup, flip the sign on (screenTorsoX - 0.5)
        const normalizedOffset = (screenTorsoX - 0.5) * 3.2; 
        const targetStanceX = THREE.MathUtils.clamp(normalizedOffset, -LANE_HALF_WIDTH + BALL_RADIUS, LANE_HALF_WIDTH - BALL_RADIUS);
        this.playerStanceX += (targetStanceX - this.playerStanceX) * Math.min(1.0, dt * 14);
      }
    }

    // Sync stance reticle position
    if (this.stanceReticleGroup) {
      this.stanceReticleGroup.position.x = this.playerStanceX;
    }

    // Idle animation for ready bowling ball held at bowler's stance
    if (this.readyBallMesh) {
      const isReadyToBowl = this.isPlayerTurn && !this.waitingForReset && !this.ball?.active && !this.matchOver;
      this.readyBallMesh.visible = isReadyToBowl;
      if (isReadyToBowl) {
        this.readyBallMesh.position.y = 0.62 + Math.sin(this.animT * 3.5) * 0.02;
      }
    }

    // Enforce Standing Posture Gate for Bowling Execution
    const isStanding = Avatar3D.isFullBodyStanding(motionFrame?.worldLandmarks || []);
    if (!isStanding && this.isPlayerTurn && !this.waitingForReset && !this.matchOver) {
      this.turnIndicatorEl.innerHTML = '🪑 SEATED/LOW FRAME DETECTED — STAND UP AT APPROACH TO BOWL';
      this.turnIndicatorEl.style.borderColor = 'rgba(239, 68, 68, 0.8)';
      this.bowlingPhase = 'IDLE';
      this.liveWindupPower = 0;
      this.updatePowerMeter(0);
      return;
    }

    // Two-phase deliberate bowling gesture detector (100% motion-driven, zero keys)
    if (motionFrame && this.isPlayerTurn && !this.waitingForReset && !this.ball?.active && !this.matchOver) {
      if (this.startGraceTimer <= 0) {
        this.detectBowlingGesture(motionFrame, dt);
      }
    } else {
      // Fade power meter when not player's turn or ball is rolling
      if (this.liveWindupPower > 0) {
        this.liveWindupPower = THREE.MathUtils.lerp(this.liveWindupPower, 0, dt * 6);
        this.updatePowerMeter(this.liveWindupPower);
      }
    }

    // AI turn — show aim arc then release
    if (!this.isPlayerTurn && !this.waitingForReset && !this.ball?.active && !this.matchOver) {
      this.aiRollTimer -= dt;

      if (this.aiRollTimer <= 1.8 && this.aiAimGroup === null) {
        this.showAIAimArc(this.aiTargetStartX, this.aiHookAccelX);
      }

      if (this.aiAimGroup) {
        const pulse = 0.5 + 0.5 * Math.sin(this.animT * 8);
        this.aiAimGroup.children.forEach((c) => {
          (c as THREE.Mesh).material && ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).setValues(
            { opacity: 0.35 + pulse * 0.55 }
          );
        });
      }

      if (this.aiRollTimer <= 0) {
        this.hideAIAimArc();
        this.aiRoll();
      }
    }

    // Ball physics
    if (this.ball?.active) {
      this.stepBallPhysics(dt);
    }

    // Pin fall animation
    for (const pin of this.pins) {
      if (pin.isDown) {
        pin.mesh.rotation.z += pin.fallAngVel * dt;
        pin.mesh.position.addScaledVector(pin.fallVel, dt);
        pin.fallVel.y -= GRAVITY * dt;
        pin.fallAngVel *= 0.95;
        if (pin.mesh.position.y < -0.5) {
          pin.mesh.position.y = -0.5;
          pin.fallVel.set(0, 0, 0);
        }
      }
    }

    // Subtle beacon glow pulsation for remaining pins
    if (this.pinsUpCount <= 3) {
      const pulseScale = 1.0 + 0.15 * Math.sin(this.animT * 7);
      for (const pin of this.pins) {
        if (!pin.isDown && pin.beaconMesh.visible) {
          pin.beaconMesh.scale.setScalar(pulseScale);
        }
      }
    }

    // Dynamic Chase-Cam / Pin-Cam past mid-lane (amplifies speed sensation)
    if (this.ball?.active && this.ball.pos.z > 2.0) {
      const chaseTarget = new THREE.Vector3(this.ball.pos.x * 0.4, 0.55, this.ball.pos.z - 2.4);
      this.camera.position.lerp(chaseTarget, Math.min(1.0, dt * 6.5));
      this.camera.lookAt(0, 0.40, PIN_DECK_Z);
      this.isChaseCamActive = true;
    } else if (this.isChaseCamActive) {
      // Smoothly return to preset camera when ball stops
      const presetPos = this.getPresetCameraPos();
      const presetLook = this.getPresetCameraLook();
      this.camera.position.lerp(presetPos, Math.min(1.0, dt * 5.0));
      this.camera.lookAt(presetLook);
      if (this.camera.position.distanceTo(presetPos) < 0.08) {
        this.camera.position.copy(presetPos);
        this.camera.lookAt(presetLook);
        this.isChaseCamActive = false;
      }
    } else {
      // Camera gentle bob in broadcast view when ball is not in chase
      if (this.camera && this.currentCameraPreset === 'broadcast') {
        this.camera.position.y = 4.4 + Math.sin(this.animT * 0.35) * 0.006;
      }
    }

    // Camera shake trauma decay (arcade impact juice)
    if (this.cameraShakeTrauma > 0) {
      this.cameraShakeTrauma = Math.max(0, this.cameraShakeTrauma - dt * 3.2);
      const traumaSq = this.cameraShakeTrauma * this.cameraShakeTrauma;
      this.camera.position.x += (Math.random() - 0.5) * traumaSq * 0.22;
      this.camera.position.y += (Math.random() - 0.5) * traumaSq * 0.22;
    }

    this.renderer.render(this.scene, this.camera);
  }

  public onAction(_event: ActionEvent): void {
    // Intentionally no-op: bowling strictly relies on detectSeatedGesture()
    // with its momentum/kinetic-energy gate to avoid accidental false triggers.
  }

  public onResize(width: number, height: number): void {
    if (this.renderer) this.renderer.setSize(width, height);
    if (this.camera) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
  }

  public getScore(): GameScoreState { return { ...this.scoreState }; }

  public onScoreChange(callback: (score: GameScoreState) => void): () => void {
    this.scoreCallbacks.push(callback);
    return () => { this.scoreCallbacks = this.scoreCallbacks.filter(c => c !== callback); };
  }

  public destroy(): void {
    cancelAnimationFrame(this.animFrameId);
    window.removeEventListener('keydown', this.keyHandler);
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.domElement.remove();
    }
    if (this.scorecardEl) this.scorecardEl.remove();
    if (this.turnIndicatorEl) this.turnIndicatorEl.remove();
    if (this.aimGuideEl) this.aimGuideEl.remove();
    if (this.pinRackEl) this.pinRackEl.remove();
    if (this.powerMeterEl) this.powerMeterEl.remove();
    if (this.impactFlashEl) this.impactFlashEl.remove();
    if (this.strikeBannerEl) this.strikeBannerEl.remove();
    if (this.cameraViewBtn) this.cameraViewBtn.remove();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Scene Building
  // ─────────────────────────────────────────────────────────────────────────

  private buildThreeScene(): void {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0010);
    this.scene.fog = new THREE.Fog(0x0a0010, 36, 90);

    // Default to high-angle Olympic TV Broadcaster view
    this.camera = new THREE.PerspectiveCamera(48, this.container.clientWidth / this.container.clientHeight, 0.1, 200);
    this.applyCameraPreset('broadcast');

    // Ambient lighting
    const ambient = new THREE.AmbientLight(0x2a1a4a, 0.7);
    this.scene.add(ambient);

    // Overhead directional light along lane
    const overhead = new THREE.DirectionalLight(0xffffff, 1.3);
    overhead.position.set(0, 10, -3);
    overhead.castShadow = true;
    overhead.shadow.mapSize.set(2048, 2048);
    this.scene.add(overhead);

    // Dedicated High-Power Pin Deck Spotlight
    const pinDeckSpot = new THREE.SpotLight(0xffffff, 4.8, 22, Math.PI / 3, 0.25, 1.2);
    pinDeckSpot.position.set(0, 5.5, PIN_DECK_Z);
    pinDeckSpot.target.position.set(0, 0, PIN_DECK_Z);
    pinDeckSpot.castShadow = true;
    this.scene.add(pinDeckSpot);
    this.scene.add(pinDeckSpot.target);

    // Neon strip lights along lane
    const neonColors = [0x8800ff, 0x0088ff, 0xff0088];
    for (let i = 0; i < 3; i++) {
      const neon = new THREE.PointLight(neonColors[i], 1.6, 16);
      neon.position.set((i - 1) * 2.5, 2.8, -3 + i * 5);
      this.scene.add(neon);
    }

    this.laneGroup = new THREE.Group();
    this.scene.add(this.laneGroup);

    this.buildLane();
    this.buildApproachCourt();
    this.buildPins();
    this.buildBallTemplate();
    this.buildEnvironment();
  }

  private buildLane(): void {
    const laneGeo = new THREE.PlaneGeometry(LANE_HALF_WIDTH * 2, LANE_LENGTH);
    const laneMat = new THREE.MeshStandardMaterial({
      color: 0xd4a96a,
      roughness: 0.25,
      metalness: 0.05,
    });
    const lane = new THREE.Mesh(laneGeo, laneMat);
    lane.rotation.x = -Math.PI / 2;
    lane.position.set(0, 0, (APPROACH_Z + PIN_DECK_Z) / 2);
    lane.receiveShadow = true;
    this.laneGroup.add(lane);

    // Arrow targeting dots on lane
    for (let i = -2; i <= 2; i++) {
      const dotGeo = new THREE.CircleGeometry(0.024, 16);
      const dotMat = new THREE.MeshBasicMaterial({ color: 0xff4400 });
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.rotation.x = -Math.PI / 2;
      dot.position.set(i * 0.22, 0.001, APPROACH_Z + 3.8);
      this.laneGroup.add(dot);
    }

    // Gutters
    for (const side of [-1, 1]) {
      const gutterGeo = new THREE.PlaneGeometry(0.12, LANE_LENGTH);
      const gutterMat = new THREE.MeshStandardMaterial({ color: 0x221100, roughness: 0.9 });
      const gutter = new THREE.Mesh(gutterGeo, gutterMat);
      gutter.rotation.x = -Math.PI / 2;
      gutter.position.set(side * (LANE_HALF_WIDTH + 0.06), -0.02, (APPROACH_Z + PIN_DECK_Z) / 2);
      this.laneGroup.add(gutter);
    }

    // Pin deck platform
    const deckGeo = new THREE.BoxGeometry(LANE_HALF_WIDTH * 2 + 0.12, 0.02, 2.2);
    const deckMat = new THREE.MeshStandardMaterial({ color: 0xc09050, roughness: 0.35 });
    const deck = new THREE.Mesh(deckGeo, deckMat);
    deck.position.set(0, 0, PIN_DECK_Z);
    this.laneGroup.add(deck);
  }

  private buildApproachCourt(): void {
    const approachLen = Math.abs(APPROACH_Z - APPROACH_START_Z); // 5.5m approach
    const approachGeo = new THREE.PlaneGeometry(LANE_HALF_WIDTH * 2 + 0.8, approachLen);
    const approachMat = new THREE.MeshStandardMaterial({
      color: 0xdfb47a,
      roughness: 0.3,
      metalness: 0.05,
    });
    const approachFloor = new THREE.Mesh(approachGeo, approachMat);
    approachFloor.rotation.x = -Math.PI / 2;
    approachFloor.position.set(0, -0.002, (APPROACH_Z + APPROACH_START_Z) / 2);
    approachFloor.receiveShadow = true;
    this.scene.add(approachFloor);

    // Glowing Neon Foul Line Strip
    const foulLaserGeo = new THREE.PlaneGeometry(LANE_HALF_WIDTH * 2, 0.05);
    const foulLaserMat = new THREE.MeshBasicMaterial({ color: 0xff1144 });
    const foulLaser = new THREE.Mesh(foulLaserGeo, foulLaserMat);
    foulLaser.rotation.x = -Math.PI / 2;
    foulLaser.position.set(0, 0.002, APPROACH_Z);
    this.scene.add(foulLaser);

    // 7 Foul line approach dots
    for (let i = -3; i <= 3; i++) {
      const dotGeo = new THREE.CircleGeometry(0.016, 16);
      const dotMat = new THREE.MeshBasicMaterial({ color: 0x331100 });
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.rotation.x = -Math.PI / 2;
      dot.position.set(i * 0.22, 0.001, APPROACH_Z - 0.25);
      this.scene.add(dot);
    }

    // 7 Alignment dots at 12ft
    for (let i = -3; i <= 3; i++) {
      const dotGeo = new THREE.CircleGeometry(0.018, 16);
      const dotMat = new THREE.MeshBasicMaterial({ color: 0x331100 });
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.rotation.x = -Math.PI / 2;
      dot.position.set(i * 0.22, 0.001, APPROACH_Z - 3.4);
      this.scene.add(dot);
    }

    // Stance Reticle (indicates bowler's standing footprints, aim guide ray, and ready ball)
    this.stanceReticleGroup = new THREE.Group();

    // Footprints: Two athletic bowler shoes on approach floor
    for (const footX of [-0.14, 0.14]) {
      const shoeGroup = new THREE.Group();
      shoeGroup.position.set(footX, 0.004, 0);

      const soleGeo = new THREE.PlaneGeometry(0.12, 0.28);
      const soleMat = new THREE.MeshBasicMaterial({
        color: 0x00f2fe,
        transparent: true,
        opacity: 0.65,
        side: THREE.DoubleSide,
      });
      const sole = new THREE.Mesh(soleGeo, soleMat);
      sole.rotation.x = -Math.PI / 2;
      shoeGroup.add(sole);

      const heelGeo = new THREE.PlaneGeometry(0.10, 0.08);
      const heelMat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
      });
      const heel = new THREE.Mesh(heelGeo, heelMat);
      heel.rotation.x = -Math.PI / 2;
      heel.position.set(0, 0.001, 0.08);
      shoeGroup.add(heel);

      this.stanceReticleGroup.add(shoeGroup);
    }

    // Glowing base stance disc
    const reticleRingGeo = new THREE.RingGeometry(0.24, 0.28, 32);
    const reticleRingMat = new THREE.MeshBasicMaterial({
      color: 0x00f2fe,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    });
    const reticleRing = new THREE.Mesh(reticleRingGeo, reticleRingMat);
    reticleRing.rotation.x = -Math.PI / 2;
    reticleRing.position.y = 0.003;
    this.stanceReticleGroup.add(reticleRing);

    // Directional forward arrow
    const arrowGeo = new THREE.ConeGeometry(0.06, 0.16, 16);
    const arrowMat = new THREE.MeshBasicMaterial({ color: 0x39ff14 });
    const arrow = new THREE.Mesh(arrowGeo, arrowMat);
    arrow.rotation.x = -Math.PI / 2;
    arrow.position.set(0, 0.004, 0.40);
    this.stanceReticleGroup.add(arrow);

    // Aim guide ray line extending forward to foul line
    const rayGeo = new THREE.PlaneGeometry(0.02, 1.0);
    const rayMat = new THREE.MeshBasicMaterial({
      color: 0x00f2fe,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
    });
    const ray = new THREE.Mesh(rayGeo, rayMat);
    ray.rotation.x = -Math.PI / 2;
    ray.position.set(0, 0.004, 0.85);
    this.stanceReticleGroup.add(ray);

    // Ready Bowling Ball hovering at bowler's stance
    const readyGeo = new THREE.SphereGeometry(BALL_RADIUS, 22, 18);
    const readyMat = new THREE.MeshStandardMaterial({
      color: 0x331166,
      roughness: 0.15,
      metalness: 0.7,
      emissive: new THREE.Color(0x1a0033),
      emissiveIntensity: 0.4,
    });
    this.readyBallMesh = new THREE.Mesh(readyGeo, readyMat);
    this.readyBallMesh.position.set(0, 0.62, 0.15);
    this.readyBallMesh.castShadow = true;

    // 3 finger holes on ready ball
    for (const [hx, hy] of [[-0.02, 0.03], [0.02, 0.03], [0, -0.03]]) {
      const holeGeo = new THREE.CircleGeometry(0.012, 12);
      const holeMat = new THREE.MeshBasicMaterial({ color: 0x050010 });
      const hole = new THREE.Mesh(holeGeo, holeMat);
      hole.position.set(hx, hy, BALL_RADIUS + 0.001);
      this.readyBallMesh.add(hole);
    }
    this.stanceReticleGroup.add(this.readyBallMesh);

    this.stanceReticleGroup.position.set(0, 0, APPROACH_Z - 1.2);
    this.scene.add(this.stanceReticleGroup);

    // Approach side walls & LED trim
    for (const side of [-1, 1]) {
      const appWallGeo = new THREE.BoxGeometry(0.08, 0.8, approachLen);
      const appWallMat = new THREE.MeshStandardMaterial({ color: 0x110022, roughness: 0.8 });
      const appWall = new THREE.Mesh(appWallGeo, appWallMat);
      appWall.position.set(side * (LANE_HALF_WIDTH + 0.44), 0.4, (APPROACH_Z + APPROACH_START_Z) / 2);
      this.scene.add(appWall);

      const ledGeo = new THREE.BoxGeometry(0.02, 0.03, approachLen);
      const ledMat = new THREE.MeshBasicMaterial({ color: 0x00f2fe });
      const led = new THREE.Mesh(ledGeo, ledMat);
      led.position.set(side * (LANE_HALF_WIDTH + 0.40), 0.8, (APPROACH_Z + APPROACH_START_Z) / 2);
      this.scene.add(led);
    }
  }

  private buildPins(): void {
    this.pins = [];
    this.pinBeacons = [];
    let pinNum = 1;

    for (const [ox, oz] of PIN_POSITIONS) {
      const pinGroup = new THREE.Group();

      const bodyMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.15,
        metalness: 0.05,
        emissive: new THREE.Color(0x333348),
        emissiveIntensity: 0.28,
      });

      const bodyGeo = new THREE.CylinderGeometry(PIN_RADIUS * 0.5, PIN_RADIUS, PIN_HEIGHT * 0.7, 14);
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.position.y = PIN_HEIGHT * 0.35;
      body.castShadow = true;
      pinGroup.add(body);

      const headGeo = new THREE.SphereGeometry(PIN_RADIUS * 0.65, 12, 10);
      const head = new THREE.Mesh(headGeo, bodyMat);
      head.position.y = PIN_HEIGHT * 0.75;
      head.castShadow = true;
      pinGroup.add(head);

      const baseGeo = new THREE.CylinderGeometry(PIN_RADIUS, PIN_RADIUS * 1.1, 0.02, 14);
      const base = new THREE.Mesh(baseGeo, bodyMat);
      base.position.y = 0.01;
      pinGroup.add(base);

      // Two bright crimson neck stripes
      const stripeMat = new THREE.MeshStandardMaterial({
        color: 0xff1133,
        emissive: new THREE.Color(0xcc0022),
        emissiveIntensity: 0.6,
        roughness: 0.2,
      });
      for (const offset of [0.46, 0.52]) {
        const ringGeo = new THREE.TorusGeometry(PIN_RADIUS * 0.58, 0.009, 8, 24);
        const ring = new THREE.Mesh(ringGeo, stripeMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = PIN_HEIGHT * offset;
        pinGroup.add(ring);
      }

      const worldX = ox;
      const worldZ = PIN_DECK_Z + oz;
      pinGroup.position.set(worldX, 0, worldZ);
      pinGroup.scale.set(1.28, 1.28, 1.28);

      this.laneGroup.add(pinGroup);

      // In-world ground target beacon under pin
      const beaconGeo = new THREE.RingGeometry(0.08, 0.15, 24);
      const beaconMat = new THREE.MeshBasicMaterial({
        color: 0x00f2fe,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85,
      });
      const beacon = new THREE.Mesh(beaconGeo, beaconMat);
      beacon.rotation.x = -Math.PI / 2;
      beacon.position.set(worldX, 0.005, worldZ);
      beacon.visible = false;
      this.scene.add(beacon);
      this.pinBeacons.push(beacon);

      this.pins.push({
        mesh: pinGroup,
        standingPos: new THREE.Vector3(worldX, 0, worldZ),
        isDown: false,
        fallVel: new THREE.Vector3(),
        fallAngVel: 0,
        pinNumber: pinNum++,
        beaconMesh: beacon,
      });
    }
  }

  private buildBallTemplate(): void {
    const geo = new THREE.SphereGeometry(BALL_RADIUS, 22, 18);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x220066,
      roughness: 0.15,
      metalness: 0.6,
      emissive: new THREE.Color(0x110033),
      emissiveIntensity: 0.35,
    });
    this.ballTemplate = new THREE.Mesh(geo, mat);
    this.ballTemplate.castShadow = true;
  }

  private buildEnvironment(): void {
    for (const side of [-1, 1]) {
      const wallGeo = new THREE.PlaneGeometry(LANE_LENGTH, 5);
      const wallMat = new THREE.MeshStandardMaterial({ color: 0x110022, roughness: 1 });
      const wall = new THREE.Mesh(wallGeo, wallMat);
      wall.rotation.y = side * -Math.PI / 2;
      wall.position.set(side * (LANE_HALF_WIDTH + 0.5), 1.5, (APPROACH_Z + PIN_DECK_Z) / 2);
      this.scene.add(wall);
    }

    // Backlit pin canopy masking unit
    const canopyGeo = new THREE.BoxGeometry(LANE_HALF_WIDTH * 2 + 0.3, 1.6, 0.6);
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0x180033, roughness: 0.2, metalness: 0.8 });
    const canopy = new THREE.Mesh(canopyGeo, canopyMat);
    canopy.position.set(0, 2.6, PIN_DECK_Z + 1.2);
    this.scene.add(canopy);

    const panelGeo = new THREE.PlaneGeometry(LANE_HALF_WIDTH * 2 + 0.1, 1.5);
    const panelMat = new THREE.MeshBasicMaterial({ color: 0x381255 });
    const panel = new THREE.Mesh(panelGeo, panelMat);
    panel.position.set(0, 1.4, PIN_DECK_Z + 1.5);
    this.scene.add(panel);

    const backGeo = new THREE.PlaneGeometry(3.5, 4.5);
    const backMat = new THREE.MeshStandardMaterial({ color: 0x0d001a });
    const backWall = new THREE.Mesh(backGeo, backMat);
    backWall.position.set(0, 1.5, PIN_DECK_Z + 2.5);
    this.scene.add(backWall);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Camera Presets
  // ─────────────────────────────────────────────────────────────────────────

  private applyCameraPreset(preset: 'broadcast' | 'over_shoulder' | 'court_level'): void {
    this.currentCameraPreset = preset;
    this.isChaseCamActive = false;
    const targetPos = this.getPresetCameraPos();
    const targetLook = this.getPresetCameraLook();

    this.camera.position.copy(targetPos);
    this.camera.lookAt(targetLook);
    // Wide broadcast vs intimate over-shoulder vs low approach stance
    this.camera.fov = preset === 'broadcast' ? 52 : preset === 'over_shoulder' ? 68 : 74;
    this.camera.updateProjectionMatrix();

    if (this.cameraViewBtn) {
      const label = preset === 'broadcast' ? 'Broadcast Wide' : preset === 'over_shoulder' ? 'Action OTS' : 'Low Approach';
      this.cameraViewBtn.innerHTML = `<span>📹</span><span>View: ${label}</span>`;
    }
  }

  private getPresetCameraPos(): THREE.Vector3 {
    if (this.currentCameraPreset === 'broadcast') {
      return new THREE.Vector3(0, 6.2, APPROACH_Z - 6.5); // High wide TV broadcast stadium perspective
    } else if (this.currentCameraPreset === 'over_shoulder') {
      return new THREE.Vector3(this.playerStanceX * 0.8, 1.95, APPROACH_Z - 1.4); // Tight 3rd-person behind bowler shoulder
    } else {
      return new THREE.Vector3(this.playerStanceX, 1.35, APPROACH_Z - 0.45); // Low close approach stance view
    }
  }

  private getPresetCameraLook(): THREE.Vector3 {
    if (this.currentCameraPreset === 'broadcast') {
      return new THREE.Vector3(0, 0.3, 4.5); // Broad view across entire lane surface
    } else if (this.currentCameraPreset === 'over_shoulder') {
      return new THREE.Vector3(this.playerStanceX * 0.3, 0.40, PIN_DECK_Z * 0.55); // Down-the-board tracking framing
    } else {
      return new THREE.Vector3(this.playerStanceX * 0.1, 0.35, PIN_DECK_Z * 0.8); // Pin deck focus
    }
  }

  private cycleCameraView(): void {
    if (this.currentCameraPreset === 'broadcast') {
      this.applyCameraPreset('over_shoulder');
    } else if (this.currentCameraPreset === 'over_shoulder') {
      this.applyCameraPreset('court_level');
    } else {
      this.applyCameraPreset('broadcast');
    }
  }

  private buildCameraViewButton(): void {
    this.cameraViewBtn = document.createElement('button');
    this.cameraViewBtn.className = 'icon-btn camera-view-toggle-btn glass-panel';
    this.cameraViewBtn.id = 'btn-bowling-camera-view';
    this.cameraViewBtn.innerHTML = '<span>📹</span><span>View: Broadcast</span>';
    this.cameraViewBtn.title = 'Switch Camera View [Key: C]';
    this.cameraViewBtn.onclick = () => this.cycleCameraView();
    this.container.appendChild(this.cameraViewBtn);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HUD Building
  // ─────────────────────────────────────────────────────────────────────────

  private buildHUD(): void {
    // Scorecard
    this.scorecardEl = document.createElement('div');
    this.scorecardEl.id = 'bowling-scorecard';
    this.scorecardEl.style.cssText = `
      position: absolute; top: 72px; left: 50%; transform: translateX(-50%);
      background: rgba(10, 0, 20, 0.88); backdrop-filter: blur(12px);
      border: 1px solid rgba(136, 0, 255, 0.4); border-radius: 12px;
      padding: 10px 16px; min-width: 680px; max-width: 92vw; overflow-x: auto;
      font-family: 'Outfit', 'Inter', monospace; font-size: 11px; color: #ddd;
      box-shadow: 0 4px 30px rgba(136,0,255,0.3); z-index: 30;
    `;
    this.container.appendChild(this.scorecardEl);

    // 10-Pin Mini-Rack HUD
    this.pinRackEl = document.createElement('div');
    this.pinRackEl.id = 'bowling-pin-rack';
    this.pinRackEl.innerHTML = `
      <div class="pin-rack-header">PIN RACK</div>
      <div class="pin-row r4">
        <span class="pin-dot" data-pin="7">7</span>
        <span class="pin-dot" data-pin="8">8</span>
        <span class="pin-dot" data-pin="9">9</span>
        <span class="pin-dot" data-pin="10">10</span>
      </div>
      <div class="pin-row r3">
        <span class="pin-dot" data-pin="4">4</span>
        <span class="pin-dot" data-pin="5">5</span>
        <span class="pin-dot" data-pin="6">6</span>
      </div>
      <div class="pin-row r2">
        <span class="pin-dot" data-pin="2">2</span>
        <span class="pin-dot" data-pin="3">3</span>
      </div>
      <div class="pin-row r1">
        <span class="pin-dot" data-pin="1">1</span>
      </div>
      <div class="pin-rack-status" id="pin-rack-status">10 PINS STANDING</div>
    `;
    this.container.appendChild(this.pinRackEl);

    this.pinDots.clear();
    for (let i = 1; i <= 10; i++) {
      const el = this.pinRackEl.querySelector(`[data-pin="${i}"]`) as HTMLElement;
      if (el) this.pinDots.set(i, el);
    }
    this.pinRackStatusEl = this.pinRackEl.querySelector('#pin-rack-status') as HTMLElement;

    // Power Meter HUD (live vertical neon bar)
    this.powerMeterEl = document.createElement('div');
    this.powerMeterEl.className = 'bowling-power-meter';
    this.powerMeterEl.innerHTML = `
      <div class="meter-title">POWER</div>
      <div class="meter-track">
        <div class="meter-fill" id="bowling-power-fill"></div>
      </div>
      <div class="meter-val" id="bowling-power-val">0%</div>
    `;
    this.container.appendChild(this.powerMeterEl);
    this.powerFillEl = this.powerMeterEl.querySelector('#bowling-power-fill') as HTMLElement;
    this.powerValEl = this.powerMeterEl.querySelector('#bowling-power-val') as HTMLElement;

    // Strike Screen Flash Overlay
    this.impactFlashEl = document.createElement('div');
    this.impactFlashEl.className = 'bowling-impact-flash';
    this.container.appendChild(this.impactFlashEl);

    // Strike Celebratory Banner
    this.strikeBannerEl = document.createElement('div');
    this.strikeBannerEl.className = 'bowling-strike-banner';
    this.strikeBannerEl.textContent = '⚡ STRIKE! ⚡';
    this.container.appendChild(this.strikeBannerEl);

    // Turn indicator
    this.turnIndicatorEl = document.createElement('div');
    this.turnIndicatorEl.id = 'bowling-turn';
    this.turnIndicatorEl.style.cssText = `
      position: absolute; bottom: 100px; left: 50%; transform: translateX(-50%);
      background: rgba(10, 0, 20, 0.92); border: 1px solid rgba(136, 0, 255, 0.5);
      border-radius: 999px; padding: 10px 28px; font-family: 'Outfit', 'Inter', sans-serif;
      font-size: 15px; color: #fff; font-weight: 600; letter-spacing: 1px;
      backdrop-filter: blur(8px); z-index: 30; text-align: center; min-width: 280px;
    `;
    this.container.appendChild(this.turnIndicatorEl);

    // Aim guide / controls hint (100% motion-driven, no keys)
    this.aimGuideEl = document.createElement('div');
    this.aimGuideEl.id = 'bowling-aim';
    this.aimGuideEl.style.cssText = `
      position: absolute; bottom: 160px; left: 50%; transform: translateX(-50%);
      color: rgba(136, 0, 255, 0.85); font-family: 'Outfit', 'Inter', sans-serif;
      font-size: 12px; letter-spacing: 2px; text-align: center; z-index: 30;
    `;
    this.aimGuideEl.textContent = '🔄 RAISE / PULL HAND BACK TO CHARGE BOWL';
    this.container.appendChild(this.aimGuideEl);

    // Camera view button
    this.buildCameraViewButton();
  }

  private updatePowerMeter(power: number): void {
    if (!this.powerFillEl || !this.powerValEl) return;
    const pct = Math.round(THREE.MathUtils.clamp(power, 0, 1) * 100);
    this.powerFillEl.style.height = `${pct}%`;
    this.powerValEl.textContent = `${pct}%`;
    if (pct > 75) {
      this.powerFillEl.classList.add('maxed');
    } else {
      this.powerFillEl.classList.remove('maxed');
    }
  }

  private triggerStrikeFlash(): void {
    if (!this.impactFlashEl) return;
    this.impactFlashEl.classList.add('strike-flash');
    setTimeout(() => {
      this.impactFlashEl?.classList.remove('strike-flash');
    }, 140);
  }

  private showStrikeBanner(): void {
    if (!this.strikeBannerEl) return;
    this.strikeBannerEl.classList.add('show');
    setTimeout(() => {
      this.strikeBannerEl?.classList.remove('show');
    }, 1400);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Keyboard Events (Zero Bowling Keys — Strictly Match Restart R & View C)
  // ─────────────────────────────────────────────────────────────────────────

  private keyHandler = (e: KeyboardEvent) => {
    // Camera toggle shortcut
    if (e.key === 'c' || e.key === 'C') {
      this.cycleCameraView();
      return;
    }

    // Match restart / reset
    if (e.key === 'r' || e.key === 'R') {
      this.reset();
      return;
    }

    // Lateral stance adjustments via keyboard
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
      this.playerStanceX = Math.max(-0.65, this.playerStanceX - 0.08);
      if (this.stanceReticleGroup) this.stanceReticleGroup.position.x = this.playerStanceX;
      return;
    }
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
      this.playerStanceX = Math.min(0.65, this.playerStanceX + 0.08);
      if (this.stanceReticleGroup) this.stanceReticleGroup.position.x = this.playerStanceX;
      return;
    }

    // NOTE: Space and Enter keys intentionally DO NOT bowl the ball.
    // The ball release is 100% pure motion-driven via detectSeatedGesture().
  };

  private bindKeyboardEvents(): void {
    window.addEventListener('keydown', this.keyHandler);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Two-Phase Bowling Delivery State Machine (Cock ➔ Ballistic Release)
  // ─────────────────────────────────────────────────────────────────────────

  private detectBowlingGesture(frame: MotionFrame, dt: number): void {
    if (this.startGraceTimer > 0 || this.gestureCooldown > 0 || this.readyWaitTimer > 0) return;
    if (!frame.worldLandmarks || frame.worldLandmarks.length < 17) return;

    const rightWrist = frame.worldLandmarks[PoseLandmark.RIGHT_WRIST];
    const leftWrist = frame.worldLandmarks[PoseLandmark.LEFT_WRIST];
    const rightShoulder = frame.worldLandmarks[PoseLandmark.RIGHT_SHOULDER];
    const leftShoulder = frame.worldLandmarks[PoseLandmark.LEFT_SHOULDER];
    if (!rightWrist && !leftWrist) return;

    const rightVel = frame.velocities ? frame.velocities[PoseLandmark.RIGHT_WRIST] : (frame.metrics?.rightWristVelocity || { x: 0, y: 0, z: 0 });
    const leftVel = frame.velocities ? frame.velocities[PoseLandmark.LEFT_WRIST] : (frame.metrics?.leftWristVelocity || { x: 0, y: 0, z: 0 });

    const rSpeed = Math.hypot(rightVel.x, rightVel.y, rightVel.z);
    const lSpeed = Math.hypot(leftVel.x, leftVel.y, leftVel.z);
    const isLeft = lSpeed > rSpeed * 1.2 && lSpeed > 1.2;
    const wrist = isLeft ? leftWrist : rightWrist;
    const shoulder = isLeft ? leftShoulder : rightShoulder;
    const wristVel = isLeft ? leftVel : rightVel;

    if (!wrist || !shoulder) return;

    const speedMag = Math.hypot(wristVel.x, wristVel.y, wristVel.z);
    const isCockedHighOrBack = wrist.y > shoulder.y + 0.08;

    // Phase 1: Cocking / Setup pose (hand raised/set)
    if (isCockedHighOrBack && this.bowlingPhase === 'IDLE') {
      this.bowlingPhase = 'COCKED';
      this.cockingDuration = 0;
    }

    if (this.bowlingPhase === 'COCKED') {
      this.cockingDuration += dt;
      this.liveWindupPower = THREE.MathUtils.lerp(this.liveWindupPower, Math.min(1.0, this.cockingDuration / 0.6), dt * 6);
      this.updatePowerMeter(this.liveWindupPower);

      if (this.aimGuideEl) {
        this.aimGuideEl.textContent = '🟢 COCKED — SWEEP ARM FORWARD/DOWN TO RELEASE BOWL';
        this.aimGuideEl.style.color = '#39ff14';
      }

      // Phase 2: Ballistic forward/downward bowling delivery stroke
      // Requires high-energy forward/downward velocity (> 4.8 m/s total / > 3.4 m/s forward-down thrust)
      const forwardDownThrust = Math.max(wristVel.z, -wristVel.y, Math.hypot(wristVel.z, wristVel.y));
      if (forwardDownThrust > 3.4 && speedMag > 4.6 && this.cockingDuration > 0.20) {
        const shoulderMidX = (leftShoulder && rightShoulder) ? (leftShoulder.x + rightShoulder.x) / 2 : shoulder.x;
        const deltaX = wrist.x - shoulderMidX;
        const hookAccelX = THREE.MathUtils.clamp(deltaX * -1.6, -1.4, 1.4);
        const lateralBias = THREE.MathUtils.clamp(deltaX * 0.25, -0.3, 0.3);
        const releaseSpeed = THREE.MathUtils.clamp(speedMag * 1.2, 5.0, 9.2);

        this.releaseBall(releaseSpeed, lateralBias, hookAccelX, false);
        this.audio.badmintonWhoosh(releaseSpeed * 0.6);

        this.bowlingPhase = 'IDLE';
        this.cockingDuration = 0;
        this.liveWindupPower = 0;
        this.updatePowerMeter(0);
        this.startGraceTimer = 0.6;
        this.gestureCooldown = 1.2;
      } else if (this.cockingDuration > 3.5) {
        // Timeout reset if holding cocked pose too long
        this.bowlingPhase = 'IDLE';
        this.cockingDuration = 0;
        this.liveWindupPower = 0;
        this.updatePowerMeter(0);
      }
    } else {
      if (this.aimGuideEl) {
        this.aimGuideEl.textContent = '🔄 COCK ARM BACK OR UP TO PREPARE DELIVERY';
        this.aimGuideEl.style.color = 'rgba(136, 0, 255, 0.85)';
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Ball Release & Physics
  // ─────────────────────────────────────────────────────────────────────────

  private releaseBall(forwardSpeed: number, lateralBias: number, hookAccelX = 0, isAI = false): void {
    const mesh = this.ballTemplate.clone() as THREE.Mesh;
    if (isAI) {
      const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
      mat.color.setHex(0x880033);
      mat.emissive.setHex(0x440011);
      mat.emissiveIntensity = 0.5;
      mesh.material = mat;
    }

    const startX = isAI ? this.aiTargetStartX : this.playerStanceX;
    mesh.position.set(startX, BALL_RADIUS, APPROACH_Z + 0.3);
    this.scene.add(mesh);

    this.ball = {
      mesh,
      pos: mesh.position.clone(),
      vel: new THREE.Vector3(lateralBias * 1.2, 0, forwardSpeed),
      active: true,
      hookAccelX,
      isAI,
    };

    this.audio.badmintonHit(50);
    if (!isAI) this.aimGuideEl.style.opacity = '0';
  }

  private stepBallPhysics(dt: number): void {
    if (!this.ball || !this.ball.active) return;
    const b = this.ball;

    // Apply gravity only if ball is airborne
    if (b.pos.y > BALL_RADIUS) {
      b.vel.y -= GRAVITY * dt;
    } else {
      b.pos.y = BALL_RADIUS;
      b.vel.y = Math.max(0, b.vel.y);
    }

    // Smooth lateral velocity steering (no sideways snap)
    if (b.hookAccelX !== 0) {
      const laneProgress = THREE.MathUtils.clamp(
        (b.pos.z - APPROACH_Z) / (PIN_DECK_Z - APPROACH_Z),
        0,
        1
      );
      // Smooth bell/cubic curve for realistic oil-to-dry backend reaction
      const hookProfile = Math.pow(laneProgress, 1.8);
      const targetVelX = b.hookAccelX * 0.75 * hookProfile;
      // Smoothly steer lateral velocity instead of stacking acceleration spikes
      b.vel.x = THREE.MathUtils.lerp(b.vel.x, targetVelX, dt * 5.0);
    }

    // Rolling friction on Z axis
    const speed = Math.abs(b.vel.z);
    const frictionDecel = LANE_FRICTION * GRAVITY * dt;
    if (speed > frictionDecel) {
      b.vel.z -= Math.sign(b.vel.z) * frictionDecel;
    }

    // Gentle lateral stability damping
    const latFriction = b.hookAccelX !== 0 ? 0.008 : LANE_FRICTION;
    b.vel.x *= Math.max(0, 1 - latFriction * dt * 40);

    // Soft gutter boundary clamp
    const maxLaneX = LANE_HALF_WIDTH - BALL_RADIUS;
    if (Math.abs(b.pos.x) > maxLaneX) {
      b.pos.x = Math.sign(b.pos.x) * maxLaneX;
      if (Math.sign(b.vel.x) === Math.sign(b.pos.x)) {
        b.vel.x *= -0.20;
      }
    }

    // Integrate position
    b.pos.addScaledVector(b.vel, dt);
    b.mesh.position.copy(b.pos);

    // Ball rotation (visual)
    const angVel = b.vel.z / BALL_RADIUS;
    b.mesh.rotation.x += angVel * dt;
    b.mesh.rotation.z += (b.vel.x / BALL_RADIUS) * dt;

    // Check pin collisions
    this.checkPinCollisions();

    // Ball reached pin deck or went past
    if (b.pos.z >= PIN_DECK_Z + 1.5) {
      this.finishRoll();
    }

    // Ball stopped
    if (b.vel.length() < 0.2 && b.pos.z > APPROACH_Z + 1) {
      this.finishRoll();
    }
  }

  private checkPinCollisions(): void {
    if (!this.ball) return;
    const bp = this.ball.pos;
    for (const pin of this.pins) {
      if (pin.isDown) continue;
      const dx = bp.x - pin.mesh.position.x;
      const dz = bp.z - pin.mesh.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < BALL_RADIUS + PIN_RADIUS) {
        // Knock pin down
        pin.isDown = true;
        const knockDir = new THREE.Vector3(dx, 0, dz).normalize();
        pin.fallVel.set(knockDir.x * 1.5, 2.5, knockDir.z * 1.5);
        pin.fallAngVel = (Math.random() - 0.5) * 8;
        // Chain reaction
        this.checkPinChain(pin);
        this.audio.bowlingPinHit(1.0);
        this.cameraShakeTrauma = Math.max(this.cameraShakeTrauma, 0.35);
        this.pinsUpCount = this.pins.filter(p => !p.isDown).length;
        this.updatePinRack();
      }
    }
  }

  private checkPinChain(initialKnockedPin: PinState): void {
    const queue: PinState[] = [initialKnockedPin];
    const processed = new Set<number>([initialKnockedPin.pinNumber]);

    while (queue.length > 0) {
      const sourcePin = queue.shift()!;
      for (const pin of this.pins) {
        if (pin.isDown || processed.has(pin.pinNumber)) continue;
        
        const dx = pin.mesh.position.x - sourcePin.mesh.position.x;
        const dz = pin.mesh.position.z - sourcePin.mesh.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        
        // Proximity-weighted cascade threshold (0.35m covers adjacent triangular rack spacing)
        if (dist < 0.35) {
          const fallChance = dist < 0.24 ? 0.90 : 0.60;
          if (Math.random() < fallChance) {
            pin.isDown = true;
            processed.add(pin.pinNumber);
            queue.push(pin); // Propagate to next wave of neighbors
            
            // Propagate dynamic directional scatter from the falling source pin
            const knockDir = new THREE.Vector3(dx, 0.25, dz).normalize();
            pin.fallVel.set(knockDir.x * 1.9, 2.3, knockDir.z * 1.9);
            pin.fallAngVel = (Math.random() - 0.5) * 9;
          }
        }
      }
    }
    
    this.pinsUpCount = this.pins.filter(p => !p.isDown).length;
    this.updatePinRack();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Game Flow
  // ─────────────────────────────────────────────────────────────────────────

  private finishRoll(): void {
    if (!this.ball) return;
    this.scene.remove(this.ball.mesh);
    this.ball = null;

    const knocked = 10 - this.pinsUpCount;
    this.recordRoll(knocked);

    // Enforce 2-second cooldown / get ready wait period
    this.readyWaitTimer = 3.0;
    this.bowlingPhase = 'IDLE';
    this.cockingDuration = 0;
    this.liveWindupPower = 0;
    this.updatePowerMeter(0);
  }

  private recordRoll(knocked: number): void {
    const frames = this.isPlayerTurn ? this.playerFrames : this.aiFrames;
    const frame = this.currentFrame;

    frames[frame] = frames[frame] ?? [];
    frames[frame].push(knocked);
    this.rollInFrame++;

    const rolls = frames[frame];
    const isStrike = this.rollInFrame === 1 && knocked === 10;
    const isSpare = this.rollInFrame === 2 && (rolls[0] + knocked === 10);
    const isTenthFrame = frame === 9;

    // Strike Juice: Hit-stop slow mo, camera screen shake, radial flash, and multi-pin shatter
    if (isStrike) {
      this.hitStopTimer = 0.08;
      this.cameraShakeTrauma = 1.0;
      this.triggerStrikeFlash();
      this.showStrikeBanner();
      this.audio.bowlingStrikeShatter();
    }

    let frameComplete = false;
    if (isStrike && !isTenthFrame) {
      frameComplete = true;
    } else if (this.rollInFrame >= 2 && !isTenthFrame) {
      frameComplete = true;
    } else if (isTenthFrame) {
      const maxRolls = (rolls[0] === 10 || (rolls[0] + (rolls[1] ?? 0)) >= 10) ? 3 : 2;
      if (rolls.length >= maxRolls) {
        frameComplete = true;
      }
    }

    this.updateScoreState();
    this.updateHUD();

    if (frameComplete) {
      if (this.isPlayerTurn && this.opponentMode === 'system') {
        this.isPlayerTurn = false;
        this.setupAITurnParams();
        this.aiRollTimer = 2.5;
        this.aiAimGroup = null;
        this.pinsUpCount = 10;
        this.setAllPinsUp();
        this.rollInFrame = 0;
        this.updateHUD();
      } else {
        this.currentFrame++;
        this.rollInFrame = 0;
        if (this.currentFrame >= 10) {
          this.endMatch();
          return;
        }
        this.isPlayerTurn = true;
        this.pinsUpCount = 10;
        this.setAllPinsUp();
        this.aiRollTimer = 0;
        this.updateHUD();
        this.aimGuideEl.style.opacity = '1';
      }
    } else {
      if (isStrike) this.setAllPinsUp();
      this.aimGuideEl.style.opacity = this.isPlayerTurn ? '1' : '0';
    }
  }

  private setupAITurnParams(): void {
    type DiffParams = { startX: number; hookAccelX: number };
    const diffMap: Record<DifficultyLevel, DiffParams> = {
      casual: { startX: 0.0, hookAccelX: 0.0 },
      pro: { startX: 0.18, hookAccelX: -0.8 },
      legend: { startX: 0.30, hookAccelX: -1.6 },
    };
    const p = diffMap[this.difficulty];
    this.aiTargetStartX = p.startX;
    this.aiHookAccelX = p.hookAccelX;
  }

  private aiRoll(): void {
    type DiffParams = { speed: number; startX: number; hookAccelX: number; accuracy: number };
    const diffMap: Record<DifficultyLevel, DiffParams> = {
      casual: { speed: 4.2, startX: 0.0, hookAccelX: 0.0, accuracy: 0.50 },
      pro: { speed: 5.5, startX: 0.18, hookAccelX: -0.8, accuracy: 0.75 },
      legend: { speed: 6.8, startX: 0.30, hookAccelX: -1.6, accuracy: 0.92 },
    };
    const p = diffMap[this.difficulty];

    const willStrike = Math.random() < p.accuracy;
    const missOffsetX = willStrike ? 0 : (Math.random() - 0.5) * 0.35;
    const initLateralVel = p.startX * -0.3;

    this.releaseBall(
      p.speed,
      initLateralVel + missOffsetX * 0.3,
      p.hookAccelX + (willStrike ? 0 : (Math.random() - 0.5) * 0.4),
      true
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // AI Aim Arc Visualizer
  // ─────────────────────────────────────────────────────────────────────────

  private showAIAimArc(startX: number, hookAccelX: number): void {
    const group = new THREE.Group();
    const dotGeo = new THREE.SphereGeometry(0.025, 8, 6);
    const dotMat = new THREE.MeshBasicMaterial({
      color: 0xff22cc,
      transparent: true,
      opacity: 0.8,
    });

    const STEPS = 28;
    const laneLen = PIN_DECK_Z - APPROACH_Z;

    let simX = startX;
    let simVX = startX * -0.3;
    const simDt = 0.05;

    for (let i = 0; i <= STEPS; i++) {
      const simZ = APPROACH_Z + (i / STEPS) * laneLen;
      const progress = THREE.MathUtils.clamp((simZ - APPROACH_Z) / laneLen, 0, 1);
      const hookProfile = Math.pow(progress, 1.8);
      const targetVelX = hookAccelX * 0.75 * hookProfile;
      simVX = THREE.MathUtils.lerp(simVX, targetVelX, simDt * 5.0);
      simX += simVX * simDt;
      simX = Math.max(-LANE_HALF_WIDTH + 0.05, Math.min(LANE_HALF_WIDTH - 0.05, simX));

      const scale = 0.6 + (i / STEPS) * 1.4;
      const dot = new THREE.Mesh(dotGeo, (dotMat as THREE.MeshBasicMaterial).clone());
      dot.scale.setScalar(scale);
      dot.position.set(simX, 0.008, simZ);
      group.add(dot);
    }

    const arrowGeo = new THREE.ConeGeometry(0.045, 0.12, 8);
    const arrowMat = new THREE.MeshBasicMaterial({ color: 0xff00ff, transparent: true, opacity: 0.9 });
    const arrow = new THREE.Mesh(arrowGeo, arrowMat);
    const lastDot = group.children[group.children.length - 1] as THREE.Mesh;
    arrow.position.set(lastDot.position.x, 0.06, lastDot.position.z);
    arrow.rotation.x = -Math.PI / 2;
    group.add(arrow);

    this.scene.add(group);
    this.aiAimGroup = group;
  }

  private hideAIAimArc(): void {
    if (this.aiAimGroup) {
      this.scene.remove(this.aiAimGroup);
      this.aiAimGroup.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          ((obj as THREE.Mesh).geometry)?.dispose();
          const m = (obj as THREE.Mesh).material;
          if (Array.isArray(m)) m.forEach(x => x.dispose());
          else (m as THREE.Material)?.dispose();
        }
      });
      this.aiAimGroup = null;
    }
  }

  private setAllPinsUp(): void {
    for (const pin of this.pins) {
      pin.isDown = false;
      pin.mesh.position.copy(pin.standingPos);
      pin.mesh.rotation.set(0, 0, 0);
      pin.fallVel.set(0, 0, 0);
      pin.fallAngVel = 0;
      pin.beaconMesh.visible = false;
    }
    this.pinsUpCount = 10;
    this.updatePinRack();
  }

  private updatePinRack(): void {
    if (!this.pinRackEl) return;
    const standingPinNums: number[] = [];

    for (const pin of this.pins) {
      const dot = this.pinDots.get(pin.pinNumber);
      if (pin.isDown) {
        if (dot) dot.className = 'pin-dot down';
        pin.beaconMesh.visible = false;
      } else {
        standingPinNums.push(pin.pinNumber);
        pin.beaconMesh.visible = this.pinsUpCount <= 3;
        if (dot) {
          dot.className = this.pinsUpCount <= 2 ? 'pin-dot standing spare-target' : 'pin-dot standing';
        }
      }
    }

    if (this.pinRackStatusEl) {
      if (this.pinsUpCount === 10) {
        this.pinRackStatusEl.textContent = '10 PINS STANDING';
        this.pinRackStatusEl.className = 'pin-rack-status';
      } else if (this.pinsUpCount === 0) {
        this.pinRackStatusEl.textContent = '⚡ ALL PINS DOWN!';
        this.pinRackStatusEl.className = 'pin-rack-status alert';
      } else if (this.pinsUpCount === 1) {
        this.pinRackStatusEl.textContent = `🎯 1 PIN LEFT: PIN ${standingPinNums[0]}`;
        this.pinRackStatusEl.className = 'pin-rack-status alert';
      } else if (this.pinsUpCount === 2) {
        const isSplit = (standingPinNums.includes(7) && standingPinNums.includes(10)) ||
          (standingPinNums.includes(4) && standingPinNums.includes(10)) ||
          (standingPinNums.includes(6) && standingPinNums.includes(7));
        this.pinRackStatusEl.textContent = isSplit
          ? `🎯 ${standingPinNums[0]}-${standingPinNums[1]} SPLIT!`
          : `🎯 PINS: ${standingPinNums.join(' & ')}`;
        this.pinRackStatusEl.className = 'pin-rack-status alert';
      } else {
        this.pinRackStatusEl.textContent = `${this.pinsUpCount} PINS STANDING`;
        this.pinRackStatusEl.className = 'pin-rack-status';
      }
    }
  }

  private endMatch(): void {
    this.matchOver = true;
    this.hideAIAimArc();
    const { runningTotal: pt } = calcFrameScore(this.playerFrames);
    const playerTotal = pt[pt.length - 1] ?? 0;
    const { runningTotal: at } = calcFrameScore(this.aiFrames);
    const aiTotal = at[at.length - 1] ?? 0;

    this.scoreState.player1Score = playerTotal;
    this.scoreState.player2Score = aiTotal;
    this.scoreState.isGameOver = true;
    this.scoreState.winner = playerTotal >= aiTotal ? 1 : 2;
    this.emitScore();
    this.updateHUD();
    const playerGrade = playerTotal >= 200 ? '🏆 GREAT GAME!' : playerTotal >= 150 ? '👏 SOLID GAME' : '🎳 GOOD EFFORT';
    this.aimGuideEl.innerHTML = `${playerGrade} &nbsp;|&nbsp; You: <strong>${playerTotal}/300</strong> &nbsp;|&nbsp; AI: <strong>${aiTotal}/300</strong> &nbsp;·&nbsp; Press <kbd>R</kbd> to bowl again`;
    this.aimGuideEl.style.opacity = '1';

    this.audio.scoreChime();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Score State & HUD Updates
  // ─────────────────────────────────────────────────────────────────────────

  private updateScoreState(): void {
    const { runningTotal: pt } = calcFrameScore(this.playerFrames);
    const { runningTotal: at } = calcFrameScore(this.aiFrames);
    this.scoreState.player1Score = pt[pt.length - 1] ?? 0;
    this.scoreState.player2Score = at[at.length - 1] ?? 0;
    this.scoreState.rallyCount = this.currentFrame;
    this.emitScore();
  }

  private emitScore(): void {
    const s = { ...this.scoreState };
    for (const cb of this.scoreCallbacks) cb(s);
  }

  private frameMarkLabel(rolls: number[], frameIdx: number): string {
    if (!rolls || rolls.length === 0) return '&nbsp;';
    const r0 = rolls[0];
    const r1 = rolls[1];
    if (frameIdx < 9) {
      if (r0 === 10) return 'X';
      if (r1 !== undefined && r0 + r1 === 10) return `${r0} /`;
      return rolls.map(r => r === 0 ? '-' : String(r)).join(' ');
    } else {
      const parts = rolls.map((r, i) => {
        if (r === 10) return 'X';
        if (i === 1 && rolls[0] !== 10 && rolls[0] + r === 10) return '/';
        if (i === 2 && rolls[1] !== 10 && rolls[1] + r === 10) return '/';
        return r === 0 ? '-' : String(r);
      });
      return parts.join(' ');
    }
  }

  private updateHUD(): void {
    const { frameScores: _pfs, runningTotal: pt } = calcFrameScore(this.playerFrames);
    const { frameScores: _afs, runningTotal: at } = calcFrameScore(this.aiFrames);

    const cols = Array.from({ length: 10 }, (_, i) => {
      const pRolls = this.playerFrames[i] ?? [];
      const aRolls = this.aiFrames[i] ?? [];
      const active = i === this.currentFrame && !this.matchOver;
      const bg = active ? 'rgba(136,0,255,0.25)' : 'transparent';
      return `
        <td style="border:1px solid rgba(136,0,255,0.25); padding:4px 8px; text-align:center; min-width:52px; background:${bg}; border-radius:4px;">
          <div style="font-size:10px; color:#aaa;">${i + 1}</div>
          <div style="font-size:13px; color:#fff; font-weight:700; min-height:16px;">${this.frameMarkLabel(pRolls, i)}</div>
          <div style="font-size:11px; color:#88aaff;">${pt[i] ?? ''}</div>
          <div style="border-top:1px solid rgba(255,68,136,0.2); margin:3px 0; padding-top:3px; font-size:11px; color:#ff88aa;">${this.frameMarkLabel(aRolls, i)}</div>
          <div style="font-size:10px; color:#ff4488;">${at[i] ?? ''}</div>
        </td>`;
    }).join('');

    this.scorecardEl.innerHTML = `
      <table style="border-collapse:separate; border-spacing:2px; width:100%;">
        <tr>
          <td style="padding:4px 10px; font-size:11px; white-space:nowrap; color:#88aaff; font-weight:700; min-width:60px;">👤 YOU</td>
          ${cols}
          <td style="padding:4px 10px; text-align:right; font-size:13px; font-weight:800; color:#88aaff; white-space:nowrap;">
            ${pt[pt.length - 1] ?? 0}
          </td>
        </tr>
        <tr>
          <td style="padding:2px 10px; font-size:10px; color:#ff4488;">🤖 AI</td>
          ${Array.from({ length: 10 }, (_, i) => {
      const aRolls = this.aiFrames[i] ?? [];
      return `<td style="border:1px solid rgba(255,68,136,0.2); padding:2px 8px; text-align:center; font-size:10px; color:#ff88aa;">${at[i] ?? ''}</td>`;
    }).join('')}
          <td style="padding:2px 10px; text-align:right; font-size:12px; font-weight:700; color:#ff4488;">${at[at.length - 1] ?? 0}</td>
        </tr>
      </table>
    `;

    if (this.readyWaitTimer > 0) {
      const secs = Math.ceil(this.readyWaitTimer);
      this.turnIndicatorEl.innerHTML = `⏳ GET READY (${secs}s) — POSITION & RESET STANCE`;
      this.turnIndicatorEl.style.borderColor = 'rgba(245, 158, 11, 0.7)';
    } else if (this.matchOver) {
      const pTotal = pt[pt.length - 1] ?? 0;
      const aTotal = at[at.length - 1] ?? 0;
      const won = pTotal > aTotal;
      const tied = pTotal === aTotal;
      this.turnIndicatorEl.innerHTML = `
        ${won ? '🏆' : tied ? '🤝' : '😔'} MATCH COMPLETE &nbsp;·&nbsp;
        You: <strong>${pTotal}/300</strong> &nbsp;·&nbsp; AI: <strong>${aTotal}/300</strong>
        &nbsp;·&nbsp; ${won ? '🎉 YOU WIN!' : tied ? 'TIE!' : '🤖 AI WINS'}
      `;
      this.turnIndicatorEl.style.borderColor = won ? 'rgba(68,255,136,0.6)' : tied ? 'rgba(200,200,60,0.6)' : 'rgba(255,68,68,0.6)';
    } else if (this.startGraceTimer > 0) {
      this.turnIndicatorEl.innerHTML = `🎯 GET READY &nbsp;·&nbsp; PULL BACK & SWEEP FORWARD TO BOWL`;
      this.turnIndicatorEl.style.borderColor = 'rgba(0,242,254,0.7)';
    } else if (!this.isPlayerTurn) {
      const frameInfo = `Frame ${Math.min(this.currentFrame + 1, 10)} / 10`;
      const phase = this.aiAimGroup !== null ? '🎯 AIMING...' : '⏳ STEPPING UP...';
      this.turnIndicatorEl.innerHTML = `🤖 AI ${phase} &nbsp;·&nbsp; ${frameInfo} &nbsp;·&nbsp; ${this.pinsUpCount} pins up`;
      this.turnIndicatorEl.style.borderColor = 'rgba(255,68,136,0.5)';
    } else {
      const frameInfo = `Frame ${Math.min(this.currentFrame + 1, 10)} / 10`;
      const rollInfo = this.rollInFrame === 0 ? '1st Ball' : '2nd Ball';
      this.turnIndicatorEl.innerHTML = `🎳 YOUR TURN &nbsp;·&nbsp; ${frameInfo} &nbsp;·&nbsp; ${rollInfo} &nbsp;·&nbsp; ${this.pinsUpCount} pins up`;
      this.turnIndicatorEl.style.borderColor = 'rgba(136,0,255,0.5)';
    }

    this.updatePinRack();
  }
}
