import * as THREE from 'three';
import { IGameScene, GameScoreState } from '../common/IGameScene';
import { GameModeId, OpponentMode, DifficultyLevel, MotionFrame, ActionEvent } from '../common/Types';
import { SoundSynthesizer } from '../util/audio/SoundSynthesizer';
import { Avatar3D } from './Avatar3D';
import { OpponentAI, getBotTarget, solveLaunchVelocity } from '../util/ai/OpponentAI';
import { VectorNormalizer } from '../util/motion/VectorNormalizer';

export class BadmintonScene implements IGameScene {
  public readonly id: GameModeId = 'badminton';
  public readonly title = 'Badminton 3D Pro Arena';

  private container!: HTMLElement;
  private audio!: SoundSynthesizer;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;

  // Characters
  private playerAvatar!: Avatar3D;
  private opponentAvatar!: Avatar3D;
  private opponentAI!: OpponentAI;
  private readonly vectorNormalizer = new VectorNormalizer();

  // First-Person Athletic Arm & Hand Rigs
  private fpRacketGroup!: THREE.Group;
  private fpDominantArmGroup!: THREE.Group;
  private fpSupportArmGroup!: THREE.Group;
  private fpFrameMat!: THREE.MeshStandardMaterial;
  private fpStringMat!: THREE.MeshBasicMaterial;
  private racketRecoilAngle = 0;

  // Shuttlecock
  private shuttleGroup!: THREE.Group;
  private shuttlePos = new THREE.Vector3(0, 2.0, -3.5);
  private shuttleVel = new THREE.Vector3(0, 0, 0);
  private isShuttleHeld = true;
  private isShuttleInPlay = false;
  private rallyState: 'READY_TO_SERVE' | 'IN_PLAY' | 'POINT_AWARDED' | 'GAME_OVER' = 'READY_TO_SERVE';
  private lastHitter: 'player' | 'opponent' | null = null;
  private serveCountdown = 2.5; // Opponent-only serve delay
  private physicsAccumulator = 0;
  private previousRacketPosition = new THREE.Vector3(0, 1.5, -3.5);
  private racketVelocity = new THREE.Vector3();

  // Dynamic Serve & Support Hand Tracking
  private serveAimLine!: THREE.Line;
  private serveLandingReticle!: THREE.Mesh;
  private trackedSupportHandPos = new THREE.Vector3(-0.35, 1.25, -3.8);
  private prevShuttlePos = new THREE.Vector3(0, 2.0, -3.5);

  // Aerodynamic Turnaround Flip
  private shuttleFlipTimer = 0;
  private shuttlePrevQuat = new THREE.Quaternion();
  private shuttleTargetQuat = new THREE.Quaternion();

  // Court geometry
  private readonly courtLength = 13.4;
  private readonly courtWidth = 6.1;
  private readonly singlesCourtWidth = 5.18; // 2.59m half-width for official singles
  private readonly netHeight = 1.55;

  // Active racket position (combined from motion tracking and mouse/pointer)
  private activeRacketPos = new THREE.Vector3(0, 1.5, -3.5);
  private mouseRacketTarget = new THREE.Vector3(0, 1.5, -3.5);
  private isUsingMouse = false;
  private lastMouseTime = performance.now();
  private mouseSpeed = 2.0;
  private playerZ = -4.2;

  // AI Paddle
  private aiPaddlePos = new THREE.Vector3(0, 1.5, 4.2);

  // Net mesh reference (for ripple effect)
  private netMesh!: THREE.Mesh;
  private netHitTimer = 0;
  private netHitBanner?: HTMLElement;
  /** Counts every net-fault collision. Read by Playwright via window.__camarena.getDebugState() */
  private _netFaultCount = 0;

  // Shuttle trail system & depth shadow
  private readonly TRAIL_LENGTH = 12;
  private shuttleTrail: THREE.Vector3[] = [];
  private shuttleTrailMeshes: THREE.Mesh[] = [];
  private shuttleHaloMat!: THREE.MeshBasicMaterial;
  private shuttleHaloMesh!: THREE.Mesh;
  private shuttleFloorShadowMesh!: THREE.Mesh;
  private shuttleFloorShadowMat!: THREE.MeshBasicMaterial;

  // Vertical Altitude Laser Stem & Ballistic Intercept Reticle
  private altitudeStemLine!: THREE.Line;
  private altitudeStemGeo!: THREE.BufferGeometry;
  private incomingTargetPos = new THREE.Vector3(0, 1.4, -3.5);
  private incomingFlightTotalTime = 1.5;
  private incomingFlightStartTime = 0;
  private isIncomingReticleActive = false;

  // 3D Incoming Flight Trajectory Arc
  private incomingTrajectoryLine!: THREE.Line;
  private incomingTrajectoryGeo!: THREE.BufferGeometry;
  private readonly INCOMING_TRAJECTORY_POINTS = 36;
  private lastPlayerShotSpeed = 6.0;
  private lastPlayerShotForwardSpeed = 4.2;

  // In-Flight Predictive Floor Landing Ring (Mario Tennis / Wii Sports Dynamic Target)
  private incomingFloorRingGroup!: THREE.Group;
  private incomingFloorOuterRingMesh!: THREE.Mesh;
  private incomingFloorOuterRingMat!: THREE.MeshBasicMaterial;
  private incomingFloorBullseyeMesh!: THREE.Mesh;
  private incomingFloorBullseyeMat!: THREE.MeshBasicMaterial;
  private incomingFloorLandingPos = new THREE.Vector3(0, 0.02, -3.4);
  private isIncomingFloorRingActive = false;

  // Multi-layered visual impact feedback & procedural camera trauma
  private impactGroup!: THREE.Group;
  private impactParticles: { mesh: THREE.Mesh; velocity: THREE.Vector3 }[] = [];
  private impactFlash!: THREE.Mesh;
  private impactShockwave!: THREE.Mesh;
  private impactShockwaveMat!: THREE.MeshBasicMaterial;
  private impactTimer = 0;
  private impactMaxDuration = 0.36;
  private impactIsSmash = false;
  private cameraTrauma = 0;
  private baseCameraPos = new THREE.Vector3(0, 7.8, -10.8);
  private baseCameraLook = new THREE.Vector3(0, 1.1, 0.2);
  private baseCameraFov = 46;
  private screenImpactFlashEl?: HTMLElement;
  private hitQualityBadgeEl?: HTMLElement;
  private lineCallBadgeEl?: HTMLElement;

  // ─── Section 2: Spring-Damper FOV Punch ────────────────────────────────────
  private fovSpringVel = 0;     // FOV spring velocity (°/s)
  private currentFov = 46;

  // ─── Section 3: Radial Visual Streaks ──────────────────────────────────────
  private streakCanvas?: HTMLCanvasElement;
  private streakCtx?: CanvasRenderingContext2D;
  private streakTimer = 0.22;
  private streakAlpha = 0;
  private streakIsSmash = false;

  // ─── Section 4: Rally Momentum & Tension Escalation ───────────────────────
  private rallyTensionLevel = 0;      // 0.0–1.0 escalates every shot
  private timeScale = 1.0;            // Current time scale for slow-motion
  private timeScaleTarget = 1.0;      // Target time scale
  private ambientLight?: THREE.AmbientLight;
  private ambientLightPulse = 0;      // 0–1 hit-pulse driver
  private sceneFog?: THREE.FogExp2;

  // Chalk decals pool
  private chalkDecals: { group: THREE.Group; ringMesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; life: number; maxLife: number }[] = [];

  // Camera presets
  private currentCameraPreset: 'court_level' | 'broadcast' | 'over_shoulder' = 'broadcast';
  private cameraViewBtn?: HTMLButtonElement;

  // ─── Video Capture (MediaRecorder API) ──────────────────────────────────────────
  private mediaRecorder?: MediaRecorder;
  private recordingStream?: MediaStream;
  private recordedChunks: Blob[] = [];
  private isRecording = false;
  private recordBtn?: HTMLButtonElement;
  private recordingIndicator?: HTMLDivElement;

  // 3D Strike Reticle
  private impactReticleGroup?: THREE.Group;
  private impactOuterRingMesh?: THREE.Mesh;
  private impactOuterRingMat?: THREE.MeshBasicMaterial;
  private impactInnerRingMat?: THREE.MeshBasicMaterial;
  private swingNowCueEl?: HTMLElement;
  private hitStopTimer = 0;
  private swingIntentTimer = 0;
  private lastDebugWristSpeed = 0;
  private lastDebugAction: string = 'READY_STANCE';
  /** Set by click / Space — explicit user serve or return, not webcam jitter. */
  private userSwingIntentTimer = 0;
  /** Wrist speed that sits above typical webcam rest noise (~6.5 km/h). */
  private readonly intentionalSwingMps = 1.8; // ~6.5 km/h natural swing threshold
  /**
   * Swept-Volume: previous-frame racket head world position.
   * Used to build the 3D displacement segment (prevRacketHead → currentRacketHead)
   * for closest-approach distance against the shuttle's path each frame.
   */
  private prevRacketHeadPos = new THREE.Vector3(0, 1.5, -3.5);
  /** Kept for parity — no longer used as primary gate but retained for debug readout. */
  private prevWristSpeed = 0;

  // Player procedural IK swing animation state machine
  private playerSwingTimer = 0;
  private playerSwingDuration = 0.22;
  private playerSwingTarget = new THREE.Vector3();
  private playerSwingIsSmash = false;

  // Serve guidance HUD banner & two-stage arming state machine
  private serveBanner?: HTMLElement;
  private serveCooldownTimer = 0;
  private isServeArmed = false;
  private floorDropGraceTimer = 0;
  private floorDropImmunityTimer = 0;
  private lastNetCrossing: {
    y: number;
    x: number;
    hitter: string | null;
    cleared: boolean;
    timestamp: number;
  } | null = null;
  private pendingNetFault: {
    winner: 1 | 2;
    reason: string;
    timer: number;
  } | null = null;

  // Score
  private targetScore = 11;
  private winByTwo = true;
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
    lastPointReason: undefined,
    matchPointText: undefined,
    gameModeTitle: 'Badminton 3D Pro'
  };

  private scoreCallbacks: ((score: GameScoreState) => void)[] = [];
  private isRunning = false;
  private currentDifficulty: DifficultyLevel = 'casual';
  private currentOpponentMode: OpponentMode = 'system';
  private dominantHand: 'right' | 'left' = 'right';

  // Event handlers for cleanup
  private pointerMoveHandler?: (e: MouseEvent) => void;
  private pointerDownHandler?: (e: MouseEvent) => void;
  private keydownHandler?: (e: KeyboardEvent) => void;

  public init(
    container: HTMLElement,
    audio: SoundSynthesizer,
    config?: { opponentMode: OpponentMode; difficulty: DifficultyLevel; targetScore?: number; dominantHand?: 'right' | 'left' }
  ): void {
    this.container = container;
    this.audio = audio;
    if (config) {
      this.currentDifficulty = config.difficulty;
      this.currentOpponentMode = config.opponentMode;
      if (config.targetScore) {
        this.targetScore = config.targetScore;
        this.scoreState.targetScore = config.targetScore;
      }
      if (config.dominantHand) {
        this.dominantHand = config.dominantHand;
      }
    }

    // Three.js Setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x060913);
    this.scene.fog = new THREE.FogExp2(0x060913, 0.015);

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    // 54° FOV for authentic natural court perspective
    this.camera = new THREE.PerspectiveCamera(this.baseCameraFov, width / height, 0.1, 100);
    this.camera.position.copy(this.baseCameraPos);
    this.camera.lookAt(this.baseCameraLook);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true // Required so canvas.captureStream() captures rendered 3D frames instead of blank buffers
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    container.appendChild(this.renderer.domElement);

    // Arena Lighting
    this.setupLighting();

    // 3D Badminton Court
    this.buildCourt();

    // Player Avatar — crisp, fully visible athletic neon avatar
    this.playerAvatar = new Avatar3D(0x00f2fe, 0x39ff14);
    this.playerAvatar.setEquipment('badminton');
    this.playerAvatar.setDominantArm(this.dominantHand);
    this.playerAvatar.setGhostMode(false);
    this.playerAvatar.group.position.set(0, 0, this.playerZ);
    this.scene.add(this.playerAvatar.group);

    (window as any).__camarena_active_scene = this;

    this.opponentAvatar = new Avatar3D(0xff0055, 0xfacc15);
    this.opponentAvatar.setEquipment('badminton');
    this.opponentAvatar.group.position.set(0, 0, 4.0);
    this.opponentAvatar.group.rotation.y = Math.PI;
    this.opponentAvatar.applyDefaultPose('badminton', true);
    this.scene.add(this.opponentAvatar.group);

    // AI
    this.opponentAI = new OpponentAI(this.currentDifficulty, { x: 0, y: 0, z: 4.2 });

    // Build dedicated first-person racket for court_level view
    this.buildFirstPersonRacket();

    // Apply default camera preset: Olympic TV broadcast view
    this.applyCameraPreset('broadcast');

    // Camera view toggle button
    this.buildCameraViewButton();
    this.buildRecordButton();

    // Serve guidance banner
    this.buildServeBanner();

    // Shuttlecock + trail + depth shadow
    this.buildShuttlecock();
    this.buildShuttleFloorShadow();
    this.buildShuttleTrail();
    this.buildServeTrajectoryArc();
    this.buildIncomingTrajectoryArc();
    this.buildIncomingFloorRing();
    this.buildImpactFeedback();
    this.buildImpactReticle();
    this.buildChalkDecals();
    this.buildStreakOverlay();

    // Net hit notification banner
    this.buildNetHitBanner();

    // Prepare first serve
    this.resetBall(1);

    // Setup interactive mouse / touch controls
    this.setupPointerControls();
  }

  // ─── First-Person Racket & Athletic Arm Rigs ────────────────────────────────

  private buildFirstPersonRacket(): void {
    this.fpRacketGroup = new THREE.Group();

    // Handle grip
    const handleGeo = new THREE.CylinderGeometry(0.016, 0.020, 0.30, 12);
    const handleMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.85 });
    const handle = new THREE.Mesh(handleGeo, handleMat);
    handle.position.y = 0.15;
    this.fpRacketGroup.add(handle);

    // Grip tape ring
    const gripRingGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.025, 12);
    const gripRingMat = new THREE.MeshStandardMaterial({ color: 0x39ff14, roughness: 0.4 });
    const gripRing = new THREE.Mesh(gripRingGeo, gripRingMat);
    gripRing.position.y = 0.28;
    this.fpRacketGroup.add(gripRing);

    // Carbon shaft
    const shaftGeo = new THREE.CylinderGeometry(0.006, 0.008, 0.44, 10);
    const shaftMat = new THREE.MeshStandardMaterial({
      color: 0x0ea5e9, metalness: 0.85, roughness: 0.15,
      emissive: 0x0284c7, emissiveIntensity: 0.3
    });
    const shaft = new THREE.Mesh(shaftGeo, shaftMat);
    shaft.position.y = 0.52;
    this.fpRacketGroup.add(shaft);

    // Racket head frame — neon cyan glow
    const frameGeo = new THREE.TorusGeometry(0.155, 0.012, 10, 36);
    this.fpFrameMat = new THREE.MeshStandardMaterial({
      color: 0x00f2fe, emissive: 0x00f2fe, emissiveIntensity: 0.85,
      metalness: 0.5, roughness: 0.15
    });
    const frame = new THREE.Mesh(frameGeo, this.fpFrameMat);
    frame.scale.set(0.88, 1.18, 1);
    frame.position.y = 0.89;
    this.fpRacketGroup.add(frame);

    // String bed
    const stringGeo = new THREE.CircleGeometry(0.145, 24);
    this.fpStringMat = new THREE.MeshBasicMaterial({
      color: 0xe0f2fe, transparent: true, opacity: 0.5, wireframe: true
    });
    const strings = new THREE.Mesh(stringGeo, this.fpStringMat);
    strings.scale.set(0.88, 1.18, 1);
    strings.position.y = 0.89;
    this.fpRacketGroup.add(strings);

    // Sculpted athletic right/dominant hand and forearm
    this.fpDominantArmGroup = new THREE.Group();
    const gloveMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a, roughness: 0.4, metalness: 0.5
    });
    const wristbandMat = new THREE.MeshStandardMaterial({
      color: 0x00f2fe, emissive: 0x00f2fe, emissiveIntensity: 0.6
    });

    // Forearm extending backward/downward
    const forearmGeo = new THREE.CylinderGeometry(0.034, 0.042, 0.42, 12);
    const forearm = new THREE.Mesh(forearmGeo, gloveMat);
    forearm.position.set(0.04, -0.08, -0.16);
    forearm.rotation.x = -Math.PI * 0.32;
    this.fpDominantArmGroup.add(forearm);

    // Wristband
    const wristbandGeo = new THREE.CylinderGeometry(0.036, 0.036, 0.035, 12);
    const wristband = new THREE.Mesh(wristbandGeo, wristbandMat);
    wristband.position.set(0.02, 0.05, -0.04);
    wristband.rotation.x = -Math.PI * 0.2;
    this.fpDominantArmGroup.add(wristband);

    // Palm wrapping handle
    const palmGeo = new THREE.BoxGeometry(0.052, 0.086, 0.048);
    const palm = new THREE.Mesh(palmGeo, gloveMat);
    palm.position.set(-0.012, 0.15, 0.002);
    this.fpDominantArmGroup.add(palm);

    // Curled fingers wrapping handle
    const fingerMat = new THREE.MeshStandardMaterial({
      color: 0x39ff14, emissive: 0x39ff14, emissiveIntensity: 0.4, roughness: 0.3
    });
    for (let f = 0; f < 4; f++) {
      const fGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.042, 8);
      const finger = new THREE.Mesh(fGeo, fingerMat);
      finger.rotation.z = Math.PI / 2;
      finger.position.set(0.015, 0.11 + f * 0.026, 0.018);
      this.fpDominantArmGroup.add(finger);
    }
    // Thumb
    const thumbGeo = new THREE.CylinderGeometry(0.009, 0.009, 0.036, 8);
    const thumb = new THREE.Mesh(thumbGeo, fingerMat);
    thumb.rotation.x = Math.PI * 0.35;
    thumb.position.set(-0.016, 0.17, -0.022);
    this.fpDominantArmGroup.add(thumb);

    this.fpRacketGroup.add(this.fpDominantArmGroup);
    this.fpRacketGroup.visible = false;
    this.scene.add(this.fpRacketGroup);

    // Build First-Person Non-Dominant Support Arm Rig
    this.fpSupportArmGroup = new THREE.Group();
    const supportArmGeo = new THREE.CylinderGeometry(0.030, 0.038, 0.38, 12);
    const supportArm = new THREE.Mesh(supportArmGeo, gloveMat);
    supportArm.position.set(0, -0.16, -0.14);
    supportArm.rotation.x = -Math.PI * 0.28;
    this.fpSupportArmGroup.add(supportArm);

    const sBandGeo = new THREE.CylinderGeometry(0.033, 0.033, 0.03, 12);
    const sBandMat = new THREE.MeshStandardMaterial({
      color: 0xfbbf24, emissive: 0xfbbf24, emissiveIntensity: 0.6
    });
    const sBand = new THREE.Mesh(sBandGeo, sBandMat);
    sBand.position.set(0, -0.02, -0.02);
    this.fpSupportArmGroup.add(sBand);

    const sPalmGeo = new THREE.BoxGeometry(0.046, 0.068, 0.038);
    const sPalm = new THREE.Mesh(sPalmGeo, gloveMat);
    sPalm.position.set(0, 0.04, 0);
    this.fpSupportArmGroup.add(sPalm);

    // Cupped fingers lightly pinching / supporting shuttlecock
    for (let f = 0; f < 4; f++) {
      const fGeo = new THREE.CylinderGeometry(0.007, 0.007, 0.036, 8);
      const finger = new THREE.Mesh(fGeo, sBandMat);
      finger.position.set(-0.016 + f * 0.011, 0.082, 0.012);
      finger.rotation.x = 0.35;
      this.fpSupportArmGroup.add(finger);
    }
    const sThumbGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.03, 8);
    const sThumb = new THREE.Mesh(sThumbGeo, sBandMat);
    sThumb.position.set(0.024, 0.055, -0.01);
    sThumb.rotation.z = -0.45;
    this.fpSupportArmGroup.add(sThumb);

    this.fpSupportArmGroup.visible = false;
    this.scene.add(this.fpSupportArmGroup);
  }

  // ─── Camera Presets ─────────────────────────────────────────────────────────

  private applyCameraPreset(preset: 'court_level' | 'broadcast' | 'over_shoulder'): void {
    this.currentCameraPreset = preset;

    if (preset === 'court_level') {
      // Natural athletic third-person perspective behind player:
      // Player avatar stands at z = -3.8 in clear view, looking over net to opponent
      this.baseCameraPos.set(0, 2.05, -7.4);
      this.baseCameraLook.set(0, 1.2, 1.5);
      this.baseCameraFov = 54;
      this.camera.fov = 54;
      this.camera.position.copy(this.baseCameraPos);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(this.baseCameraLook);
      this.camera.updateProjectionMatrix();
      this.playerAvatar.group.visible = true;
      this.playerAvatar.setActionOTSVisibility(false);
      if (this.fpRacketGroup) this.fpRacketGroup.visible = false;
      if (this.fpSupportArmGroup) this.fpSupportArmGroup.visible = false;
    } else if (preset === 'broadcast') {
      // High-angle stadium broadcast camera (Olympic reference framing)
      this.baseCameraPos.set(0, 7.8, -10.8);
      this.baseCameraLook.set(0, 1.1, 0.2);
      this.baseCameraFov = 46;
      this.camera.fov = 46;
      this.camera.position.copy(this.baseCameraPos);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(this.baseCameraLook);
      this.camera.updateProjectionMatrix();
      this.playerAvatar.group.visible = true;
      this.playerAvatar.setActionOTSVisibility(false);
      if (this.fpRacketGroup) this.fpRacketGroup.visible = false;
      if (this.fpSupportArmGroup) this.fpSupportArmGroup.visible = false;
    } else if (preset === 'over_shoulder') {
      // Intimate third-person action OTS perspective
      this.baseCameraPos.set(0, 2.35, -5.4);
      this.baseCameraLook.set(0, 1.25, 0.5);
      this.baseCameraFov = 52;
      this.camera.fov = 52;
      this.camera.position.copy(this.baseCameraPos);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(this.baseCameraLook);
      this.camera.updateProjectionMatrix();
      this.playerAvatar.group.visible = true;
      this.playerAvatar.setActionOTSVisibility(false);
      if (this.fpRacketGroup) this.fpRacketGroup.visible = false;
      if (this.fpSupportArmGroup) this.fpSupportArmGroup.visible = false;
    }
  }

  // ─── Serve Trajectory Arc & Reticle ─────────────────────────────────────────

  private buildServeTrajectoryArc(): void {
    const pointsCount = 28;
    const positions = new Float32Array(pointsCount * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.LineDashedMaterial({
      color: 0xfbbf24,
      dashSize: 0.18,
      gapSize: 0.10,
      transparent: true,
      opacity: 0.85
    });

    this.serveAimLine = new THREE.Line(geo, mat);
    this.serveAimLine.computeLineDistances();
    this.serveAimLine.visible = false;
    this.scene.add(this.serveAimLine);

    // Pulsing landing reticle on floor
    const ringGeo = new THREE.RingGeometry(0.10, 0.18, 24);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.45
    });
    this.serveLandingReticle = new THREE.Mesh(ringGeo, ringMat);
    this.serveLandingReticle.rotation.x = -Math.PI / 2;
    this.serveLandingReticle.position.set(0, 0.005, 3.8);
    this.serveLandingReticle.visible = false;
    this.scene.add(this.serveLandingReticle);
  }

  private updateServeTrajectory(origin: THREE.Vector3): void {
    if (!this.serveAimLine || !this.serveLandingReticle) return;

    this.serveAimLine.visible = true;
    this.serveLandingReticle.visible = true;

    // Calculate dynamic serve launch kinematics matching executePlayerServe()
    const speedZ = 11.5;

    const swingX = this.racketVelocity.x;
    const avatarX = this.playerAvatar ? this.playerAvatar.group.position.x : 0;
    const contactOffset = (origin.x - avatarX) / 0.35;
    const serveVX = THREE.MathUtils.clamp((swingX * 0.45) + (contactOffset * 1.2), -3.5, 3.5);

    const targetZ = 3.6; // center of opponent service court
    const dynamicTargetX = THREE.MathUtils.clamp(
      origin.x + (serveVX / (speedZ * 0.75)) * (targetZ - origin.z),
      -this.courtWidth * 0.46,
      this.courtWidth * 0.46
    );

    const targetNetY = 2.35; // Crisp, athletic net crossing arc
    const pointsCount = 28;
    const posAttr = this.serveAimLine.geometry.attributes.position as THREE.BufferAttribute;

    for (let i = 0; i < pointsCount; i++) {
      const t = i / (pointsCount - 1);
      const curX = THREE.MathUtils.lerp(origin.x, dynamicTargetX, t);
      const curZ = THREE.MathUtils.lerp(origin.z, targetZ, t);

      // Normalized parabola peaking before the net and descending
      const arcLift = Math.sin(t * Math.PI) * (targetNetY - Math.min(origin.y, 1.2) + 0.38);
      const curY = THREE.MathUtils.lerp(origin.y, 0.12, t) + Math.max(0, arcLift);

      posAttr.setXYZ(i, curX, curY, curZ);
    }
    posAttr.needsUpdate = true;
    this.serveAimLine.computeLineDistances();

    // Position landing reticle at dynamic aim target
    this.serveLandingReticle.position.set(dynamicTargetX, 0.005, targetZ);
    const pulse = 1.0 + Math.sin(performance.now() * 0.008) * 0.18;
    this.serveLandingReticle.scale.set(pulse, pulse, 1);
  }

  private hideServeTrajectory(): void {
    if (this.serveAimLine) this.serveAimLine.visible = false;
    if (this.serveLandingReticle) this.serveLandingReticle.visible = false;
  }

  // ─── 3D Incoming Trajectory Arc System ──────────────────────────────────────

  private buildIncomingTrajectoryArc(): void {
    const pointsCount = this.INCOMING_TRAJECTORY_POINTS;
    const positions = new Float32Array(pointsCount * 3);
    this.incomingTrajectoryGeo = new THREE.BufferGeometry();
    this.incomingTrajectoryGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.LineDashedMaterial({
      color: 0x00f2fe, // Vibrant radiant neon cyan arc
      dashSize: 0.20,
      gapSize: 0.10,
      transparent: true,
      opacity: 0.90
    });

    this.incomingTrajectoryLine = new THREE.Line(this.incomingTrajectoryGeo, mat);
    this.incomingTrajectoryLine.computeLineDistances();
    this.incomingTrajectoryLine.visible = false;
    this.scene.add(this.incomingTrajectoryLine);
  }

  private updateIncomingTrajectory(origin: THREE.Vector3, velocity: THREE.Vector3, target?: { x: number; z: number }): void {
    if (!this.incomingTrajectoryLine || !this.incomingTrajectoryGeo) return;

    const pointsCount = this.INCOMING_TRAJECTORY_POINTS;
    const posAttr = this.incomingTrajectoryGeo.attributes.position as THREE.BufferAttribute;

    let simX = origin.x;
    let simY = origin.y;
    let simZ = origin.z;
    let simVx = velocity.x;
    let simVy = velocity.y;
    let simVz = velocity.z;

    const simDt = 0.045;
    const DRAG_COEFFICIENT = 0.085;

    for (let i = 0; i < pointsCount; i++) {
      posAttr.setXYZ(i, simX, simY, simZ);

      const speed = Math.hypot(simVx, simVy, simVz);
      const dragMag = DRAG_COEFFICIENT * speed;
      simVx -= dragMag * simVx * simDt;
      simVy -= dragMag * simVy * simDt;
      simVz -= dragMag * simVz * simDt;
      simVy -= 9.81 * simDt;

      simX += simVx * simDt;
      simY += simVy * simDt;
      simZ += simVz * simDt;

      if (simY < 0.05) {
        simY = 0.05;
      }
    }

    posAttr.needsUpdate = true;
    this.incomingTrajectoryLine.computeLineDistances();
    this.incomingTrajectoryLine.visible = true;
  }

  private hideIncomingTrajectory(): void {
    if (this.incomingTrajectoryLine) {
      this.incomingTrajectoryLine.visible = false;
    }
  }

  // ─── In-Flight Predictive Floor Landing Ring ──────────────────────────────

  private buildIncomingFloorRing(): void {
    this.incomingFloorRingGroup = new THREE.Group();

    // Outer pulsing prediction ring on court floor
    const outerGeo = new THREE.RingGeometry(0.28, 0.36, 32);
    this.incomingFloorOuterRingMat = new THREE.MeshBasicMaterial({
      color: 0x00f2fe, // Neon cyan
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85
    });
    this.incomingFloorOuterRingMesh = new THREE.Mesh(outerGeo, this.incomingFloorOuterRingMat);
    this.incomingFloorOuterRingMesh.rotation.x = -Math.PI / 2;
    this.incomingFloorRingGroup.add(this.incomingFloorOuterRingMesh);

    // Inner bright landing focal dot
    const innerGeo = new THREE.CircleGeometry(0.08, 24);
    this.incomingFloorBullseyeMat = new THREE.MeshBasicMaterial({
      color: 0xff0077, // Vibrant neon magenta core
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.90
    });
    this.incomingFloorBullseyeMesh = new THREE.Mesh(innerGeo, this.incomingFloorBullseyeMat);
    this.incomingFloorBullseyeMesh.rotation.x = -Math.PI / 2;
    this.incomingFloorBullseyeMesh.position.y = 0.001;
    this.incomingFloorRingGroup.add(this.incomingFloorBullseyeMesh);

    this.incomingFloorRingGroup.position.set(0, 0.02, -3.4);
    this.incomingFloorRingGroup.visible = false;
    this.scene.add(this.incomingFloorRingGroup);
  }

  private spawnIncomingFloorRing(origin: THREE.Vector3, velocity: THREE.Vector3, target?: { x: number; z: number }): void {
    if (!this.incomingFloorRingGroup) return;

    // Numerical forward simulation to find exact floor landing coordinate (y <= 0.08m)
    let simX = origin.x;
    let simY = origin.y;
    let simZ = origin.z;
    let simVx = velocity.x;
    let simVy = velocity.y;
    let simVz = velocity.z;

    const dt = 0.016; // 60 fps simulation
    const DRAG_COEFFICIENT = 0.085;

    for (let i = 0; i < 240; i++) {
      const speed = Math.hypot(simVx, simVy, simVz);
      const dragMag = DRAG_COEFFICIENT * speed;
      simVx -= dragMag * simVx * dt;
      simVy -= dragMag * simVy * dt;
      simVz -= dragMag * simVz * dt;
      simVy -= 9.81 * dt;

      simX += simVx * dt;
      simY += simVy * dt;
      simZ += simVz * dt;

      if (simY <= 0.08) {
        break;
      }
    }

    // Target fallback if simulation is out of range
    const landingX = THREE.MathUtils.clamp(target ? target.x : simX, -this.singlesCourtWidth * 0.44, this.singlesCourtWidth * 0.44);
    const landingZ = THREE.MathUtils.clamp(target ? target.z : simZ, -4.0, -1.8);

    this.incomingFloorLandingPos.set(landingX, 0.02, landingZ);
    this.incomingFloorRingGroup.position.copy(this.incomingFloorLandingPos);
    this.incomingFloorRingGroup.scale.set(1.2, 1, 1.2);
    this.incomingFloorRingGroup.visible = true;
    this.isIncomingFloorRingActive = true;
  }

  private updateIncomingFloorRing(): void {
    if (!this.incomingFloorRingGroup || !this.isIncomingFloorRingActive) return;

    const isIncoming = this.rallyState === 'IN_PLAY' && this.lastHitter === 'opponent' && this.shuttleVel.z < -0.4;
    if (!isIncoming) {
      this.hideIncomingFloorRing();
      return;
    }

    // Scale dynamically contracts from 1.3 down to 0.40 as shuttle descends toward floor (y: 2.8m -> 0.15m)
    const altitude = Math.max(0.08, this.shuttlePos.y);
    const scaleFactor = THREE.MathUtils.clamp(0.35 + altitude * 0.35, 0.35, 1.35);
    const pulse = 1.0 + Math.sin(performance.now() * 0.012) * 0.08;
    this.incomingFloorRingGroup.scale.set(scaleFactor * pulse, 1, scaleFactor * pulse);

    // Increase opacity as shuttle descends
    if (this.incomingFloorOuterRingMat) {
      this.incomingFloorOuterRingMat.opacity = THREE.MathUtils.clamp(1.0 - altitude * 0.15, 0.65, 0.95);
    }
  }

  private hideIncomingFloorRing(): void {
    this.isIncomingFloorRingActive = false;
    if (this.incomingFloorRingGroup) {
      this.incomingFloorRingGroup.visible = false;
    }
  }

  // ─── Incoming Impact Reticle (Dynamic Timing Ring) ─────────────────────────

  private buildImpactReticle(): void {
    this.impactReticleGroup = new THREE.Group();

    // Outer dynamic timing ring that contracts as shot approaches strike plane
    const outerRingGeo = new THREE.RingGeometry(0.29, 0.35, 32);
    this.impactOuterRingMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.65
    });
    this.impactOuterRingMesh = new THREE.Mesh(outerRingGeo, this.impactOuterRingMat);
    this.impactReticleGroup.add(this.impactOuterRingMesh);

    // Inner bullseye ring (target hit zone)
    const innerRingGeo = new THREE.RingGeometry(0.06, 0.08, 24);
    this.impactInnerRingMat = new THREE.MeshBasicMaterial({
      color: 0x00f2fe,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.45
    });
    const innerRing = new THREE.Mesh(innerRingGeo, this.impactInnerRingMat);
    this.impactReticleGroup.add(innerRing);

    // Center target focal dot
    const centerDotGeo = new THREE.CircleGeometry(0.02, 16);
    const centerDotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.45 });
    const centerDot = new THREE.Mesh(centerDotGeo, centerDotMat);
    this.impactReticleGroup.add(centerDot);

    // 4 Crosshair ticks
    const tickGeo = new THREE.PlaneGeometry(0.015, 0.07);
    const tickMat = new THREE.MeshBasicMaterial({ color: 0x00f2fe, side: THREE.DoubleSide, transparent: true, opacity: 0.45 });
    for (let i = 0; i < 4; i++) {
      const tick = new THREE.Mesh(tickGeo, tickMat);
      const angle = (i * Math.PI) / 2;
      tick.position.set(Math.cos(angle) * 0.22, Math.sin(angle) * 0.22, 0);
      tick.rotation.z = angle;
      this.impactReticleGroup.add(tick);
    }

    this.impactReticleGroup.visible = false;
    this.scene.add(this.impactReticleGroup);

    // ─── Vertical Altitude Drop-Stem (Mario Tennis / Wii Sports Technique) ───
    this.altitudeStemGeo = new THREE.BufferGeometry();
    const stemPositions = new Float32Array(6);
    this.altitudeStemGeo.setAttribute('position', new THREE.BufferAttribute(stemPositions, 3));
    const stemMat = new THREE.LineBasicMaterial({
      color: 0x00f2fe,
      transparent: true,
      opacity: 0.55
    });
    this.altitudeStemLine = new THREE.Line(this.altitudeStemGeo, stemMat);
    this.altitudeStemLine.visible = false;
    this.scene.add(this.altitudeStemLine);
  }

  public hideImpactReticle(): void {
    this.isIncomingReticleActive = false;
    if (this.impactReticleGroup) {
      this.impactReticleGroup.visible = false;
    }
    this.hideIncomingTrajectory();
    this.hideIncomingFloorRing();
    if (this.swingNowCueEl) {
      this.swingNowCueEl.classList.remove('active');
    }
  }

  /**
   * Spawns arrival timing reticle immediately on AI strike frame (t = 0)
   * Predicts ballistic trajectory landing point at player strike plane (z ≈ -3.5m)
   */
  public spawnIncomingInterceptReticle(origin: THREE.Vector3, velocity: THREE.Vector3, target?: { x: number; z: number }): void {
    if (!this.impactReticleGroup || !this.impactOuterRingMesh || !this.impactOuterRingMat) return;

    const strikeZ = target ? target.z : (this.playerAvatar ? this.playerAvatar.group.position.z : -3.5);
    const forwardSpeed = Math.abs(velocity.z);
    if (forwardSpeed < 0.5) return;

    // Aerodynamic flight time: quadratic drag slows vz by ~35% across court length
    const distanceZ = Math.abs(strikeZ - origin.z);
    const estFlightTime = THREE.MathUtils.clamp(distanceZ / (forwardSpeed * 0.78), 1.50, 3.20);

    // Hard clamp target strictly to inner court center (cannot hit sidelines)
    const targetX = target ? target.x : Math.max(-0.8, Math.min(0.8, (Math.random() - 0.5) * 1.6));
    const targetZ = target ? target.z : strikeZ;
    const predY = 1.35; // Ideal strike waist/chest plane height

    this.incomingTargetPos.set(
      THREE.MathUtils.clamp(targetX, -0.80, 0.80),
      THREE.MathUtils.clamp(predY, 0.75, 2.40),
      targetZ
    );

    this.incomingFlightTotalTime = estFlightTime;
    this.incomingFlightStartTime = performance.now();
    this.isIncomingReticleActive = true;

    this.impactReticleGroup.position.copy(this.incomingTargetPos);
    this.impactReticleGroup.lookAt(this.camera.position);
    this.impactReticleGroup.visible = true;

    // Outer ring starts at scale 1.0 on AI strike frame (t = 0)
    this.impactOuterRingMesh.scale.set(1.0, 1.0, 1);
    this.impactOuterRingMat.color.setHex(0xf59e0b);
    this.impactOuterRingMat.opacity = 0.65;
  }

  private updateImpactReticle(): void {
    if (!this.impactReticleGroup || !this.impactOuterRingMesh || !this.impactOuterRingMat) return;

    // Active during incoming opponent shots heading towards player (negative Z velocity)
    const isIncoming = this.rallyState === 'IN_PLAY' && this.lastHitter === 'opponent' && this.shuttleVel.z < -0.6;
    if (!isIncoming) {
      this.hideImpactReticle();
      return;
    }

    // Fallback: If reticle wasn't pre-spawned on opponent strike frame, spawn now
    if (!this.isIncomingReticleActive) {
      this.spawnIncomingInterceptReticle(this.shuttlePos, this.shuttleVel);
    }

    const elapsedSec = (performance.now() - this.incomingFlightStartTime) / 1000;
    const tRemaining = this.incomingFlightTotalTime - elapsedSec;

    // Refine target position based on live coordinates as shuttle approaches
    const strikeZ = this.playerAvatar ? this.playerAvatar.group.position.z : -3.5;
    const deltaZ = strikeZ - this.shuttlePos.z;
    const instantaneousTimeToArrival = Math.abs(deltaZ) / Math.max(0.1, Math.abs(this.shuttleVel.z));

    if (tRemaining < -0.35 || instantaneousTimeToArrival > 3.5) {
      this.hideImpactReticle();
      this.hideIncomingTrajectory();
      return;
    }

    this.impactReticleGroup.visible = true;
    this.impactReticleGroup.position.copy(this.incomingTargetPos);
    this.impactReticleGroup.lookAt(this.camera.position);

    // Continuous smooth contraction from 1.0 at t=0 down to 0.24 at contact window
    const progress = THREE.MathUtils.clamp(elapsedSec / this.incomingFlightTotalTime, 0, 1);
    const ringScale = THREE.MathUtils.lerp(1.0, 0.24, progress);
    this.impactOuterRingMesh.scale.set(ringScale, ringScale, 1);

    // Color stages:
    if (tRemaining <= 0) {
      // Expired / missed window: red flash
      this.impactOuterRingMat.color.setHex(0xef4444);
      this.impactOuterRingMat.opacity = 0.85;
      if (this.swingNowCueEl) this.swingNowCueEl.classList.remove('active');
    } else if (tRemaining <= 0.20 || instantaneousTimeToArrival <= 0.20) {
      // Perfect swing window (t_remaining in [0.0s, 0.20s]): Pulsing neon green (#39ff14)
      this.impactOuterRingMat.color.setHex(0x39ff14);
      const pulseAlpha = 0.85 + Math.sin(performance.now() * 0.03) * 0.15;
      this.impactOuterRingMat.opacity = pulseAlpha;
      if (this.impactInnerRingMat) {
        this.impactInnerRingMat.color.setHex(0x39ff14);
        this.impactInnerRingMat.opacity = pulseAlpha;
      }
      if (this.swingNowCueEl) {
        this.swingNowCueEl.classList.add('active');
      }
    } else {
      // Flight in progress (t_remaining > 0.20s): Amber / orange
      this.impactOuterRingMat.color.setHex(0xf59e0b);
      this.impactOuterRingMat.opacity = 0.65;
      if (this.impactInnerRingMat) {
        this.impactInnerRingMat.color.setHex(0x00f2fe);
        this.impactInnerRingMat.opacity = 0.45;
      }
      if (this.swingNowCueEl) {
        this.swingNowCueEl.classList.remove('active');
      }
    }
  }

  private buildCameraViewButton(): void {
    this.cameraViewBtn = document.createElement('button');
    this.cameraViewBtn.className = 'icon-btn camera-view-toggle-btn glass-panel';
    this.cameraViewBtn.id = 'btn-bm-camera-view';
    this.cameraViewBtn.innerHTML = '<span>📹</span><span>View: Olympic TV</span>';
    this.cameraViewBtn.title = 'Switch Camera View [Key: C]';
    this.cameraViewBtn.onclick = () => this.cycleCameraView();
    this.container.appendChild(this.cameraViewBtn);
  }

  private cycleCameraView(): void {
    if (this.currentCameraPreset === 'broadcast') {
      this.applyCameraPreset('court_level');
      if (this.cameraViewBtn) this.cameraViewBtn.innerHTML = '<span>🎥</span><span>View: Court</span>';
    } else if (this.currentCameraPreset === 'court_level') {
      this.applyCameraPreset('over_shoulder');
      if (this.cameraViewBtn) this.cameraViewBtn.innerHTML = '<span>🎥</span><span>View: Action OTS</span>';
    } else {
      this.applyCameraPreset('broadcast');
      if (this.cameraViewBtn) this.cameraViewBtn.innerHTML = '<span>🎥</span><span>View: Olympic TV</span>';
    }
  }

  // ─── Video Capture ──────────────────────────────────────────────────────────

  private buildRecordButton(): void {
    this.recordBtn = document.createElement('button');
    this.recordBtn.className = 'icon-btn bm-record-btn glass-panel';
    this.recordBtn.id = 'btn-bm-record';
    this.recordBtn.innerHTML = '⚫️ 🔴 REC';
    this.recordBtn.title = 'Start / Stop video capture [Esc to stop]';
    this.recordBtn.onclick = () => {
      if (this.isRecording) {
        this.stopRecording();
      } else {
        this.startRecording();
      }
    };
    this.container.appendChild(this.recordBtn);

    // Live recording indicator pill (top-left corner)
    this.recordingIndicator = document.createElement('div');
    this.recordingIndicator.className = 'bm-recording-indicator';
    this.recordingIndicator.id = 'bm-recording-indicator';
    this.recordingIndicator.innerHTML = '● REC';
    this.recordingIndicator.style.display = 'none';
    this.container.appendChild(this.recordingIndicator);
  }

  private startRecording(): void {
    if (this.isRecording) return;

    // Collect tracks: Three.js canvas stream + optional Web Audio destination stream
    const tracks: MediaStreamTrack[] = [];

    // 1. Video track from the Three.js WebGL canvas (30 fps)
    const canvas = this.renderer.domElement;
    try {
      const canvasStream = (canvas as any).captureStream ? (canvas as any).captureStream(30) : null;
      if (canvasStream) {
        canvasStream.getVideoTracks().forEach((t: MediaStreamTrack) => tracks.push(t));
      }
    } catch (e) {
      console.error('[CamArena] Failed to capture canvas stream:', e);
    }

    if (tracks.length === 0) {
      console.warn('[CamArena] No capturable video tracks found. MediaRecorder not started.');
      return;
    }

    // 2. Audio track from the AudioContext destination, if supported and active
    try {
      const audioCtx = (this.audio as any).ctx as (AudioContext | null);
      if (audioCtx && audioCtx.state !== 'closed' && (audioCtx as any).createMediaStreamDestination) {
        const dest = (audioCtx as any).createMediaStreamDestination() as MediaStreamAudioDestinationNode;
        audioCtx.destination.connect(dest);
        dest.stream.getAudioTracks().forEach(t => tracks.push(t));
      }
    } catch (_) {
      // Audio capture not available — record video only
    }

    const stream = new MediaStream(tracks);
    this.recordingStream = stream;

    // Codec priority: MP4 (H.264) plays natively in Windows Media Player; fall back to WebM
    const mimeCandidates = [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4;codecs=avc1,opus',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm'
    ];
    const selectedMime = mimeCandidates.find(t => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) || '';

    this.recordedChunks = [];
    try {
      this.mediaRecorder = new MediaRecorder(stream, {
        mimeType: selectedMime || undefined,
        videoBitsPerSecond: 6_000_000
      });
    } catch (err) {
      console.warn('[CamArena] Falling back to default MediaRecorder options:', err);
      this.mediaRecorder = new MediaRecorder(stream);
    }

    const actualMime = this.mediaRecorder.mimeType || selectedMime || 'video/webm';

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.recordedChunks.push(e.data);
    };

    this.mediaRecorder.onstop = () => {
      this.isRecording = false;
      this.updateRecordButtonState();
      this.saveRecording(actualMime);
      this.recordingStream?.getTracks().forEach(track => track.stop());
      this.recordingStream = undefined;
    };

    this.mediaRecorder.start(200); // Collect chunk slices every 200 ms
    this.isRecording = true;
    this.updateRecordButtonState();
    console.log(`[CamArena] 🔴 Recording started (${actualMime}) — Press Esc or button to stop and save.`);
  }

  public stopRecording(): void {
    if (!this.isRecording || !this.mediaRecorder) return;
    if (this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
  }

  private saveRecording(mimeType: string): void {
    if (this.recordedChunks.length === 0) {
      console.warn('[CamArena] No recorded data available to save.');
      return;
    }

    const isMp4 = mimeType.toLowerCase().includes('mp4');
    const ext = isMp4 ? 'mp4' : 'webm';
    const blob = new Blob(this.recordedChunks, { type: mimeType || (isMp4 ? 'video/mp4' : 'video/webm') });
    const url = URL.createObjectURL(blob);

    // Build timestamped filename
    const now = new Date();
    const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    const filename = `CamArena_Badminton_${ts}.${ext}`;

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    try {
      a.click();
    } finally {
      // Keep the link and object URL alive while Chrome queues the asynchronous download.
      setTimeout(() => {
        a.remove();
        URL.revokeObjectURL(url);
      }, 30_000);
    }

    this.recordedChunks = [];
    console.log(`[CamArena] ✅ Video saved: ${filename} (${(blob.size / 1_048_576).toFixed(2)} MB, type: ${mimeType})`);
  }

  private updateRecordButtonState(): void {
    if (this.recordBtn) {
      if (this.isRecording) {
        this.recordBtn.innerHTML = '⏹️ STOP';
        this.recordBtn.classList.add('is-recording');
        this.recordBtn.title = 'Stop recording and save [Esc]';
      } else {
        this.recordBtn.innerHTML = '⚫️ 🔴 REC';
        this.recordBtn.classList.remove('is-recording');
        this.recordBtn.title = 'Start video capture [Esc to stop]';
      }
    }
    if (this.recordingIndicator) {
      this.recordingIndicator.style.display = this.isRecording ? 'flex' : 'none';
    }
  }

  // ─── Serve Banner ───────────────────────────────────────────────────────────


  private buildServeBanner(): void {
    this.serveBanner = document.createElement('div');
    this.serveBanner.className = 'serve-guidance-banner';
    this.serveBanner.id = 'bm-serve-banner';
    this.serveBanner.style.cssText = `
      position: absolute; top: 76px; left: 50%; transform: translateX(-50%);
      background: rgba(0, 242, 254, 0.14); border: 1.5px solid rgba(0, 242, 254, 0.6);
      border-radius: 12px; padding: 10px 28px; color: #00f2fe;
      font-family: 'Inter', sans-serif; font-size: 15px; font-weight: 700;
      letter-spacing: 0.06em; text-align: center; backdrop-filter: blur(8px);
      pointer-events: none; z-index: 30; display: none;
      animation: servePulse 1.4s ease-in-out infinite;
      box-shadow: 0 4px 20px rgba(0, 242, 254, 0.25);
    `;
    this.container.appendChild(this.serveBanner);
  }

  private showServeBanner(text: string, state: 'amber' | 'ready' | 'opponent' = 'ready'): void {
    if (!this.serveBanner) return;
    this.serveBanner.textContent = text;
    this.serveBanner.classList.remove('amber', 'ready');
    if (state === 'amber') {
      this.serveBanner.classList.add('amber');
    } else if (state === 'ready') {
      this.serveBanner.classList.add('ready');
    }
    this.serveBanner.style.display = 'block';
  }

  private hideServeBanner(): void {
    if (!this.serveBanner) return;
    this.serveBanner.style.display = 'none';
  }

  // ─── Pointer Controls ───────────────────────────────────────────────────────

  private setupPointerControls(): void {
    this.pointerMoveHandler = (e: MouseEvent) => {
      const rect = this.container.getBoundingClientRect();
      const normX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const normY = ((e.clientY - rect.top) / rect.height) * 2 - 1;

      const now = performance.now();
      const dtMouse = Math.max(0.001, (now - this.lastMouseTime) / 1000);
      this.lastMouseTime = now;

      // Map to badminton player court zone
      const newX = normX * (this.courtWidth / 2 + 0.5);
      const newY = 1.0 + (1 - (normY + 1) / 2) * 2.2; // 1.0m to 3.2m height

      const distMoved = Math.hypot(newX - this.mouseRacketTarget.x, newY - this.mouseRacketTarget.y);
      this.mouseSpeed = THREE.MathUtils.lerp(this.mouseSpeed, distMoved / dtMouse, 0.35);

      this.mouseRacketTarget.x = newX;
      this.mouseRacketTarget.y = newY;
      this.isUsingMouse = true;
    };

    this.pointerDownHandler = () => {
      this.userSwingIntentTimer = 0.45;
      this.triggerSwing(true);
    };

    this.keydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Escape: stop an active recording (if any) — no other scene-level escape action needed
        if (this.isRecording) this.stopRecording();
      } else if (e.key === 'c' || e.key === 'C') {
        this.cycleCameraView();
      } else if (e.key === ' ') {
        e.preventDefault();
        this.userSwingIntentTimer = 0.45;
        this.triggerSwing(true);
      } else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        this.mouseRacketTarget.x -= 0.55;
        this.mouseSpeed = 2.8;
        this.isUsingMouse = true;
      } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        this.mouseRacketTarget.x += 0.55;
        this.mouseSpeed = 2.8;
        this.isUsingMouse = true;
      } else if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        this.playerZ = Math.min(-1.7, this.playerZ + 0.40);
        this.mouseRacketTarget.y = Math.min(this.mouseRacketTarget.y + 0.25, 3.5);
        this.mouseSpeed = 3.2;
        this.isUsingMouse = true;
      } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
        this.playerZ = Math.max(-4.5, this.playerZ - 0.40);
        this.mouseRacketTarget.y = Math.max(this.mouseRacketTarget.y - 0.25, 0.6);
        this.mouseSpeed = 2.0;
        this.isUsingMouse = true;
      }
    };

    this.container.addEventListener('mousemove', this.pointerMoveHandler);
    this.container.addEventListener('mousedown', this.pointerDownHandler);
    window.addEventListener('keydown', this.keydownHandler);
  }

  private triggerSwing(isUserInitiated = false): void {
    if (this.rallyState === 'READY_TO_SERVE' && this.scoreState.currentServer === 1) {
      if (this.isServeStrikeRegistered(this.mouseSpeed, 0, isUserInitiated)) {
        this.executePlayerServe(this.shuttlePos);
      }
      return;
    }

    if (this.rallyState === 'IN_PLAY' && this.lastHitter !== 'player') {
      this.swingIntentTimer = 0.25;
      const inPlayerZone = this.shuttlePos.z <= -1.2 && this.shuttleVel.z < 0.2;
      if (inPlayerZone) {
        const racketHeadPos = this.playerAvatar.getRacketHeadWorldPosition();
        const dist3D = racketHeadPos.distanceTo(this.shuttlePos);
        const sweptDist = this.distanceToSegment(racketHeadPos, this.prevShuttlePos, this.shuttlePos);
        const effectiveDist = Math.min(dist3D, sweptDist);

        if (effectiveDist <= 1.25 && isUserInitiated) {
          this.hitStopTimer = 0.016;
          this.floorDropGraceTimer = 0;
          this.swingIntentTimer = 0;
          this.userSwingIntentTimer = 0;
          this.executePlayerHit(
            racketHeadPos,
            Math.max(this.mouseSpeed, 3.2),
            this.mouseRacketTarget.y > 2.2 || this.shuttlePos.y < 1.30
          );
        }
      }
    }
  }

  public triggerPlayerSwing(targetPos: THREE.Vector3, isSmash = false, duration = 0.22): void {
    this.playerSwingTimer = duration;
    this.playerSwingDuration = duration;
    this.playerSwingTarget.copy(targetPos);
    this.playerSwingIsSmash = isSmash;
    this.playerAvatar.playSwingAnimation(this.playerSwingTarget, 0.35, isSmash, this.dominantHand);
  }

  private distanceToSegment(point: THREE.Vector3, start: THREE.Vector3, end: THREE.Vector3): number {
    const segment = end.clone().sub(start);
    const lengthSq = segment.lengthSq();
    if (lengthSq < 1e-8) return point.distanceTo(start);
    const t = THREE.MathUtils.clamp(point.clone().sub(start).dot(segment) / lengthSq, 0, 1);
    return point.distanceTo(start.clone().addScaledVector(segment, t));
  }

  /**
   * Swept-Volume: closest 3D distance between two finite line segments.
   * Segment A: (a0 → a1) — racket head swept path this frame.
   * Segment B: (b0 → b1) — shuttlecock path this frame.
   * Returns the minimum distance between any point on A and any point on B.
   */
  private closestApproachSegSeg(
    a0: THREE.Vector3, a1: THREE.Vector3,
    b0: THREE.Vector3, b1: THREE.Vector3
  ): number {
    const d1 = a1.clone().sub(a0); // racket direction
    const d2 = b1.clone().sub(b0); // shuttle direction
    const r  = a0.clone().sub(b0);

    const a = d1.dot(d1);
    const e = d2.dot(d2);
    const f = d2.dot(r);

    let s: number, t: number;

    if (a <= 1e-8 && e <= 1e-8) {
      // Both segments degenerate to points
      return a0.distanceTo(b0);
    }
    if (a <= 1e-8) {
      s = 0;
      t = THREE.MathUtils.clamp(f / e, 0, 1);
    } else {
      const c = d1.dot(r);
      if (e <= 1e-8) {
        t = 0;
        s = THREE.MathUtils.clamp(-c / a, 0, 1);
      } else {
        const b = d1.dot(d2);
        const denom = a * e - b * b;
        s = denom !== 0 ? THREE.MathUtils.clamp((b * f - c * e) / denom, 0, 1) : 0;
        t = (b * s + f) / e;
        if (t < 0) {
          t = 0;
          s = THREE.MathUtils.clamp(-c / a, 0, 1);
        } else if (t > 1) {
          t = 1;
          s = THREE.MathUtils.clamp((b - c) / a, 0, 1);
        }
      }
    }

    const closestA = a0.clone().addScaledVector(d1, s);
    const closestB = b0.clone().addScaledVector(d2, t);
    return closestA.distanceTo(closestB);
  }

  // ─── Lighting ───────────────────────────────────────────────────────────────

  private setupLighting(): void {
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
    this.scene.add(this.ambientLight);

    // Store fog reference for tension-driven density ramp
    this.sceneFog = this.scene.fog as THREE.FogExp2;

    const stadiumLight1 = new THREE.DirectionalLight(0xffffff, 1.4);
    stadiumLight1.position.set(5, 9, 0);
    stadiumLight1.castShadow = true;
    stadiumLight1.shadow.mapSize.width = 1024;
    stadiumLight1.shadow.mapSize.height = 1024;
    this.scene.add(stadiumLight1);

    const stadiumLight2 = new THREE.DirectionalLight(0xffffff, 1.4);
    stadiumLight2.position.set(-5, 9, 0);
    this.scene.add(stadiumLight2);

    // Cyan court accent light near player baseline
    const accentLight = new THREE.PointLight(0x00f2fe, 2.5, 20);
    accentLight.position.set(0, 4, -4);
    this.scene.add(accentLight);

    // Magenta opponent side accent
    const pinkLight = new THREE.PointLight(0xff0055, 2, 18);
    pinkLight.position.set(0, 4, 4);
    this.scene.add(pinkLight);

    // Stadium spotlight cones aimed down at court & net
    const netSpotlight = new THREE.SpotLight(0x00f2fe, 1.8, 25, Math.PI / 4, 0.45, 1.2);
    netSpotlight.position.set(0, 10, 0);
    netSpotlight.target.position.set(0, 0, 0);
    this.scene.add(netSpotlight);
    this.scene.add(netSpotlight.target);
  }

  // ─── Tokyo 2020 Olympic Stencil Texture Generator ──────────────────────────

  private createTokyo2020Texture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 1024, 256);

    // "TOKYO 2020" Crisp Stencil Typography
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 68px "Inter", "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TOKYO 2020', 512, 72);

    // 5 Olympic Rings in White Stencil
    const ringRadius = 24;
    const ringLineWidth = 5.5;
    const cx = 512;
    const cy = 172;
    const xStep = 56;
    const ringCenters = [
      { x: cx - xStep * 2, y: cy - 14 },
      { x: cx, y: cy - 14 },
      { x: cx + xStep * 2, y: cy - 14 },
      { x: cx - xStep, y: cy + 14 },
      { x: cx + xStep, y: cy + 14 }
    ];

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = ringLineWidth;
    for (const pos of ringCenters) {
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, ringRadius, 0, Math.PI * 2);
      ctx.stroke();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  // ─── Court ──────────────────────────────────────────────────────────────────

  private buildCourt(): void {
    // 1. Official Tokyo 2020 BWF vibrant green tournament mat
    const courtGeo = new THREE.PlaneGeometry(this.courtWidth, this.courtLength);
    const courtMat = new THREE.MeshStandardMaterial({
      color: 0x127447,
      roughness: 0.55,
      metalness: 0.05
    });
    const courtMesh = new THREE.Mesh(courtGeo, courtMat);
    courtMesh.rotation.x = -Math.PI / 2;
    courtMesh.receiveShadow = true;
    this.scene.add(courtMesh);

    // 2. Tokyo 2020 Olympic Crimson Red surrounding floor mat (16m x 22m)
    const redFloorGeo = new THREE.PlaneGeometry(16, 22);
    const redFloorMat = new THREE.MeshStandardMaterial({
      color: 0x9e1b32,
      roughness: 0.65,
      metalness: 0.05
    });
    const redFloor = new THREE.Mesh(redFloorGeo, redFloorMat);
    redFloor.rotation.x = -Math.PI / 2;
    redFloor.position.y = -0.005;
    redFloor.receiveShadow = true;
    this.scene.add(redFloor);

    // 3. Dark Outer Stadium Arena Floor
    const stadiumGeo = new THREE.PlaneGeometry(36, 46);
    const stadiumMat = new THREE.MeshStandardMaterial({ color: 0x080c14, roughness: 0.85 });
    const stadiumFloor = new THREE.Mesh(stadiumGeo, stadiumMat);
    stadiumFloor.rotation.x = -Math.PI / 2;
    stadiumFloor.position.y = -0.012;
    this.scene.add(stadiumFloor);

    // 4. Tokyo 2020 Olympic Stencils on the Red Floor
    const tokyo2020Tex = this.createTokyo2020Texture();
    const stencilMatNear = new THREE.MeshBasicMaterial({
      map: tokyo2020Tex,
      transparent: true,
      opacity: 0.92,
      depthWrite: false
    });
    const stencilNearGeo = new THREE.PlaneGeometry(6.4, 1.6);
    const stencilNear = new THREE.Mesh(stencilNearGeo, stencilMatNear);
    stencilNear.rotation.x = -Math.PI / 2;
    stencilNear.position.set(0, 0.001, -8.0);
    this.scene.add(stencilNear);

    const stencilMatFar = new THREE.MeshBasicMaterial({
      map: tokyo2020Tex,
      transparent: true,
      opacity: 0.92,
      depthWrite: false
    });
    const stencilFar = new THREE.Mesh(stencilNearGeo, stencilMatFar);
    stencilFar.rotation.x = -Math.PI / 2;
    stencilFar.rotation.z = Math.PI; // Face outwards / towards far side
    stencilFar.position.set(0, 0.001, 8.0);
    this.scene.add(stencilFar);

    // 5. White Court Lines (BWF regulation singles & doubles markings)
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const addLine = (w: number, h: number, x: number, z: number) => {
      const lineGeo = new THREE.PlaneGeometry(w, h);
      const line = new THREE.Mesh(lineGeo, lineMat);
      line.rotation.x = -Math.PI / 2;
      line.position.set(x, 0.002, z);
      this.scene.add(line);
    };

    const halfW = this.courtWidth / 2; // 3.05m
    const halfL = this.courtLength / 2; // 6.70m
    const halfSinglesW = this.singlesCourtWidth / 2; // 2.59m
    const lineThickness = 0.045;

    // Doubles outer boundaries
    addLine(this.courtWidth, lineThickness, 0, halfL);
    addLine(this.courtWidth, lineThickness, 0, -halfL);
    addLine(lineThickness, this.courtLength, halfW, 0);
    addLine(lineThickness, this.courtLength, -halfW, 0);

    // Singles sidelines (2.59m half-width)
    addLine(lineThickness, this.courtLength, halfSinglesW, 0);
    addLine(lineThickness, this.courtLength, -halfSinglesW, 0);

    // Net line (Z = 0)
    addLine(this.courtWidth, lineThickness * 1.4, 0, 0);

    // Short service lines (1.98m from net)
    addLine(this.courtWidth, lineThickness, 0, 1.98);
    addLine(this.courtWidth, lineThickness, 0, -1.98);

    // Doubles long service lines (0.76m inside back baseline)
    addLine(this.courtWidth, lineThickness, 0, halfL - 0.76);
    addLine(this.courtWidth, lineThickness, 0, -(halfL - 0.76));

    // Center service line (between short service line and back baseline)
    addLine(lineThickness, halfL - 1.98, 0, (halfL + 1.98) / 2);
    addLine(lineThickness, halfL - 1.98, 0, -(halfL + 1.98) / 2);

    // 6. Net Posts
    const postGeo = new THREE.CylinderGeometry(0.04, 0.04, this.netHeight, 16);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8 });
    const postLeft = new THREE.Mesh(postGeo, postMat);
    postLeft.position.set(-halfW - 0.1, this.netHeight / 2, 0);
    this.scene.add(postLeft);
    const postRight = new THREE.Mesh(postGeo, postMat);
    postRight.position.set(halfW + 0.1, this.netHeight / 2, 0);
    this.scene.add(postRight);

    // 7. Net mesh
    const netMeshGeo = new THREE.PlaneGeometry(this.courtWidth + 0.2, 0.76);
    const netMat = new THREE.MeshStandardMaterial({
      color: 0x242424,
      emissive: 0x000000,
      emissiveIntensity: 0,
      transparent: true, opacity: 0.65, side: THREE.DoubleSide
    });
    this.netMesh = new THREE.Mesh(netMeshGeo, netMat);
    this.netMesh.position.set(0, this.netHeight - 0.38, 0);
    this.scene.add(this.netMesh);

    const tapeGeo = new THREE.BoxGeometry(this.courtWidth + 0.2, 0.08, 0.03);
    const tapeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const tape = new THREE.Mesh(tapeGeo, tapeMat);
    tape.position.set(0, this.netHeight, 0);
    this.scene.add(tape);

    // 8. Umpire High Chair (Tokyo 2020 tournament high stand on right side of net at X = +3.8, Z = 0)
    const umpireChairGroup = new THREE.Group();
    umpireChairGroup.position.set(3.8, 0, 0);

    const metalFrameMat = new THREE.MeshStandardMaterial({ color: 0x2563eb, metalness: 0.7, roughness: 0.3 });
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5 });
    const silverMat = new THREE.MeshStandardMaterial({ color: 0xd1d5db, metalness: 0.8, roughness: 0.2 });

    // 4 angled ladder legs
    const legGeo = new THREE.CylinderGeometry(0.025, 0.03, 1.95, 8);
    const legFL = new THREE.Mesh(legGeo, metalFrameMat);
    legFL.position.set(-0.25, 0.95, -0.28);
    legFL.rotation.z = -0.08;
    legFL.rotation.x = -0.06;
    umpireChairGroup.add(legFL);

    const legFR = new THREE.Mesh(legGeo, metalFrameMat);
    legFR.position.set(0.25, 0.95, -0.28);
    legFR.rotation.z = 0.08;
    legFR.rotation.x = -0.06;
    umpireChairGroup.add(legFR);

    const legBL = new THREE.Mesh(legGeo, metalFrameMat);
    legBL.position.set(-0.25, 0.95, 0.28);
    legBL.rotation.z = -0.08;
    legBL.rotation.x = 0.06;
    umpireChairGroup.add(legBL);

    const legBR = new THREE.Mesh(legGeo, metalFrameMat);
    legBR.position.set(0.25, 0.95, 0.28);
    legBR.rotation.z = 0.08;
    legBR.rotation.x = 0.06;
    umpireChairGroup.add(legBR);

    // Ladder rungs
    for (let r = 1; r <= 4; r++) {
      const rungGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.46, 8);
      const rung = new THREE.Mesh(rungGeo, silverMat);
      rung.rotation.z = Math.PI / 2;
      rung.position.set(0, r * 0.38, -0.26 + (r * 0.02));
      umpireChairGroup.add(rung);
    }

    // High seat platform
    const platformGeo = new THREE.BoxGeometry(0.65, 0.05, 0.65);
    const platform = new THREE.Mesh(platformGeo, metalFrameMat);
    platform.position.set(0, 1.82, 0);
    umpireChairGroup.add(platform);

    // Chair seat cushion
    const seatGeo = new THREE.BoxGeometry(0.50, 0.08, 0.46);
    const seat = new THREE.Mesh(seatGeo, seatMat);
    seat.position.set(0, 1.88, 0.02);
    umpireChairGroup.add(seat);

    // Chair backrest
    const backGeo = new THREE.BoxGeometry(0.48, 0.44, 0.06);
    const back = new THREE.Mesh(backGeo, seatMat);
    back.position.set(0, 2.12, 0.24);
    umpireChairGroup.add(back);

    // Umpire desk / clipboard holder
    const deskGeo = new THREE.BoxGeometry(0.48, 0.03, 0.24);
    const desk = new THREE.Mesh(deskGeo, silverMat);
    desk.position.set(0, 2.05, -0.24);
    umpireChairGroup.add(desk);

    // Canopy pillar & sunshade roof
    const canopyPillarGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.70, 8);
    const canopyPillar = new THREE.Mesh(canopyPillarGeo, silverMat);
    canopyPillar.position.set(0, 2.50, 0.24);
    umpireChairGroup.add(canopyPillar);

    const canopyGeo = new THREE.BoxGeometry(0.75, 0.03, 0.85);
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.4 });
    const canopy = new THREE.Mesh(canopyGeo, canopyMat);
    canopy.position.set(0, 2.85, 0);
    canopy.rotation.x = -0.08;
    umpireChairGroup.add(canopy);

    this.scene.add(umpireChairGroup);

    // 9. Shuttlecock Caddy Stand (left side of net at X = -3.8, Z = 0)
    const caddyGroup = new THREE.Group();
    caddyGroup.position.set(-3.8, 0, 0);

    const baseGeo = new THREE.CylinderGeometry(0.24, 0.28, 0.06, 16);
    const caddyBase = new THREE.Mesh(baseGeo, silverMat);
    caddyBase.position.y = 0.03;
    caddyGroup.add(caddyBase);

    const colGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.88, 12);
    const col = new THREE.Mesh(colGeo, silverMat);
    col.position.y = 0.47;
    caddyGroup.add(col);

    const trayGeo = new THREE.CylinderGeometry(0.18, 0.14, 0.20, 16, 1, true);
    const trayMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4, side: THREE.DoubleSide });
    const tray = new THREE.Mesh(trayGeo, trayMat);
    tray.position.set(0, 0.92, 0);
    tray.rotation.z = 0.12;
    caddyGroup.add(tray);

    for (let s = 0; s < 2; s++) {
      const miniCork = new THREE.Mesh(
        new THREE.SphereGeometry(0.024, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0xffffff })
      );
      miniCork.position.set(-0.04 + s * 0.08, 0.96, 0);
      caddyGroup.add(miniCork);

      const miniFeathers = new THREE.Mesh(
        new THREE.ConeGeometry(0.04, 0.07, 10, 1, true),
        new THREE.MeshStandardMaterial({ color: 0xf8fafc, side: THREE.DoubleSide })
      );
      miniFeathers.position.set(-0.04 + s * 0.08, 0.92, 0);
      miniFeathers.rotation.x = Math.PI;
      caddyGroup.add(miniFeathers);
    }

    this.scene.add(caddyGroup);

    // 10. LED boundary runners along tournament red mat side borders
    const ledMat = new THREE.MeshBasicMaterial({ color: 0x00f2fe });
    const ledLeft = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 20.0), ledMat);
    ledLeft.rotation.x = -Math.PI / 2;
    ledLeft.position.set(-7.8, 0.002, 0);
    this.scene.add(ledLeft);

    const ledRight = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 20.0), ledMat);
    ledRight.rotation.x = -Math.PI / 2;
    ledRight.position.set(7.8, 0.002, 0);
    this.scene.add(ledRight);
  }

  // ─── Shuttlecock ────────────────────────────────────────────────────────────

  private buildShuttlecock(): void {
    this.shuttleGroup = new THREE.Group();
    this.shuttleGroup.scale.set(1.25, 1.25, 1.25);

    // Cork hemisphere positioned at +Y so cork points in +Y flight direction
    const corkGeo = new THREE.SphereGeometry(0.038, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const corkMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc, roughness: 0.3,
      emissive: 0xffffff, emissiveIntensity: 0.3
    });
    const cork = new THREE.Mesh(corkGeo, corkMat);
    cork.position.y = 0.032;
    this.shuttleGroup.add(cork);

    // Feather skirt cone flared out backwards towards -Y
    const featherGeo = new THREE.ConeGeometry(0.082, 0.115, 16, 1, true);
    const featherMat = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.5 });
    const feathers = new THREE.Mesh(featherGeo, featherMat);
    feathers.position.y = -0.036;
    feathers.rotation.x = Math.PI; // Flare skirt backwards
    this.shuttleGroup.add(feathers);

    // Bright solid glow halo for tracking visibility and serve arming feedback (solid, NOT wireframe so visible at 16m)
    const haloGeo = new THREE.SphereGeometry(0.085, 16, 16);
    this.shuttleHaloMat = new THREE.MeshBasicMaterial({
      color: 0xffea00, wireframe: false, transparent: true, opacity: 0.75, depthWrite: false
    });
    this.shuttleHaloMesh = new THREE.Mesh(haloGeo, this.shuttleHaloMat);
    this.shuttleGroup.add(this.shuttleHaloMesh);

    this.shuttleGroup.castShadow = true;
    this.scene.add(this.shuttleGroup);
  }

  private buildShuttleFloorShadow(): void {
    const shadowGeo = new THREE.CircleGeometry(0.20, 24);
    this.shuttleFloorShadowMat = new THREE.MeshBasicMaterial({
      color: 0x070d18,
      transparent: true,
      opacity: 0.65,
      depthWrite: false
    });
    this.shuttleFloorShadowMesh = new THREE.Mesh(shadowGeo, this.shuttleFloorShadowMat);
    this.shuttleFloorShadowMesh.rotation.x = -Math.PI / 2;
    this.shuttleFloorShadowMesh.position.set(0, 0.02, 0);
    this.shuttleFloorShadowMesh.visible = false;
    this.scene.add(this.shuttleFloorShadowMesh);
  }

  // ─── Chalk Floor Decal System & Line Calling ─────────────────────────────────

  private buildChalkDecals(): void {
    const ringGeo = new THREE.RingGeometry(0.04, 0.22, 28);
    const puffGeo = new THREE.CircleGeometry(0.08, 16);

    for (let i = 0; i < 8; i++) {
      const group = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0,
        depthWrite: false
      });
      const ringMesh = new THREE.Mesh(ringGeo, mat);
      ringMesh.rotation.x = -Math.PI / 2;
      group.add(ringMesh);

      const puffMesh = new THREE.Mesh(puffGeo, mat);
      puffMesh.rotation.x = -Math.PI / 2;
      group.add(puffMesh);

      group.position.y = 0.006;
      group.visible = false;
      this.scene.add(group);
      this.chalkDecals.push({ group, ringMesh, mat, life: 0, maxLife: 1.2 });
    }
  }

  private spawnChalkDecal(x: number, z: number): void {
    const decal = this.chalkDecals.find(d => d.life <= 0) || this.chalkDecals[0];
    decal.group.position.set(x, 0.006, z);
    decal.life = decal.maxLife;
    decal.mat.opacity = 0.95;
    decal.ringMesh.scale.set(1, 1, 1);
    decal.group.visible = true;
  }

  private updateChalkDecals(deltaTime: number): void {
    for (const decal of this.chalkDecals) {
      if (decal.life > 0) {
        decal.life = Math.max(0, decal.life - deltaTime);
        const progress = 1 - decal.life / decal.maxLife;
        const scale = 1.0 + progress * 1.8;
        decal.ringMesh.scale.set(scale, scale, 1);
        decal.mat.opacity = Math.max(0, (1 - progress) * 0.95);
        if (decal.life === 0) {
          decal.group.visible = false;
        }
      }
    }
  }

  private showLineCallBadge(isIn: boolean, x: number, z: number): void {
    if (!this.lineCallBadgeEl) return;
    const text = isIn ? `🟢 IN! (${Math.abs(x).toFixed(2)}m, ${Math.abs(z).toFixed(2)}m)` : `🔴 OUT! (${Math.abs(x).toFixed(2)}m, ${Math.abs(z).toFixed(2)}m)`;
    this.lineCallBadgeEl.textContent = text;
    this.lineCallBadgeEl.className = `bm-line-call-badge visible ${isIn ? 'in-call' : 'out-call'}`;
    setTimeout(() => {
      if (this.lineCallBadgeEl) {
        this.lineCallBadgeEl.className = 'bm-line-call-badge';
      }
    }, 1300);
  }

  private buildShuttleTrail(): void {
    // High-contrast aerodynamic cyan-yellow glow ribbon: 12 points
    const colorCyan = new THREE.Color(0x00f5ff);
    const colorYellow = new THREE.Color(0xffee00);

    for (let i = 0; i < this.TRAIL_LENGTH; i++) {
      const t = i / this.TRAIL_LENGTH;
      const r = 0.042 * (1 - t * 0.65);
      const trailGeo = new THREE.SphereGeometry(r, 8, 8);
      const trailColor = new THREE.Color().lerpColors(colorCyan, colorYellow, t);
      const trailMat = new THREE.MeshBasicMaterial({
        color: trailColor,
        transparent: true,
        opacity: (1 - t) * 0.60
      });
      const trailMesh = new THREE.Mesh(trailGeo, trailMat);
      trailMesh.visible = false;
      this.shuttleTrailMeshes.push(trailMesh);
      this.scene.add(trailMesh);
    }
  }

  // ─── Multi-Layer Visual Impact & Camera Shake ──────────────────────────────

  private buildImpactFeedback(): void {
    this.impactGroup = new THREE.Group();
    this.impactGroup.visible = false;

    // 36 luminous spark particles with varied sizes and vibrant colors
    const particleGeo = new THREE.SphereGeometry(0.04, 6, 6);
    for (let i = 0; i < 36; i++) {
      const isGold = i % 3 === 0;
      const isWhite = i % 3 === 1;
      const color = isWhite ? 0xffffff : (isGold ? 0xfbbf24 : 0x00f2fe);
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending
      });
      const mesh = new THREE.Mesh(particleGeo, material);
      this.impactGroup.add(mesh);
      this.impactParticles.push({ mesh, velocity: new THREE.Vector3() });
    }

    // Expanding shockwave ring
    const ringGeo = new THREE.RingGeometry(0.06, 0.20, 32);
    this.impactShockwaveMat = new THREE.MeshBasicMaterial({
      color: 0x00f2fe,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.impactShockwave = new THREE.Mesh(ringGeo, this.impactShockwaveMat);
    this.impactShockwave.rotation.x = -Math.PI / 2;
    this.impactGroup.add(this.impactShockwave);

    // Central flash core
    const flashMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.impactFlash = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 16), flashMaterial);
    this.impactGroup.add(this.impactFlash);

    this.scene.add(this.impactGroup);

    // DOM overlays for impact feedback
    this.buildHitFeedbackDOM();
  }

  private buildHitFeedbackDOM(): void {
    this.screenImpactFlashEl = document.createElement('div');
    this.screenImpactFlashEl.className = 'bm-impact-flash';
    this.container.appendChild(this.screenImpactFlashEl);

    this.hitQualityBadgeEl = document.createElement('div');
    this.hitQualityBadgeEl.className = 'bm-hit-badge';
    this.container.appendChild(this.hitQualityBadgeEl);

    this.lineCallBadgeEl = document.createElement('div');
    this.lineCallBadgeEl.className = 'bm-line-call-badge';
    this.container.appendChild(this.lineCallBadgeEl);

    this.swingNowCueEl = document.createElement('div');
    this.swingNowCueEl.className = 'bm-peripheral-timing-cue';
    this.swingNowCueEl.id = 'bm-peripheral-timing-cue';
    this.container.appendChild(this.swingNowCueEl);
  }

  private triggerImpactFeedback(
    position: THREE.Vector3,
    type: 'smash' | 'drive' | 'clear' | 'drop' | 'serve' = 'drive',
    speedKmh = 80,
    isOpponent = false
  ): void {
    const isSmash = type === 'smash';
    this.impactIsSmash = isSmash;
    this.impactGroup.position.copy(position);
    this.impactGroup.visible = true;
    this.impactTimer = this.impactMaxDuration;
    this.hitStopTimer = isOpponent ? 0.020 : 0.050; // 50ms tactile micro hit-stop for player

    // Surge racket frame glow
    if (this.fpFrameMat && !isOpponent) {
      this.fpFrameMat.emissiveIntensity = isSmash ? 3.4 : 2.2;
    }

    if (isOpponent) {
      if (this.opponentAvatar) {
        this.opponentAvatar.pulseImpact(type === 'smash' ? 'smash' : 'hit');
        this.opponentAvatar.flashStringBedWhite(0.08);
      }
    } else {
      if (this.playerAvatar) {
        this.playerAvatar.pulseImpact(type === 'smash' ? 'smash' : (type === 'serve' ? 'serve' : 'hit'));
        this.playerAvatar.flashStringBedWhite(0.06);
      }
      // Racket physical recoil kick
      this.racketRecoilAngle = isSmash ? -0.22 : -0.12;
    }

    // Procedural camera trauma shake (decays smoothly in update)
    this.cameraTrauma = Math.min(1.0, this.cameraTrauma + (isSmash ? 0.82 : (isOpponent ? 0.22 : 0.50)));

    // ─── Section 2: Spring-Damper FOV Punch ──────────────────────────────────────────
    // Inject spring velocity on each hit: smash widens view dramatically, smaller for soft shots
    const fovPunch = isSmash ? 12.0 : (type === 'clear' || type === 'drive' ? 7.0 : 3.5);
    this.fovSpringVel += fovPunch;

    // ─── Section 3: Radial Streak Trigger ─────────────────────────────────────────────
    // Only fires on power smashes > 80 km/h for max cinematic impact
    if (isSmash && speedKmh > 80) {
      this.streakAlpha = 0.72;
      this.streakTimer = 0.22;
      this.streakIsSmash = true;
    } else if (type === 'clear' || type === 'drive') {
      this.streakAlpha = 0.30;
      this.streakTimer = 0.14;
      this.streakIsSmash = false;
    }

    // ─── Section 4: Rally Tension Update ─────────────────────────────────────────────
    // Tension rises with every hit, maxing out at rally count 24
    this.rallyTensionLevel = Math.min(1.0, this.scoreState.rallyCount / 24);
    // Arena ambient light pulse on each hit (bright flash, decays in update)
    this.ambientLightPulse = isSmash ? 1.0 : 0.65;

    // Pre-hit swing whoosh — plays at hit frame with swing speed proportional to shot type
    const whooshVel = isSmash ? 9.5 : (type === 'clear' || type === 'drive' ? 5.5 : 2.5);
    this.audio.badmintonWhoosh(whooshVel);

    // Shockwave color: bright gold (#ffd700) for opponent hits, cyan/red/amber for player hits
    const shockColor = isOpponent ? 0xffd700 : (isSmash ? 0xff3344 : (type === 'serve' ? 0xfbbf24 : 0x00ffff));
    this.impactShockwaveMat.color.setHex(shockColor);
    this.impactShockwave.scale.setScalar(0.2);
    this.impactShockwaveMat.opacity = 1;

    // Flash core
    this.impactFlash.scale.setScalar(0.5);
    (this.impactFlash.material as THREE.MeshBasicMaterial).color.setHex(isOpponent ? 0xffeb3b : 0xffffff);
    (this.impactFlash.material as THREE.MeshBasicMaterial).opacity = 1;

    // High velocity particle radial explosion
    const speedMult = isSmash ? 4.8 : (type === 'serve' ? 2.6 : 3.4);
    for (const [index, particle] of this.impactParticles.entries()) {
      const theta = (index / this.impactParticles.length) * Math.PI * 2;
      particle.mesh.position.set(0, 0, 0);
      particle.velocity.set(
        Math.cos(theta) * speedMult * 0.85,
        (Math.sin(theta * 1.6) * 0.4 + 0.3) * speedMult,
        Math.sin(theta) * speedMult * 0.85
      );
      (particle.mesh.material as THREE.MeshBasicMaterial).color.setHex(isOpponent ? 0xffd700 : 0x00f2fe);
      (particle.mesh.material as THREE.MeshBasicMaterial).opacity = 1;
    }

    // Screen impact vignette flash
    if (this.screenImpactFlashEl && !isOpponent) {
      this.screenImpactFlashEl.className = `bm-impact-flash ${isSmash ? 'active-smash' : 'active-hit'}`;
      setTimeout(() => {
        if (this.screenImpactFlashEl) this.screenImpactFlashEl.className = 'bm-impact-flash';
      }, 160);
    }

    if (!isOpponent) {
      // Floating hit quality badge for player
      let badgeText = '';
      let badgeStyle: 'smash' | 'drive' | 'lift' | 'sweet' = 'drive';
      if (type === 'smash') {
        badgeText = `💥 OVERHEAD SMASH ${speedKmh.toFixed(0)} KM/H`;
        badgeStyle = 'smash';
      } else if (type === 'clear') {
        badgeText = `🏸 UNDERHAND LIFT`;
        badgeStyle = 'lift';
      } else if (type === 'drop') {
        badgeText = `🎯 TIGHT DROP`;
        badgeStyle = 'sweet';
      } else if (type === 'serve') {
        badgeText = `🏸 SWEET SPOT SERVE ${speedKmh.toFixed(0)} KM/H`;
        badgeStyle = 'sweet';
      } else {
        badgeText = `🏸 CLEAN DRIVE`;
        badgeStyle = 'drive';
      }
      this.showHitQualityBadge(badgeText, badgeStyle);
    }

    // Dispatch window event for MotionHUD PIP camera mirror sparks
    window.dispatchEvent(new CustomEvent('camarena-impact', { detail: { isSmash } }));
  }

  private showHitQualityBadge(text: string, style: 'smash' | 'drive' | 'lift' | 'sweet' | 'bot' | boolean = 'drive'): void {
    if (!this.hitQualityBadgeEl) return;
    this.hitQualityBadgeEl.textContent = text;
    let styleClass = '';
    if (style === 'smash' || style === true) styleClass = 'smash-style';
    else if (style === 'lift') styleClass = 'lift-style';
    else if (style === 'sweet') styleClass = 'sweet-style';
    else if (style === 'bot') styleClass = 'bot-style';
    this.hitQualityBadgeEl.className = `bm-hit-badge visible ${styleClass}`;
    setTimeout(() => {
      if (this.hitQualityBadgeEl) {
        this.hitQualityBadgeEl.className = 'bm-hit-badge';
      }
    }, 900);
  }

  private updateImpactFeedback(deltaTime: number): void {
    // 1. Decay Racket Recoil
    if (Math.abs(this.racketRecoilAngle) > 0.005) {
      this.racketRecoilAngle = THREE.MathUtils.lerp(this.racketRecoilAngle, 0, deltaTime * 16);
    } else {
      this.racketRecoilAngle = 0;
    }

    // 2. Decay Racket Frame Glow
    if (this.fpFrameMat && this.fpFrameMat.emissiveIntensity > 0.85) {
      this.fpFrameMat.emissiveIntensity = THREE.MathUtils.lerp(this.fpFrameMat.emissiveIntensity, 0.85, deltaTime * 8);
    }

    // 3. Dynamic Third-Person Sports Tracking with Smooth Camera Bias
    const isOpponentInFlight = this.rallyState === 'IN_PLAY' && this.shuttleVel.z < -0.4 && this.lastHitter === 'opponent';
    const lateralTrackingTarget = isOpponentInFlight
      ? this.shuttlePos.x * 0.40
      : (this.playerAvatar ? this.playerAvatar.group.position.x * 0.10 : 0);

    if (this.currentCameraPreset === 'broadcast' && this.playerAvatar) {
      const avX = this.playerAvatar.group.position.x;
      const targetCamX = avX * 0.20;

      // Subtle lateral broadcast camera sway tracking player lateral position & incoming shuttle
      this.baseCameraPos.x = THREE.MathUtils.lerp(this.baseCameraPos.x, targetCamX, 0.04);
      this.baseCameraPos.y = 7.8;
      this.baseCameraPos.z = -10.8;
      this.baseCameraLook.x = THREE.MathUtils.lerp(this.baseCameraLook.x, lateralTrackingTarget, isOpponentInFlight ? 0.08 : 0.02);
      this.baseCameraLook.y = 1.1;
      this.baseCameraLook.z = isOpponentInFlight ? THREE.MathUtils.lerp(this.baseCameraLook.z, THREE.MathUtils.clamp(this.shuttlePos.z * 0.25, -1.5, 0.5), 0.04) : 0.2;
    } else if (this.currentCameraPreset === 'over_shoulder' && this.playerAvatar) {
      const avX = this.playerAvatar.group.position.x;
      const targetCamX = avX * 0.35;

      // Smooth linear interpolation so camera glides seamlessly with player footwork/lunges
      this.baseCameraPos.x = THREE.MathUtils.lerp(this.baseCameraPos.x, targetCamX, 0.05);
      this.baseCameraPos.y = 2.35;
      this.baseCameraPos.z = -5.4;
      this.baseCameraLook.x = THREE.MathUtils.lerp(this.baseCameraLook.x, lateralTrackingTarget, isOpponentInFlight ? 0.08 : 0.02);
      this.baseCameraLook.y = 1.25;
      this.baseCameraLook.z = isOpponentInFlight ? THREE.MathUtils.lerp(this.baseCameraLook.z, THREE.MathUtils.clamp(this.shuttlePos.z * 0.30, -1.2, 0.8), 0.04) : 0.5;
    } else if (this.currentCameraPreset === 'court_level' && this.playerAvatar) {
      this.baseCameraLook.x = THREE.MathUtils.lerp(this.baseCameraLook.x, lateralTrackingTarget, isOpponentInFlight ? 0.08 : 0.02);
    }

    this.camera.up.set(0, 1, 0);

    // Stable FOV per preset: 40° for Olympic TV broadcast, 52° for OTS, 54° for court-level
    this.currentFov = this.baseCameraFov;
    this.fovSpringVel = 0;
    this.cameraTrauma = 0;
    this.camera.fov = this.baseCameraFov;
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(this.baseCameraPos);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.baseCameraLook);

    // 4. Particle & Shockwave update
    if (this.impactTimer <= 0) {
      // Still update streaks, ambient, fog, and time-scale even with no active particles
      this.updateStreaks(deltaTime);
      this.updateTensionFX(deltaTime);
      return;
    }

    this.impactTimer = Math.max(0, this.impactTimer - deltaTime);
    const progress = 1 - this.impactTimer / this.impactMaxDuration;

    for (const particle of this.impactParticles) {
      particle.mesh.position.addScaledVector(particle.velocity, deltaTime);
      particle.velocity.y -= 7.5 * deltaTime;
      particle.velocity.multiplyScalar(0.96);
      (particle.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - progress);
    }

    const maxWaveScale = this.impactIsSmash ? 3.4 : 2.2;
    this.impactShockwave.scale.setScalar(0.2 + progress * maxWaveScale);
    this.impactShockwaveMat.opacity = Math.max(0, (1 - progress) * 0.9);

    this.impactFlash.scale.setScalar(0.5 + progress * 2.2);
    (this.impactFlash.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - progress * 1.6);

    if (this.impactTimer === 0) {
      this.impactGroup.visible = false;
    }

    // Always update secondary effect systems every frame
    this.updateStreaks(deltaTime);
    this.updateTensionFX(deltaTime);
  }

  // ─── Section 3: Streak Overlay Build & Update ────────────────────────────────────

  private buildStreakOverlay(): void {
    this.streakCanvas = document.createElement('canvas');
    this.streakCanvas.style.cssText = [
      'position:absolute', 'top:0', 'left:0', 'width:100%', 'height:100%',
      'pointer-events:none', 'z-index:4'
    ].join(';');
    this.streakCanvas.width = this.container.clientWidth || window.innerWidth;
    this.streakCanvas.height = this.container.clientHeight || window.innerHeight;
    this.streakCtx = this.streakCanvas.getContext('2d') ?? undefined;
    this.container.appendChild(this.streakCanvas);
  }

  private updateStreaks(dt: number): void {
    if (!this.streakCanvas || !this.streakCtx) return;
    if (this.streakAlpha <= 0) {
      if (this.streakCanvas.style.opacity !== '0') {
        this.streakCtx.clearRect(0, 0, this.streakCanvas.width, this.streakCanvas.height);
        this.streakCanvas.style.opacity = '0';
      }
      return;
    }

    // Decay streak alpha over streakTimer duration
    this.streakAlpha = Math.max(0, this.streakAlpha - (dt / this.streakTimer) * 0.72);

    const w = this.streakCanvas.width;
    const h = this.streakCanvas.height;
    const cx = w * 0.5;
    const cy = h * 0.5;
    const maxLen = Math.min(w, h) * 0.46 * this.streakAlpha;
    const NUM_STREAKS = 12;

    this.streakCtx.clearRect(0, 0, w, h);
    this.streakCanvas.style.opacity = '1';

    for (let i = 0; i < NUM_STREAKS; i++) {
      const angle = (i / NUM_STREAKS) * Math.PI * 2 + 0.18;
      const jitter = (Math.random() - 0.5) * 0.22;
      const finalAngle = angle + jitter;

      // Streak starts near center, extends outward
      const startR = maxLen * 0.05;
      const endR = maxLen * (0.55 + Math.random() * 0.45);

      const x1 = cx + Math.cos(finalAngle) * startR;
      const y1 = cy + Math.sin(finalAngle) * startR;
      const x2 = cx + Math.cos(finalAngle) * endR;
      const y2 = cy + Math.sin(finalAngle) * endR;

      // Smash: vivid red-orange streaks; other: cyan radials
      const alpha = this.streakAlpha * 0.9;
      const color = this.streakIsSmash
        ? `rgba(255,80,60,${alpha})`
        : `rgba(0,242,254,${alpha})`;

      const lineWidth = this.streakIsSmash ? (1.8 + Math.random() * 1.2) : (1.2 + Math.random() * 0.8);

      this.streakCtx.beginPath();
      this.streakCtx.moveTo(x1, y1);
      this.streakCtx.lineTo(x2, y2);
      this.streakCtx.strokeStyle = color;
      this.streakCtx.lineWidth = lineWidth;
      this.streakCtx.stroke();
    }
  }

  // ─── Section 4: Rally Tension FX ────────────────────────────────────────────────

  private updateTensionFX(dt: number): void {
    this.timeScale = 1.0;
    this.timeScaleTarget = 1.0;

    // Ambient light pulse: bright flash on each hit, decays in ~0.8s
    if (this.ambientLightPulse > 0 && this.ambientLight) {
      this.ambientLightPulse = Math.max(0, this.ambientLightPulse - dt * 1.25);
      // Base 0.85 + tension bonus up to 0.10 + hit pulse up to 0.65
      this.ambientLight.intensity = 0.85 + this.rallyTensionLevel * 0.10 + this.ambientLightPulse * 0.65;
    } else if (this.ambientLight) {
      // Gentle breathing with rally tension
      this.ambientLight.intensity = THREE.MathUtils.lerp(
        this.ambientLight.intensity,
        0.85 + this.rallyTensionLevel * 0.10,
        dt * 2.0
      );
    }

    // Fog density ramp: escalates from 0.025 (quiet) to 0.045 (max tension)
    if (this.sceneFog) {
      const targetFogDensity = 0.025 + this.rallyTensionLevel * 0.020;
      this.sceneFog.density = THREE.MathUtils.lerp(this.sceneFog.density, targetFogDensity, dt * 0.8);
    }
  }

  private trackRacketTarget(target: THREE.Vector3, frameDt: number): void {
    if (this.activeRacketPos.distanceTo(target) > 0.25) {
      this.activeRacketPos.copy(target);
      return;
    }

    const alpha = 1.0 - Math.exp(-24.0 * Math.min(frameDt, 0.1));
    this.activeRacketPos.lerp(target, alpha);
  }

  private buildNetHitBanner(): void {
    this.netHitBanner = document.createElement('div');
    this.netHitBanner.id = 'bm-net-hit-banner';
    this.netHitBanner.style.cssText = `
      position: absolute; top: 38%; left: 50%; transform: translateX(-50%);
      background: rgba(255, 30, 30, 0.18); border: 2px solid rgba(255, 60, 60, 0.75);
      border-radius: 14px; padding: 12px 36px; color: #ff4444;
      font-family: 'Inter', sans-serif; font-size: 22px; font-weight: 900;
      letter-spacing: 0.1em; text-align: center; backdrop-filter: blur(10px);
      pointer-events: none; z-index: 40; display: none;
      text-shadow: 0 0 16px rgba(255,60,60,0.8);
      box-shadow: 0 0 24px rgba(255,30,30,0.4);
    `;
    this.netHitBanner.textContent = '⛔ HIT NET!';
    this.container.appendChild(this.netHitBanner);
  }

  private showNetHitBanner(): void {
    if (!this.netHitBanner) return;
    this.netHitBanner.style.display = 'block';
    setTimeout(() => {
      if (this.netHitBanner) this.netHitBanner.style.display = 'none';
    }, 1400);
  }

  // ─── Reset & Serve ──────────────────────────────────────────────────────────

  private setupServe(server: 1 | 2 = 1): void {
    this.isShuttleInPlay = false;
    this.rallyState = 'READY_TO_SERVE';
    this.isServeArmed = false;
    this.floorDropGraceTimer = 0;
    this.floorDropImmunityTimer = 0.6;
    this.pendingNetFault = null;
    this.shuttleTrail = [];
    this.lastNetCrossing = null;
    this.hideImpactReticle();
    this.serveCountdown = 2.0; // Reset AI serve countdown every single serve

    // Reset player footwork stance to baseline for every serve
    this.playerZ = -4.2;
    this.playerAvatar.group.position.z = -4.2;

    // Reset AI stance to its home position for every serve
    this.opponentAI.reset();
    this.opponentAvatar.group.position.set(this.opponentAI.position.x, 0, this.opponentAI.position.z);
    this.playerAvatar.setDominantArm(this.dominantHand);

    // Guaranteed visibility & mesh reset
    this.shuttleGroup.visible = true;
    this.shuttleGroup.traverse(c => { c.visible = true; });

    if (server === 1) {
      this.isShuttleHeld = true;
      this.lastHitter = null;
      this.serveCooldownTimer = 0.35;

      const liveHand = this.playerAvatar.getSupportHandWorldPosition();
      const avatarPos = this.playerAvatar.group.position;
      const isRightHanded = this.dominantHand === 'right';
      const defaultX = avatarPos.x + (isRightHanded ? 0.20 : -0.20);
      const defaultY = 1.25;
      const defaultZ = avatarPos.z + 0.35;

      if (liveHand.y >= 1.05) {
        this.shuttlePos.set(liveHand.x, liveHand.y + 0.05, liveHand.z + 0.08);
      } else {
        this.shuttlePos.set(defaultX, defaultY, defaultZ);
      }
      this.shuttleGroup.position.copy(this.shuttlePos);
      this.prevShuttlePos.copy(this.shuttlePos);
      this.shuttleVel.set(0, 0, 0);

      this.shuttleGroup.rotation.set(-Math.PI * 0.45, 0, 0);
      this.updateServeTrajectory(this.shuttlePos);

      this.showServeBanner('⚡ READY! SWING TO SERVE', 'ready');
      window.dispatchEvent(new CustomEvent('camarena-holding-shuttle', { detail: { isHolding: true } }));
    } else {
      this.isShuttleHeld = false;
      this.lastHitter = 'opponent';
      this.serveCountdown = 2.0;

      this.shuttlePos.set(this.opponentAvatar.group.position.x, 1.4, this.opponentAvatar.group.position.z - 0.3);
      this.shuttleGroup.position.copy(this.shuttlePos);
      this.prevShuttlePos.copy(this.shuttlePos);
      this.shuttleVel.set(0, 0, 0);

      this.hideServeTrajectory();
      this.showServeBanner('🤖 OPPONENT SERVING — Get ready!', 'opponent');
      window.dispatchEvent(new CustomEvent('camarena-holding-shuttle', { detail: { isHolding: false } }));
    }

    this.previousRacketPosition.copy(this.playerAvatar.getRacketWorldPosition());
    this.racketVelocity.set(0, 0, 0);
    this.mouseSpeed = 0;
    this.isServeArmed = true;
    if (this.shuttleFloorShadowMesh) {
      this.shuttleFloorShadowMesh.visible = false;
    }
  }

  private resetBall(server: 1 | 2 = 1): void {
    this.setupServe(server);
  }

  private getRacketToShuttleDistance(): number {
    const racketHeadPos = this.playerAvatar.getRacketHeadWorldPosition();
    return racketHeadPos.distanceTo(this.shuttlePos);
  }

  private isRacketInServeProximity(): boolean {
    const racketHeadPos = this.playerAvatar.getRacketHeadWorldPosition();

    // 1. Planar 2D distance on Camera projection plane (X and Y)
    const distXY = Math.hypot(racketHeadPos.x - this.shuttlePos.x, racketHeadPos.y - this.shuttlePos.y);

    // 2. Generous Z-depth window (absorbs synthetic depth noise)
    const distZ = Math.abs(racketHeadPos.z - this.shuttlePos.z);

    // Criteria: racket passing through the serve pocket on a committed swing (forgiving proximity)
    return distXY <= 1.40 && distZ <= 1.35;
  }

  private isServeStrikeRegistered(wristSpeed = 0, swingSpeed = 0, userInitiated = false): boolean {
    if (this.rallyState !== 'READY_TO_SERVE' || this.scoreState.currentServer !== 1) return false;
    if (this.serveCooldownTimer > 0) return false;
    // Explicit user click or spacebar ALWAYS serves
    if (userInitiated) return true;
    if (!this.isRacketInServeProximity()) return false;

    // Must be an active, fast stroke (> 4.2 m/s / ~15 km/h) to distinguish from resting desk noise
    const physicalSpeed = Math.max(wristSpeed, swingSpeed);
    return physicalSpeed >= 4.2;
  }

  /**
   * Pulls launch velocity back so the simulated landing stays inside singles,
   * matching the in-play drag/gravity integrator.
   */
  private constrainLandingInCourt(origin: THREE.Vector3, vel: THREE.Vector3, towardOpponent: boolean): void {
    vel.x = THREE.MathUtils.clamp(vel.x, -0.60, 0.60);
    if (towardOpponent) {
      // Player hitting toward opponent court: comfortable carry to mid/back court (3.5 to 8.5 m/s)
      vel.z = THREE.MathUtils.clamp(vel.z, 3.5, 8.5);
      vel.y = THREE.MathUtils.clamp(vel.y, 3.5, 7.5);
    } else {
      // Opponent hitting toward player court: matches player's gentle rally pace (-5.2 to -2.8 m/s)
      vel.z = THREE.MathUtils.clamp(vel.z, -5.2, -2.8);
      vel.y = THREE.MathUtils.clamp(vel.y, 4.0, 7.5);
    }
  }

  private executePlayerServe(contactPoint = this.shuttlePos): void {
    if (this.rallyState !== 'READY_TO_SERVE' || this.scoreState.currentServer !== 1) return;

    // Critical Implementation Guard: Toggle isShuttleHeld = false immediately on frame 1
    // before applying launch velocity so continuous docking guard doesn't re-dock the shuttle.
    this.isShuttleHeld = false;
    this.rallyState = 'IN_PLAY';
    this.isShuttleInPlay = true;
    this.lastHitter = 'player';
    this.scoreState.rallyCount++;
    this.hideServeBanner();
    this.hideServeTrajectory();
    this.hideImpactReticle();
    this.shuttleTrail = []; // Clear trail on new serve
    window.dispatchEvent(new CustomEvent('camarena-holding-shuttle', { detail: { isHolding: false } }));

    // Launch from the exact point of contact
    this.shuttlePos.copy(contactPoint);
    this.shuttleGroup.position.copy(this.shuttlePos);

    // Trigger visual swing stroke through the shuttlecock
    this.triggerPlayerSwing(this.shuttlePos.clone(), false, 0.22);
    this.playerAvatar.pulseImpact('serve');

    // Dynamic serve speed scaling with physical swing velocity
    const rawRacketSpeed = Math.max(this.racketVelocity.length(), this.isUsingMouse ? this.mouseSpeed : 0);
    const serveRatio = THREE.MathUtils.clamp((rawRacketSpeed - 1.8) / 3.8, 0.0, 1.0);
    const serveVZ = THREE.MathUtils.lerp(5.8, 8.2, serveRatio);
    const serveVY = THREE.MathUtils.lerp(6.0, 7.4, serveRatio); // Higher vertical launch for guaranteed net clearance
    const serveVX = THREE.MathUtils.clamp(this.racketVelocity.x * 0.12, -0.35, 0.35);
    this.shuttleVel.set(serveVX, serveVY, serveVZ);
    this.enforceNetClearance(this.shuttlePos.clone(), this.shuttleVel, 1.90);
    this.constrainLandingInCourt(this.shuttlePos.clone(), this.shuttleVel, true);
    this.lastPlayerShotSpeed = this.shuttleVel.length();
    this.lastPlayerShotForwardSpeed = Math.abs(this.shuttleVel.z);
    this.hideIncomingTrajectory();
    this.prevShuttlePos.copy(this.shuttlePos);
    this.floorDropImmunityTimer = 0.6;

    // Fast 2-frame turnaround flip animation so cork points along launch vector
    this.shuttleFlipTimer = 0.035;
    this.shuttlePrevQuat.copy(this.shuttleGroup.quaternion);
    this.shuttleTargetQuat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.shuttleVel.clone().normalize());

    const speedKmh = Math.round(this.shuttleVel.length() * 3.6);
    this.updateSpeedometer(speedKmh);
    this.triggerImpactFeedback(this.shuttlePos, 'serve', speedKmh);
    const serveQuality = serveRatio > 0.65 ? `🏸 POWER SERVE ${speedKmh} KM/H` : (serveRatio < 0.25 ? `🏸 SOFT SERVE ${speedKmh} KM/H` : `🏸 SERVE ${speedKmh} KM/H`);
    this.showHitQualityBadge(serveQuality, false);
    this.audio.badmintonHit(70);
    if (this.shuttleHaloMat && this.shuttleHaloMesh) {
      this.shuttleHaloMat.color.setHex(0xfbbf24);
      this.shuttleHaloMesh.scale.set(1.0, 1.0, 1.0);
      this.shuttleHaloMat.opacity = 0.55;
    }
    this.notifyScore();
  }

  private enforceNetClearance(
    origin: THREE.Vector3,
    velocity: THREE.Vector3,
    minimumHeight = 1.65
  ): void {
    const isPlayerShot = velocity.z > 0.1 && origin.z < 0;
    const isOpponentShot = velocity.z < -0.1 && origin.z > 0;
    if (!isPlayerShot && !isOpponentShot) return;

    // Serve trajectory safety override: player-side origin heading toward net
    // Applies a secondary correction target of 1.78m to handle shallow launch angles.
    if (origin.z < -1.0 && velocity.z > 0) {
      const distToNet = Math.abs(origin.z);
      const tNet = distToNet / Math.max(0.5, Math.abs(velocity.z));
      const predHeight = origin.y + velocity.y * tNet - 0.5 * 9.81 * tNet * tNet;
      if (predHeight < 1.78) {
        velocity.y += (1.78 - predHeight) * 1.35;
      }
    }

    // Minimum net height requirement (net tape is at Y = 1.524m)
    const effectiveMin = Math.max(minimumHeight, 1.85);

    const distToNet = Math.abs(origin.z);
    const forwardSpeed = Math.abs(velocity.z);
    if (forwardSpeed < 0.5) return;
    const timeToNet = distToNet / (forwardSpeed * 0.86);

    const predictedHeight = origin.y + velocity.y * timeToNet - 0.5 * 9.8 * timeToNet * timeToNet;

    if (predictedHeight < effectiveMin) {
      // Solve kinematically for the corrected vy with a 0.20 m/s safety margin
      velocity.y = (effectiveMin - origin.y + 0.5 * 9.8 * timeToNet * timeToNet) / timeToNet + 0.20;
    }
  }

  public executePlayerHit(racketPos: THREE.Vector3, vSwing = 2.0, isUpward = false): void {
    this.isShuttleHeld = false;
    this.lastHitter = 'player';
    this.scoreState.rallyCount++;
    this.floorDropGraceTimer = 0;
    this.hideServeBanner();
    this.hideServeTrajectory();
    this.hideImpactReticle();
    this.shuttleTrail = []; // Clear trail on new hit

    const origin = this.shuttlePos.clone();
    const contactY = origin.y;
    const vySwing = this.racketVelocity.y;
    const vxSwing = this.racketVelocity.x;

    let shotType: 'smash' | 'drive' | 'clear' | 'drop' = 'drive';
    let speedZ: number;
    let reqVy: number;
    let speedKmh: number;
    let badgeText: string;
    let badgeStyle: 'smash' | 'drive' | 'lift' | 'sweet' = 'drive';

    // ─── 3D Swipe-Vector Shot Mapping ────────────────────────────────────────────────────────
    // Shot type and trajectory are determined from live racket velocity at contact frame.
    // swipe direction drives both arc shape and outgoing angle — 1:1 directional binding.
    //
    //  swipeY > +0.25 m/s   = upward scoop/lift    → High Clear lob (vy=6.5–8.2, vz=3.5–6.0)
    //  swipeY < -0.20 m/s   = downward slash        → Downward Smash  (vy=1.2–1.8, vz=7.5–9.5)
    //  swipeY ≈ neutral, fast = flat horizontal push  → Drive           (vy=3.5–4.2, vz=5.5–8.5)
    //  swipeY ≈ neutral, slow = gentle push           → Soft Drop       (vy=3.8,     vz=2.2–3.5)
    //  swipeX               = cross-court angle binding: outVx = clamp(swipeX * 2.2, ±0.65)
    const swipeY       = this.racketVelocity.y;
    const swipeX       = this.racketVelocity.x;
    const swipeSpeedXZ = Math.hypot(this.racketVelocity.x, this.racketVelocity.z);
    const rawRacketSpeed = Math.max(vSwing, this.racketVelocity.length());
    const speedRatio = THREE.MathUtils.clamp((rawRacketSpeed - 1.5) / 5.0, 0.0, 1.0);

    // Cross-court angle: lateral racket motion maps 1:1 to shuttlecock exit angle
    const outVx = THREE.MathUtils.clamp(swipeX * 2.2, -0.65, 0.65);

    const isUpwardSwipe   = swipeY > 0.25 || isUpward;
    const isDownwardSlash = swipeY < -0.20 && rawRacketSpeed > 3.2;
    const isFastFlat      = !isUpwardSwipe && !isDownwardSlash && swipeSpeedXZ > 2.2;

    if (isDownwardSlash) {
      shotType   = 'smash';
      speedZ     = THREE.MathUtils.lerp(4.0, 5.0, speedRatio);
      reqVy      = THREE.MathUtils.lerp(2.2, 1.6, speedRatio);
      badgeText  = `💥 OVERHEAD SMASH`;
      badgeStyle = 'smash';
      this.audio.badmintonSmash();
    } else if (isUpwardSwipe) {
      shotType   = 'clear';
      speedZ     = THREE.MathUtils.lerp(2.8, 4.2, speedRatio);
      reqVy      = THREE.MathUtils.lerp(5.8, 7.2, speedRatio);
      badgeText  = `🏘 HIGH CLEAR`;
      badgeStyle = 'lift';
      this.audio.badmintonHit(70);
    } else if (isFastFlat) {
      shotType   = 'drive';
      speedZ     = THREE.MathUtils.lerp(3.5, 4.8, speedRatio);
      reqVy      = THREE.MathUtils.lerp(3.8, 3.2, speedRatio);
      badgeText  = swipeSpeedXZ > 4.0 ? `⚡ POWER DRIVE` : `🏘 DRIVE`;
      badgeStyle = swipeSpeedXZ > 4.0 ? 'sweet' : 'drive';
      this.audio.badmintonHit(swipeSpeedXZ > 4.0 ? 90 : 65);
    } else {
      shotType   = 'drop';
      speedZ     = THREE.MathUtils.lerp(2.0, 3.0, rawRacketSpeed / 2.2);
      reqVy      = 3.4;
      badgeText  = `🎯 SOFT DROP`;
      badgeStyle = 'lift';
      this.audio.badmintonHit(40);
    }

    this.shuttleVel.set(outVx, reqVy, speedZ);

    this.enforceNetClearance(this.shuttlePos.clone(), this.shuttleVel, 1.85);
    this.constrainLandingInCourt(this.shuttlePos.clone(), this.shuttleVel, true);
    this.lastPlayerShotSpeed = this.shuttleVel.length();
    this.lastPlayerShotForwardSpeed = Math.abs(this.shuttleVel.z);
    this.hideIncomingTrajectory();
    this.floorDropImmunityTimer = 0.6; // Disable floor drop for 0.6s on return launch

    // ─── Req. 3: Actual post-collision velocity for all feedback readouts ────────────────
    // Always read from the resolved shuttleVel AFTER enforceNetClearance and constrainLandingInCourt
    // so badge, speedometer, and impact feedback all reflect the true launched speed.
    const actualSpeedKmh = Math.round(this.shuttleVel.length() * 3.6);
    // Update badge text to reflect actual speed
    if (shotType === 'smash') {
      badgeText = `💥 OVERHEAD SMASH ${actualSpeedKmh} KM/H`;
    } else if (shotType === 'drop') {
      badgeText = `🎯 SOFT DROP ${actualSpeedKmh} KM/H`;
    } else if (shotType === 'clear') {
      badgeText = `🏘 HIGH CLEAR ${actualSpeedKmh} KM/H`;
    } else {
      badgeText = actualSpeedKmh > Math.round(4.2 * 9.5) ? `⚡ POWER STROKE ${actualSpeedKmh} KM/H` : `🏘 DRIVE ${actualSpeedKmh} KM/H`;
    }

    this.prevShuttlePos.copy(this.shuttlePos);
    this.rallyState = 'IN_PLAY';
    this.isShuttleInPlay = true;

    // 50ms Micro Hit-Stop: freeze shuttle on strings for 3 frames
    this.hitStopTimer = 0.050;

    // Fast 2-frame turnaround flip animation so cork points along outgoing launch vector
    this.shuttleFlipTimer = 0.035;
    this.shuttlePrevQuat.copy(this.shuttleGroup.quaternion);
    this.shuttleTargetQuat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.shuttleVel.clone().normalize());

    this.shuttlePos.copy(racketPos);
    this.shuttleGroup.position.copy(racketPos);
    this.triggerPlayerSwing(racketPos.clone(), shotType === 'smash', 0.22);
    this.playerAvatar.pulseImpact(shotType === 'smash' ? 'smash' : 'hit');
    this.playerAvatar.flashStringBedWhite(0.06);
    this.updateSpeedometer(actualSpeedKmh);
    this.triggerImpactFeedback(racketPos, shotType, actualSpeedKmh);
    this.showHitQualityBadge(badgeText, badgeStyle);
    this.notifyScore();
  }

  private updateSpeedometer(speedKmh: number): void {
    const speedCard = document.querySelector('.stroke-speed');
    if (speedCard) {
      speedCard.textContent = `${Math.round(speedKmh)} KM/H`;
      if (speedKmh > 75) speedCard.className = 'stroke-speed smash';
      else if (speedKmh > 45) speedCard.className = 'stroke-speed fast';
      else speedCard.className = 'stroke-speed';
    }
    const meterFill = document.querySelector('.meter-fill') as HTMLElement;
    if (meterFill) {
      meterFill.style.width = `${Math.min(100, (speedKmh / 120) * 100)}%`;
    }
  }

  // ─── Game Loop ──────────────────────────────────────────────────────────────

  public start(): void { this.isRunning = true; }
  public pause(): void { this.isRunning = false; }
  public resume(): void { this.isRunning = true; }

  public setTargetScore(score: number): void {
    this.targetScore = score;
    this.scoreState.targetScore = score;
    this.notifyScore();
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
      targetScore: this.targetScore,
      winByTwo: this.winByTwo,
      lastPointReason: undefined,
      matchPointText: undefined,
      gameModeTitle: 'Badminton 3D Pro'
    };
    this.opponentAI.reset();
    this.resetBall(1);
    this.notifyScore();
  }

  public update(deltaTime: number, motionFrame: MotionFrame | null): void {
    if (!this.isRunning) return;

    const frameDt = Math.min(Math.max(deltaTime, 0), 0.1);
    this.timeScale = 1.0;
    this.timeScaleTarget = 1.0;
    if (this.userSwingIntentTimer > 0) {
      this.userSwingIntentTimer = Math.max(0, this.userSwingIntentTimer - frameDt);
    }
    let vSwing = 0;
    let isUpwardSwing = false;
    let trackedWristVel: { x: number; y: number; z: number } | null = null;

    if (motionFrame && motionFrame.worldLandmarks) {
      this.isUsingMouse = false;
      this.playerAvatar.update(motionFrame.worldLandmarks, this.dominantHand, frameDt);

      // Lateral Movement (X): Map user's mirrored torso/hip root position to court width bounds
      const normX = this.vectorNormalizer.getMirroredTorsoX(motionFrame.rawLandmarks);
      const targetAvatarX = THREE.MathUtils.clamp(normX * 1.8, -this.singlesCourtWidth * 0.44, this.singlesCourtWidth * 0.44);

      // Anchor player to standard BWF midcourt position (z = -4.2m)
      let targetAvatarZ = -4.2;

      // Contextual lunge forward only when opponent hits a short net drop
      const isShortDrop = this.rallyState === 'IN_PLAY' && this.shuttleVel.z < 0 && this.shuttlePos.z > -3.2 && this.shuttlePos.z < -1.2;
      if (isShortDrop) {
        const lungeTargetZ = THREE.MathUtils.clamp(this.shuttlePos.z - 0.40, -4.2, -2.2);
        targetAvatarZ = Math.max(targetAvatarZ, lungeTargetZ);
      }

      this.playerZ = THREE.MathUtils.lerp(this.playerZ, targetAvatarZ, 0.15);
      this.playerAvatar.group.position.x = THREE.MathUtils.lerp(this.playerAvatar.group.position.x, targetAvatarX, 0.20);
      this.playerAvatar.group.position.z = this.playerZ;

      const domWristIdx = this.dominantHand === 'right' ? 16 : 15;

      // Calculate smoothed wrist velocity for shot classification, filtering out resting noise
      const smoothedWristVel = this.playerAvatar.getSmoothedDominantWristVelocity();
      const rawWristVel = motionFrame.velocities?.[domWristIdx] || (this.dominantHand === 'right' ? motionFrame.metrics.rightWristVelocity : motionFrame.metrics.leftWristVelocity);
      const combinedSpeed = Math.max(smoothedWristVel.length(), rawWristVel ? Math.hypot(rawWristVel.x, rawWristVel.y, rawWristVel.z) : 0);
      this.lastDebugWristSpeed = combinedSpeed;
      this.lastDebugAction = motionFrame.activeAction;

      if (combinedSpeed >= 1.0) { // Deadzone ambient resting jitter below 1.0 m/s (3.6 km/h)
        trackedWristVel = rawWristVel || { x: smoothedWristVel.x, y: smoothedWristVel.y, z: smoothedWristVel.z };
        vSwing = combinedSpeed;
        isUpwardSwing = (trackedWristVel.y || 0) > 0.45;
      } else {
        trackedWristVel = { x: 0, y: 0, z: 0 };
        vSwing = 0;
        isUpwardSwing = false;
      }

      // Avatar3D.update has already placed the racket directly on filtered
      // MediaPipe landmark for dominant wrist. Do not replace that pose with a camera-plane
      // target: doing so makes the racket appear fixed while the real hand moves.
      const dominantTarget = this.playerAvatar.getHandWorldPosition(this.dominantHand);
      this.activeRacketPos.copy(dominantTarget);

      if (this.playerSwingTimer > 0) {
        this.playerSwingTimer = Math.max(0, this.playerSwingTimer - frameDt);
        const progress = 1.0 - (this.playerSwingTimer / this.playerSwingDuration);
        this.playerAvatar.playSwingAnimation(this.playerSwingTarget, progress, this.playerSwingIsSmash, this.dominantHand);
      } else if (this.rallyState === 'READY_TO_SERVE' && this.scoreState.currentServer === 1) {
        // Both hands remain driven by their live MediaPipe landmarks.
        const sHand = this.playerAvatar.getSupportHandWorldPosition();
        this.trackedSupportHandPos.copy(sHand);
      } else {
        // Rally: dominant arm remains driven by the live dominant wrist landmark.
        const sHand = this.playerAvatar.getSupportHandWorldPosition();
        this.trackedSupportHandPos.copy(sHand);
      }
    } else if (this.isUsingMouse) {
      // Allow mouse / keyboard to move player across court within [-2.2, 2.2] and [-4.2, -1.7]
      const targetAvatarX = THREE.MathUtils.clamp(this.mouseRacketTarget.x * 0.65, -2.2, 2.2);

      let targetAvatarZ = this.playerZ;
      const isShortDrop = this.rallyState === 'IN_PLAY' && this.shuttleVel.z < 0 && this.shuttlePos.z > -3.2 && this.shuttlePos.z < -1.2;
      if (isShortDrop) {
        const lungeTargetZ = THREE.MathUtils.clamp(this.shuttlePos.z - 0.40, -4.2, -2.2);
        targetAvatarZ = Math.max(targetAvatarZ, lungeTargetZ);
      }

      this.playerAvatar.group.position.x = THREE.MathUtils.lerp(this.playerAvatar.group.position.x, targetAvatarX, 0.25);
      this.playerAvatar.group.position.z = THREE.MathUtils.lerp(this.playerAvatar.group.position.z, targetAvatarZ, 0.18);

      vSwing = this.mouseSpeed;
      isUpwardSwing = this.mouseRacketTarget.y > 2.2;

      this.trackRacketTarget(this.mouseRacketTarget, frameDt);

      const mouseNormX = THREE.MathUtils.clamp(this.mouseRacketTarget.x / (this.courtWidth / 2 + 0.5), -1, 1);
      const mouseNormY = THREE.MathUtils.clamp(((this.mouseRacketTarget.y - 1.0) / 2.2) * 2.0 - 1.0, -1, 1);

      if (this.playerSwingTimer > 0) {
        this.playerSwingTimer = Math.max(0, this.playerSwingTimer - frameDt);
        const progress = 1.0 - (this.playerSwingTimer / this.playerSwingDuration);
        this.playerAvatar.playSwingAnimation(this.playerSwingTarget, progress, this.playerSwingIsSmash, this.dominantHand);
      } else if (this.rallyState === 'READY_TO_SERVE' && this.scoreState.currentServer === 1) {
        // Mouse fallback keeps the support hand at its current live position.
        const supportTarget = this.playerAvatar.getSupportHandWorldPosition();
        const sideOffset = this.dominantHand === 'right' ? 0.15 : -0.15;
        const dominantTarget = Avatar3D.mapScreenToStrikePlane(this.camera, mouseNormX, mouseNormY, 0, false, 2.05, sideOffset, this.playerAvatar.group.position.z);

        this.playerAvatar.poseArmsToTargets(dominantTarget, supportTarget, this.dominantHand, this.racketVelocity);
        this.trackedSupportHandPos.copy(this.playerAvatar.getSupportHandWorldPosition());
      } else {
        // In rally: dominant arm reaches towards mouse target with racket on strike plane
        const sideOffset = this.dominantHand === 'right' ? 0.15 : -0.15;
        const dominantTarget = Avatar3D.mapScreenToStrikePlane(this.camera, mouseNormX, mouseNormY, 0, false, 2.05, sideOffset, this.playerAvatar.group.position.z);
        this.playerAvatar.poseArmsToTargets(dominantTarget, undefined, this.dominantHand, this.racketVelocity);
      }
    }

    // Clamp X to valid court range
    this.activeRacketPos.x = Math.max(-this.courtWidth * 0.45, Math.min(this.courtWidth * 0.45, this.activeRacketPos.x));

    // 1. Ensure Player's Cyan Racket is explicitly locked to right wrist and visible at all times
    this.playerAvatar.lockRacketToWrist();
    const racketGroup = this.playerAvatar.getRacketGroup();
    if (racketGroup) {
      racketGroup.visible = true;
      racketGroup.scale.set(1.0, 1.0, 1.0);
      if (this.playerAvatar.racketMesh) this.playerAvatar.racketMesh.visible = true;
      racketGroup.traverse((child) => { child.visible = true; });
    }
    this.opponentAvatar.lockRacketToWrist();
    const oppRacketGroup = this.opponentAvatar.getRacketGroup();
    if (oppRacketGroup) {
      oppRacketGroup.visible = true;
      oppRacketGroup.scale.set(1.0, 1.0, 1.0);
      if (this.opponentAvatar.racketMesh) this.opponentAvatar.racketMesh.visible = true;
      oppRacketGroup.traverse((child) => { child.visible = true; });
    }

    const wristPosition = this.playerAvatar.getDominantWristWorldPosition();
    const safeDelta = Math.max(0.008, frameDt);
    const rawWristVel = wristPosition.clone().sub(this.previousRacketPosition).divideScalar(safeDelta);
    // Deadzone resting noise below 0.3 m/s (~1.1 km/h)
    if (rawWristVel.length() < 0.3) {
      rawWristVel.set(0, 0, 0);
    }
    // EMA smoothing with alpha = 0.35 to swallow resting jitter
    this.racketVelocity.lerp(rawWristVel, 0.35);
    this.previousRacketPosition.copy(wristPosition);

    const motionSpeed = trackedWristVel
      ? Math.hypot(trackedWristVel.x, trackedWristVel.y, trackedWristVel.z)
      : 0;

    const dbgEl = document.getElementById('debug-hand-display');
    if (dbgEl) dbgEl.remove();


    const swingVy = trackedWristVel?.y || 0;
    const isUnderhandScoop = swingVy > 0.80 && this.shuttlePos.y < 1.30;

    // Track prev wrist speed for debug readout only
    this.prevWristSpeed = motionSpeed > 0 ? motionSpeed : (this.isUsingMouse ? this.mouseSpeed : 0);

    // ─── Swept-Volume Line-Segment Collision Detection ──────────────────────────────────
    // Each frame we build two 3D segments:
    //   Racket segment : prevRacketHeadPos → currentRacketHeadPos
    //   Shuttle segment: prevShuttlePos    → shuttlePos
    // We compute the minimum 3D distance between these two swept paths.
    // A real stroke is detected when BOTH:
    //   • closestApproach <= 0.42 m  (geometrical contact)
    //   • racketStepLen  >= 2.2 m/s  (dynamic stroke, not a static hold or slow reposition)
    // OR when the user explicitly clicked / pressed Space and shuttle is within 0.85m.
    //
    // Shot power is then mapped directly from the kinetic racket displacement:
    //   outSpeed = clamp(racketStepLen * 1.8, 2.2, 9.5)  [m/s]
    // This gives: slow push ≈ 2–3 m/s → soft drop; hard swing ≈ 7–9 m/s → smash.

    if (this.rallyState === 'IN_PLAY' && this.lastHitter !== 'player') {
      const inPlayerZone = this.shuttlePos.z <= -1.0 && this.shuttlePos.z >= -5.2 && this.shuttleVel.z < 0.3;
      if (inPlayerZone) {
        const currentRacketHead = this.playerAvatar.getRacketHeadWorldPosition();

        // Build the two swept segments for this frame
        const racketStep    = currentRacketHead.clone().sub(this.prevRacketHeadPos);
        const racketStepLen = racketStep.length();  // metres swept this frame (≈ m/s at 60 fps)

        const closestApproach = this.closestApproachSegSeg(
          this.prevRacketHeadPos, currentRacketHead,
          this.prevShuttlePos,    this.shuttlePos
        );

        // ─── Intentional Dynamic Strike Gate ──────────────────────────────────────────────
        // Directional alignment: vector from racket to shuttle must align with swing displacement
        const racketToShuttle = this.shuttlePos.clone().sub(currentRacketHead).normalize();
        const racketDir       = racketStepLen > 1e-4 ? racketStep.clone().normalize() : new THREE.Vector3();
        const alignment       = racketToShuttle.dot(racketDir);

        const directDist = currentRacketHead.distanceTo(this.shuttlePos);
        const swingSpeedMps = racketStepLen / Math.max(0.008, frameDt);
        const wristSpeed = this.racketVelocity.length();
        const effectiveSpeed = Math.max(swingSpeedMps, wristSpeed, motionSpeed);

        // Generous physical stroke gate: accepts natural arm swings (>= 2.2 m/s) within 0.65m racket reach
        const isDynamicSwing = effectiveSpeed >= 2.2 && (alignment > 0.30 || directDist <= 0.50) && closestApproach <= 0.65;
        const isExplicitUserSwing = (this.userSwingIntentTimer > 0 || this.swingIntentTimer > 0) && directDist <= 0.90;

        if (isDynamicSwing || isExplicitUserSwing) {
          // Cap player return speed to gentle, trackable rally speed (3.5 to 7.0 m/s)
          const outSpeed = THREE.MathUtils.clamp(Math.max(effectiveSpeed * 0.85, 3.5), 3.5, 7.0);

          this.hitStopTimer = 0.016;
          this.floorDropGraceTimer = 0;
          this.swingIntentTimer    = 0;
          this.userSwingIntentTimer = 0;
          const isUpwardOrScoop = isUpwardSwing || isUnderhandScoop || swingVy > 0.35 || this.shuttlePos.y < 1.35;
          this.executePlayerHit(currentRacketHead, outSpeed, isUpwardOrScoop);
        }

        // Advance racket head position for next frame's swept-volume computation
        this.prevRacketHeadPos.copy(currentRacketHead);
      }
    } else {
      // Outside contact zone: keep prevRacketHeadPos current so there's no stale-segment
      // discontinuity jump when the shuttle enters the player zone next frame.
      this.prevRacketHeadPos.copy(this.playerAvatar.getRacketHeadWorldPosition());
    }

    // 3. Serve Logic & Real-Time Hand Tracking
    if (this.rallyState === 'READY_TO_SERVE' && !this.scoreState.isGameOver) {
      if (this.scoreState.currentServer === 1) {
        if (this.serveCooldownTimer > 0) {
          this.serveCooldownTimer = Math.max(0, this.serveCooldownTimer - deltaTime);
        }

        if (this.isShuttleHeld) {
          const liveHand = this.playerAvatar.getSupportHandWorldPosition();
          const avatarPos = this.playerAvatar.group.position;
          const isRightHanded = this.dominantHand === 'right';
          const defaultX = avatarPos.x + (isRightHanded ? -0.15 : 0.15);
          const defaultY = 1.25;
          const defaultZ = avatarPos.z + 0.35;

          let targetX = defaultX;
          let targetY = defaultY;
          let targetZ = defaultZ;

          if (liveHand.y >= 1.05) {
            targetX = liveHand.x;
            targetY = liveHand.y + 0.05;
            targetZ = liveHand.z + 0.08;
          }

          this.shuttlePos.set(
            THREE.MathUtils.lerp(this.shuttlePos.x, targetX, 0.25),
            THREE.MathUtils.lerp(this.shuttlePos.y, targetY, 0.25),
            THREE.MathUtils.lerp(this.shuttlePos.z, targetZ, 0.25)
          );
          this.shuttleGroup.position.copy(this.shuttlePos);
          this.prevShuttlePos.copy(this.shuttlePos);
          this.shuttleGroup.visible = true;

          // Shuttlecock orientation: cork points forward toward net, feathers resting in hand
          this.shuttleGroup.rotation.set(-Math.PI * 0.45, 0, 0);

          // Update holographic serve trajectory arc in real-time
          this.updateServeTrajectory(this.shuttlePos);

          const inServeZone = this.isRacketInServeProximity();
          this.isServeArmed = true;

          // Visual Serve Readiness Indicator on held shuttlecock:
          // Bright neon green (#00FF88) pulse when in hitting range; Warm amber when outside range
          if (this.shuttleHaloMat && this.shuttleHaloMesh) {
            if (inServeZone) {
              this.shuttleHaloMat.color.setHex(0x00ff88);
              const pulse = 1.2 + Math.sin(performance.now() * 0.012) * 0.30;
              this.shuttleHaloMesh.scale.set(pulse, pulse, pulse);
              this.shuttleHaloMat.opacity = 0.95;
            } else {
              this.shuttleHaloMat.color.setHex(0xf59e0b);
              this.shuttleHaloMesh.scale.set(1.0, 1.0, 1.0);
              this.shuttleHaloMat.opacity = 0.60;
            }
          }
          this.showServeBanner('⚡ READY! SWING TO SERVE', 'ready');

          // Trigger serve on active swing strike
          const motionWristSpeed = trackedWristVel ? Math.hypot(trackedWristVel.x, trackedWristVel.y, trackedWristVel.z) : 0;
          if (this.isServeStrikeRegistered(motionWristSpeed, vSwing, this.userSwingIntentTimer > 0)) {
            const racketHeadPos = this.playerAvatar.getRacketHeadWorldPosition();
            this.userSwingIntentTimer = 0;
            this.executePlayerServe(racketHeadPos);
          }
        }
      } else {
        // AI server: keep shuttlecock visibly docked in front of opponent until served
        this.shuttlePos.set(this.opponentAvatar.group.position.x, 1.4, this.opponentAvatar.group.position.z - 0.3);
        this.shuttleGroup.position.copy(this.shuttlePos);
        this.prevShuttlePos.copy(this.shuttlePos);
        this.shuttleGroup.visible = true;

        // AI serves after a fair countdown
        this.serveCountdown -= deltaTime;
        if (this.serveCountdown <= 0) {
          this.isShuttleHeld = false;
          this.rallyState = 'IN_PLAY';
          this.isShuttleInPlay = true;
          this.lastHitter = 'opponent';
          this.hideServeBanner();

          this.shuttlePos.set(this.opponentAvatar.group.position.x, 1.4, this.opponentAvatar.group.position.z - 0.3);
          const target = getBotTarget('clear', this.currentDifficulty);
          const launchVel = solveLaunchVelocity(
            this.shuttlePos,
            target,
            'clear',
            0.085,
            9.81,
            1.85,
            this.opponentAI?.pacingProfile,
            this.lastPlayerShotSpeed || 5.8
          );
          this.shuttleVel.set(launchVel.x, launchVel.y, launchVel.z);
          this.constrainLandingInCourt(this.shuttlePos.clone(), this.shuttleVel, false);
          this.floorDropImmunityTimer = 0.6;
          this.prevShuttlePos.copy(this.shuttlePos);
          const oppRacketHead = this.opponentAvatar.getRacketHeadWorldPosition();
          this.triggerImpactFeedback(oppRacketHead, 'serve', 30, true);
          this.audio.badmintonHit(90);
          this.showHitQualityBadge('🏸 BOT HIT • GENTLE SERVE', 'bot');
          this.spawnIncomingInterceptReticle(this.shuttlePos, this.shuttleVel, target);
          this.spawnIncomingFloorRing(this.shuttlePos, this.shuttleVel, target);
          this.updateIncomingTrajectory(oppRacketHead, this.shuttleVel, target);
        }
      }
    }

    // 4. Shuttlecock Aerodynamics & Flight Physics
    const FIXED_DT = 1 / 60;
    if (this.rallyState === 'IN_PLAY') {
      this.physicsAccumulator = Math.min(this.physicsAccumulator + frameDt, 0.1);
    } else {
      this.physicsAccumulator = 0;
    }

    while (this.rallyState === 'IN_PLAY' && this.physicsAccumulator >= FIXED_DT) {
      const dt = FIXED_DT;
      if (this.hitStopTimer > 0) {
        this.hitStopTimer = Math.max(0, this.hitStopTimer - FIXED_DT);
        const racketHead = this.playerAvatar.getRacketHeadWorldPosition();
        this.shuttlePos.copy(racketHead);
        this.shuttleGroup.position.copy(racketHead);
      }

      if (this.hitStopTimer <= 0) {
        const speed = this.shuttleVel.length();

        // Realistic badminton shuttlecock aerodynamic drag (F_drag proportional to v^2)
        // Decelerates rapidly near apex and drops steeply in parachute arc
        const DRAG_COEFFICIENT = 0.085;
        const dragMag = DRAG_COEFFICIENT * speed;
        this.shuttleVel.x -= dragMag * this.shuttleVel.x * dt;
        this.shuttleVel.y -= dragMag * this.shuttleVel.y * dt;
        this.shuttleVel.z -= dragMag * this.shuttleVel.z * dt;

        // Gravity
        this.shuttleVel.y -= 9.81 * dt;

        // Update position
        this.shuttlePos.addScaledVector(this.shuttleVel, dt);
        this.shuttleGroup.position.copy(this.shuttlePos);

        // Aerodynamic orientation: align cork along velocity vector, or fast 2-frame turnaround flip
        if (this.shuttleFlipTimer > 0) {
          this.shuttleFlipTimer -= dt;
          const progress = Math.max(0, Math.min(1, 1 - this.shuttleFlipTimer / 0.035));
          this.shuttleGroup.quaternion.copy(this.shuttlePrevQuat).slerp(this.shuttleTargetQuat, progress);
        } else if (speed > 0.45) {
          const dir = this.shuttleVel.clone().normalize();
          this.shuttleGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        }

        // Continuous Swept Net Collision Detection
        const prevZ = this.prevShuttlePos.z;
        const currZ = this.shuttlePos.z;
        const crossedNet = (prevZ < 0 && currZ >= 0) || (prevZ > 0 && currZ <= 0);

        if (crossedNet) {
          const t = (0 - prevZ) / (currZ - prevZ);
          const intersectY = this.prevShuttlePos.y + t * (this.shuttlePos.y - this.prevShuttlePos.y);
          const intersectX = this.prevShuttlePos.x + t * (this.shuttlePos.x - this.prevShuttlePos.x);

          this.lastNetCrossing = {
            y: intersectY,
            x: intersectX,
            hitter: this.lastHitter,
            cleared: intersectY > this.netHeight,
            timestamp: performance.now()
          };

          // Net collision strict bounds: |x| <= 3.05m, y <= 1.52m tape height (dips to 1.524m in center)
          if (intersectY <= 1.52 && Math.abs(intersectX) <= 3.05 && (Math.abs(currZ) <= 0.15 || Math.abs(prevZ) <= 0.15 || Math.abs(this.shuttlePos.z) <= 0.15)) {
            // Physically bounce shuttlecock off net tape
            this.shuttlePos.set(intersectX, Math.min(intersectY, 1.50), 0.04 * (prevZ < 0 ? -1 : 1));
            this.shuttleGroup.position.copy(this.shuttlePos);
            this.audio.badmintonHit(30);
            this.netHitTimer = 0.6;
            this.shuttleVel.z = -this.shuttleVel.z * 0.18;
            this.shuttleVel.y = -0.6;
            this.shuttleVel.x *= 0.3;
            const ptWinner = this.lastHitter === 'player' ? 2 : 1;
            const faultReason = this.lastHitter === 'player'
              ? 'Net Fault! Shuttle struck net on your shot (+1 Opponent)'
              : 'Net Fault! Opponent return struck the net (+1 Player)';
            if (!this.pendingNetFault) {
              this.pendingNetFault = {
                winner: ptWinner,
                reason: faultReason,
                timer: 0.35 // 350ms physical tumble before banner and point award
              };
            }
          }
        }
        this.prevShuttlePos.copy(this.shuttlePos);
      }

      this.physicsAccumulator -= FIXED_DT;
    }

    if (this.rallyState === 'IN_PLAY') {
      // Net ripple animation
      if (this.netHitTimer > 0) {
        this.netHitTimer -= frameDt;
        const pulse = Math.abs(Math.sin(this.netHitTimer * 30));
        (this.netMesh.material as THREE.MeshStandardMaterial).emissive.setHex(0xff2222);
        (this.netMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = pulse * 1.4;
      } else {
        (this.netMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0;
      }

      // Shuttle trail update — Aerodynamic cyan-yellow glow
      this.shuttleTrail.unshift(this.shuttlePos.clone());
      if (this.shuttleTrail.length > this.TRAIL_LENGTH) this.shuttleTrail.pop();
      for (let i = 0; i < this.TRAIL_LENGTH; i++) {
        const tm = this.shuttleTrailMeshes[i];
        if (!tm) continue;
        if (this.shuttleTrail[i]) {
          tm.visible = true;
          tm.position.copy(this.shuttleTrail[i]);
          const baseOpacity = (1 - i / this.TRAIL_LENGTH) * 0.60;
          (tm.material as THREE.MeshBasicMaterial).opacity = Math.min(0.90, baseOpacity * (1 + this.rallyTensionLevel * 0.4));
          const tensionScale = 1.0 + this.rallyTensionLevel * 0.35 * (1 - i / this.TRAIL_LENGTH);
          tm.scale.setScalar(tensionScale);
        } else {
          tm.visible = false;
        }
      }

      // ─── Incoming Shot Visibility Boost + Distance Scaling ─────────────────────────────────────────
      // When incoming from opponent across the court, scale up to 3.2x so it is instantly seen at 16m distance.
      // Solid radiant electric-magenta warning (0xff0077, opacity 0.95) gives maximum contrast against dark court.
      const isOpponentInFlight = this.shuttleVel.z < 0 && this.lastHitter === 'opponent';
      const justCrossedNet     = this.prevShuttlePos.z > 0 && this.shuttlePos.z <= 0;

      // Distance-aware scale: 3.2x when far away in opponent court (z > 0), transitioning to 2.0x near player
      const incomingTargetScale = isOpponentInFlight
        ? THREE.MathUtils.lerp(2.0, 3.2, THREE.MathUtils.clamp((this.shuttlePos.z + 1.0) / 4.5, 0, 1))
        : 1.25;

      this.shuttleGroup.scale.setScalar(incomingTargetScale);

      if (this.shuttleHaloMat && this.shuttleHaloMesh) {
        if (justCrossedNet && isOpponentInFlight) {
          // ⚡ Net-crossing flash: brilliant white flash burst for 1 frame
          this.shuttleHaloMat.color.setHex(0xffffff);
          this.shuttleHaloMesh.scale.setScalar(2.6);
          this.shuttleHaloMat.opacity = 1.0;
        } else if (isOpponentInFlight) {
          // Radiant electric high-contrast warning (neon magenta/cyan core) while incoming
          this.shuttleHaloMat.color.setHex(0xff0077);
          this.shuttleHaloMesh.scale.setScalar(1.6 + Math.sin(performance.now() * 0.015) * 0.20);
          this.shuttleHaloMat.opacity = 0.95;
        } else {
          // Outgoing shot: warm gold
          this.shuttleHaloMat.color.setHex(0xfbbf24);
          this.shuttleHaloMesh.scale.set(1.0, 1.0, 1.0);
          this.shuttleHaloMat.opacity = 0.55;
        }
      }

      // Vertical Altitude Laser Stem (connecting airborne shuttlecock down to its floor shadow)
      if (this.altitudeStemLine && this.altitudeStemGeo) {
        if ((this.rallyState === 'IN_PLAY' || this.isShuttleInPlay) && this.shuttlePos.y > 0.12) {
          this.altitudeStemLine.visible = true;
          const posAttr = this.altitudeStemGeo.attributes.position as THREE.BufferAttribute;
          posAttr.setXYZ(0, this.shuttlePos.x, this.shuttlePos.y, this.shuttlePos.z);
          posAttr.setXYZ(1, this.shuttlePos.x, 0.02, this.shuttlePos.z);
          posAttr.needsUpdate = true;
        } else {
          this.altitudeStemLine.visible = false;
        }
      }

      // Dynamic Floor Shadow Blob pinned to court floor (y = 0.02m)
      // Mario Tennis / Wii Sports depth cues: arcs high -> expands and softens; descends -> contracts to sharp, dark circle
      if (this.shuttleFloorShadowMesh && this.shuttleFloorShadowMat) {
        if (this.rallyState === 'IN_PLAY' || this.isShuttleInPlay) {
          this.shuttleFloorShadowMesh.visible = true;
          const yShuttle = Math.max(0, this.shuttlePos.y);
          this.shuttleFloorShadowMesh.position.set(this.shuttlePos.x, 0.02, this.shuttlePos.z);
          const s = THREE.MathUtils.clamp(0.55 + yShuttle * 0.22, 0.50, 1.60);
          this.shuttleFloorShadowMesh.scale.set(s, s, 1);
          this.shuttleFloorShadowMat.opacity = THREE.MathUtils.clamp(0.85 - yShuttle * 0.14, 0.28, 0.85);
        } else {
          this.shuttleFloorShadowMesh.visible = false;
        }
      }

      // Delayed net fault resolution: player sees shuttlecock tumble down off the net
      if (this.pendingNetFault) {
        this.pendingNetFault.timer -= frameDt;
        if (this.pendingNetFault.timer <= 0 || this.shuttlePos.y <= 0.08) {
          this._netFaultCount++;
          this.showNetHitBanner();
          const fault = this.pendingNetFault;
          this.pendingNetFault = null;
          this.handleRallyPoint(fault.winner, fault.reason);
          return;
        }
      }

      // 5. AI Opponent Interception & Continuous Tracking
      // Evaluated BEFORE ground impact so the bot intercepts incoming shots cleanly
      if (this.opponentAI) {
        const courtBounds = {
          minX: -this.singlesCourtWidth * 0.44,
          maxX: this.singlesCourtWidth * 0.44,
          minZ: 1.0, // Changed from 2.2 to 1.0 so the bot can reach frontcourt serves/drops
          maxZ: this.courtLength * 0.46
        };

        const aiResult = this.opponentAI.update(
          frameDt,
          this.shuttlePos,
          this.shuttleVel,
          courtBounds,
          this.scoreState.rallyCount,
          this.lastPlayerShotSpeed
        );

        this.opponentAvatar.group.position.x = this.opponentAI.position.x;
        this.opponentAvatar.group.position.z = this.opponentAI.position.z;

        if (aiResult.isPreparingSwing) {
          // Visual 200ms anticipation backswing pose
          this.opponentAvatar.playBackswingPose(aiResult.windupProgress, 'right', aiResult.isSmash);
        }

        if (aiResult.didHit && aiResult.hitVelocity) {
          this.shuttleVel.set(aiResult.hitVelocity.x, aiResult.hitVelocity.y, aiResult.hitVelocity.z);
          this.constrainLandingInCourt(this.shuttlePos.clone(), this.shuttleVel, false);
          this.floorDropImmunityTimer = 0.6;
          this.prevShuttlePos.copy(this.shuttlePos);
          this.lastHitter = 'opponent';
          this.scoreState.rallyCount++;

          // 2-frame turnaround flip animation on opponent return
          this.shuttleFlipTimer = 0.035;
          this.shuttlePrevQuat.copy(this.shuttleGroup.quaternion);
          this.shuttleTargetQuat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.shuttleVel.clone().normalize());

          const oppRacketHead = this.opponentAvatar.getRacketHeadWorldPosition();
          const shotType = aiResult.shotType || (aiResult.isSmash ? 'smash' : 'clear');
          const botSpeedKmh = Math.round(this.shuttleVel.length() * 3.6);

          this.updateSpeedometer(botSpeedKmh);

          // Spawn bright gold impact starburst at opponent's racket head
          this.triggerImpactFeedback(oppRacketHead, shotType, botSpeedKmh, true);

          // Punchy, racket string audio crack
          if (aiResult.isSmash) {
            this.audio.badmintonSmash();
          } else {
            this.audio.badmintonHit(70);
          }

          // Top hit quality badge ONLY (no blocking floating banner)
          const badgeText = aiResult.isSmash
            ? `💥 BOT HIT • SMASH ${botSpeedKmh} KM/H`
            : (shotType === 'drop' ? `🏸 BOT HIT • DROP ${botSpeedKmh} KM/H` : `🏸 BOT HIT • CLEAR ${botSpeedKmh} KM/H`);
          this.showHitQualityBadge(badgeText, 'bot');

          // Spawn full-flight intercept reticle at player's baseline and render 3D flight trajectory
          this.spawnIncomingInterceptReticle(this.shuttlePos, this.shuttleVel, aiResult.target);
          this.spawnIncomingFloorRing(this.shuttlePos, this.shuttleVel, aiResult.target);
          this.updateIncomingTrajectory(oppRacketHead, this.shuttleVel, aiResult.target);
        }
      }

      // Ground/Floor Impact with Visual Chalk Decal & Singles Line Calling
      // True cork floor impact threshold: y <= 0.08m
      // Do NOT check FLOOR DROP during the first 0.6 seconds of any shot!
      if (this.floorDropImmunityTimer > 0) {
        this.floorDropImmunityTimer = Math.max(0, this.floorDropImmunityTimer - frameDt);
      } else if (this.shuttlePos.y <= 0.08) {
        // Defer floor drop fault by 120ms if incoming shot is in player's court within 0.80m of racket to allow active scoop
        const racketHeadPos = this.playerAvatar.getRacketHeadWorldPosition();
        const distToRacket = racketHeadPos.distanceTo(this.shuttlePos);
        const isIncomingToPlayer = this.shuttleVel.z < 0 && this.shuttlePos.z <= -2.5 && this.lastHitter === 'opponent';

        if (isIncomingToPlayer && distToRacket <= 1.10 && this.floorDropGraceTimer < 0.220) {
          this.floorDropGraceTimer += frameDt;
          // Hold at floor level during grace window so player can scoop it without premature fault
          this.shuttlePos.y = 0.08;
          return;
        }

        this.floorDropGraceTimer = 0;
        this.shuttlePos.y = 0.05;
        this.isShuttleInPlay = false;

        const impactX = this.shuttlePos.x;
        const impactZ = this.shuttlePos.z;

        // Spawn instantaneous chalk ring/puff decal on the court mesh at the exact (X, Z) coordinate
        this.spawnChalkDecal(impactX, impactZ);

        // Official Singles Court Dimensions & In-Bounds Check
        // Center: X = 0.0m, Half-width: |X| <= 2.65m
        // Net: Z = 0.0m
        // Player Court: Z in [-6.75m, 0.05m]
        // Opponent Court: Z in [0.0m, +6.70m]
        const isInsidePlayerCourt = Math.abs(impactX) <= 2.65 && impactZ >= -6.75 && impactZ <= 0.05;
        const isInsideOpponentCourt = Math.abs(impactX) <= 2.59 && impactZ >= 0.0 && impactZ <= 6.70;

        console.log(`[BOUNCE EVAL] pos.x: ${impactX.toFixed(3)}, pos.z: ${impactZ.toFixed(3)}, isInsidePlayerCourt: ${isInsidePlayerCourt}, isInsideOpponentCourt: ${isInsideOpponentCourt}`);

        if (impactZ > 0) {
          // Landed on Opponent side
          if (isInsideOpponentCourt) {
            this.showLineCallBadge(true, impactX, impactZ); // Green IN
            this.handleRallyPoint(1, `In! (+1 Player)`);
          } else {
            this.showLineCallBadge(false, impactX, impactZ); // Red OUT
            this.handleRallyPoint(2, `Out of Bounds! (+1 Opponent)`);
          }
        } else {
          // Landed on Player side
          if (isInsidePlayerCourt) {
            // It dropped on player's floor. That's a clean point for the bot, NOT out of bounds!
            this.showHitQualityBadge(`FLOOR DROP (+1 BOT)`, 'bot');
            this.handleRallyPoint(2, `Floor Drop (+1 Bot)`);
          } else {
            // Bot hit it past your baseline or wide
            this.showLineCallBadge(false, impactX, impactZ);
            this.handleRallyPoint(1, `Opponent Hit Out! (+1 Player)`);
          }
        }
        return;
      }
    }

    // Opponent dynamic IK swing animation
    if (this.opponentAI && this.opponentAI.isSwinging) {
      this.opponentAvatar.playSwingAnimation(
        new THREE.Vector3(this.opponentAI.swingTarget.x, this.opponentAI.swingTarget.y, this.opponentAI.swingTarget.z),
        this.opponentAI.swingProgress,
        this.opponentAI.lastShotType === 'smash',
        'right'
      );
    }

    // Update chalk floor impact decals
    this.updateChalkDecals(deltaTime);

    // 5. Incoming Impact Reticle & Dynamic Floor Landing Target
    this.updateImpactReticle();
    this.updateIncomingFloorRing();

    this.updateImpactFeedback(deltaTime);

    this.renderer.render(this.scene, this.camera);
  }

  public onAction(event: ActionEvent): void {
    // Only register explicit high-velocity physical swings (> 3.5 m/s)
    if (event.speedMps < 3.5) return;

    if (this.rallyState === 'READY_TO_SERVE' && this.scoreState.currentServer === 1) {
      if (this.serveCooldownTimer <= 0 && this.isRacketInServeProximity()) {
        this.executePlayerServe(this.shuttlePos);
      }
      return;
    }

    if (this.rallyState === 'IN_PLAY' && this.lastHitter !== 'player') {
      // Prime swing intent for 250ms without forcing an automatic hit
      this.swingIntentTimer = 0.25;
    }
  }

  // ─── Point & Score ──────────────────────────────────────────────────────────

  private handleRallyPoint(winner: 1 | 2, reason: string): void {
    if (this.rallyState !== 'IN_PLAY') return;
    this.floorDropGraceTimer = 0;
    this.rallyState = 'POINT_AWARDED';
    this.isShuttleInPlay = false;
    this.shuttleVel.set(0, 0, 0);
    this.hideImpactReticle();
    this.hideIncomingTrajectory();
    this.hideIncomingFloorRing();

    this.scoreState.lastPointWinner = winner;
    this.scoreState.lastPointReason = reason;

    if (winner === 1) {
      this.scoreState.player1Score++;
      this.scoreState.currentServer = 1;
      this.audio.scoreChime();
    } else {
      this.scoreState.player2Score++;
      this.scoreState.currentServer = 2;
    }

    const p1 = this.scoreState.player1Score;
    const p2 = this.scoreState.player2Score;
    const target = this.targetScore;
    const maxCap = target <= 5 ? 7 : (target === 11 ? 15 : 30);

    // Match point & deuce detection
    if (p1 >= target - 1 && p2 >= target - 1) {
      if (p1 === p2) {
        this.scoreState.matchPointText = `DEUCE (${p1} - ${p2}) • WIN BY 2`;
      } else if (p1 > p2) {
        this.scoreState.matchPointText = `MATCH POINT: PLAYER (${p1} - ${p2})`;
      } else {
        this.scoreState.matchPointText = `MATCH POINT: OPPONENT (${p2} - ${p1})`;
      }
    } else if (p1 === target - 1) {
      this.scoreState.matchPointText = `MATCH POINT: PLAYER (${p1} - ${p2})`;
    } else if (p2 === target - 1) {
      this.scoreState.matchPointText = `MATCH POINT: OPPONENT (${p2} - ${p1})`;
    } else {
      this.scoreState.matchPointText = undefined;
    }

    const p1Wins = (p1 >= target && p1 - p2 >= 2) || p1 >= maxCap;
    const p2Wins = (p2 >= target && p2 - p1 >= 2) || p2 >= maxCap;

    if (p1Wins) {
      this.scoreState.isGameOver = true;
      this.scoreState.winner = 1;
      this.rallyState = 'GAME_OVER';
      this.audio.whistle();
      // Auto-stop recording when the match ends so the clip is cleanly saved
      setTimeout(() => this.stopRecording(), 800);
    } else if (p2Wins) {
      this.scoreState.isGameOver = true;
      this.scoreState.winner = 2;
      this.rallyState = 'GAME_OVER';
      this.audio.whistle();
      setTimeout(() => this.stopRecording(), 800);
    }

    this.notifyScore();

    if (!this.scoreState.isGameOver) {
      setTimeout(() => {
        if (this.isRunning) {
          this.resetBall(this.scoreState.currentServer);
        }
      }, 1200);
    }
  }

  // ─── Resize / Score / Destroy ───────────────────────────────────────────────

  public onResize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  public setDominantHand(hand: 'right' | 'left'): void {
    this.dominantHand = hand;
    if (this.playerAvatar) {
      this.playerAvatar.setDominantArm(hand);
    }
    this.serveCooldownTimer = 0.5;
    this.racketVelocity.set(0, 0, 0);
    if (this.playerAvatar) {
      this.previousRacketPosition.copy(this.playerAvatar.getRacketWorldPosition());
    }
    if (this.rallyState === 'READY_TO_SERVE' && this.scoreState.currentServer === 1 && this.isShuttleHeld) {
      const sHand = this.playerAvatar.getSupportHandWorldPosition();
      this.shuttlePos.set(sHand.x, sHand.y + 0.04, sHand.z + 0.05);
      this.shuttleGroup.position.copy(this.shuttlePos);
      this.prevShuttlePos.copy(this.shuttlePos);
      this.updateServeTrajectory(this.shuttlePos);
    }
  }

  public getScore(): GameScoreState { return this.scoreState; }

  /**
   * Debug API surface consumed exclusively by Playwright automated tests.
   * Returns a plain-object snapshot of live physics state each frame.
   */
  public getDebugState(): any {
    const racketWorldPos = this.playerAvatar ? this.playerAvatar.getRacketWorldPosition() : null;
    const rightWristWorldPos = this.playerAvatar ? this.playerAvatar.getHandWorldPosition('right') : null;
    const leftWristWorldPos = this.playerAvatar ? this.playerAvatar.getHandWorldPosition('left') : null;
    const racketLocalPos = this.playerAvatar?.getRacketGroup() ? this.playerAvatar.getRacketGroup()!.position.clone() : null;

    return {
      rallyState: this.rallyState,
      lastHitter: this.lastHitter,
      isShuttleHeld: this.isShuttleHeld,
      shuttlePos: { x: this.shuttlePos.x, y: this.shuttlePos.y, z: this.shuttlePos.z },
      shuttleVel: { x: this.shuttleVel.x, y: this.shuttleVel.y, z: this.shuttleVel.z },
      isServeArmed: this.isServeArmed,
      netFaultCount: this._netFaultCount,
      scorePlayer: this.scoreState.player1Score,
      scoreOpponent: this.scoreState.player2Score,
      rallyCount: this.scoreState.rallyCount,
      lastNetCrossing: this.lastNetCrossing ? { ...this.lastNetCrossing } : null,
      racketWorldPos: racketWorldPos ? { x: racketWorldPos.x, y: racketWorldPos.y, z: racketWorldPos.z } : null,
      rightWristWorldPos: rightWristWorldPos ? { x: rightWristWorldPos.x, y: rightWristWorldPos.y, z: rightWristWorldPos.z } : null,
      leftWristWorldPos: leftWristWorldPos ? { x: leftWristWorldPos.x, y: leftWristWorldPos.y, z: leftWristWorldPos.z } : null,
      racketLocalPos: racketLocalPos ? { x: racketLocalPos.x, y: racketLocalPos.y, z: racketLocalPos.z } : null,
      lastAction: this.lastDebugAction,
      wristSpeed: this.lastDebugWristSpeed,
      dominantHand: this.dominantHand
    };
  }

  /**
   * Fires a clean player serve bypassing all webcam/jitter checks.
   * Used by Playwright tests to deterministically start rallies.
   */
  public debugServe(): void {
    if (this.rallyState === 'READY_TO_SERVE') {
      if (this.scoreState.currentServer === 1) {
        this.isServeArmed = true;
        this.executePlayerServe(this.shuttlePos);
      } else {
        this.serveCountdown = 0; // Trigger opponent serve immediately
      }
    }
  }

  public onScoreChange(callback: (score: GameScoreState) => void): () => void {
    this.scoreCallbacks.push(callback);
    return () => {
      this.scoreCallbacks = this.scoreCallbacks.filter(c => c !== callback);
    };
  }

  private notifyScore(): void {
    for (const cb of this.scoreCallbacks) cb(this.scoreState);
  }

  public destroy(): void {
    this.isRunning = false;
    // Stop any active recording before tearing down the renderer
    this.stopRecording();
    this.hideServeBanner();

    if (this.recordBtn) {
      this.recordBtn.remove();
      this.recordBtn = undefined;
    }
    if (this.recordingIndicator) {
      this.recordingIndicator.remove();
      this.recordingIndicator = undefined;
    }

    if (this.cameraViewBtn) {
      this.cameraViewBtn.remove();
      this.cameraViewBtn = undefined;
    }
    if (this.serveBanner) {
      this.serveBanner.remove();
      this.serveBanner = undefined;
    }
    if (this.netHitBanner) {
      this.netHitBanner.remove();
      this.netHitBanner = undefined;
    }
    if (this.screenImpactFlashEl) {
      this.screenImpactFlashEl.remove();
      this.screenImpactFlashEl = undefined;
    }
    if (this.hitQualityBadgeEl) {
      this.hitQualityBadgeEl.remove();
      this.hitQualityBadgeEl = undefined;
    }
    if (this.impactGroup) {
      this.scene.remove(this.impactGroup);
      this.impactParticles = [];
    }
    if (this.serveAimLine) {
      this.scene.remove(this.serveAimLine);
    }
    if (this.serveLandingReticle) {
      this.scene.remove(this.serveLandingReticle);
    }
    if (this.impactReticleGroup) {
      this.scene.remove(this.impactReticleGroup);
      this.impactReticleGroup = undefined;
    }
    if (this.altitudeStemLine) {
      this.scene.remove(this.altitudeStemLine);
    }
    if (this.incomingTrajectoryLine) {
      this.scene.remove(this.incomingTrajectoryLine);
    }
    if (this.incomingFloorRingGroup) {
      this.scene.remove(this.incomingFloorRingGroup);
    }
    if (this.fpRacketGroup) {
      this.scene.remove(this.fpRacketGroup);
    }
    if (this.fpSupportArmGroup) {
      this.scene.remove(this.fpSupportArmGroup);
    }
    // Remove shuttle trail meshes & floor shadow
    for (const tm of this.shuttleTrailMeshes) this.scene.remove(tm);
    this.shuttleTrailMeshes = [];
    this.shuttleTrail = [];
    if (this.shuttleFloorShadowMesh) {
      this.scene.remove(this.shuttleFloorShadowMesh);
    }
    if (this.pointerMoveHandler) {
      this.container.removeEventListener('mousemove', this.pointerMoveHandler);
    }
    if (this.pointerDownHandler) {
      this.container.removeEventListener('mousedown', this.pointerDownHandler);
    }
    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler);
    }
    if (this.renderer && this.renderer.domElement) {
      this.renderer.domElement.remove();
      this.renderer.dispose();
    }
  }
}
