import * as THREE from 'three';
import { IGameScene, GameScoreState } from '../core/scene/IGameScene';
import { GameModeId, OpponentMode, DifficultyLevel, MotionFrame, ActionEvent } from '../core/motion/Types';
import { SoundSynthesizer } from '../core/audio/SoundSynthesizer';
import { Avatar3D } from './components/Avatar3D';
import { OpponentAI } from '../core/multiplayer/OpponentAI';
import { VectorNormalizer } from '../core/motion/VectorNormalizer';
import { PACING_PROFILES } from '../core/multiplayer/OpponentAI';

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
  private readyPoseTimer = 0;
  private physicsAccumulator = 0;
  private previousRacketPosition = new THREE.Vector3(0, 1.5, -3.5);
  private racketVelocity = new THREE.Vector3();

  // Dynamic Serve & Support Hand Tracking
  private serveAimLine!: THREE.Line;
  private serveLandingReticle!: THREE.Mesh;
  private trackedSupportHandPos = new THREE.Vector3(-0.35, 1.25, -3.8);
  private lastSupportHandY = 1.25;
  private supportHandSpeedY = 0;
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
  private playerZ = -3.65;

  // AI Paddle
  private aiPaddlePos = new THREE.Vector3(0, 1.5, 4.2);

  // Net mesh reference (for ripple effect)
  private netMesh!: THREE.Mesh;
  private netHitTimer = 0;
  private netHitBanner?: HTMLElement;

  // Shuttle trail system & depth shadow
  private readonly TRAIL_LENGTH = 12;
  private shuttleTrail: THREE.Vector3[] = [];
  private shuttleTrailMeshes: THREE.Mesh[] = [];
  private shuttleHaloMat!: THREE.MeshBasicMaterial;
  private shuttleHaloMesh!: THREE.Mesh;
  private shuttleFloorShadowMesh!: THREE.Mesh;
  private shuttleFloorShadowMat!: THREE.MeshBasicMaterial;

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
  private baseCameraPos = new THREE.Vector3(0, 1.95, -5.2);
  private baseCameraLook = new THREE.Vector3(0, 1.4, 3.2);
  private baseCameraFov = 72;
  private screenImpactFlashEl?: HTMLElement;
  private hitQualityBadgeEl?: HTMLElement;
  private lineCallBadgeEl?: HTMLElement;

  // ─── Section 2: Spring-Damper FOV Punch ────────────────────────────────────
  private fovSpringVel = 0;     // FOV spring velocity (°/s)
  private currentFov = 72;

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
  private currentCameraPreset: 'court_level' | 'broadcast' | 'over_shoulder' = 'over_shoulder';
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

  // Serve guidance HUD banner & two-stage arming state machine
  private serveBanner?: HTMLElement;
  private serveCooldownTimer = 0;
  private isServeArmed = false;
  private serveArmTimer = 0;
  private floorDropGraceTimer = 0;

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

  // Event handlers for cleanup
  private pointerMoveHandler?: (e: MouseEvent) => void;
  private pointerDownHandler?: (e: MouseEvent) => void;
  private keydownHandler?: (e: KeyboardEvent) => void;

  public init(
    container: HTMLElement,
    audio: SoundSynthesizer,
    config?: { opponentMode: OpponentMode; difficulty: DifficultyLevel; targetScore?: number }
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
    }

    // Three.js Setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x070c18);
    this.scene.fog = new THREE.FogExp2(0x070c18, 0.025);

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
    this.playerAvatar.setGhostMode(false);
    this.playerAvatar.group.position.set(0, 0, this.playerZ);
    this.scene.add(this.playerAvatar.group);

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

    // Apply default camera preset: intimate Action Over-the-Shoulder
    this.applyCameraPreset('over_shoulder');

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
      // Elevated stadium view — full court overview
      this.baseCameraPos.set(0, 5.0, -8.2);
      this.baseCameraLook.set(0, 1.1, 0.8);
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
    } else if (preset === 'over_shoulder') {
      // Intimate Action Over-the-Shoulder (OTS) perspective
      const avX = this.playerAvatar ? this.playerAvatar.group.position.x : 0;
      const avZ = this.playerAvatar ? this.playerAvatar.group.position.z : this.playerZ;
      this.baseCameraPos.set(0, 1.95, -5.2);
      this.baseCameraLook.set(0, 1.4, 3.2);
      this.baseCameraFov = 72;
      this.camera.fov = 72;
      this.camera.position.copy(this.baseCameraPos);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(this.baseCameraLook);
      this.camera.updateProjectionMatrix();
      this.playerAvatar.group.visible = true;
      this.playerAvatar.setActionOTSVisibility(true);
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
    const isCasual = this.currentDifficulty === 'casual';
    const isPro = this.currentDifficulty === 'pro';
    const speedZ = isCasual ? 7.0 : (isPro ? 10.5 : 13.5);

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

    const targetNetY = isCasual ? 3.3 : 2.5; // Lofty high-clear arc over tape
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

  // ─── Incoming Impact Reticle (Dynamic Timing Ring) ─────────────────────────

  private buildImpactReticle(): void {
    this.impactReticleGroup = new THREE.Group();

    // Outer dynamic timing ring that contracts as shot approaches strike plane
    const outerRingGeo = new THREE.RingGeometry(0.29, 0.35, 32);
    this.impactOuterRingMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.45
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
  }

  private updateImpactReticle(): void {
    if (!this.impactReticleGroup || !this.impactOuterRingMesh || !this.impactOuterRingMat) return;

    // Active during incoming opponent shots heading towards player
    const isIncoming = this.rallyState === 'IN_PLAY' && this.lastHitter === 'opponent' && this.shuttleVel.z < -0.6;
    if (!isIncoming) {
      this.impactReticleGroup.visible = false;
      return;
    }

    // Strike plane is situated in player foreground at z = -3.5m
    const strikeZ = -3.5;
    const distZ = strikeZ - this.shuttlePos.z;
    const timeToArrival = distZ / this.shuttleVel.z; // distZ is negative, shuttleVel.z is negative -> positive time

    if (timeToArrival > 0 && timeToArrival < 2.5) {
      this.impactReticleGroup.visible = true;

      // Ballistic arrival point projection
      const arrX = this.shuttlePos.x + this.shuttleVel.x * timeToArrival;
      const arrY = Math.max(0.35, this.shuttlePos.y + this.shuttleVel.y * timeToArrival - 0.5 * 9.8 * timeToArrival * timeToArrival);

      this.impactReticleGroup.position.set(
        THREE.MathUtils.clamp(arrX, -this.courtWidth * 0.45, this.courtWidth * 0.45),
        THREE.MathUtils.clamp(arrY, 0.4, 3.2),
        strikeZ
      );
      this.impactReticleGroup.lookAt(this.camera.position);

      // Outer timing ring contracts smoothly down to match the inner ring (scale ~0.24)
      const pacingProfile = PACING_PROFILES[
        this.currentDifficulty === 'legend' ? 'pro' : this.currentDifficulty === 'pro' ? 'normal' : 'casual'
      ];
      const tNorm = Math.max(0, Math.min(1, timeToArrival / pacingProfile.targetFlightTime));
      const ringScale = THREE.MathUtils.lerp(0.24, 1.0, tNorm);
      this.impactOuterRingMesh.scale.set(ringScale, ringScale, 1);

      // Peripheral timing cue fires when inside the profile's hit time window — zero text over court
      const swingNowThreshold = pacingProfile.hitTimeWindow / 1000; // 0.26s casual, 0.12s pro
      if (timeToArrival <= swingNowThreshold) {
        this.impactOuterRingMat.color.setHex(0x39ff14);
        const pulseAlpha = 0.75 + Math.sin(performance.now() * 0.03) * 0.25;
        this.impactOuterRingMat.opacity = pulseAlpha;
        if (this.impactInnerRingMat) {
          this.impactInnerRingMat.color.setHex(0x39ff14);
          this.impactInnerRingMat.opacity = pulseAlpha;
        }
        if (this.swingNowCueEl) {
          this.swingNowCueEl.classList.add('active');
        }
      } else {
        this.impactOuterRingMat.color.setHex(0xf59e0b);
        this.impactOuterRingMat.opacity = 0.50;
        if (this.impactInnerRingMat) {
          this.impactInnerRingMat.color.setHex(0x00f2fe);
          this.impactInnerRingMat.opacity = 0.45;
        }
        if (this.swingNowCueEl) {
          this.swingNowCueEl.classList.remove('active');
        }
      }
    } else {
      this.impactReticleGroup.visible = false;
      if (this.swingNowCueEl) this.swingNowCueEl.classList.remove('active');
    }
  }

  private buildCameraViewButton(): void {
    this.cameraViewBtn = document.createElement('button');
    this.cameraViewBtn.className = 'icon-btn camera-view-toggle-btn glass-panel';
    this.cameraViewBtn.id = 'btn-bm-camera-view';
    this.cameraViewBtn.innerHTML = '<span>🎥</span><span>View: Action OTS</span>';
    this.cameraViewBtn.title = 'Switch Camera View [Key: C]';
    this.cameraViewBtn.onclick = () => this.cycleCameraView();
    this.container.appendChild(this.cameraViewBtn);
  }

  private cycleCameraView(): void {
    if (this.currentCameraPreset === 'over_shoulder') {
      this.applyCameraPreset('broadcast');
      if (this.cameraViewBtn) this.cameraViewBtn.innerHTML = '<span>🎥</span><span>View: Broadcast</span>';
    } else if (this.currentCameraPreset === 'broadcast') {
      this.applyCameraPreset('court_level');
      if (this.cameraViewBtn) this.cameraViewBtn.innerHTML = '<span>🎥</span><span>View: Court</span>';
    } else {
      this.applyCameraPreset('over_shoulder');
      if (this.cameraViewBtn) this.cameraViewBtn.innerHTML = '<span>🎥</span><span>View: Action OTS</span>';
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
        this.mouseRacketTarget.y = Math.min(this.mouseRacketTarget.y + 0.35, 3.5);
        this.playerZ = Math.min(-2.8, this.playerZ + 0.35);
        this.mouseSpeed = 3.2;
        this.isUsingMouse = true;
      } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
        this.mouseRacketTarget.y = Math.max(this.mouseRacketTarget.y - 0.35, 0.6);
        this.playerZ = Math.max(-4.5, this.playerZ - 0.35);
        this.mouseSpeed = 1.8;
        this.isUsingMouse = true;
      }
    };

    this.container.addEventListener('mousemove', this.pointerMoveHandler);
    this.container.addEventListener('mousedown', this.pointerDownHandler);
    window.addEventListener('keydown', this.keydownHandler);
  }

  private triggerSwing(isUserInitiated = false): void {
    if (this.rallyState === 'READY_TO_SERVE' && this.scoreState.currentServer === 1) {
      const racketHeadPos = this.playerAvatar.getRacketHeadWorldPosition();
      if (this.isServeStrikeRegistered(isUserInitiated, Math.max(this.mouseSpeed, this.racketVelocity.length()))) {
        this.executePlayerServe(racketHeadPos);
      }
      return;
    }

    if (this.rallyState === 'IN_PLAY' && this.lastHitter !== 'player') {
      this.swingIntentTimer = 0.50; // 500ms generous swing intent buffer
      const inPlayerHalf = this.shuttlePos.z <= -2.8 && this.shuttlePos.z > -7.2 && this.shuttleVel.z < 0;
      if (inPlayerHalf) {
        const racketHeadPos = this.playerAvatar.getRacketHeadWorldPosition();
        const sweptDist = this.distanceToSegment(racketHeadPos, this.prevShuttlePos, this.shuttlePos);
        const dist3D = racketHeadPos.distanceTo(this.shuttlePos);
        const effectiveDist = Math.min(dist3D, sweptDist);

        const racketNDC = racketHeadPos.clone().project(this.camera);
        const shuttleNDC = this.shuttlePos.clone().project(this.camera);
        const screenDist = Math.hypot(shuttleNDC.x - racketNDC.x, shuttleNDC.y - racketNDC.y);

        // Full-height arcade cylinder from Y = 0.15m to 3.20m, expanding to 1.45m for wide edge shots (|x| > 1.20m)
        const isWideShot = Math.abs(this.shuttlePos.x) > 1.20;
        const hitRadius = isWideShot ? 1.45 : 1.10;
        const isVerticalInRange = this.shuttlePos.y >= 0.15 && this.shuttlePos.y <= 3.20;
        const distHorizontal = Math.hypot(racketHeadPos.x - this.shuttlePos.x, racketHeadPos.z - this.shuttlePos.z);
        const isCylinderHit = distHorizontal <= hitRadius && isVerticalInRange;

        if (effectiveDist <= hitRadius || isCylinderHit || screenDist < 0.28) {
          this.hitStopTimer = 0.016;
          this.floorDropGraceTimer = 0;
          this.executePlayerHit(
            racketHeadPos,
            Math.max(this.mouseSpeed, 2.5),
            this.mouseRacketTarget.y > 2.2 || this.shuttlePos.y < 1.30
          );
        }
      }
    }
  }

  private getRacketWorldPos(): THREE.Vector3 {
    return this.playerAvatar.getRacketWorldPosition();
  }

  private isServeStrikeRegistered(isUserInitiated = false, trackedSwingSpeed = 0): boolean {
    if (this.serveCooldownTimer > 0) {
      return false;
    }
    const racketHeadPos = this.playerAvatar.getRacketHeadWorldPosition();
    const dist3D = racketHeadPos.distanceTo(this.shuttlePos);
    const previousHeadPos = racketHeadPos.clone().sub(this.racketVelocity.clone().multiplyScalar(0.016));
    const sweptDistance = this.distanceToSegment(this.shuttlePos, previousHeadPos, racketHeadPos);
    const effectiveDist = Math.min(dist3D, sweptDistance);

    const racketNDC = racketHeadPos.clone().project(this.camera);
    const shuttleNDC = this.shuttlePos.clone().project(this.camera);
    const screenDist = Math.hypot(racketNDC.x - shuttleNDC.x, racketNDC.y - shuttleNDC.y);

    const totalSwingSpeed = Math.max(this.racketVelocity.length(), trackedSwingSpeed);

    // 1. Resilient contact volume: 0.40m (40cm) or screenDist < 0.18
    const isInsideVolume = effectiveDist <= 0.40;
    const isScreenOverlap = screenDist < 0.18;

    // 2. Stroke velocity gate: > 0.65 m/s or user initiated
    const isDeliberateSwing = totalSwingSpeed > 0.65 || isUserInitiated;

    if (isUserInitiated) {
      this.isServeArmed = true;
      return true;
    }

    return this.isServeArmed && (isInsideVolume || isScreenOverlap) && isDeliberateSwing;
  }

  private distanceToSegment(point: THREE.Vector3, start: THREE.Vector3, end: THREE.Vector3): number {
    const segment = end.clone().sub(start);
    const lengthSq = segment.lengthSq();
    if (lengthSq < 1e-8) return point.distanceTo(start);
    const t = THREE.MathUtils.clamp(point.clone().sub(start).dot(segment) / lengthSq, 0, 1);
    return point.distanceTo(start.clone().addScaledVector(segment, t));
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
  }

  // ─── Court ──────────────────────────────────────────────────────────────────

  private buildCourt(): void {
    // Green athletic court mat
    const courtGeo = new THREE.PlaneGeometry(this.courtWidth, this.courtLength);
    const courtMat = new THREE.MeshStandardMaterial({ color: 0x0d5c3a, roughness: 0.6 });
    const courtMesh = new THREE.Mesh(courtGeo, courtMat);
    courtMesh.rotation.x = -Math.PI / 2;
    courtMesh.receiveShadow = true;
    this.scene.add(courtMesh);

    // Surrounding stadium floor
    const stadiumGeo = new THREE.PlaneGeometry(28, 36);
    const stadiumMat = new THREE.MeshStandardMaterial({ color: 0x0a101d, roughness: 0.8 });
    const stadiumFloor = new THREE.Mesh(stadiumGeo, stadiumMat);
    stadiumFloor.rotation.x = -Math.PI / 2;
    stadiumFloor.position.y = -0.01;
    this.scene.add(stadiumFloor);

    // White Court Lines
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const addLine = (w: number, h: number, x: number, z: number) => {
      const lineGeo = new THREE.PlaneGeometry(w, h);
      const line = new THREE.Mesh(lineGeo, lineMat);
      line.rotation.x = -Math.PI / 2;
      line.position.set(x, 0.002, z);
      this.scene.add(line);
    };

    const halfW = this.courtWidth / 2;
    const halfL = this.courtLength / 2;
    const lineThickness = 0.05;

    addLine(this.courtWidth, lineThickness, 0, halfL);
    addLine(this.courtWidth, lineThickness, 0, -halfL);
    addLine(lineThickness, this.courtLength, halfW, 0);
    addLine(lineThickness, this.courtLength, -halfW, 0);
    addLine(this.courtWidth, lineThickness * 1.5, 0, 0);
    addLine(this.courtWidth, lineThickness, 0, 1.98);
    addLine(this.courtWidth, lineThickness, 0, -1.98);
    addLine(lineThickness, halfL - 1.98, 0, (halfL + 1.98) / 2);
    addLine(lineThickness, halfL - 1.98, 0, -(halfL + 1.98) / 2);

    // Net Posts
    const postGeo = new THREE.CylinderGeometry(0.04, 0.04, this.netHeight, 16);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8 });
    const postLeft = new THREE.Mesh(postGeo, postMat);
    postLeft.position.set(-halfW - 0.1, this.netHeight / 2, 0);
    this.scene.add(postLeft);
    const postRight = new THREE.Mesh(postGeo, postMat);
    postRight.position.set(halfW + 0.1, this.netHeight / 2, 0);
    this.scene.add(postRight);

    // Net — stored for ripple effect
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

    // Bright glow halo for tracking visibility and serve arming feedback
    const haloGeo = new THREE.SphereGeometry(0.072, 8, 8);
    this.shuttleHaloMat = new THREE.MeshBasicMaterial({
      color: 0xfbbf24, wireframe: true, transparent: true, opacity: 0.55
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
    speedKmh = 80
  ): void {
    const isSmash = type === 'smash';
    this.impactIsSmash = isSmash;
    this.impactGroup.position.copy(position);
    this.impactGroup.visible = true;
    this.impactTimer = this.impactMaxDuration;
    this.hitStopTimer = 0.035; // 2-frame simulation micro-pause for weight & certainty

    // Surge racket frame glow
    if (this.fpFrameMat) {
      this.fpFrameMat.emissiveIntensity = isSmash ? 3.4 : 2.2;
    }
    if (this.playerAvatar) {
      this.playerAvatar.pulseImpact(type === 'smash' ? 'smash' : (type === 'serve' ? 'serve' : 'hit'));
    }
    // Racket physical recoil kick
    this.racketRecoilAngle = isSmash ? -0.22 : -0.12;

    // Procedural camera trauma shake (decays smoothly in update)
    this.cameraTrauma = Math.min(1.0, this.cameraTrauma + (isSmash ? 0.82 : (type === 'serve' ? 0.32 : 0.50)));

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

    // Shockwave color and reset
    this.impactShockwaveMat.color.setHex(isSmash ? 0xff3344 : (type === 'serve' ? 0xfbbf24 : 0x00f2fe));
    this.impactShockwave.scale.setScalar(0.2);
    this.impactShockwaveMat.opacity = 1;

    // Flash core
    this.impactFlash.scale.setScalar(0.5);
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
      (particle.mesh.material as THREE.MeshBasicMaterial).opacity = 1;
    }

    // Screen impact vignette flash
    if (this.screenImpactFlashEl) {
      this.screenImpactFlashEl.className = `bm-impact-flash ${isSmash ? 'active-smash' : 'active-hit'}`;
      setTimeout(() => {
        if (this.screenImpactFlashEl) this.screenImpactFlashEl.className = 'bm-impact-flash';
      }, 160);
    }

    // Floating hit quality badge
    let badgeText = '';
    if (type === 'smash') badgeText = `💥 POWER SMASH ${speedKmh.toFixed(0)} KM/H`;
    else if (type === 'clear') badgeText = `⚡ OVERHEAD CLEAR`;
    else if (type === 'drop') badgeText = `🎯 TIGHT DROP`;
    else if (type === 'serve') badgeText = `🏸 SWEET SPOT SERVE ${speedKmh.toFixed(0)} KM/H`;
    else badgeText = `⚡ CLEAN DRIVE ${speedKmh.toFixed(0)} KM/H`;
    this.showHitQualityBadge(badgeText, isSmash);

    // Dispatch window event for MotionHUD PIP camera mirror sparks
    window.dispatchEvent(new CustomEvent('camarena-impact', { detail: { isSmash } }));
  }

  private showHitQualityBadge(text: string, isSmash = false): void {
    if (!this.hitQualityBadgeEl) return;
    this.hitQualityBadgeEl.textContent = text;
    this.hitQualityBadgeEl.className = `bm-hit-badge visible ${isSmash ? 'smash-style' : ''}`;
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

    // 3. Procedural Camera Trauma Shake & Dynamic OTS Tracking with Smooth Lerp (~0.08)
    if (this.currentCameraPreset === 'over_shoulder' && this.playerAvatar) {
      const avX = this.playerAvatar.group.position.x;
      const avZ = this.playerAvatar.group.position.z;
      const targetCamX = avX * 0.45;
      const targetCamZ = -4.75;
      const targetLookX = avX * 0.2;

      // Smooth linear interpolation so camera glides seamlessly with player footwork/lunges
      this.baseCameraPos.x = THREE.MathUtils.lerp(this.baseCameraPos.x, targetCamX, 0.05);
      this.baseCameraPos.y = 1.95;
      this.baseCameraPos.z = targetCamZ;
      this.baseCameraLook.x = THREE.MathUtils.lerp(this.baseCameraLook.x, targetLookX, 0.012);
      this.baseCameraLook.y = 1.4;
      this.baseCameraLook.z = 3.2;
    }

    this.camera.up.set(0, 1, 0);

    // Keep the Action OTS frame stable. Impact feedback must not move the
    // horizon or couple the camera to raw landmark jitter.
    this.currentFov = 72;
    this.fovSpringVel = 0;
    this.cameraTrauma = 0;
    this.camera.fov = 72;
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
      const endR   = maxLen * (0.55 + Math.random() * 0.45);

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

  private getTrackedHandPosition(landmark: MotionFrame['worldLandmarks'][number], zBase = this.playerZ): THREE.Vector3 {
    return new THREE.Vector3(
      THREE.MathUtils.clamp(landmark.x * 2.2, -this.courtWidth * 0.48, this.courtWidth * 0.48),
      THREE.MathUtils.clamp(1.0 + (-landmark.y - 0.55) * 1.8, 0.45, 3.6),
      THREE.MathUtils.clamp(zBase + landmark.z * 1.5, -6.2, -2.4)
    );
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

  private speedMultiplier(): number {
    if (this.currentDifficulty === 'casual') return 0.58;
    if (this.currentDifficulty === 'pro') return 0.80;
    return 1.0; // legend
  }

  // ─── Reset & Serve ──────────────────────────────────────────────────────────

  private setupServe(server: 1 | 2 = 1): void {
    this.isShuttleInPlay = false;
    this.rallyState = 'READY_TO_SERVE';
    this.isServeArmed = false;
    this.serveArmTimer = 0;
    this.floorDropGraceTimer = 0;
    this.shuttleTrail = [];

    // Reset AI stance to its home position for every serve
    this.opponentAI.reset();
    this.opponentAvatar.group.position.set(this.opponentAI.position.x, 0, this.opponentAI.position.z);

    // Guaranteed visibility & mesh reset
    this.shuttleGroup.visible = true;
    this.shuttleGroup.traverse(c => { c.visible = true; });

    if (server === 1) {
      this.isShuttleHeld = true;
      this.lastHitter = null;
      this.serveCooldownTimer = 0.4;

      // Immediate support hand docking directly to player's non-dominant hand
      const liveHand = this.playerAvatar.getSupportHandWorldPosition();
      this.shuttlePos.set(liveHand.x, liveHand.y + 0.04, liveHand.z + 0.05);
      this.shuttleGroup.position.copy(this.shuttlePos);
      this.prevShuttlePos.copy(this.shuttlePos);
      this.shuttleVel.set(0, 0, 0);

      // Cork faces net, feathers rest in hand
      this.shuttleGroup.rotation.set(-Math.PI * 0.45, 0, 0);

      // Immediately activate aim trajectory arc
      this.updateServeTrajectory(this.shuttlePos);

      this.showServeBanner('🏸 DRAW RACKET BACK TO ARM SERVE', 'amber');
      window.dispatchEvent(new CustomEvent('camarena-holding-shuttle', { detail: { isHolding: true } }));
    } else {
      this.isShuttleHeld = false;
      this.lastHitter = 'opponent';
      this.serveCountdown = 2.5;

      // Dock shuttlecock to opponent server
      this.shuttlePos.set(this.opponentAvatar.group.position.x, 1.4, this.opponentAvatar.group.position.z + 0.3);
      this.shuttleGroup.position.copy(this.shuttlePos);
      this.prevShuttlePos.copy(this.shuttlePos);
      this.shuttleVel.set(0, 0, 0);

      this.hideServeTrajectory();
      this.showServeBanner('🤖 OPPONENT SERVING — Get ready!', 'opponent');
      window.dispatchEvent(new CustomEvent('camarena-holding-shuttle', { detail: { isHolding: false } }));
    }

    this.previousRacketPosition.copy(this.playerAvatar.getRacketWorldPosition());
    this.racketVelocity.set(0, 0, 0);
    this.readyPoseTimer = 0;
    if (this.shuttleFloorShadowMesh) {
      this.shuttleFloorShadowMesh.visible = false;
    }
    if (this.shuttleHaloMat && this.shuttleHaloMesh) {
      this.shuttleHaloMat.color.setHex(0xf59e0b);
      this.shuttleHaloMesh.scale.set(1.0, 1.0, 1.0);
      this.shuttleHaloMat.opacity = 0.60;
    }
  }

  private resetBall(server: 1 | 2 = 1): void {
    this.setupServe(server);
  }

  private executePlayerServe(contactPoint = this.playerAvatar.getRacketContactPoint()): void {
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
    this.shuttleTrail = []; // Clear trail on new serve
    window.dispatchEvent(new CustomEvent('camarena-holding-shuttle', { detail: { isHolding: false } }));

    // Launch directly from current dynamic shuttlecock position
    const origin = contactPoint.clone();
    this.shuttlePos.copy(origin);
    this.shuttleGroup.position.copy(origin);

    const isCasual = this.currentDifficulty === 'casual';
    const isPro = this.currentDifficulty === 'pro';
    // Casual serve: gentle lofty high-clear arc (vz = +7.2 m/s, vy = +7.4 m/s, ~1.65s hang time)
    const speedZ = isCasual ? 7.2 : (isPro ? 10.5 : 13.5);
    const launchVY = isCasual ? 7.4 : (isPro ? 6.5 : 5.8);

    const swingX = this.racketVelocity.x;
    const contactOffset = (origin.x - this.playerAvatar.group.position.x) / 0.35;
    const serveVX = THREE.MathUtils.clamp((swingX * 0.45) + (contactOffset * 1.2), -3.5, 3.5);

    this.shuttleVel.set(serveVX, launchVY, speedZ);
    this.enforceNetClearance(origin, this.shuttleVel, 1.85);
    this.readyPoseTimer = 0;
    this.prevShuttlePos.copy(this.shuttlePos);

    // Fast 2-frame turnaround flip animation so cork points along launch vector
    this.shuttleFlipTimer = 0.035;
    this.shuttlePrevQuat.copy(this.shuttleGroup.quaternion);
    this.shuttleTargetQuat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.shuttleVel.clone().normalize());

    // Calculate actual serve speed in km/h for the HUD badge (speedZ = 7.2 m/s -> ~26 km/h)
    const speedKmh = Math.round(speedZ * 3.6);
    this.triggerImpactFeedback(origin, 'serve', speedKmh);
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
    minimumHeight = 1.85
  ): void {
    const forwardSpeed = Math.abs(velocity.z);
    if (forwardSpeed < 0.1) return;

    const timeToNet = Math.max(0.1, Math.abs(origin.z) / (forwardSpeed * 0.75));
    const predictedHeight = origin.y + velocity.y * timeToNet - 0.5 * 9.8 * timeToNet * timeToNet;
    if (predictedHeight < minimumHeight) {
      // Add required upward lift so the shuttle cleanly clears the net tape without inflating forward speed
      velocity.y = Math.max(
        velocity.y,
        (minimumHeight - origin.y + 0.5 * 9.8 * timeToNet * timeToNet) / timeToNet + 0.25
      );
    }
  }

  private executePlayerHit(racketPos: THREE.Vector3, vSwing = 2.0, isUpward = false): void {
    this.isShuttleHeld = false;
    this.lastHitter = 'player';
    this.scoreState.rallyCount++;
    this.floorDropGraceTimer = 0;
    this.hideServeBanner();
    this.hideServeTrajectory();
    this.shuttleTrail = []; // Clear trail on new hit

    const origin = this.shuttlePos.clone();
    const isCasual = this.currentDifficulty === 'casual';
    const isPro = this.currentDifficulty === 'pro';
    const contactY = origin.y;
    const isAimedHigh = this.mouseRacketTarget.y > 2.2;

    let shotType: 'smash' | 'drive' | 'clear' | 'drop' = 'drive';
    let speedZ: number;
    let reqVy: number;
    let speedKmh = 65;

    // Underhand Scoop Lift: Low shots (contactY < 1.30m) scooped upward or with defensive intent
    const isUnderhandScoop = contactY < 1.30 && (isUpward || this.racketVelocity.y > 0.35 || vSwing > 0.40);

    if (isUnderhandScoop) {
      // Underhand scoop launches with high defensive trajectory over the net deep into opponent court
      shotType = 'clear';
      speedZ = 7.0;
      reqVy = 7.8;
      speedKmh = 52 + Math.random() * 8;
      this.audio.badmintonHit(60);
    } else if (contactY > 1.9 && vSwing > 2.8 && !isCasual) {
      // 1. POWER SMASH (pro/legend only)
      shotType = 'smash';
      speedZ = isPro ? 16.0 : 20.0;
      reqVy = 3.5;
      speedKmh = 120 + Math.random() * 20;
      this.audio.badmintonSmash();
    } else if (contactY > 1.6 || isUpward || isAimedHigh || isCasual) {
      // 2. OVERHEAD CLEAR / LOB (default in casual for lofty ~1.40s readable arc)
      shotType = 'clear';
      speedZ = isCasual ? 8.5 : (isPro ? 10.5 : 13.5);
      reqVy = isCasual ? 7.8 : (isPro ? 6.5 : 5.8);
      speedKmh = 60 + Math.random() * 10;
      this.audio.badmintonHit(65);
    } else if (vSwing < 1.2) {
      // 3. DROP SHOT
      shotType = 'drop';
      speedZ = isCasual ? 6.5 : (isPro ? 7.5 : 8.5);
      reqVy = isCasual ? 4.2 : 4.0;
      speedKmh = 45 + Math.random() * 8;
      this.audio.badmintonHit(45);
    } else {
      // 4. FLAT DRIVE
      shotType = 'drive';
      speedZ = isCasual ? 11.0 : (isPro ? 13.0 : 16.0);
      reqVy = isCasual ? 5.2 : 4.8;
      speedKmh = 80 + Math.random() * 12;
      this.audio.badmintonHit(65);
    }

    const swingX = this.racketVelocity.x;
    const contactOffset = (origin.x - this.playerAvatar.group.position.x) / 0.35;
    const returnX = THREE.MathUtils.clamp((swingX * 0.45) + (contactOffset * 1.2), -3.5, 3.5);

    this.shuttleVel.set(returnX, reqVy, speedZ);
    this.enforceNetClearance(origin, this.shuttleVel, shotType === 'clear' ? 2.2 : 1.85);
    this.prevShuttlePos.copy(this.shuttlePos);
    this.rallyState = 'IN_PLAY';
    this.isShuttleInPlay = true;

    // Fast 2-frame turnaround flip animation so cork points along outgoing launch vector
    this.shuttleFlipTimer = 0.035;
    this.shuttlePrevQuat.copy(this.shuttleGroup.quaternion);
    this.shuttleTargetQuat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.shuttleVel.clone().normalize());

    this.shuttlePos.copy(racketPos);
    this.shuttleGroup.position.copy(racketPos);
    this.triggerImpactFeedback(racketPos, shotType, speedKmh);
    this.notifyScore();
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
    let vSwing = this.mouseSpeed;
    let isUpwardSwing = this.mouseRacketTarget.y > 2.2;
    let trackedWristVel: { x: number; y: number; z: number } | null = null;

    if (motionFrame && motionFrame.worldLandmarks) {
      this.playerAvatar.update(motionFrame.worldLandmarks, motionFrame.metrics.dominantArm, frameDt);

      // Use visible shoulders for lateral footwork; hips and ankles are often
      // outside a desktop webcam's frame and should not lock the avatar.
      const normX = this.vectorNormalizer.getMirroredShoulderX(motionFrame.rawLandmarks);
      const targetAvatarX = THREE.MathUtils.clamp(normX * 2.4, -2.3, 2.3);
      const hipZ = motionFrame.metrics.hipCenterWorld.z;
      const targetAvatarZ = THREE.MathUtils.clamp(-3.65 - hipZ * 1.6, -4.5, -2.8);

      this.playerAvatar.group.position.x = THREE.MathUtils.lerp(this.playerAvatar.group.position.x, targetAvatarX, 0.15);
      this.playerAvatar.group.position.z = THREE.MathUtils.lerp(this.playerAvatar.group.position.z, targetAvatarZ, Math.min(1, deltaTime * 8));

      const domWristIdx = 16;

      // Calculate instantaneous wrist velocity for shot classification
      const wristVel = motionFrame.velocities?.[domWristIdx] || motionFrame.metrics.rightWristVelocity;
      if (wristVel) {
        trackedWristVel = wristVel;
        vSwing = Math.hypot(wristVel.x, wristVel.y, wristVel.z);
        isUpwardSwing = wristVel.y > 0.45;
      }

      // Avatar3D.update has already placed the racket directly on filtered
      // MediaPipe landmark 16. Do not replace that pose with a camera-plane
      // target: doing so makes the racket appear fixed while the real hand moves.
      const dominantTarget = this.playerAvatar.getHandWorldPosition('right');
      this.activeRacketPos.copy(dominantTarget);

      if (this.rallyState === 'READY_TO_SERVE' && this.scoreState.currentServer === 1) {
        // Both hands remain driven by their live MediaPipe landmarks.
        const sHand = this.playerAvatar.getSupportHandWorldPosition();
        this.trackedSupportHandPos.copy(sHand);
      } else {
        // Rally: dominant arm remains driven by the live right-wrist landmark.
        const sHand = this.playerAvatar.getSupportHandWorldPosition();
        this.trackedSupportHandPos.copy(sHand);
      }
    } else if (this.isUsingMouse) {
      // Allow mouse / keyboard to move player across court within [-2.2, 2.2] and [-4.5, -2.8]
      const targetAvatarX = THREE.MathUtils.clamp(this.mouseRacketTarget.x * 0.65, -2.2, 2.2);
      this.playerAvatar.group.position.x = THREE.MathUtils.lerp(this.playerAvatar.group.position.x, targetAvatarX, 0.25);
      this.playerAvatar.group.position.z = THREE.MathUtils.lerp(this.playerAvatar.group.position.z, this.playerZ, 0.15);

      vSwing = this.mouseSpeed;
      isUpwardSwing = this.mouseRacketTarget.y > 2.2;

      this.trackRacketTarget(this.mouseRacketTarget, frameDt);

      const mouseNormX = THREE.MathUtils.clamp(this.mouseRacketTarget.x / (this.courtWidth / 2 + 0.5), -1, 1);
      const mouseNormY = THREE.MathUtils.clamp(((this.mouseRacketTarget.y - 1.0) / 2.2) * 2.0 - 1.0, -1, 1);

      if (this.rallyState === 'READY_TO_SERVE' && this.scoreState.currentServer === 1) {
        // Mouse fallback keeps the support hand at its current live position.
        const supportTarget = this.playerAvatar.getSupportHandWorldPosition();
        const dominantTarget = Avatar3D.mapScreenToStrikePlane(this.camera, mouseNormX, mouseNormY, 0, false, 0.95, 0.15);

        this.playerAvatar.poseArmsToTargets(dominantTarget, supportTarget, 'right');
        this.trackedSupportHandPos.copy(this.playerAvatar.getSupportHandWorldPosition());
      } else {
        // In rally: dominant arm reaches towards mouse target with racket on strike plane
        const dominantTarget = Avatar3D.mapScreenToStrikePlane(this.camera, mouseNormX, mouseNormY, 0, false, 0.95, 0.15);
        this.playerAvatar.poseArmsToTargets(dominantTarget, undefined, 'right');
      }
    }

    // Clamp X to valid court range
    this.activeRacketPos.x = Math.max(-this.courtWidth * 0.45, Math.min(this.courtWidth * 0.45, this.activeRacketPos.x));

    this.playerAvatar.keepRacketInViewport(this.camera, 0.82);
    const racketPosition = this.playerAvatar.getRacketWorldPosition();
    const safeDelta = Math.max(0.008, frameDt);
    this.racketVelocity.copy(racketPosition).sub(this.previousRacketPosition).divideScalar(safeDelta);
    this.previousRacketPosition.copy(racketPosition);
    this.readyPoseTimer = 0;

    // 1. Omnidirectional Swing Intent Recognition
    // Calculate total 3D swing velocities across motion tracking and racket displacement
    const swingVx = Math.abs(this.racketVelocity.x) > (trackedWristVel ? Math.abs(trackedWristVel.x) : 0) ? this.racketVelocity.x : (trackedWristVel?.x || 0);
    const swingVy = Math.abs(this.racketVelocity.y) > (trackedWristVel ? Math.abs(trackedWristVel.y) : 0) ? this.racketVelocity.y : (trackedWristVel?.y || 0);
    const swingVz = Math.abs(this.racketVelocity.z) > (trackedWristVel ? Math.abs(trackedWristVel.z) : 0) ? this.racketVelocity.z : (trackedWristVel?.z || 0);
    const vSwing3D = Math.sqrt(swingVx * swingVx + swingVy * swingVy + swingVz * swingVz);
    const effectiveSwingSpeed = Math.max(vSwing, vSwing3D, this.racketVelocity.length());

    // Criteria:
    // 1. Underhand Scoop: Upward velocity vy > +0.45 m/s while shuttlecock is low (y < 1.30m)
    const isUnderhandScoop = swingVy > 0.45 && this.shuttlePos.y < 1.30;
    // 2. Wide Forehand / Backhand: Lateral velocity |vx| > +0.50 m/s
    const isWideLateralStroke = Math.abs(swingVx) > 0.50;
    // 3. Standard Drive / Clear: Total 3D velocity > 0.60 m/s or forward vz > +0.35 m/s
    const isStandardStroke = effectiveSwingSpeed > 0.60 || swingVz > 0.35 || (this.isUsingMouse && this.mouseSpeed > 0.40);

    const hasActiveStrokeIntent = isUnderhandScoop || isWideLateralStroke || isStandardStroke || isUpwardSwing;

    if (hasActiveStrokeIntent) {
      this.swingIntentTimer = 0.45; // 450ms intent window
    } else {
      this.swingIntentTimer = Math.max(0, this.swingIntentTimer - deltaTime);
    }
    const hasSwingIntent = this.swingIntentTimer > 0;

    // 2. Arcade Swept Hit Cylinder Collision Detection (player side)
    if (this.rallyState === 'IN_PLAY' && this.lastHitter !== 'player') {
      const inPlayerZone = this.shuttlePos.z <= -0.6 && this.shuttlePos.z > -7.2 && this.shuttleVel.z < 0;
      if (inPlayerZone) {
        const racketHeadPos = this.playerAvatar.getRacketHeadWorldPosition();

        // 1. Swept Segment vs. Racket Head Center: segment between prevShuttlePos and shuttlePos
        const sweptDist = this.distanceToSegment(racketHeadPos, this.prevShuttlePos, this.shuttlePos);
        const dist3D = racketHeadPos.distanceTo(this.shuttlePos);
        const effectiveDist = Math.min(dist3D, sweptDist);

        // 2. Screen-Space Visual Fallback
        const racketNDC = racketHeadPos.clone().project(this.camera);
        const shuttleNDC = this.shuttlePos.clone().project(this.camera);
        const screenDist = Math.hypot(shuttleNDC.x - racketNDC.x, shuttleNDC.y - racketNDC.y);

        // Calculate time to arrival at the player's racket Z plane
        const strikeZ = racketHeadPos.z;
        const timeToArrival = this.shuttleVel.z < -0.1
          ? (strikeZ - this.shuttlePos.z) / this.shuttleVel.z
          : Number.POSITIVE_INFINITY;

        // Full-Height Arcade Hit Volume (Y = 0.15m to 3.20m) & Wide Lateral Reach (|x| > 1.20m -> 1.45m)
        const isWideShot = Math.abs(this.shuttlePos.x) > 1.20;
        const hitRadius = isWideShot ? 1.45 : 1.10;
        const isInsideHitVolume = effectiveDist <= hitRadius;
        const isScreenOverlap = screenDist < 0.28;
        const isInPlayerZone = this.shuttlePos.z <= -2.8;

        // Vertical cylinder test (floor to ceiling Y in [0.15, 3.20])
        const isVerticalInRange = this.shuttlePos.y >= 0.15 && this.shuttlePos.y <= 3.20;
        const distHorizontal = Math.hypot(racketHeadPos.x - this.shuttlePos.x, racketHeadPos.z - this.shuttlePos.z);
        const isCylinderHit = distHorizontal <= hitRadius && isVerticalInRange;

        // Arrival window [-0.15s, +0.25s]
        const isWithinTemporalWindow = timeToArrival >= -0.15 && timeToArrival <= 0.25;
        const hasSwingMotion = effectiveSwingSpeed > 0.45 || hasSwingIntent || hasActiveStrokeIntent;
        const isProximityBlock = (effectiveDist <= 0.55 || (distHorizontal <= 0.55 && isVerticalInRange)) && effectiveSwingSpeed > 0.25;

        if (isInPlayerZone && (((isWithinTemporalWindow && (isInsideHitVolume || isCylinderHit || isScreenOverlap)) && hasSwingMotion) || isProximityBlock)) {
          // Snap shuttlecock to racket head for 1 frame (hit-stop), play sound/sparks, and launch return
          this.hitStopTimer = 0.016; // 1-frame hit-stop pause
          this.floorDropGraceTimer = 0;
          const isUpwardOrScoop = isUpwardSwing || isUnderhandScoop || swingVy > 0.35 || this.shuttlePos.y < 1.30;
          this.executePlayerHit(racketHeadPos, Math.max(effectiveSwingSpeed, 2.4), isUpwardOrScoop);
        }
      }
    }

    // 3. Serve Logic & Real-Time Hand Tracking
    if (this.rallyState === 'READY_TO_SERVE' && !this.scoreState.isGameOver) {
      if (this.scoreState.currentServer === 1) {
        if (this.serveCooldownTimer > 0) {
          this.serveCooldownTimer = Math.max(0, this.serveCooldownTimer - deltaTime);
        }

        if (this.isShuttleHeld) {
          // The support hand is always MediaPipe left wrist (15).
          const handPos = this.playerAvatar.getSupportHandWorldPosition();
          this.shuttlePos.set(handPos.x, handPos.y + 0.04, handPos.z + 0.05);
          this.shuttleGroup.position.copy(this.shuttlePos);
          this.prevShuttlePos.copy(this.shuttlePos);
          this.shuttleGroup.visible = true;

          // Shuttlecock orientation: cork points forward toward net, feathers resting in hand
          this.shuttleGroup.rotation.set(-Math.PI * 0.45, 0, 0);

          // Update holographic serve trajectory arc in real-time
          this.updateServeTrajectory(this.shuttlePos);

          // Physical Cocking / Arming Requirement:
          // Must draw the racket head back >= 0.35m from the held shuttlecock for at least 0.12s
          const racketHeadPos = this.playerAvatar.getRacketHeadWorldPosition();
          const distRacketToShuttle = racketHeadPos.distanceTo(this.shuttlePos);

          if (!this.isServeArmed) {
            if (distRacketToShuttle >= 0.35) {
              this.serveArmTimer += deltaTime;
              if (this.serveArmTimer >= 0.12) {
                this.isServeArmed = true;
                this.showServeBanner('⚡ READY! SWING TO SERVE', 'ready');
              } else {
                this.showServeBanner('🏸 DRAW RACKET BACK TO ARM SERVE', 'amber');
              }
            } else {
              this.serveArmTimer = 0;
              this.showServeBanner('🏸 DRAW RACKET BACK TO ARM SERVE', 'amber');
            }
          } else {
            this.showServeBanner('⚡ READY! SWING TO SERVE', 'ready');
          }

          // Visual Arming Indicator on held shuttlecock:
          // Amber/yellow glow when !isServeArmed; Bright neon green pulse when isServeArmed
          if (this.shuttleHaloMat && this.shuttleHaloMesh) {
            if (this.isServeArmed) {
              this.shuttleHaloMat.color.setHex(0x39ff14);
              const pulse = 1.0 + Math.sin(performance.now() * 0.012) * 0.22;
              this.shuttleHaloMesh.scale.set(pulse, pulse, pulse);
              this.shuttleHaloMat.opacity = 0.85;
            } else {
              this.shuttleHaloMat.color.setHex(0xf59e0b);
              this.shuttleHaloMesh.scale.set(1.0, 1.0, 1.0);
              this.shuttleHaloMat.opacity = 0.60;
            }
          }

          // Deliberate stroke execution or webcam swing
          if (this.isServeStrikeRegistered(false, effectiveSwingSpeed)) {
            this.executePlayerServe(this.playerAvatar.getRacketHeadWorldPosition());
          }
        }
      } else {
        // AI server: keep shuttlecock visibly docked to opponent until served
        this.shuttlePos.set(this.opponentAvatar.group.position.x, 1.4, this.opponentAvatar.group.position.z + 0.3);
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

          const origin = this.shuttlePos.clone();
          // High-arc readable serve using active difficulty pacing profile.
          // Casual: vz = -9.1 m/s, vy = +8.0 m/s -> ~1.55s hang-time to player baseline.
          const servePacing = PACING_PROFILES[
            this.currentDifficulty === 'legend' ? 'pro'
            : this.currentDifficulty === 'pro' ? 'normal'
            : 'casual'
          ];
          const isCasual = this.currentDifficulty === 'casual';
          const speedZ = isCasual ? 9.1 : (Math.abs(servePacing.opponentSpeedZ) + (Math.random() - 0.5) * 0.4);
          const reqVy  = isCasual ? 8.0 : (servePacing.opponentLiftY + (Math.random() - 0.5) * 0.4);
          const targetX = (Math.random() - 0.5) * 2.0;

          this.shuttleVel.set(targetX * 0.4, reqVy, -speedZ);
          this.enforceNetClearance(origin, this.shuttleVel, 1.85);
          this.prevShuttlePos.copy(this.shuttlePos);
          this.triggerImpactFeedback(origin, 'serve', Math.round(speedZ * 3.6));
          this.audio.badmintonHit(50);
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
      }

      if (this.hitStopTimer <= 0) {
        const speed = this.shuttleVel.length();

        // Calibrated aerodynamic quadratic drag: k = 0.080 m^-1
        // Matches real feather shuttlecock flight: ~1.40s lofty arc, clear float at apex, lands at player baseline
        const dragCoeff = 0.080;
        const dragMag = dragCoeff * speed;
        this.shuttleVel.x -= dragMag * this.shuttleVel.x * dt;
        this.shuttleVel.y -= dragMag * this.shuttleVel.y * dt;
        this.shuttleVel.z -= dragMag * this.shuttleVel.z * dt;

        // Gravity
        this.shuttleVel.y -= 9.8 * dt;

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

          // Net collision strict bounds: |x| <= 3.05m (half-court 3.05m), y <= 1.55m tape height
          // No inflated proximity margin — shots physically above y=1.55m pass cleanly over the net
          if (intersectY <= this.netHeight && Math.abs(intersectX) <= 3.05) {
            this.shuttlePos.set(intersectX, intersectY, 0.02 * (prevZ < 0 ? -1 : 1));
            this.shuttleGroup.position.copy(this.shuttlePos);
            this.audio.badmintonHit(30);
            this.netHitTimer = 0.6;
            this.showNetHitBanner();
            this.shuttleVel.z = -this.shuttleVel.z * 0.25;
            this.shuttleVel.x *= 0.4;
            const ptWinner = this.lastHitter === 'player' ? 2 : 1;
            const faultReason = this.lastHitter === 'player'
              ? 'Net Fault! Shuttle struck net on your shot (+1 Opponent)'
              : 'Net Fault! Opponent return struck the net (+1 Player)';
            this.handleRallyPoint(ptWinner, faultReason);
            return;
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

      // Dynamic Floor Shadow Blob pinned to court floor (y = 0.02m)
      if (this.shuttleFloorShadowMesh && this.shuttleFloorShadowMat) {
        if (this.rallyState === 'IN_PLAY' || this.isShuttleInPlay) {
          this.shuttleFloorShadowMesh.visible = true;
          const yShuttle = Math.max(0, this.shuttlePos.y);
          this.shuttleFloorShadowMesh.position.set(this.shuttlePos.x, 0.02, this.shuttlePos.z);
          const s = THREE.MathUtils.clamp(1.0 - yShuttle * 0.12, 0.4, 1.2);
          this.shuttleFloorShadowMesh.scale.set(s, s, 1);
          this.shuttleFloorShadowMat.opacity = THREE.MathUtils.clamp(0.85 - yShuttle * 0.14, 0.25, 0.75);
        } else {
          this.shuttleFloorShadowMesh.visible = false;
        }
      }

      // Ground/Floor Impact with Visual Chalk Decal & Singles Line Calling
      // True cork floor impact threshold: y <= 0.08m
      if (this.shuttlePos.y <= 0.08) {
        // Defer floor drop fault by 120ms if incoming shot is in player's court within 0.80m of racket to allow active scoop
        const racketHeadPos = this.playerAvatar.getRacketHeadWorldPosition();
        const distToRacket = racketHeadPos.distanceTo(this.shuttlePos);
        const isIncomingToPlayer = this.shuttleVel.z < 0 && this.shuttlePos.z <= -2.8 && this.lastHitter === 'opponent';

        if (isIncomingToPlayer && distToRacket <= 0.80 && this.floorDropGraceTimer < 0.120) {
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

        // Official Singles Court Dimensions: 5.18m wide (half 2.59m), 13.4m long (half 6.7m)
        const halfSinglesW = this.singlesCourtWidth / 2; // 2.59m
        const halfCourtL = this.courtLength / 2; // 6.70m
        const isInsideSingles = Math.abs(impactX) <= halfSinglesW && Math.abs(impactZ) <= halfCourtL;

        if (impactZ > 0) {
          // Shuttle landed on Opponent court
          this.showLineCallBadge(isInsideSingles, impactX, impactZ);
          if (isInsideSingles) {
            this.handleRallyPoint(1, `In! Player shot landed cleanly inside singles court (${impactX.toFixed(2)}m, ${impactZ.toFixed(2)}m) (+1 Player)`);
          } else {
            this.handleRallyPoint(2, `Out of Bounds! Player shot landed beyond singles lines (${impactX.toFixed(2)}m, ${impactZ.toFixed(2)}m) (+1 Opponent)`);
          }
        } else {
          // Shuttle landed on Player court
          this.showLineCallBadge(isInsideSingles, impactX, impactZ);
          if (isInsideSingles) {
            this.handleRallyPoint(2, `Floor Drop! Opponent shot landed in Player court (${impactX.toFixed(2)}m, ${impactZ.toFixed(2)}m) (+1 Opponent)`);
          } else {
            this.handleRallyPoint(1, `Out of Bounds! Opponent return sailed out (${impactX.toFixed(2)}m, ${impactZ.toFixed(2)}m) (+1 Player)`);
          }
        }
        return;
      }

      // 5. AI Opponent Interception with 3D Landing Prediction and Return Swing
      if (this.lastHitter === 'player' && this.shuttlePos.z > 1.0) {
        const courtBounds = {
          minX: -this.singlesCourtWidth * 0.46,
          maxX: this.singlesCourtWidth * 0.46,
          minZ: 2.2,
          maxZ: this.courtLength * 0.48
        };

        const aiResult = this.opponentAI.update(
          frameDt,
          this.shuttlePos,
          this.shuttleVel,
          courtBounds,
          this.scoreState.rallyCount
        );

        this.opponentAvatar.group.position.x = this.opponentAI.position.x;
        this.opponentAvatar.group.position.z = this.opponentAI.position.z;

        if (aiResult.didHit && aiResult.hitVelocity) {
          this.shuttleVel.set(aiResult.hitVelocity.x, aiResult.hitVelocity.y, aiResult.hitVelocity.z);
          this.enforceNetClearance(
            this.shuttlePos,
            this.shuttleVel,
            1.85 // 30cm clearance over 1.55m net tape
          );
          this.prevShuttlePos.copy(this.shuttlePos);
          this.lastHitter = 'opponent';
          this.scoreState.rallyCount++;

          // 2-frame turnaround flip animation on opponent return
          this.shuttleFlipTimer = 0.035;
          this.shuttlePrevQuat.copy(this.shuttleGroup.quaternion);
          this.shuttleTargetQuat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.shuttleVel.clone().normalize());

          const shotType = aiResult.shotType || (aiResult.isSmash ? 'smash' : 'drive');
          this.triggerImpactFeedback(this.shuttlePos, shotType, aiResult.isSmash ? 115 : 75);

          if (aiResult.isSmash) {
            this.audio.badmintonSmash();
          } else {
            this.audio.badmintonHit(70);
          }
        }
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

    // 5. Incoming Impact Reticle (projected onto strike plane)
    this.updateImpactReticle();

    this.updateImpactFeedback(deltaTime);

    this.renderer.render(this.scene, this.camera);
  }

  public onAction(event: ActionEvent): void {
    if (this.rallyState === 'READY_TO_SERVE' && this.scoreState.currentServer === 1) {
      this.triggerSwing(true);
      return;
    }

    if (this.rallyState !== 'IN_PLAY') return;

    this.triggerSwing(true);
  }

  // ─── Point & Score ──────────────────────────────────────────────────────────

  private handleRallyPoint(winner: 1 | 2, reason: string): void {
    if (this.rallyState !== 'IN_PLAY') return;
    this.floorDropGraceTimer = 0;
    this.rallyState = 'POINT_AWARDED';
    this.isShuttleInPlay = false;
    this.shuttleVel.set(0, 0, 0);

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
    const maxCap = target === 11 ? 15 : 30;

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
        if (this.isRunning && this.rallyState === 'POINT_AWARDED') {
          this.resetBall(this.scoreState.currentServer);
        }
      }, 1600);
    }
  }

  // ─── Resize / Score / Destroy ───────────────────────────────────────────────

  public onResize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  public getScore(): GameScoreState { return this.scoreState; }

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
