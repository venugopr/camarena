import * as THREE from 'three';
import { IGameScene, GameScoreState } from '../common/IGameScene';
import { GameModeId, OpponentMode, DifficultyLevel, MotionFrame, ActionEvent } from '../common/Types';
import { SoundSynthesizer } from '../util/audio/SoundSynthesizer';
import { Avatar3D } from '../badminton/Avatar3D';
import { VectorNormalizer } from '../util/motion/VectorNormalizer';
import { TennisCourt } from './TennisCourt';
import { TennisPhysics, TennisHitResult } from './TennisPhysics';
import { TennisRules } from './TennisRules';
import { TennisAI } from './TennisAI';
import { TennisHUD } from './TennisHUD';
import { TennisSpatialTracker } from './TennisSpatialTracker';

export type TennisCameraPreset = 'broadcast' | 'over_shoulder' | 'court_level';

export class TennisScene implements IGameScene {
  public readonly id: GameModeId = 'tennis';
  public readonly title = 'Lawn Tennis 3D';

  private container!: HTMLElement;
  private audio!: SoundSynthesizer;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;

  // Tennis Subsystems
  private court!: TennisCourt;
  private physics!: TennisPhysics;
  private rules!: TennisRules;
  private ai!: TennisAI;
  private hud!: TennisHUD;
  private vectorNormalizer = new VectorNormalizer();
  private spatialTracker = new TennisSpatialTracker();

  // Standing Motion Gate & Desktop Input Fallback
  private postureModalEl!: HTMLElement;
  public isUsingKeyboardMouse = false;
  private lastInputTime = 0;
  private keysDown: Set<string> = new Set();
  private sunLight!: THREE.DirectionalLight;

  // 1-Bounce Tennis Rule Engine State
  private bouncesThisSide = 0;
  private ballInPlayerZone = false;

  // Player Avatar & Tracking
  private playerAvatar!: Avatar3D;
  private dominantArm: 'right' | 'left' = 'right';
  private playerPosition = new THREE.Vector3(0, 0, -11.5);
  private playerRacketTarget = new THREE.Vector3(0, 1.2, -10.8);
  private playerRacketVelocity = new THREE.Vector3(0, 0, 0);
  private lastPlayerRacketPos = new THREE.Vector3(0, 1.2, -10.8);
  private isPointerActive = false;

  // Camera Presets
  private currentCameraPreset: TennisCameraPreset = 'broadcast';
  private targetCameraPos = new THREE.Vector3(0, 4.8, -17.2);
  private targetCameraLook = new THREE.Vector3(0, 1.2, 2.0);

  // Match & Serve Lifecycle State
  private isServingState = true;
  private serveTossTimer = 0;
  private serveTossActive = false;
  private serveTossPos = new THREE.Vector3();
  private serveTossVel = new THREE.Vector3();
  private aiServeCooldown = 1.2;
  private serveGuideLine!: THREE.Line;
  private lastDominantWristPos = new THREE.Vector3();
  private lastSupportHandPos = new THREE.Vector3();

  // Score callbacks for GameSceneManager & ScoreOverlay
  private scoreCallbacks: ((s: GameScoreState) => void)[] = [];
  private pointTransitionTimer = 0;
  private isTransitioningPoint = false;

  public scoreState: GameScoreState = {
    player1Score: 0,
    player2Score: 0,
    currentServer: 1,
    rallyCount: 0,
    isGameOver: false,
    winner: null,
    lastPointWinner: null,
    targetScore: 11,
    winByTwo: true,
    gameModeTitle: 'Lawn Tennis 3D Pro'
  };

  public get ballMesh(): THREE.Group {
    return this.physics.ballMesh;
  }

  // Match Settings
  private opponentMode: OpponentMode = 'system';
  private difficulty: DifficultyLevel = 'casual';

  // Keyboard handler ref
  private keydownHandler?: (e: KeyboardEvent) => void;
  private keyupHandler?: (e: KeyboardEvent) => void;
  private pointerMoveHandler?: (e: PointerEvent) => void;
  private pointerDownHandler?: (e: PointerEvent) => void;

  public async init(
    container: HTMLElement,
    audio: SoundSynthesizer,
    config?: { opponentMode: OpponentMode; difficulty: DifficultyLevel; targetScore?: number; dominantHand?: 'right' | 'left' }
  ): Promise<void> {
    this.container = container;
    this.audio = audio;
    if (config) {
      this.opponentMode = config.opponentMode;
      this.difficulty = config.difficulty;
      if (config.dominantHand) this.dominantArm = config.dominantHand;
    }
    this.vectorNormalizer.setDominantHand(this.dominantArm);

    this.buildScene();
    this.setupEvents();

    // Activate in-match broadcast bar and mount scoreboard HUD
    const topNav = document.querySelector('.top-nav');
    if (topNav) topNav.classList.add('in-match');
    const scoreWrapper = document.querySelector('.score-wrapper') as HTMLElement;
    if (scoreWrapper) scoreWrapper.style.display = 'flex';

    this.scoreState = {
      player1Score: 0,
      player2Score: 0,
      currentServer: 1,
      rallyCount: 0,
      isGameOver: false,
      winner: null,
      lastPointWinner: null,
      targetScore: this.rules.targetGamesPerSet,
      winByTwo: true,
      gameModeTitle: 'Lawn Tennis 3D Pro'
    };
    this.notifyScore();

    // Register active debug bridge
    (window as any).__camarena_active_scene = this;
  }

  private buildScene(): void {
    // 1. Renderer with antialiasing and shadow map
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.container.appendChild(this.renderer.domElement);

    // 2. Three.js Scene & Australian/US Open Atmosphere
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020a17);
    this.scene.fog = new THREE.FogExp2(0x020a17, 0.015);

    // 3. Camera
    this.camera = new THREE.PerspectiveCamera(54, this.container.clientWidth / this.container.clientHeight, 0.1, 300);
    this.setCameraPreset('broadcast', true);

    // 4. Stadium Floodlights & Ambient Illumination
    this.setupStadiumLighting();

    // 5. ITF Court Geometry & Stadium Props
    this.court = new TennisCourt();
    this.scene.add(this.court.group);

    // 6. Tennis Physics & Ball
    this.physics = new TennisPhysics();
    this.scene.add(this.physics.ballMesh);
    this.scene.add(this.physics.getShadowMesh());
    this.scene.add(this.physics.getTrailMesh());

    // Connect physics bounce & fault events
    this.physics.onBounce = (e) => this.handleBallBounce(e);
    this.physics.onNetFault = (pos) => this.handleNetFault(pos);
    this.physics.onNetTapeLet = (pos) => this.handleNetTapeLet(pos);

    // Holographic Serve Trajectory Line (Option A)
    const guideGeo = new THREE.BufferGeometry();
    const guideMat = new THREE.LineDashedMaterial({
      color: 0x00f2fe,
      dashSize: 0.35,
      gapSize: 0.15,
      transparent: true,
      opacity: 0.75
    });
    this.serveGuideLine = new THREE.Line(guideGeo, guideMat);
    this.serveGuideLine.visible = false;
    this.scene.add(this.serveGuideLine);

    // 7. Tennis Rules Machine (3 Games per set default for snappy arcade match)
    this.rules = new TennisRules(3, 1);

    // 8. Player Humanoid Avatar (Athletic Cyan/Volt Mannequin)
    this.playerAvatar = new Avatar3D({
      primaryColor: 0x00f2fe,
      secondaryColor: 0x38ef7d,
      avatarStyle: 'humanoid'
    });
    this.playerAvatar.setEquipment('tennis');
    this.playerAvatar.setDominantArm(this.dominantArm);
    this.playerAvatar.group.position.copy(this.playerPosition);
    this.playerAvatar.applyDefaultPose('tennis', false);
    this.scene.add(this.playerAvatar.group);

    // 9. Opponent AI (Athletic Crimson/Gold Mannequin)
    this.ai = new TennisAI();
    this.ai.setDifficulty(this.difficulty);
    this.ai.avatar.setDominantArm('right');
    this.scene.add(this.ai.avatar.group);

    // Enable castShadow on player and opponent avatars for outdoor hardcourt shadows
    this.playerAvatar.group.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) c.castShadow = true;
    });
    this.ai.avatar.group.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) c.castShadow = true;
    });

    // 10. Floating Broadcast HUD
    this.hud = new TennisHUD(this.container, () => this.cycleCameraPreset());
    this.hud.updateScore(this.rules.getScoreDetails());

    // 11. Mandatory Standing Posture Gate Modal DOM Element
    this.postureModalEl = document.createElement('div');
    this.postureModalEl.id = 'tennis-posture-modal';
    this.postureModalEl.className = 'hidden';
    this.postureModalEl.innerHTML = `
      <div class="tennis-posture-card">
        <div class="tennis-posture-icon">🧍‍♂️</div>
        <div class="tennis-posture-title">PLEASE STAND UP AT THE BASELINE TO PLAY TENNIS</div>
        <div class="tennis-posture-desc">Step back until your full body and legs are visible in the camera, or press any key / click mouse for desk mode.</div>
        <div class="tennis-posture-hint">DESK BYPASS: PRESS A / D OR CLICK MOUSE TO PLAY SEATED</div>
      </div>
    `;
    this.container.appendChild(this.postureModalEl);

    // Initial Serve Setup
    this.resetForNextServe();
  }

  private setupStadiumLighting(): void {
    // Ambient stadium glow
    const ambient = new THREE.AmbientLight(0xdbeafe, 0.65);
    this.scene.add(ambient);

    // Hemisphere light (sky cyan/blue, ground hardcourt navy)
    const hemi = new THREE.HemisphereLight(0x38bdf8, 0x0f172a, 0.5);
    this.scene.add(hemi);

    // Crisp Directional Sunlight casting real-time shadows on hardcourt
    this.sunLight = new THREE.DirectionalLight(0xfffbeb, 2.5);
    this.sunLight.position.set(14, 30, -12);
    this.sunLight.target.position.set(0, 0, 0);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 5;
    this.sunLight.shadow.camera.far = 70;
    const d = 16;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0004;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // 4 Corner Stadium Floodlight Towers
    const towerCoords = [
      [-10, 16, -18],
      [10, 16, -18],
      [-10, 16, 18],
      [10, 16, 18]
    ];

    for (const [x, y, z] of towerCoords) {
      const flood = new THREE.SpotLight(0xffffff, 2.0, 80, Math.PI / 4, 0.4, 1.2);
      flood.position.set(x, y, z);
      flood.target.position.set(x * 0.2, 0, z * 0.2);
      flood.castShadow = false; // SunLight handles sharp hardcourt shadows efficiently
      this.scene.add(flood);
      this.scene.add(flood.target);
    }
  }

  private setupEvents(): void {
    // Keyboard controls:
    // - Any keypress marks user as using keyboard/mouse (bypassing posture gate)
    // - 'C': camera preset
    // - 'A' / 'D' / Arrow keys: move player avatar laterally
    // - 'Space' / 'Enter': serve toss & hit or groundstroke swing
    this.keydownHandler = (e: KeyboardEvent) => {
      this.keysDown.add(e.code);
      this.keysDown.add(e.key);

      const isBypassKey =
        ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(e.code) ||
        ['w', 'a', 's', 'd', 'W', 'A', 'S', 'D', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(e.key);

      if (isBypassKey) {
        this.isUsingKeyboardMouse = true;
        this.lastInputTime = performance.now();
        if (this.postureModalEl) this.postureModalEl.classList.add('hidden');
      }

      if (e.key === 'c' || e.key === 'C') {
        this.cycleCameraPreset();
      } else if (e.key === ' ' || e.key === 'Enter') {
        if (this.isServingState && this.rules.currentServer === 1) {
          if (!this.serveTossActive) {
            this.startServeToss();
          } else {
            this.executePlayerServe();
          }
        } else if (this.physics.inPlay && this.physics.ballVel.z < 0) {
          this.triggerManualGroundstroke();
        }
      }
    };
    window.addEventListener('keydown', this.keydownHandler);

    this.keyupHandler = (e: KeyboardEvent) => {
      this.keysDown.delete(e.code);
      this.keysDown.delete(e.key);
    };
    window.addEventListener('keyup', this.keyupHandler);

    // Mouse pointer control for desktop / desk testing
    this.pointerMoveHandler = (e: PointerEvent) => {
      this.isUsingKeyboardMouse = true;
      this.lastInputTime = performance.now();
      if (this.postureModalEl) this.postureModalEl.classList.add('hidden');

      const rect = this.container.getBoundingClientRect();
      const normX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const normY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);

      this.isPointerActive = true;
      const targetX = normX * 4.2;
      const targetY = THREE.MathUtils.clamp(1.2 + normY * 0.8, 0.4, 2.2);

      this.playerRacketTarget.set(targetX, targetY, -10.6);

      // If not holding lateral movement keys, mouse steers avatar laterally across court
      const hasLateralKey =
        this.keysDown.has('KeyA') ||
        this.keysDown.has('KeyD') ||
        this.keysDown.has('ArrowLeft') ||
        this.keysDown.has('ArrowRight') ||
        this.keysDown.has('a') ||
        this.keysDown.has('d');
      if (!hasLateralKey) {
        this.playerPosition.x = THREE.MathUtils.clamp(normX * 4.4, -4.5, 4.5);
        this.playerAvatar.group.position.x = this.playerPosition.x;
      }
    };
    this.container.addEventListener('pointermove', this.pointerMoveHandler);

    this.pointerDownHandler = (_e: PointerEvent) => {
      this.isUsingKeyboardMouse = true;
      this.lastInputTime = performance.now();
      if (this.postureModalEl) this.postureModalEl.classList.add('hidden');

      if (this.isServingState && this.rules.currentServer === 1) {
        if (!this.serveTossActive) {
          this.startServeToss();
        } else {
          this.executePlayerServe();
        }
      } else if (this.physics.inPlay && this.physics.ballVel.z < 0) {
        this.triggerManualGroundstroke();
      }
    };
    this.container.addEventListener('pointerdown', this.pointerDownHandler);
  }

  private triggerManualGroundstroke(): void {
    this.playerAvatar.playSwingAnimation(this.physics.ballPos, 0.5, false, this.dominantArm);
    this.playerRacketVelocity.set(0, 2.2, 8.5);

    // If ball is within striking range, attempt strike immediately
    const racketPos = this.playerAvatar.getRacketWorldPosition();
    const dist = racketPos.distanceTo(this.physics.ballPos);
    const ballZ = this.physics.ballPos.z;
    if (ballZ >= -13.0 && ballZ <= -8.5 && dist <= 1.4 && this.physics.ballVel.z < 0) {
      this.executePlayerHit(8.5);
    }
  }

  public setCameraPreset(preset: TennisCameraPreset, immediate = false): void {
    this.currentCameraPreset = preset;

    if (preset === 'broadcast') {
      this.targetCameraPos.set(0, 5.2, -18.0);
      this.targetCameraLook.set(0, 1.1, 2.5);
    } else if (preset === 'over_shoulder') {
      this.targetCameraPos.set(this.playerPosition.x * 0.5, 2.6, this.playerPosition.z - 4.2);
      this.targetCameraLook.set(this.playerPosition.x * 0.25, 1.4, this.playerPosition.z + 9.0);
    } else {
      // court_level
      this.targetCameraPos.set(0, 1.6, -15.0);
      this.targetCameraLook.set(0, 1.0, 2.0);
    }

    if (immediate) {
      this.camera.position.copy(this.targetCameraPos);
      this.camera.lookAt(this.targetCameraLook);
    }

    if (this.hud) this.hud.setCameraName(preset);
  }

  public cycleCameraPreset(): void {
    const sequence: TennisCameraPreset[] = ['broadcast', 'over_shoulder', 'court_level'];
    const curIdx = sequence.indexOf(this.currentCameraPreset);
    const nextPreset = sequence[(curIdx + 1) % sequence.length];
    this.setCameraPreset(nextPreset);
  }

  public setDominantHand(hand: 'right' | 'left'): void {
    this.dominantArm = hand;
    this.playerAvatar.setDominantArm(hand);
    this.vectorNormalizer.setDominantHand(hand);
  }

  public setDominantArm(arm: 'right' | 'left'): void {
    this.setDominantHand(arm);
  }

  public setTargetScore(score: number): void {
    this.rules.targetGamesPerSet = Math.max(1, score);
  }

  public start(): void {
    const topNav = document.querySelector('.top-nav');
    if (topNav) topNav.classList.add('in-match');
    const scoreWrapper = document.querySelector('.score-wrapper') as HTMLElement;
    if (scoreWrapper) scoreWrapper.style.display = 'flex';
    this.resetForNextServe();
    this.notifyScore();
  }

  public pause(): void {
    const topNav = document.querySelector('.top-nav');
    if (topNav) topNav.classList.remove('in-match');
  }

  public resume(): void {
    const topNav = document.querySelector('.top-nav');
    if (topNav) topNav.classList.add('in-match');
  }

  public reset(): void {
    this.rules.resetMatch();
    this.isTransitioningPoint = false;
    this.scoreState = {
      player1Score: 0,
      player2Score: 0,
      currentServer: 1,
      rallyCount: 0,
      isGameOver: false,
      winner: null,
      lastPointWinner: null,
      targetScore: this.rules.targetGamesPerSet,
      winByTwo: true,
      gameModeTitle: 'Lawn Tennis 3D Pro',
      gamesWon1: 0,
      gamesWon2: 0,
      gamesToWinMatch: this.rules.targetGamesPerSet,
      currentGameNumber: 1
    };
    this.resetForNextServe();
    this.notifyScore();
  }

  public setupServe(server: 1 | 2): void {
    this.isServingState = true;
    this.serveTossActive = false;
    this.serveTossTimer = 0;
    this.aiServeCooldown = 1.4;
    this.bouncesThisSide = 0;
    this.ballInPlayerZone = false;
    this.court.hideLandingTarget();
    this.spatialTracker.reset(-11.5);
    Avatar3D.resetStandingCalibration();

    const courtSide = this.rules.serveCourtSide;
    const serverX = courtSide === 'deuce' ? 1.8 : -1.8;

    if (server === 1) {
      this.playerPosition.set(serverX, 0, -11.5);
      this.playerAvatar.group.position.copy(this.playerPosition);

      const supportHand = this.playerAvatar.getSupportHandWorldPosition();
      const isRightHanded = this.dominantArm === 'right';
      const defaultX = this.playerAvatar.group.position.x + (isRightHanded ? -0.22 : 0.22);
      const defaultY = 1.25;
      const defaultZ = this.playerAvatar.group.position.z + 0.35;

      let dockPos: THREE.Vector3;
      if (supportHand && supportHand.y >= 0.95) {
        dockPos = new THREE.Vector3(supportHand.x, supportHand.y + 0.06, supportHand.z + 0.08);
      } else {
        dockPos = new THREE.Vector3(defaultX, defaultY, defaultZ);
      }

      this.physics.prepareServe(1, dockPos.x, dockPos.z, dockPos.y);
      this.physics.inPlay = false;
      this.physics.ballVel.set(0, 0, 0);
      this.physics.ballMesh.position.copy(dockPos);
      this.physics.prevBallPos.copy(dockPos);
      this.physics.ballMesh.visible = true;
      this.ai.resetPosition(false, courtSide);
      this.hud.showCallout('⚡ TOSS & HIT TO SERVE', 'in', 2000);
    } else {
      const aiServerX = courtSide === 'deuce' ? -1.8 : 1.8;
      this.playerPosition.set(courtSide === 'deuce' ? -1.8 : 1.8, 0, -11.89);
      this.playerAvatar.group.position.copy(this.playerPosition);
      this.ai.resetPosition(true, courtSide);

      const aiZ = 11.5;
      const dockPos = new THREE.Vector3(aiServerX + 0.25, 1.4, aiZ - 0.35);
      this.physics.prepareServe(2, dockPos.x, dockPos.z, dockPos.y);
      this.physics.inPlay = false;
      this.physics.ballVel.set(0, 0, 0);
      this.physics.ballMesh.position.copy(dockPos);
      this.physics.prevBallPos.copy(dockPos);
      this.physics.ballMesh.visible = true;
    }

    this.playerAvatar.applyDefaultPose('tennis', false);
    this.lastPlayerRacketPos.copy(this.playerAvatar.getRacketWorldPosition());
    this.lastDominantWristPos.copy(this.playerAvatar.getDominantWristWorldPosition());
    this.lastSupportHandPos.copy(this.playerAvatar.getSupportHandWorldPosition());
    this.hud.updateScore(this.rules.getScoreDetails());
    this.updateServeGuide();
  }

  private resetForNextServe(): void {
    this.setupServe(this.rules.currentServer);
  }

  /**
   * Updates holographic serve trajectory guide line (Option A)
   */
  private updateServeGuide(): void {
    if (!this.serveGuideLine) return;
    if (!this.isServingState || this.rules.currentServer !== 1 || this.serveTossActive) {
      this.serveGuideLine.visible = false;
      return;
    }

    const courtSide = this.rules.serveCourtSide;
    const targetX = courtSide === 'deuce' ? -2.0 : 2.0;
    const targetZ = 4.8;
    const startPos = this.physics.ballPos.clone();
    const endPos = new THREE.Vector3(targetX, 0.05, targetZ);

    const points: THREE.Vector3[] = [];
    const segments = 24;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const x = THREE.MathUtils.lerp(startPos.x, endPos.x, t);
      const z = THREE.MathUtils.lerp(startPos.z, endPos.z, t);
      const arcHeight = Math.sin(t * Math.PI) * 1.8;
      const y = THREE.MathUtils.lerp(startPos.y, endPos.y, t) + arcHeight;
      points.push(new THREE.Vector3(x, y, z));
    }

    this.serveGuideLine.geometry.dispose();
    this.serveGuideLine.geometry = new THREE.BufferGeometry().setFromPoints(points);
    this.serveGuideLine.computeLineDistances();
    this.serveGuideLine.visible = true;
  }

  /**
   * Streamlined Motion-Driven Serve
   * Launches the ball cleanly forward into the opponent's diagonal service box with arc lift and net clearance.
   */
  public executePlayerServe(speedOverride?: number): void {
    if (!this.isServingState || this.rules.currentServer !== 1) return;

    const courtSide = this.rules.serveCourtSide;
    const targetX = courtSide === 'deuce' ? -2.0 : 2.0;
    const targetZ = 4.8;
    const startX = this.physics.ballPos.x;
    const startY = Math.max(1.4, this.physics.ballPos.y);
    const startZ = this.physics.ballPos.z;

    const speed = THREE.MathUtils.clamp(speedOverride ?? 19.0, 16.0, 22.0);
    const flightTime = THREE.MathUtils.clamp(16.5 / speed, 0.72, 0.88);
    const vz = (targetZ - startZ) / flightTime;
    const vx = (targetX - startX) / flightTime;
    const vy = 2.4;

    const serveVel = new THREE.Vector3(vx, vy, vz);
    this.physics.enforceNetClearance(this.physics.ballPos, serveVel, 1.35);
    this.physics.launchServe(1, serveVel, new THREE.Vector3(35, 0, 0));

    this.isServingState = false;
    this.serveTossActive = false;
    this.serveTossTimer = 0;
    this.bouncesThisSide = 0;
    this.ballInPlayerZone = false;
    if (this.serveGuideLine) this.serveGuideLine.visible = false;

    this.playerAvatar.pulseImpact('serve');
    this.playerAvatar.flashStringBedWhite(0.12);
    this.audio.tennisRacketHit(0.95, true);
    this.rules.rallyCount = 1;
    const speedKmh = serveVel.length() * 3.6;
    this.hud.showSpeed(speedKmh, 'FLAT SERVE');
    this.hud.showCallout('ACE SERVE!', 'in', 800);
  }

  /**
   * Two-Stage Overhead Toss Initiation (Option B)
   * Real standing ball toss (raising support hand up)
   */
  public startServeToss(): void {
    if (!this.isServingState || this.rules.currentServer !== 1 || this.serveTossActive) return;

    this.serveTossActive = true;
    this.serveTossTimer = 0;

    const isRightHanded = this.dominantArm === 'right';
    const defaultX = this.playerAvatar.group.position.x + (isRightHanded ? -0.22 : 0.22);
    const defaultY = 1.25;
    const defaultZ = this.playerAvatar.group.position.z + 0.35;

    let tossStart = new THREE.Vector3(defaultX, defaultY, defaultZ);
    try {
      const sHand = this.playerAvatar.getSupportHandWorldPosition();
      if (sHand && sHand.y >= 0.95) {
        tossStart.set(sHand.x, sHand.y + 0.06, sHand.z + 0.08);
      }
    } catch {}

    this.serveTossPos.copy(tossStart);
    this.serveTossVel.set(0, 4.8, 0.3); // vy = +4.8 m/s, vz = +0.3 m/s, vx = 0
    this.physics.ballPos.copy(this.serveTossPos);
    this.physics.prevBallPos.copy(this.serveTossPos);
    this.physics.ballVel.copy(this.serveTossVel);
    this.physics.ballMesh.position.copy(this.physics.ballPos);
    this.physics.ballMesh.visible = true;
    this.physics.inPlay = false; // MUST remain false during toss so TennisPhysics does NOT run gravity/bounce!

    if (this.serveGuideLine) this.serveGuideLine.visible = false;
    this.playerAvatar.playBackswingPose(0.9, this.dominantArm, true);
    this.hud.showCallout('TOSS & HIT!', 'in', 800);
  }

  /**
   * Player initiates service motion (calls executePlayerServe)
   */
  public triggerPlayerServe(): void {
    if (!this.isServingState || this.rules.currentServer !== 1) return;
    this.executePlayerServe();
  }

  /**
   * Main Scene Simulation Loop
   */
  public update(dt: number, motionFrame: MotionFrame | null): void {
    const safeDt = Math.min(dt, 0.05);
    const now = performance.now();

    // 0. Motion tracking vs Keyboard/Mouse state determination
    const hasMotionData = !!(
      motionFrame &&
      ((motionFrame.worldLandmarks && motionFrame.worldLandmarks.length >= 33) ||
        (motionFrame.rawLandmarks && motionFrame.rawLandmarks.length >= 33))
    );

    // If no keyboard/mouse input received for 3.5 seconds and motion tracking frames arrive, switch back to motion mode
    if (this.isUsingKeyboardMouse && now - this.lastInputTime > 3500 && hasMotionData) {
      this.isUsingKeyboardMouse = false;
    }

    // 1. Mandatory Standing Posture Gate with Mouse/Key Bypass
    const isStanding = hasMotionData ? Avatar3D.isFullBodyStanding(motionFrame?.worldLandmarks || []) : false;

    if (!isStanding && !this.isUsingKeyboardMouse) {
      if (this.postureModalEl) {
        this.postureModalEl.classList.remove('hidden');
      }
      // Freeze ball physics and rally state until player stands up or uses keyboard/mouse
      this.renderer.render(this.scene, this.camera);
      return;
    } else {
      if (this.postureModalEl) {
        this.postureModalEl.classList.add('hidden');
      }
    }

    // 2. Lateral Movement & Footwork Mapping (Keyboard/Mouse fallback)
    if (this.isUsingKeyboardMouse) {
      let moveDir = 0;
      if (
        this.keysDown.has('KeyA') ||
        this.keysDown.has('ArrowLeft') ||
        this.keysDown.has('a') ||
        this.keysDown.has('A')
      ) {
        moveDir -= 1;
      }
      if (
        this.keysDown.has('KeyD') ||
        this.keysDown.has('ArrowRight') ||
        this.keysDown.has('d') ||
        this.keysDown.has('D')
      ) {
        moveDir += 1;
      }
      if (moveDir !== 0) {
        const moveSpeed = 6.8;
        this.playerPosition.x = THREE.MathUtils.clamp(
          this.playerPosition.x + moveDir * moveSpeed * safeDt,
          -TennisSpatialTracker.COURT_HALF_WIDTH,
          TennisSpatialTracker.COURT_HALF_WIDTH
        );
      }

      let depthDir = 0;
      if (this.isServingState) {
        this.playerPosition.z = -11.5;
      } else {
        if (
          this.keysDown.has('KeyW') ||
          this.keysDown.has('ArrowUp') ||
          this.keysDown.has('w') ||
          this.keysDown.has('W')
        ) {
          depthDir += 1;
        }
        if (
          this.keysDown.has('KeyS') ||
          this.keysDown.has('ArrowDown') ||
          this.keysDown.has('s') ||
          this.keysDown.has('S')
        ) {
          depthDir -= 1;
        }
        if (depthDir !== 0) {
          this.playerPosition.z = THREE.MathUtils.clamp(
            this.playerPosition.z + depthDir * 5.5 * safeDt,
            TennisSpatialTracker.DEEP_DEFENSE_Z,
            TennisSpatialTracker.VOLLEY_ZONE_Z
          );
        }
      }
      this.spatialTracker.setManualPosition(this.playerPosition.x, this.playerPosition.z);
      this.playerAvatar.group.position.copy(this.playerPosition);
      this.playerAvatar.setFootworkKinematics(
        new THREE.Vector3(moveDir * 6.8, 0, depthDir * 5.5),
        false,
        moveDir > 0 ? 'right' : moveDir < 0 ? 'left' : 'none'
      );
    }

    // 3. Process Webcam or Motion Frame Tracking
    if (hasMotionData && motionFrame) {
      const landmarks = motionFrame.worldLandmarks || motionFrame.rawLandmarks;
      this.playerAvatar.update(landmarks, this.dominantArm, safeDt);

      if (!this.isUsingKeyboardMouse) {
        // Adaptive Living-Room Spatial Mapping (2.0m x 2.0m room footprint to singles half-court)
        const rawLms = motionFrame.rawLandmarks || motionFrame.worldLandmarks;
        const footwork = this.spatialTracker.update(rawLms, safeDt, false);

        if (this.isServingState) {
          // Serve position locked to baseline
          this.playerPosition.x = footwork.position.x;
          this.playerPosition.z = -11.5;
        } else {
          // In-rally full court movement: baseline defense (-12.5m) to net volley zone (-3.5m)
          this.playerPosition.x = footwork.position.x;
          this.playerPosition.z = footwork.position.z;
        }
        this.playerAvatar.group.position.copy(this.playerPosition);

        // Synchronize avatar lower-body animation: trigger procedural split-steps, lunges, and weight transfer
        this.playerAvatar.setFootworkKinematics(
          footwork.velocity,
          footwork.isSplitStepping,
          footwork.lungeDirection
        );
      }

      // Update instantaneous racket velocity & dominant wrist velocity
      const currentRacketPos = this.playerAvatar.getRacketWorldPosition();
      this.playerRacketVelocity
        .subVectors(currentRacketPos, this.lastPlayerRacketPos)
        .divideScalar(Math.max(0.001, safeDt));
      this.lastPlayerRacketPos.copy(currentRacketPos);

      const dominantWrist = this.playerAvatar.getDominantWristWorldPosition();
      const wristSpeed = dominantWrist.distanceTo(this.lastDominantWristPos) / Math.max(0.001, safeDt);
      this.lastDominantWristPos.copy(dominantWrist);

      const supportHand = this.playerAvatar.getSupportHandWorldPosition();
      const supportHandVy = (supportHand.y - this.lastSupportHandPos.y) / Math.max(0.001, safeDt);
      this.lastSupportHandPos.copy(supportHand);

      // Serve toss trigger for webcam motion mode:
      if (this.isServingState && this.rules.currentServer === 1) {
        if (!this.serveTossActive) {
          // Physical upward toss: support hand speed vy > 0.75 m/s
          if (supportHandVy > 0.75 && supportHand.y >= 0.90) {
            this.startServeToss();
          }
        }
      }
    } else {
      // Procedural Desk Pose with mouse target & athletic support arm
      let supportTarget: THREE.Vector3 | undefined = undefined;
      if (this.isServingState && this.rules.currentServer === 1 && !this.serveTossActive) {
        supportTarget = new THREE.Vector3(this.playerPosition.x - 0.25, 1.15, this.playerPosition.z + 0.35);
      } else {
        supportTarget = new THREE.Vector3(
          this.playerPosition.x - (this.dominantArm === 'right' ? 0.35 : -0.35),
          1.05,
          this.playerPosition.z + 0.15
        );
      }
      this.playerAvatar.poseArmsToTargets(this.playerRacketTarget, supportTarget, this.dominantArm, this.playerRacketVelocity);

      // Calculate instantaneous racket velocity
      const currentRacketPos = this.playerAvatar.getRacketWorldPosition();
      this.playerRacketVelocity.subVectors(currentRacketPos, this.lastPlayerRacketPos).divideScalar(Math.max(0.001, safeDt));
      this.lastPlayerRacketPos.copy(currentRacketPos);
    }

    // 4. Serve State Machine & Ball Docking
    if (this.isServingState) {
      if (this.rules.currentServer === 1) {
        if (this.serveTossActive) {
          // State 2: Active Toss Simulation
          this.serveTossTimer += safeDt;
          this.serveTossVel.y -= TennisPhysics.GRAVITY * safeDt;
          this.serveTossPos.addScaledVector(this.serveTossVel, safeDt);
          this.physics.ballPos.copy(this.serveTossPos);
          this.physics.prevBallPos.copy(this.serveTossPos);
          this.physics.ballVel.copy(this.serveTossVel);
          this.physics.ballMesh.position.copy(this.physics.ballPos);
          this.physics.inPlay = false;

          // State 3: Overhead strike check during toss (Y in [1.4m, 2.8m])
          const racketPos = this.playerAvatar.getRacketWorldPosition();
          const distToBall = racketPos.distanceTo(this.physics.ballPos);
          const racketSpeed = this.playerRacketVelocity.length();
          const inStrikeAltitude = this.physics.ballPos.y >= 1.4 && this.physics.ballPos.y <= 2.8;

          if (inStrikeAltitude && ((distToBall <= 0.85 && racketSpeed >= 1.8) || racketSpeed >= 2.2)) {
            this.executePlayerServe(Math.max(18.0, racketSpeed * 3.8));
          }

          // FAIL-SAFE AUTO-CATCH: If player does NOT strike ball and it drops below Y < 0.9m
          if (this.serveTossPos.y < 0.90 && this.serveTossVel.y < 0) {
            this.serveTossActive = false;
            this.serveTossTimer = 0;
            this.physics.ballVel.set(0, 0, 0);
            this.physics.inPlay = false;
            this.hud.showCallout('TOSS AGAIN', 'fault', 1200);
          }
        } else {
          // State 1: Continuous Hand Pinning & Zero-Gravity While Waiting to Serve
          const supportHand = this.playerAvatar.getSupportHandWorldPosition();
          const isRightHanded = this.dominantArm === 'right';
          const defaultX = this.playerAvatar.group.position.x + (isRightHanded ? -0.22 : 0.22);
          const defaultY = 1.25;
          const defaultZ = this.playerAvatar.group.position.z + 0.35;

          if (supportHand && supportHand.y >= 0.95) {
            this.physics.ballPos.set(supportHand.x, supportHand.y + 0.06, supportHand.z + 0.08);
          } else {
            this.physics.ballPos.set(defaultX, defaultY, defaultZ);
          }
          this.physics.ballMesh.position.copy(this.physics.ballPos);
          this.physics.prevBallPos.copy(this.physics.ballPos);
          this.physics.ballVel.set(0, 0, 0);
          this.physics.inPlay = false;
          this.physics.ballMesh.visible = true;

          this.updateServeGuide();
        }
      } else if (this.rules.currentServer === 2) {
        // AI executes serve after brief pause
        this.aiServeCooldown -= safeDt;
        if (this.aiServeCooldown <= 0) {
          this.isServingState = false;
          this.ai.executeAIServe(this.physics, this.rules.serveCourtSide);
          this.audio.tennisRacketHit(0.95, true);
          this.hud.showCallout('AI SERVE', 'in', 900);
        }
      }
    }

    // 5. Integrate Tennis Ball Physics
    this.physics.update(safeDt);
    this.court.update(safeDt);

    // In-Flight Landing Decal & Contracting Timing Ring Projection
    if (this.physics.inPlay && !this.isServingState) {
      const projected = this.physics.predictBounceLanding();
      if (projected) {
        this.court.showLandingTarget(projected.x, projected.z, projected.timeToBounce, projected.z < 0);
      } else {
        this.court.hideLandingTarget();
      }
    } else {
      this.court.hideLandingTarget();
    }

    // Net crossing reset for 1-bounce rule
    if (this.physics.prevBallPos.z > 0 && this.physics.ballPos.z <= 0) {
      this.bouncesThisSide = 0;
      this.ballInPlayerZone = true;
    }
    if (this.physics.prevBallPos.z < 0 && this.physics.ballPos.z >= 0) {
      this.bouncesThisSide = 0;
      this.ballInPlayerZone = false;
    }

    // 6. Player Strike Proximity Check (Groundstroke, Topspin, Slice, or Net Volley)
    if (this.physics.inPlay && this.physics.ballVel.z < 0) {
      const ballZ = this.physics.ballPos.z;
      // Strike zone extends from deep baseline (-13.5m) all the way to net tape (-0.2m)
      if (ballZ >= -13.5 && ballZ <= -0.2) {
        const racketPos = this.playerAvatar.getRacketWorldPosition();
        const dist = racketPos.distanceTo(this.physics.ballPos);
        if (dist <= 0.88) {
          const racketSpeed = this.playerRacketVelocity.length();
          const dominantWrist = this.playerAvatar.getDominantWristWorldPosition();
          const wristSpeed = dominantWrist.distanceTo(this.lastDominantWristPos) / Math.max(0.001, safeDt);
          const maxSpeed = Math.max(racketSpeed, wristSpeed);
          if (maxSpeed >= 1.6) {
            this.executePlayerHit(maxSpeed);
          }
        }
      }

      // Swept OBD disc fallback
      if (this.physics.inPlay && this.physics.ballVel.z < 0) {
        const racketPos = this.playerAvatar.getRacketWorldPosition();
        const racketNormal = this.playerAvatar.getRacketStringNormal();
        const hitResult = this.physics.checkRacketStrike(
          racketPos,
          racketNormal,
          0.26,
          this.playerRacketVelocity,
          true
        );

        if (hitResult.hit) {
          this.executePlayerHit(hitResult.speedKmh / 3.6);
        }
      }
    }

    // 7. Opponent AI Update & Strike Check
    const aiHit = this.ai.update(safeDt, this.physics, this.playerPosition.x, this.playerPosition.z);
    if (aiHit) {
      this.handleAIHit(aiHit);
    }

    // 8. Two-Bounce & Out-of-Bounds Detection
    this.evaluateRallyRules(safeDt);

    // 9. Dynamic Camera Follow
    this.updateCamera(safeDt);

    // 10. Render Scene
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Kinetic Stroke Shaping & User Effort Mapping
   */
  public executePlayerHit(vSwingInput?: number): void {
    if (!this.physics.inPlay || this.physics.ballVel.z >= 0) return;

    this.isServingState = false;
    this.serveTossActive = false;
    this.court.hideLandingTarget();

    const vMotion = this.playerRacketVelocity.length();
    const dominantWrist = this.playerAvatar.getDominantWristWorldPosition();
    const wristSpeed = dominantWrist.distanceTo(this.lastDominantWristPos) / 0.016;
    const vSwing = Math.max(vMotion, vSwingInput ?? 0, 3.2);

    const racketNormal = this.playerAvatar.getRacketStringNormal();
    const racketVy = this.playerRacketVelocity.y;
    const contactY = this.physics.ballPos.y;
    const isVolleyZone = this.playerPosition.z > -7.5 || this.physics.ballPos.z > -7.5;
    const isOverhead = contactY > 2.2 && (wristSpeed > 3.2 || vSwing > 4.2);

    let strokeBadge = 'FLAT DRIVE';
    let shotType: 'DRIVE' | 'TOPSPIN' | 'SLICE' | 'SMASH' | 'VOLLEY' = 'DRIVE';
    let launchSpeed = 29.5 + Math.min(8.5, vSwing * 0.95); // >100 km/h arcade velocity
    let outVy = 3.2;
    let spin = new THREE.Vector3(45, 0, 0);

    if (isOverhead) {
      // 1. Overhead Smash & Serve Pronation: High contact (y > 2.2m) with downward snap (> 3.5 m/s)
      strokeBadge = 'OVERHEAD SMASH';
      shotType = 'SMASH';
      launchSpeed = 35.0 + Math.min(10.0, vSwing * 1.2); // ~126 - 162 km/h
      outVy = -1.2;
      spin.set(80, 0, 0);
    } else if (isVolleyZone && this.bouncesThisSide === 0) {
      // 2. Volley Punch: Short, crisp blocking motion inside Z > -7.0m with instant forward deflection
      strokeBadge = 'VOLLEY PUNCH';
      shotType = 'VOLLEY';
      launchSpeed = 26.0 + Math.min(8.0, vSwing * 0.8);
      outVy = 2.0;
      spin.set(30, 0, 0);
    } else if (racketVy > 0.4 && racketNormal.y <= 0.22) {
      // 3. Topspin Brush: vy_racket > 0.4 m/s, pitch closed (normal.y <= 0.22)
      // Impart +180 rad/s forward spin. Ball dips sharply inside baseline and accelerates forward off bounce.
      strokeBadge = this.dominantArm === 'right' ? 'TOPSPIN FOREHAND' : 'TOPSPIN BACKHAND';
      shotType = 'TOPSPIN';
      launchSpeed = 28.0 + Math.min(10.0, vSwing * 1.05); // ~100-136 km/h
      outVy = 4.6; // High arc that dips aggressively from Magnus force
      spin.set(180, 0, 0);
    } else if (racketVy < -0.3 && racketNormal.y > 0.25) {
      // 4. Slice Cut: vy_racket < -0.3 m/s, pitch open > 15 deg (normal.y > 0.25)
      // Impart -120 rad/s backspin. Ball floats low across net and skids with reduced vertical rebound.
      strokeBadge = 'SLICE CUT';
      shotType = 'SLICE';
      launchSpeed = 24.0 + Math.min(6.5, vSwing * 0.8);
      outVy = 1.9; // Low skimming trajectory with backspin lift
      spin.set(-120, 0, 0);
    } else {
      // 5. Flat Drive: Direct horizontal strike (> 100 km/h)
      strokeBadge = 'FLAT DRIVE';
      shotType = 'DRIVE';
      launchSpeed = 29.5 + Math.min(8.5, vSwing * 1.0);
      outVy = 3.0;
      spin.set(50, 0, 0);
    }

    // Directional control from racket position & swing lateral offset
    const lateralTargetX = THREE.MathUtils.clamp(
      this.playerRacketVelocity.x * 1.6 + (this.physics.ballPos.x - this.playerAvatar.group.position.x) * 1.2,
      -3.6,
      3.6
    );
    const targetZ = 10.5;
    const toTarget = new THREE.Vector3(
      lateralTargetX - this.physics.ballPos.x,
      0,
      targetZ - this.physics.ballPos.z
    ).normalize();

    const hitVel = new THREE.Vector3(
      toTarget.x * launchSpeed * 0.42,
      outVy,
      launchSpeed * Math.abs(toTarget.z || 1.0)
    );

    // Enforce net clearance
    this.physics.enforceNetClearance(this.physics.ballPos, hitVel, shotType === 'SLICE' ? 1.08 : 1.20);

    this.physics.ballVel.copy(hitVel);
    this.physics.ballSpin.copy(spin);
    this.physics.lastHitter = 1;
    this.bouncesThisSide = 0;
    this.ballInPlayerZone = false;
    this.physics.prevBallPos.copy(this.physics.ballPos);

    const speedKmh = hitVel.length() * 3.6;
    this.playerAvatar.pulseImpact(shotType === 'SMASH' ? 'smash' : 'hit');
    this.playerAvatar.flashStringBedWhite(0.1);
    this.audio.tennisRacketHit(Math.min(1.0, speedKmh / 120), shotType === 'SMASH');
    this.rules.rallyCount++;

    // Real-time speedometer reading actual post-impact velocity in KM/H (e.g. "128 KM/H TOPSPIN FOREHAND")
    this.hud.showSpeed(speedKmh, strokeBadge);
    this.hud.showCallout(`⚡ ${Math.round(speedKmh)} KM/H ${strokeBadge}`, 'in', 900);

    this.scoreState.rallyCount = this.rules.rallyCount;
    this.notifyScore();
  }

  private handlePlayerHit(hit: TennisHitResult): void {
    this.executePlayerHit(hit.speedKmh / 3.6);
  }

  private handleAIHit(hit: TennisHitResult): void {
    this.isServingState = false;
    this.audio.tennisRacketHit(Math.min(1.0, hit.speedKmh / 120), hit.shotType === 'SMASH');
    this.rules.rallyCount++;
    this.hud.showSpeed(hit.speedKmh, hit.shotType);
  }

  public handlePointWon(winner: 1 | 2, reason: string): void {
    this.resolvePoint(winner, reason);
  }

  private handleBallBounce(e: { x: number; z: number; side: 'near' | 'far'; bounceCount: number; speedKmh: number }): void {
    if (this.isTransitioningPoint || this.isServingState) return;

    this.court.hideLandingTarget();

    // Check if bounce is in or out of singles boundary
    const isInsideSingles = this.rules.isShotInSinglesCourt(e.x, e.z);

    // Spawn visual chalk impact decal
    this.court.spawnChalkImpact(e.x, e.z, isInsideSingles);
    this.audio.tennisBallBounce(Math.min(1.0, e.speedKmh / 100));

    // Notify AI opponent of ball bounce on far side
    if (e.side === 'far') {
      this.ai.onBallBounce(e.x, e.z);
    }

    // Special Service Rule Check on 1st bounce
    if (e.bounceCount === 1 && this.rules.rallyCount <= 1) {
      const isGoodServe = this.rules.isServeInCorrectBox(e.x, e.z, this.physics.lastHitter);
      if (!isGoodServe) {
        // Service Fault!
        this.handleServiceFault(e.x, e.z);
        return;
      } else {
        this.hud.showCallout('SERVICE IN', 'in', 700);
      }
    }

    // 1-Bounce Rule Handling
    if (e.side === 'near') {
      // Near side (Player side, Z < 0)
      if (this.bouncesThisSide === 0) {
        this.bouncesThisSide = 1;
        if (!isInsideSingles) {
          // Opponent hit out on first bounce! Award point to player
          this.handlePointWon(1, 'Opponent Hit Out! (+1 Player)');
          this.hud.showCallout('OUT! (+1 PLAYER)', 'out', 1200);
          return;
        }
      } else {
        // Second bounce on player's side without being returned!
        this.handlePointWon(2, 'Double Bounce (Point Opponent)');
        this.hud.showCallout('DOUBLE BOUNCE', 'out', 1200);
        return;
      }
    } else {
      // Far side (AI side, Z > 0)
      if (e.bounceCount === 1) {
        if (!isInsideSingles) {
          // Player hit out on first bounce! Award point to opponent
          this.handlePointWon(2, 'Player Hit Out! (+1 Opponent)');
          this.hud.showCallout('OUT! (+1 OPPONENT)', 'out', 1200);
          return;
        }
      } else if (e.bounceCount >= 2) {
        // Double bounce on AI side! Award point to player
        this.handlePointWon(1, 'Double Bounce (Point Player)');
        this.hud.showCallout('DOUBLE BOUNCE', 'in', 1200);
        return;
      }
    }
  }

  private handleServiceFault(x: number, z: number): void {
    if (this.isTransitioningPoint) return;

    const server = this.physics.lastHitter;
    if (!this.rules.isSecondServe) {
      // 1st Serve Fault -> Second Serve
      this.rules.isSecondServe = true;
      this.hud.showCallout('FAULT — 2ND SERVE', 'fault', 1400);
      this.rules.lastPointReason = '1st Serve Fault. Second Serve ready.';
      this.queueNextServe(1.5);
    } else {
      // Double Fault -> Receiver wins the point!
      const receiver: 1 | 2 = server === 1 ? 2 : 1;
      this.resolvePoint(receiver, 'Double Fault! Receiver awards point.');
      this.hud.showCallout('DOUBLE FAULT', 'fault', 1500);
    }
  }

  private handleNetFault(_pos: THREE.Vector3): void {
    if (this.isTransitioningPoint) return;

    this.audio.playPingPongNet();
    const hitter = this.physics.lastHitter;

    if (this.rules.rallyCount <= 1 && this.isServingState) {
      this.handleServiceFault(_pos.x, _pos.z);
      return;
    }

    const opponent: 1 | 2 = hitter === 1 ? 2 : 1;
    this.resolvePoint(opponent, 'Net Fault! Shot failed to cross the net.');
    this.hud.showCallout('NET FAULT', 'fault', 1200);
  }

  private handleNetTapeLet(_pos: THREE.Vector3): void {
    this.audio.playPingPongNet();

    // If on serve: Net Let -> Replay Serve!
    if (this.rules.rallyCount <= 1) {
      this.hud.showCallout('NET TAPE LET — REPLAY', 'in', 1300);
      this.rules.lastPointReason = 'Net tape Let on serve. Replaying serve.';
      this.queueNextServe(1.4);
    } else {
      // In rally: lucky tape cord, ball continues in play!
      this.hud.showCallout('NET CORD!', 'in', 700);
    }
  }

  private evaluateRallyRules(dt: number): void {
    if (this.isTransitioningPoint) {
      this.pointTransitionTimer -= dt;
      if (this.pointTransitionTimer <= 0) {
        this.isTransitioningPoint = false;
        if (!this.rules.isGameOver) {
          this.resetForNextServe();
        }
      }
      return;
    }

    // Out of court boundary check if ball sailed deep past back wall (|Z| > 15m)
    if (this.physics.inPlay && Math.abs(this.physics.ballPos.z) > 15.0) {
      const winner: 1 | 2 = this.physics.lastHitter === 1 ? 2 : 1;
      this.resolvePoint(winner, 'Ball sailed out of the court.');
      this.hud.showCallout('OUT OF BOUNDS', 'out', 1200);
    }
  }

  private resolvePoint(winner: 1 | 2, reason: string): void {
    if (this.isTransitioningPoint || this.rules.isGameOver) return;

    this.isTransitioningPoint = true;
    this.pointTransitionTimer = 1.8;
    this.physics.inPlay = false;

    this.rules.awardPoint(winner, reason);
    const details = this.rules.getScoreDetails();
    this.hud.updateScore(details);

    // Update broadcast scoreState for live HUD & pause modal
    if (winner === 1) {
      this.scoreState.player1Score++;
    } else {
      this.scoreState.player2Score++;
    }
    this.scoreState.lastPointWinner = winner;
    this.scoreState.lastPointReason = reason;
    this.scoreState.currentServer = details.currentServer;
    this.scoreState.rallyCount = this.rules.rallyCount;
    this.scoreState.isGameOver = details.isGameOver;
    this.scoreState.winner = details.matchWinner;
    this.scoreState.gamesWon1 = details.player1Games;
    this.scoreState.gamesWon2 = details.player2Games;
    this.scoreState.gamesToWinMatch = this.rules.targetGamesPerSet;
    this.scoreState.currentGameNumber = details.player1Games + details.player2Games + 1;
    this.scoreState.matchPointText = details.isMatchPoint ? 'MATCH POINT!' : (details.isSetPoint ? 'SET POINT' : (details.isBreakPoint ? 'BREAK POINT' : undefined));

    this.notifyScore();

    if (details.isGameOver) {
      this.audio.playCheer();
    } else if (winner === 1) {
      this.audio.playPointWon();
    }
  }

  private queueNextServe(delaySeconds = 1.4): void {
    this.isTransitioningPoint = true;
    this.pointTransitionTimer = delaySeconds;
    this.physics.inPlay = false;
  }

  private updateCamera(dt: number): void {
    if (this.currentCameraPreset === 'over_shoulder') {
      this.targetCameraPos.set(
        this.playerPosition.x * 0.45,
        2.5,
        this.playerPosition.z - 3.8
      );
      this.targetCameraLook.set(
        this.playerPosition.x * 0.2,
        1.3,
        this.playerPosition.z + 8.5
      );
    }

    const lerpAlpha = Math.min(1.0, dt * 6.0);
    this.camera.position.lerp(this.targetCameraPos, lerpAlpha);

    // Smoothly slerp lookAt
    const curLook = new THREE.Vector3();
    this.camera.getWorldDirection(curLook);
    const targetDir = new THREE.Vector3().subVectors(this.targetCameraLook, this.camera.position).normalize();
    curLook.lerp(targetDir, lerpAlpha);
    this.camera.lookAt(this.camera.position.clone().add(curLook));
  }

  public onAction(event: ActionEvent): void {
    if (event.type === 'OVERHEAD_SMASH' || event.type === 'FOREHAND_DRIVE' || event.type === 'BACKHAND_DRIVE') {
      if (this.isServingState && this.rules.currentServer === 1) {
        if (this.serveTossActive) {
          this.executePlayerServe();
        }
      } else if (this.physics.inPlay && this.physics.ballVel.z < 0) {
        const dist = this.playerAvatar.getRacketWorldPosition().distanceTo(this.physics.ballPos);
        if (dist <= 1.4) {
          this.executePlayerHit(10.0);
        }
      }
    }
  }

  public onResize(width: number, height: number): void {
    if (this.renderer) this.renderer.setSize(width, height);
    if (this.camera) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
  }

  public getScore(): GameScoreState {
    return { ...this.scoreState };
  }

  public onScoreChange(callback: (score: GameScoreState) => void): () => void {
    this.scoreCallbacks.push(callback);
    return () => {
      this.scoreCallbacks = this.scoreCallbacks.filter(c => c !== callback);
    };
  }

  private notifyScore(): void {
    const s = this.getScore();
    for (const cb of this.scoreCallbacks) {
      cb(s);
    }
  }

  private notifyScoreChange(): void {
    this.notifyScore();
  }

  /**
   * Playwright / Automated test bridge hook
   */
  public getDebugState(): any {
    return {
      rallyState: this.physics.inPlay ? 'rally' : (this.serveTossActive ? 'toss' : 'serve_ready'),
      lastHitter: this.physics.lastHitter,
      isBallInPlay: this.physics.inPlay,
      ballPos: { x: this.physics.ballPos.x, y: this.physics.ballPos.y, z: this.physics.ballPos.z },
      ballVel: { x: this.physics.ballVel.x, y: this.physics.ballVel.y, z: this.physics.ballVel.z },
      ballSpin: { x: this.physics.ballSpin.x, y: this.physics.ballSpin.y, z: this.physics.ballSpin.z },
      bounceCountNear: this.physics.bounceCountNear,
      bounceCountFar: this.physics.bounceCountFar,
      bouncesThisSide: this.bouncesThisSide,
      ballInPlayerZone: this.ballInPlayerZone,
      scorePlayer: this.scoreState.player1Score,
      scoreOpponent: this.scoreState.player2Score,
      gamesWonPlayer: this.rules.p1Games,
      gamesWonOpponent: this.rules.p2Games,
      currentServer: this.rules.currentServer,
      rallyCount: this.rules.rallyCount,
      isGameOver: this.rules.isGameOver,
      winner: this.rules.matchWinner,
      dominantHand: this.dominantArm,
      cameraPreset: this.currentCameraPreset,
      isSecondServe: this.rules.isSecondServe,
      serveCourtSide: this.rules.serveCourtSide,
      avatarStyle: this.playerAvatar.getAvatarStyle(),
      isUsingKeyboardMouse: this.isUsingKeyboardMouse,
      serveTossActive: this.serveTossActive,
      playerPosition: { x: this.playerPosition.x, y: this.playerPosition.y, z: this.playerPosition.z }
    };
  }

  /**
   * Playwright / Automated test debug serve hook
   */
  public debugServe(): void {
    if (this.isServingState && this.rules.currentServer === 1) {
      this.executePlayerServe();
    }
  }

  public destroy(): void {
    const topNav = document.querySelector('.top-nav');
    if (topNav) topNav.classList.remove('in-match');

    if (this.keydownHandler) window.removeEventListener('keydown', this.keydownHandler);
    if (this.keyupHandler) window.removeEventListener('keyup', this.keyupHandler);
    if (this.pointerMoveHandler) this.container.removeEventListener('pointermove', this.pointerMoveHandler);
    if (this.pointerDownHandler) this.container.removeEventListener('pointerdown', this.pointerDownHandler);

    if (this.postureModalEl) {
      this.postureModalEl.remove();
    }

    this.court?.destroy();
    this.hud?.destroy();
    this.playerAvatar?.destroy();
    this.ai?.avatar?.destroy();

    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.domElement.remove();
    }
  }
}

