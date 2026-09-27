import * as THREE from 'three';
import { IGameScene, GameScoreState } from '../common/IGameScene';
import {
  GameModeId,
  OpponentMode,
  DifficultyLevel,
  MotionFrame,
  ActionEvent,
  PoseLandmark,
  Landmark3D
} from '../common/Types';
import { SoundSynthesizer } from '../util/audio/SoundSynthesizer';
import { Avatar3D } from '../badminton/Avatar3D';

export class TableTennisScene implements IGameScene {
  public readonly id: GameModeId = 'tabletennis';
  public readonly title = 'Table Tennis 3D Pro';

  private container!: HTMLElement;
  private audio!: SoundSynthesizer;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;

  // Visuals & Avatars
  private playerAvatar!: Avatar3D;
  private opponentAvatar!: Avatar3D;
  private ballMesh!: THREE.Mesh;
  private ballHaloMesh!: THREE.Mesh;
  private ballHaloMat!: THREE.MeshBasicMaterial;
  private ballShadowMesh!: THREE.Mesh;
  private ballShadowMat!: THREE.MeshBasicMaterial;
  private ballLight!: THREE.PointLight;
  private fpPaddleGroup!: THREE.Group; // First-person high-visibility bat
  private fpSweetSpotMesh!: THREE.Mesh;
  private aimReticleMesh!: THREE.Mesh;
  private netMesh!: THREE.Mesh;

  // Status Dialogue Card & Camera Toggle Button
  private statusDialogEl!: HTMLElement;
  private cameraViewBtn?: HTMLButtonElement;
  private currentCameraPreset: 'broadcast' | 'bat_focus' | 'over_shoulder' = 'broadcast';
  private lastDialogKey = '';

  // ITTF official specs (meters)
  // Table: 2.74m length (Z: -1.37 to +1.37), 1.525m width (X: -0.7625 to +0.7625), surface height 0.76m
  private readonly tableLength = 2.74;
  private readonly tableWidth = 1.525;
  private readonly tableHeight = 0.76;
  // Net: height 15.25cm (0.1525m), top at 0.9125m, total width 1.83m (15.25cm outside table on each side)
  private readonly netHeight = 0.1525;
  private readonly netWidth = 1.83;
  private readonly ballRadius = 0.02; // 40mm ping pong ball diameter = 0.04m, radius 0.02m

  // Body & Paddle Tracking
  private playerX = 0; // Lateral position along table width [-0.70, 0.70]
  private activePaddlePos = new THREE.Vector3(0.20, 0.86, -1.38);
  private prevPaddlePos = new THREE.Vector3(0.20, 0.86, -1.38);
  private paddleVelocity = new THREE.Vector3(0, 0, 0);
  private dominantHand: 'right' | 'left' = 'right';

  // Swept-Volume Line-Segment Collision Tracking
  private prevPaddleHeadPos = new THREE.Vector3(0.20, 0.86, -1.38);

  // 1:1 Motion Tracking & Exponential Smoothing (EMA)
  private prevWristPos = new THREE.Vector3();
  private hasPrevWrist = false;
  private smoothedWristVelocity = new THREE.Vector3();

  // Mouse / Pointer fallback
  private mouseX = 0;
  private mouseY = 0.86;
  private isPointerControlled = false;
  private lastPointerEventTime = 0;

  // Ball physics state
  private ballPos = new THREE.Vector3(0.20, 0.92, -1.28);
  private prevBallPos = new THREE.Vector3(0.20, 0.92, -1.28);
  private ballVel = new THREE.Vector3(0, 0, 0);
  // Spin vector (rad/s): omega.x = topspin(+)/backspin(-), omega.y = sidespin, omega.z = roll
  private ballSpin = new THREE.Vector3(0, 0, 0);
  private isBallInPlay = false;
  private rallyState: 'READY_TO_SERVE' | 'IN_SERVE' | 'IN_PLAY' | 'POINT_TRANSITION' | 'POINT_AWARDED' | 'GAME_OVER' = 'READY_TO_SERVE';
  private servePhase: 'NONE' | 'SERVER_BOUNCE' | 'SERVE_BOUNCED_SERVER' | 'RECEIVER_BOUNCE' = 'NONE';
  private lastHitter: 'player' | 'opponent' | null = null;
  private bounceCountNear = 0;
  private bounceCountFar = 0;
  private serveCountdown = 1.6;
  private isInitialStanceSettling = true;
  private startupCountdown = 1.8;
  private pointTransitionTimer = 0;
  private wristSettledTimer = 0;
  private isServeArmed = false;
  private postureGraceTimer = 0.6;
  private matchOver = false;
  private animT = 0;
  private netHitTimer = 0;
  private sweetSpotFlashTimer = 0;
  private wasNetClippedOnServe = false;
  private swingCooldown = 0;
  private hitStopTimer = 0; // Micro hit-stop (0.04s freeze) for tactile impact punch

  // Camera Shake (Juice)
  private screenShakeIntensity = 0;
  private cameraBasePos = new THREE.Vector3();

  // Natural Hand-Flow Serve & Stance Gating
  private isStanceRepositioning = false;
  private currentHipSpeed = 0;
  private prevUpperWrist = new THREE.Vector3();
  private prevUpperShoulder = new THREE.Vector3();
  private prevHipPos = new THREE.Vector3();
  private hasPrevHipPos = false;
  private hasPrevUpperBodyPos = false;
  private paddleHistory: { pos: THREE.Vector3; velZ: number; t: number }[] = [];

  // Strict Standing Posture Gate (Debounced 0.6s & Centered Modal)
  private stableStandingTimer = 0;
  private isPostureGated = false;
  private postureModalEl?: HTMLElement;
  private returnGraceTimer = 0.6;
  private playerBounceTimeout?: ReturnType<typeof setTimeout>;

  // Differentiate Table Halves & Surface Flashes
  private playerTableMesh!: THREE.Mesh;
  private opponentTableMesh!: THREE.Mesh;
  private playerTableMat!: THREE.MeshStandardMaterial;
  private opponentTableMat!: THREE.MeshStandardMaterial;
  private playerHalfFlashTimer = 0;
  private opponentHalfFlashTimer = 0;

  // 3D Bounce Decal Callout Badge & Fault Banner
  private bounceCalloutEl?: HTMLElement;
  private bounceCalloutTimer?: ReturnType<typeof setTimeout>;
  private faultBannerEl?: HTMLElement;
  private faultBannerTimer?: ReturnType<typeof setTimeout>;
  private netHitBannerEl?: HTMLElement;
  private netHitBannerTimer?: ReturnType<typeof setTimeout>;

  // Spatial Depth Perception: Vertical Drop-Stem Line & Table Bounce Ripples
  private altitudeStemGeo!: THREE.BufferGeometry;
  private altitudeStemLine!: THREE.Line;
  private altitudeStemMat!: THREE.LineBasicMaterial;
  private bounceRipples: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; life: number; maxLife: number }[] = [];

  // Ball trail system
  private readonly TRAIL_LENGTH = 10;
  private ballTrail: THREE.Vector3[] = [];
  private ballTrailMeshes: THREE.Mesh[] = [];

  // ITTF Singles Match & Scoring Rules
  private targetScore = 11;
  private winByTwo = true;
  private initialServerForGame: 1 | 2 = 1;
  private gameStartingServer: 1 | 2 = 1;
  private player1GamesWon = 0;
  private player2GamesWon = 0;
  private readonly gamesToWinMatch = 3; // Best 3 of 5 games
  private currentGameNumber = 1;
  private aiHitCooldown = 0;

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
    gameModeTitle: 'Table Tennis 3D Pro'
  };

  private scoreCallbacks: ((score: GameScoreState) => void)[] = [];
  private isRunning = false;
  private currentDifficulty: DifficultyLevel = 'casual';
  private aiWillIntercept = true;
  private hasAiInterceptDecision = false;
  private keydownHandler?: (e: KeyboardEvent) => void;
  private pointerMoveHandler?: (e: MouseEvent) => void;
  private pointerDownHandler?: (e: MouseEvent) => void;
  private activeTimeouts: ReturnType<typeof setTimeout>[] = [];

  private decideAIInterception(): void {
    // Casual Difficulty: 65% interception probability (giving player 35% winning window)
    // Pro Difficulty: 90% interception probability (10% unforced error / miss window)
    // Legend Difficulty: 95%
    const probability = this.currentDifficulty === 'casual'
      ? 0.65
      : (this.currentDifficulty === 'pro' ? 0.90 : 0.95);
    this.aiWillIntercept = Math.random() < probability;
    this.hasAiInterceptDecision = true;
  }

  public init(
    container: HTMLElement,
    audio: SoundSynthesizer,
    config?: { opponentMode?: OpponentMode; difficulty?: DifficultyLevel; dominantHand?: 'right' | 'left'; targetScore?: number }
  ): void {
    this.container = container;
    this.audio = audio;
    if (config) {
      this.currentDifficulty = config.difficulty || 'casual';
      if (config.dominantHand) this.dominantHand = config.dominantHand;
      if (config.targetScore) {
        this.targetScore = config.targetScore;
        this.scoreState.targetScore = config.targetScore;
      }
    }

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x060911);
    this.scene.fog = new THREE.FogExp2(0x060911, 0.035);

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    // Full-court pro broadcast perspective (56 deg FOV)
    this.camera = new THREE.PerspectiveCamera(56, width / height, 0.05, 50);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    // Arena Lighting
    this.setupLighting();

    // 3D Table Tennis Table & Boundaries
    this.buildTable();

    // Build Avatars
    this.playerAvatar = new Avatar3D(0x00f2fe, 0x39ff14);
    this.playerAvatar.setEquipment('tabletennis');
    this.playerAvatar.setDominantArm(this.dominantHand);
    this.playerAvatar.setGhostMode(true);
    this.playerAvatar.group.position.set(0, 0, -1.85);
    this.scene.add(this.playerAvatar.group);

    this.opponentAvatar = new Avatar3D(0xff0055, 0xfacc15);
    this.opponentAvatar.setEquipment('tabletennis');
    this.opponentAvatar.setDominantArm('right');
    this.opponentAvatar.group.position.set(0, 0, 1.50);
    this.opponentAvatar.group.rotation.y = Math.PI;
    this.opponentAvatar.applyDefaultPose('tabletennis', true);
    this.scene.add(this.opponentAvatar.group);

    // Build Dedicated High-Visibility First-Person Paddle
    this.buildFirstPersonPaddle();

    // Build HUD, Camera Controls & Arcade Aim Reticle
    this.buildHUD();
    this.buildCameraViewButton();
    this.buildAimReticle();

    // Default View: Full Court Unobstructed
    this.applyCameraPreset('broadcast');

    // Ball + trail + spatial depth anchors
    this.buildBall();
    this.buildBallTrail();
    this.buildAltitudeStem();
    this.buildBounceRipples();

    // Bind Keyboard & Pointer
    this.bindEvents();

    // Start match with initial serve
    this.startNewGame(1);
  }

  public setDominantHand(hand: 'right' | 'left'): void {
    this.dominantHand = hand;
    if (this.playerAvatar) {
      this.playerAvatar.setDominantArm(hand);
    }
  }

  public setDominantArm(arm: 'right' | 'left'): void {
    this.setDominantHand(arm);
  }

  public setTargetScore(score: number): void {
    this.targetScore = score;
    this.scoreState.targetScore = score;
    this.notifyScore();
  }

  private setupLighting(): void {
    const ambient = new THREE.AmbientLight(0xffffff, 0.95);
    this.scene.add(ambient);

    const mainLight = new THREE.DirectionalLight(0xffffff, 1.6);
    mainLight.position.set(0, 4.5, 0);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.width = 1024;
    mainLight.shadow.mapSize.height = 1024;
    mainLight.shadow.camera.near = 0.5;
    mainLight.shadow.camera.far = 10;
    mainLight.shadow.camera.left = -2;
    mainLight.shadow.camera.right = 2;
    mainLight.shadow.camera.top = 2;
    mainLight.shadow.camera.bottom = -2;
    this.scene.add(mainLight);

    const cyanRim = new THREE.PointLight(0x00f2fe, 2.2, 9);
    cyanRim.position.set(1.5, 2.2, -1.2);
    this.scene.add(cyanRim);

    const pinkRim = new THREE.PointLight(0xff0055, 1.8, 8);
    pinkRim.position.set(-1.5, 2.2, 1.2);
    this.scene.add(pinkRim);
  }

  private buildTable(): void {
    // Official ITTF Regulation Table: 2.74m length x 1.525m width, surface at Y = 0.76m
    const halfL = this.tableLength / 2; // 1.37m

    // 1. Player's Table Half (Z < 0): Distinct Navy/Cyan Accent
    this.playerTableMat = new THREE.MeshStandardMaterial({
      color: 0x172554, // Deep Navy Blue
      roughness: 0.30,
      metalness: 0.08,
      emissive: 0x00f2fe,
      emissiveIntensity: 0.06
    });
    const playerHalfGeo = new THREE.BoxGeometry(this.tableWidth, 0.04, halfL);
    this.playerTableMesh = new THREE.Mesh(playerHalfGeo, this.playerTableMat);
    this.playerTableMesh.position.set(0, this.tableHeight - 0.02, -halfL / 2);
    this.playerTableMesh.receiveShadow = true;
    this.scene.add(this.playerTableMesh);

    // 2. Opponent's Table Half (Z > 0): Distinct Dark Slate/Magenta Accent
    this.opponentTableMat = new THREE.MeshStandardMaterial({
      color: 0x1e1b4b, // Deep Slate / Indigo
      roughness: 0.30,
      metalness: 0.08,
      emissive: 0xff007f,
      emissiveIntensity: 0.06
    });
    const opponentHalfGeo = new THREE.BoxGeometry(this.tableWidth, 0.04, halfL);
    this.opponentTableMesh = new THREE.Mesh(opponentHalfGeo, this.opponentTableMat);
    this.opponentTableMesh.position.set(0, this.tableHeight - 0.02, halfL / 2);
    this.opponentTableMesh.receiveShadow = true;
    this.scene.add(this.opponentTableMesh);

    // Differentiated Border Trim & Court Lines:
    // Electric Cyan borders on player side (Z < 0) vs. Vibrant Magenta borders on opponent side (Z > 0)
    const playerBorderMat = new THREE.MeshBasicMaterial({ color: 0x00f2fe });
    const opponentBorderMat = new THREE.MeshBasicMaterial({ color: 0xff007f });
    const centerLineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    const addColoredLine = (w: number, d: number, x: number, z: number, mat: THREE.Material) => {
      const lineMesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
      lineMesh.rotation.x = -Math.PI / 2;
      lineMesh.position.set(x, this.tableHeight + 0.001, z);
      this.scene.add(lineMesh);
    };

    // 1. Player's Half (Z < 0) - Electric Cyan Borders:
    addColoredLine(this.tableWidth, 0.02, 0, -this.tableLength / 2 + 0.01, playerBorderMat); // Near baseline (-Z)
    addColoredLine(0.02, halfL, this.tableWidth / 2 - 0.01, -halfL / 2, playerBorderMat);    // Right sideline near
    addColoredLine(0.02, halfL, -this.tableWidth / 2 + 0.01, -halfL / 2, playerBorderMat);   // Left sideline near

    // 2. Opponent's Half (Z > 0) - Vibrant Magenta Borders:
    addColoredLine(this.tableWidth, 0.02, 0, this.tableLength / 2 - 0.01, opponentBorderMat);  // Far baseline (+Z)
    addColoredLine(0.02, halfL, this.tableWidth / 2 - 0.01, halfL / 2, opponentBorderMat);     // Right sideline far
    addColoredLine(0.02, halfL, -this.tableWidth / 2 + 0.01, halfL / 2, opponentBorderMat);    // Left sideline far

    // 3. Center Division Line beneath net (White) & Center Longitudinal Service Line (White)
    addColoredLine(this.tableWidth, 0.02, 0, 0, centerLineMat); // White line directly beneath net
    addColoredLine(0.003, this.tableLength, 0, 0, centerLineMat); // 3mm center longitudinal service line

    // Net Assembly (Regulation height 15.25cm = 0.1525m, total width 1.83m extending 15.25cm beyond each side)
    const netGeo = new THREE.BoxGeometry(this.netWidth, this.netHeight, 0.015);
    const netMat = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      roughness: 0.8,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide
    });
    this.netMesh = new THREE.Mesh(netGeo, netMat);
    this.netMesh.position.set(0, this.tableHeight + this.netHeight / 2, 0);
    this.scene.add(this.netMesh);

    // Net white top tape (1.5cm width)
    const tapeGeo = new THREE.BoxGeometry(this.netWidth, 0.015, 0.018);
    const tapeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const topTape = new THREE.Mesh(tapeGeo, tapeMat);
    topTape.position.set(0, this.tableHeight + this.netHeight - 0.0075, 0);
    this.scene.add(topTape);

    // Metal Net Posts (15.25cm outside each sideline at X = ±0.915m)
    const postMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8, roughness: 0.3 });
    const postGeo = new THREE.CylinderGeometry(0.012, 0.012, this.netHeight + 0.04, 16);
    const leftPost = new THREE.Mesh(postGeo, postMat);
    leftPost.position.set(-this.netWidth / 2, this.tableHeight + this.netHeight / 2, 0);
    this.scene.add(leftPost);

    const rightPost = new THREE.Mesh(postGeo, postMat);
    rightPost.position.set(this.netWidth / 2, this.tableHeight + this.netHeight / 2, 0);
    this.scene.add(rightPost);

    // Heavy Metal Sturdy Underframe Legs
    const legGeo = new THREE.CylinderGeometry(0.035, 0.035, this.tableHeight - 0.04, 16);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.5, metalness: 0.6 });
    const addLeg = (x: number, z: number) => {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(x, (this.tableHeight - 0.04) / 2, z);
      this.scene.add(leg);
    };
    addLeg(this.tableWidth * 0.4, this.tableLength * 0.4);
    addLeg(-this.tableWidth * 0.4, this.tableLength * 0.4);
    addLeg(this.tableWidth * 0.4, -this.tableLength * 0.4);
    addLeg(-this.tableWidth * 0.4, -this.tableLength * 0.4);

    // Floor court grid
    const floorGeo = new THREE.PlaneGeometry(16, 16);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x070b14, roughness: 0.9, metalness: 0.1 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  private buildFirstPersonPaddle(): void {
    this.fpPaddleGroup = new THREE.Group();

    // 1. Blade: Multi-ply wooden core
    const bladeGroup = new THREE.Group();
    const bladeGeo = new THREE.CylinderGeometry(0.082, 0.082, 0.009, 36);
    const bladeMat = new THREE.MeshStandardMaterial({
      color: 0xd97706,
      roughness: 0.5,
      metalness: 0.05
    });
    const blade = new THREE.Mesh(bladeGeo, bladeMat);
    blade.rotation.x = Math.PI / 2;
    bladeGroup.add(blade);

    // High-contrast white edge tape perimeter with glow
    const edgeTapeGeo = new THREE.TorusGeometry(0.082, 0.005, 8, 36);
    const edgeTapeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.5,
      roughness: 0.2
    });
    const edgeTape = new THREE.Mesh(edgeTapeGeo, edgeTapeMat);
    bladeGroup.add(edgeTape);

    // Vibrant Red Forehand Rubber — FACING THE TABLE SIDE (+Z)
    const redRubberGeo = new THREE.CylinderGeometry(0.079, 0.079, 0.003, 36);
    const redRubberMat = new THREE.MeshStandardMaterial({
      color: 0xdc2626,
      roughness: 0.8,
      emissive: 0x991b1b,
      emissiveIntensity: 0.25
    });
    const redRubber = new THREE.Mesh(redRubberGeo, redRubberMat);
    redRubber.rotation.x = Math.PI / 2;
    redRubber.position.z = 0.0055; // Facing table side (+Z)
    bladeGroup.add(redRubber);

    // Sweet-spot targeting ring on red forehand face
    const spotGeo = new THREE.RingGeometry(0.016, 0.024, 24);
    const spotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
    this.fpSweetSpotMesh = new THREE.Mesh(spotGeo, spotMat);
    this.fpSweetSpotMesh.position.z = 0.0075;
    bladeGroup.add(this.fpSweetSpotMesh);

    // Sleek Black Backhand Rubber — FACING THE PLAYER (-Z)
    const blackRubberMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.85 });
    const blackRubber = new THREE.Mesh(redRubberGeo, blackRubberMat);
    blackRubber.rotation.x = Math.PI / 2;
    blackRubber.position.z = -0.0055; // Facing player (-Z)
    bladeGroup.add(blackRubber);

    this.fpPaddleGroup.add(bladeGroup);

    // 2. Flared ergonomic wooden handle held in hand at the wrist
    const handleGeo = new THREE.CylinderGeometry(0.013, 0.016, 0.11, 16);
    const handleMat = new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.45, metalness: 0.1 });
    const handle = new THREE.Mesh(handleGeo, handleMat);
    handle.position.set(0, -0.08, 0);
    this.fpPaddleGroup.add(handle);

    // Initial resting position over near baseline
    this.fpPaddleGroup.position.set(0.20, 0.86, -1.38);
    this.scene.add(this.fpPaddleGroup);
  }

  private buildAimReticle(): void {
    const ringGeo = new THREE.RingGeometry(0.07, 0.11, 24);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x39ff14,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85
    });
    this.aimReticleMesh = new THREE.Mesh(ringGeo, ringMat);
    this.aimReticleMesh.rotation.x = -Math.PI / 2;
    this.aimReticleMesh.position.set(0, this.tableHeight + 0.002, 0.75);
    this.aimReticleMesh.visible = false;
    this.scene.add(this.aimReticleMesh);
  }

  private buildBall(): void {
    const ballGeo = new THREE.SphereGeometry(this.ballRadius, 24, 24);
    const ballMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.2,
      emissive: 0xffffff,
      emissiveIntensity: 0.35
    });
    this.ballMesh = new THREE.Mesh(ballGeo, ballMat);
    // Ball does not cast a shadow to the room floor (Y = 0) to eliminate misleading vertical parallax.
    // Instead, contact shadow blob is projected strictly onto the table surface plane (Y = 0.76m).
    this.ballMesh.castShadow = false;
    this.scene.add(this.ballMesh);

    // High-visibility glowing halo around ball
    const haloGeo = new THREE.SphereGeometry(this.ballRadius * 1.6, 16, 16);
    this.ballHaloMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.55
    });
    this.ballHaloMesh = new THREE.Mesh(haloGeo, this.ballHaloMat);
    this.ballMesh.add(this.ballHaloMesh);

    // Dynamic Point Light attached to ball with soft 0.6m radius
    this.ballLight = new THREE.PointLight(0xffffff, 1.8, 0.6);
    this.ballMesh.add(this.ballLight);

    // Dynamic table-projected contact shadow blob pinned to table surface
    const shadowGeo = new THREE.CircleGeometry(0.040, 24);
    this.ballShadowMat = new THREE.MeshBasicMaterial({
      color: 0x000814,
      transparent: true,
      opacity: 0.85
    });
    this.ballShadowMesh = new THREE.Mesh(shadowGeo, this.ballShadowMat);
    this.ballShadowMesh.rotation.x = -Math.PI / 2;
    this.ballShadowMesh.position.y = this.tableHeight + 0.002;
    this.scene.add(this.ballShadowMesh);
  }

  private buildAltitudeStem(): void {
    this.altitudeStemGeo = new THREE.BufferGeometry();
    const stemPositions = new Float32Array(6);
    this.altitudeStemGeo.setAttribute('position', new THREE.BufferAttribute(stemPositions, 3));
    this.altitudeStemMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.70,
      linewidth: 2
    });
    this.altitudeStemLine = new THREE.Line(this.altitudeStemGeo, this.altitudeStemMat);
    this.altitudeStemLine.visible = false;
    this.scene.add(this.altitudeStemLine);
  }

  private buildBounceRipples(): void {
    this.bounceRipples = [];
    const rippleGeo = new THREE.RingGeometry(0.016, 0.038, 32);
    for (let i = 0; i < 6; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x00f2fe,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(rippleGeo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = this.tableHeight + 0.0025;
      mesh.visible = false;
      this.scene.add(mesh);
      this.bounceRipples.push({
        mesh,
        mat,
        life: 0,
        maxLife: 0.38
      });
    }
  }

  private spawnBounceRipple(x: number, z: number, isPlayerSide: boolean): void {
    const ripple = this.bounceRipples.find(r => r.life <= 0) || this.bounceRipples[0];
    ripple.mesh.position.set(x, this.tableHeight + 0.0025, z);
    ripple.life = ripple.maxLife;
    // Red on player half (Z < 0), Light Blue / Cyan on opponent half (Z > 0)
    const colorHex = isPlayerSide ? 0xef4444 : 0x00f2fe;
    ripple.mat.color.setHex(colorHex);
    ripple.mat.opacity = 0.95;
    ripple.mesh.scale.set(1, 1, 1);
    ripple.mesh.visible = true;

    // Flash the surface of the half where the ball bounced
    if (isPlayerSide && this.playerTableMat) {
      this.playerHalfFlashTimer = 0.30;
      this.playerTableMat.emissiveIntensity = 0.65;
    } else if (!isPlayerSide && this.opponentTableMat) {
      this.opponentHalfFlashTimer = 0.30;
      this.opponentTableMat.emissiveIntensity = 0.65;
    }

    // Spawn 3D indicator callout badge
    this.showBounceCallout(isPlayerSide, x, z);
  }

  private showBounceCallout(isPlayerSide: boolean, _worldX: number, _worldZ: number): void {
    if (!this.bounceCalloutEl) return;
    if (this.bounceCalloutTimer) clearTimeout(this.bounceCalloutTimer);

    // Keep notification on upper-left side flank to preserve clear central net sightline
    this.bounceCalloutEl.style.left = '';
    this.bounceCalloutEl.style.top = '';
    this.bounceCalloutEl.className = `tt-bounce-callout ${isPlayerSide ? 'your-side' : 'opponent-side'}`;
    this.bounceCalloutEl.innerHTML = isPlayerSide
      ? '<span>⚠️</span><span>BOUNCE: YOUR SIDE</span>'
      : '<span>🟢</span><span>BOUNCE: OPPONENT SIDE</span>';
    this.bounceCalloutEl.classList.remove('hidden');

    this.bounceCalloutTimer = setTimeout(() => {
      if (this.bounceCalloutEl) {
        this.bounceCalloutEl.classList.add('hidden');
      }
    }, 850);
  }

  private showFaultBanner(text: string): void {
    if (!this.faultBannerEl) return;
    if (this.faultBannerTimer) clearTimeout(this.faultBannerTimer);
    this.faultBannerEl.textContent = text;
    this.faultBannerEl.classList.remove('hidden');

    this.faultBannerTimer = setTimeout(() => {
      if (this.faultBannerEl) {
        this.faultBannerEl.classList.add('hidden');
      }
    }, 2400);
  }

  private showNetHitBanner(): void {
    if (!this.netHitBannerEl) return;
    if (this.netHitBannerTimer) clearTimeout(this.netHitBannerTimer);
    this.netHitBannerEl.style.display = 'block';
    this.netHitBannerTimer = setTimeout(() => {
      if (this.netHitBannerEl) {
        this.netHitBannerEl.style.display = 'none';
      }
    }, 1400);
  }

  private updateBounceRipples(dt: number): void {
    for (const ripple of this.bounceRipples) {
      if (ripple.life > 0) {
        ripple.life = Math.max(0, ripple.life - dt);
        const progress = 1 - ripple.life / ripple.maxLife;
        const scale = 1.0 + progress * 3.4;
        ripple.mesh.scale.set(scale, scale, 1);
        ripple.mat.opacity = Math.max(0, (1 - progress) * 0.95);
        if (ripple.life === 0) {
          ripple.mesh.visible = false;
        }
      }
    }
  }

  private buildBallTrail(): void {
    this.ballTrailMeshes = [];
    for (let i = 0; i < this.TRAIL_LENGTH; i++) {
      const t = i / this.TRAIL_LENGTH;
      const trailGeo = new THREE.SphereGeometry(this.ballRadius * (1 - t * 0.65), 8, 8);
      const trailMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(0xffffff),
        transparent: true,
        opacity: 0
      });
      const trailMesh = new THREE.Mesh(trailGeo, trailMat);
      trailMesh.visible = false;
      this.ballTrailMeshes.push(trailMesh);
      this.scene.add(trailMesh);
    }
  }

  private buildHUD(): void {
    this.statusDialogEl = document.createElement('div');
    this.statusDialogEl.id = 'tt-status-box';
    this.statusDialogEl.className = 'state-ready';
    this.container.appendChild(this.statusDialogEl);

    // Centered glassmorphic posture modal overlay
    this.postureModalEl = document.createElement('div');
    this.postureModalEl.id = 'tt-posture-modal';
    this.postureModalEl.className = 'hidden';
    this.postureModalEl.innerHTML = `
      <div class="tt-posture-card">
        <div class="tt-posture-icon">🧍</div>
        <div class="tt-posture-title">STAND IN POSITION TO PLAY</div>
        <div class="tt-posture-desc">Step back and stand upright to begin.</div>
        <div class="tt-posture-hint">Camera must see your upright standing posture to track table tennis footwork.</div>
      </div>
    `;
    this.container.appendChild(this.postureModalEl);

    // 3D Bounce callout element
    this.bounceCalloutEl = document.createElement('div');
    this.bounceCalloutEl.className = 'tt-bounce-callout hidden';
    this.container.appendChild(this.bounceCalloutEl);

    // Explicit fault banner element
    this.faultBannerEl = document.createElement('div');
    this.faultBannerEl.className = 'tt-fault-banner hidden';
    this.container.appendChild(this.faultBannerEl);

    // Explicit net hit banner element (upper-left flank)
    this.netHitBannerEl = document.createElement('div');
    this.netHitBannerEl.id = 'tt-net-hit-banner';
    this.netHitBannerEl.style.display = 'none';
    this.netHitBannerEl.textContent = '⛔ NET HIT!';
    this.container.appendChild(this.netHitBannerEl);
  }

  private updateStatusDialog(
    title: string,
    desc: string,
    state: 'position' | 'ready' | 'active' | 'over',
    tag = 'TABLE TENNIS PRO'
  ): void {
    if (!this.statusDialogEl) return;
    const key = `${title}|${desc}|${state}|${tag}`;
    if (this.lastDialogKey === key) return;
    this.lastDialogKey = key;

    this.statusDialogEl.className = `state-${state}`;
    const dotColor =
      state === 'ready' ? '#00f2fe' :
      state === 'position' ? '#f59e0b' :
      state === 'active' ? '#34d399' : '#10b981';

    this.statusDialogEl.innerHTML = `
      <div class="tt-status-tag">
        <span class="status-dot" style="background: ${dotColor}; box-shadow: 0 0 10px ${dotColor};"></span>
        <span>${tag}</span>
      </div>
      <div class="tt-status-title">${title}</div>
      <div class="tt-status-desc">${desc}</div>
    `;
  }

  private buildCameraViewButton(): void {
    this.cameraViewBtn = document.createElement('button');
    this.cameraViewBtn.className = 'icon-btn camera-view-toggle-btn glass-panel';
    this.cameraViewBtn.id = 'btn-tt-camera-view';
    this.cameraViewBtn.innerHTML = '<span>🎥</span><span>View: Full Court</span>';
    this.cameraViewBtn.title = 'Switch Camera View: Full Court / Bat Focus / Over Shoulder [Key: C]';
    this.cameraViewBtn.onmousedown = (e: MouseEvent) => {
      e.stopPropagation();
    };
    this.cameraViewBtn.onclick = (e: MouseEvent) => {
      e.stopPropagation();
      this.cycleCameraView();
    };
    this.container.appendChild(this.cameraViewBtn);
  }

  private applyCameraPreset(preset: 'broadcast' | 'bat_focus' | 'over_shoulder'): void {
    this.currentCameraPreset = preset;
    if (preset === 'broadcast') {
      this.cameraBasePos.set(0, 1.72, -2.88);
      this.camera.position.copy(this.cameraBasePos);
      this.camera.lookAt(0, 0.76, 0.25);
      this.playerAvatar.group.visible = false;
      this.fpPaddleGroup.visible = true;
      if (this.cameraViewBtn) this.cameraViewBtn.innerHTML = '<span>🎥</span><span>View: Full Court</span>';
    } else if (preset === 'bat_focus') {
      this.cameraBasePos.set(0, 1.48, -2.55);
      this.camera.position.copy(this.cameraBasePos);
      this.camera.lookAt(0, 0.76, 0.35);
      this.playerAvatar.group.visible = false;
      this.fpPaddleGroup.visible = true;
      if (this.cameraViewBtn) this.cameraViewBtn.innerHTML = '<span>🎥</span><span>View: Bat Focus</span>';
    } else if (preset === 'over_shoulder') {
      this.cameraBasePos.set(0.72, 2.10, -3.40);
      this.camera.position.copy(this.cameraBasePos);
      this.camera.lookAt(0.08, 0.74, 0.20);
      this.playerAvatar.group.visible = true;
      this.playerAvatar.setGhostMode(true);
      this.fpPaddleGroup.visible = true;
      if (this.cameraViewBtn) this.cameraViewBtn.innerHTML = '<span>🎥</span><span>View: Over Shoulder</span>';
    }
  }

  private cycleCameraView(): void {
    if (this.currentCameraPreset === 'broadcast') {
      this.applyCameraPreset('bat_focus');
    } else if (this.currentCameraPreset === 'bat_focus') {
      this.applyCameraPreset('over_shoulder');
    } else {
      this.applyCameraPreset('broadcast');
    }
  }

  private bindEvents(): void {
    // Keyboard handlers
    this.keydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'r' || e.key === 'R') {
        this.reset();
        return;
      }
      if (e.key === 'c' || e.key === 'C') {
        this.cycleCameraView();
        return;
      }
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        this.triggerManualStrike();
      }
    };
    window.addEventListener('keydown', this.keydownHandler);

    // Mouse / Pointer handlers (for desktop testing or hybrid mouse play)
    this.pointerMoveHandler = (e: MouseEvent) => {
      const rect = this.container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const normX = (e.clientX - rect.left) / rect.width; // 0..1
      const normY = (e.clientY - rect.top) / rect.height;  // 0..1
      this.mouseX = (normX - 0.5) * 2.5; // [-1.25, +1.25] full table reach
      this.mouseY = this.tableHeight + 0.10 + (1 - normY) * 0.40; // ~0.86 to 1.26m
      this.isPointerControlled = true;
      this.lastPointerEventTime = performance.now();
    };
    this.pointerDownHandler = (e: MouseEvent) => {
      if (e.target instanceof HTMLElement && (e.target.closest('button') || e.target.closest('.interactive-btn'))) {
        return;
      }
      if (e.button === 0) { // Left click
        this.triggerManualStrike();
      }
    };
    this.container.addEventListener('mousemove', this.pointerMoveHandler);
    this.container.addEventListener('mousedown', this.pointerDownHandler);
  }

  private triggerManualStrike(): void {
    if (this.isInitialStanceSettling) return;
    if (this.rallyState === 'READY_TO_SERVE' && this.scoreState.currentServer === 1 && this.isServeArmed) {
      this.executeMotionServe();
    } else if (this.rallyState === 'IN_PLAY' && this.lastHitter !== 'player') {
      // Check if ball is on player's full half of table (Z between -1.60m and 0.0m, X between +-0.90m)
      if (this.ballPos.z <= 0.0 && this.ballPos.z >= -1.60 && Math.abs(this.ballPos.x) <= 0.90) {
        this.lastHitter = 'player';
        this.bounceCountNear = 0;
        this.bounceCountFar = 0;
        if (this.playerBounceTimeout) {
          clearTimeout(this.playerBounceTimeout);
          this.playerBounceTimeout = undefined;
        }
        for (const tid of this.activeTimeouts) clearTimeout(tid);
        this.activeTimeouts = [];
        this.returnGraceTimer = 0;
        this.postureGraceTimer = 0;
        this.executePlayerReturn(this.paddleVelocity.length() > 0.5 ? this.paddleVelocity.length() : 1.5);
      }
    }
  }

  public start(): void { this.isRunning = true; }
  public pause(): void { this.isRunning = false; }
  public resume(): void { this.isRunning = true; }

  public reset(): void {
    this.player1GamesWon = 0;
    this.player2GamesWon = 0;
    this.currentGameNumber = 1;
    this.matchOver = false;
    this.startNewGame(1);
  }

  private startNewGame(firstServer: 1 | 2 = 1): void {
    this.gameStartingServer = 1; // Always reset to 1 in single-player arcade mode (Player serves first at 0-0 of every set)
    this.initialServerForGame = this.gameStartingServer;
    this.scoreState.player1Score = 0;
    this.scoreState.player2Score = 0;
    this.scoreState.isGameOver = false;
    this.scoreState.winner = null;
    this.isInitialStanceSettling = true;
    this.startupCountdown = 1.8;
    this.isServeArmed = false;
    this.aiHitCooldown = 0;
    this.resetServe();
    this.notifyScore();
  }

  /**
   * Official ITTF Service Rotation:
   * Calculate server strictly by total points played: totalPoints = p1 + p2
   * Normal Play: Server changes every 2 points: Math.floor(totalPoints / 2) % 2 === (gameStartingServer === 1 ? 0 : 1)
   * Deuce Play (Score >= 10-10 or target - 1): Server alternates every 1 point: totalPoints % 2 === (gameStartingServer === 1 ? 0 : 1)
   */
  private determineCurrentServer(): 1 | 2 {
    const p1 = this.scoreState.player1Score;
    const p2 = this.scoreState.player2Score;
    const totalPoints = p1 + p2;

    const isDeuce = (p1 >= 10 && p2 >= 10) || (p1 >= this.targetScore - 1 && p2 >= this.targetScore - 1);
    if (isDeuce) {
      const isPlayerTurn = totalPoints % 2 === (this.gameStartingServer === 1 ? 0 : 1);
      return isPlayerTurn ? 1 : 2;
    }

    const isPlayerTurn = Math.floor(totalPoints / 2) % 2 === (this.gameStartingServer === 1 ? 0 : 1);
    return isPlayerTurn ? 1 : 2;
  }

  private setBallVisibility(visible: boolean): void {
    if (this.ballMesh) this.ballMesh.visible = visible;
    if (this.ballShadowMesh) this.ballShadowMesh.visible = visible;
    if (this.altitudeStemLine) this.altitudeStemLine.visible = visible;
  }

  private resetServe(): void {
    this.rallyState = 'READY_TO_SERVE';
    this.servePhase = 'NONE';
    this.isBallInPlay = false;
    this.bounceCountNear = 0;
    this.bounceCountFar = 0;
    this.lastHitter = null;
    this.hasAiInterceptDecision = false;
    this.aiWillIntercept = true;
    this.isStanceRepositioning = false;
    this.hasPrevUpperBodyPos = false;
    this.hasPrevHipPos = false;
    this.isServeArmed = !this.isInitialStanceSettling;
    this.pointTransitionTimer = 0;
    this.wristSettledTimer = 0;
    this.setBallVisibility(!this.isInitialStanceSettling);
    this.opponentAvatar.group.position.set(0, 0, 1.50);
    this.opponentAvatar.applyDefaultPose('tabletennis', true);
    const activeServer = this.determineCurrentServer();
    this.scoreState.currentServer = activeServer;
    this.serveCountdown = activeServer === 1 ? 0.35 : 1.5;

    if (activeServer === 1) {
      // Paddle-Docked Serve: Ball rests visibly on player's table tennis paddle
      this.dockBallToPlayerPaddle();
    } else {
      // AI serve: Ball rests at AI baseline paddle
      this.ballPos.set(0, this.tableHeight + 0.16, 1.15);
      this.prevBallPos.copy(this.ballPos);
      this.ballVel.set(0, 0, 0);
    }
  }

  /**
   * Paddle-Docked Serve:
   * During READY_TO_SERVE, locks the ping-pong ball visibly to the player's table tennis paddle.
   */
  private dockBallToPlayerPaddle(): void {
    const paddleForward = new THREE.Vector3(0, 0, 1);
    if (this.fpPaddleGroup) {
      paddleForward.applyEuler(this.fpPaddleGroup.rotation).normalize();
    }
    const dockOffset = paddleForward.multiplyScalar(this.ballRadius + 0.006);
    this.ballPos.copy(this.activePaddlePos).add(dockOffset);
    this.prevBallPos.copy(this.ballPos);
    this.ballVel.set(0, 0, 0);
    if (this.ballMesh) {
      this.ballMesh.position.copy(this.ballPos);
    }
  }

  /**
   * Replays a "Let" serve per ITTF rule (clipped net and landed legally on receiver court)
   */
  private replayLetServe(): void {
    this.updateStatusDialog('🔔 LET SERVE', 'Serve touched net and landed in — replaying serve!', 'ready', 'ITTF LET RULE');
    this.audio.tableTennisPaddleHit();
    this.rallyState = 'READY_TO_SERVE';
    this.servePhase = 'NONE';
    this.isBallInPlay = false;
    this.bounceCountNear = 0;
    this.bounceCountFar = 0;
    this.lastHitter = null;
    this.serveCountdown = 1.4;
    this.wasNetClippedOnServe = false;
    this.ballSpin.set(0, 0, 0);

    if (this.scoreState.currentServer === 1) {
      this.dockBallToPlayerPaddle();
    } else {
      this.ballPos.set(0, this.tableHeight + 0.16, 1.30);
      this.prevBallPos.copy(this.ballPos);
      this.ballVel.set(0, 0, 0);
    }
  }

  /**
   * Minimum distance between two 3D line segments (Swept-volume collision detection)
   */
  private closestApproachSegSeg(
    a0: THREE.Vector3, a1: THREE.Vector3,
    b0: THREE.Vector3, b1: THREE.Vector3
  ): number {
    const d1 = a1.clone().sub(a0);
    const d2 = b1.clone().sub(b0);
    const r = a0.clone().sub(b0);

    const a = d1.dot(d1);
    const e = d2.dot(d2);
    const f = d2.dot(r);

    let s: number, t: number;

    if (a <= 1e-8 && e <= 1e-8) {
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

  /**
   * Closed-Form Ballistic Trajectory Solver:
   * Solves exact velocity required to travel from fromPos to (targetX, tableHeight + ballRadius, targetZ)
   * while clearing the central net (Z = 0) at height H_net = tableHeight + netHeight + netClearance.
   */
  /**
   * Closed-Form Ballistic Trajectory Solver (Targeted In-Bounds Solver):
   * Solves exact velocity (vx, vy, vz) required to travel from fromPos to (targetX, tableHeight + ballRadius, targetZ)
   * while clearing the central net (Z = 0) at height H_net = tableHeight + netHeight + netClearance.
   *
   * Automatically calculates gentle, readable parabolic flight pacing so the player
   * has a natural reaction window and the ball clears the net with a beautiful, readable arc.
   */
  private solveExactControlledVelocity(
    fromPos: THREE.Vector3,
    targetX: number,
    targetZ: number,
    netClearance = 0.055,
    pacingSpeed = 3.3
  ): THREE.Vector3 {
    const targetY = this.tableHeight + this.ballRadius;
    const dz = targetZ - fromPos.z;
    const crossesNet = (fromPos.z < -0.04 && targetZ > 0.04) || (fromPos.z > 0.04 && targetZ < -0.04);

    if (crossesNet && Math.abs(dz) > 0.35) {
      const lambda = -fromPos.z / dz;
      if (lambda > 0.08 && lambda < 0.92) {
        const Hnet = this.tableHeight + this.netHeight + netClearance; // 0.76 + 0.1525 + 0.055 = ~0.9675m (>= 0.96m)
        const lineOfSightAtNet = fromPos.y + lambda * (targetY - fromPos.y);
        const deltaH = Hnet - lineOfSightAtNet;

        const g = 9.81;
        let tMin = 0.40;
        if (deltaH > 0.005) {
          const denom = g * lambda * (1.0 - lambda);
          tMin = Math.sqrt((2.0 * deltaH) / denom);
        }

        // Pacing: flight time between 0.50 and 0.65 seconds for readable arc at webcam scale
        const distZ = Math.abs(dz);
        const clampedPacing = THREE.MathUtils.clamp(pacingSpeed, 2.8, 4.0);
        const desiredFlightTime = distZ / clampedPacing;
        const flightTime = THREE.MathUtils.clamp(
          Math.max(tMin * 1.02, desiredFlightTime),
          0.50,
          0.65
        );

        // Account slightly for air drag during flight so ball lands accurately on target
        const dragCompensation = 1.01;
        const vx = ((targetX - fromPos.x) / flightTime) * dragCompensation;
        let vz = (dz / flightTime) * dragCompensation;
        const vy = (targetY - fromPos.y + 0.5 * g * flightTime * flightTime) / flightTime;

        // Ensure all standard drives and serves have an exit forward speed Vz of 2.8 to 4.0 m/s
        const vzSign = Math.sign(vz) || 1;
        const vzMag = THREE.MathUtils.clamp(Math.abs(vz), 2.8, 4.0);
        vz = vzSign * vzMag;

        return new THREE.Vector3(
          THREE.MathUtils.clamp(vx, -1.8, 1.8),
          THREE.MathUtils.clamp(vy, 1.0, 3.8),
          vz
        );
      }
    }

    // Direct parabolic trajectory when not crossing the net (e.g. bounce 1 of serve)
    const distZ = Math.max(0.30, Math.abs(dz));
    const flightTime = THREE.MathUtils.clamp(distZ / Math.max(1.8, pacingSpeed), 0.22, 0.35);
    const vx = (targetX - fromPos.x) / flightTime;
    const vz = dz / flightTime;
    const vy = (targetY - fromPos.y + 0.5 * 9.81 * flightTime * flightTime) / flightTime;

    return new THREE.Vector3(
      THREE.MathUtils.clamp(vx, -1.8, 1.8),
      THREE.MathUtils.clamp(vy, -0.6, 3.2),
      THREE.MathUtils.clamp(vz, -3.8, 3.8)
    );
  }

  /**
   * Overhauled Serve Strike Kinematic Evaluator:
   * 1. Disarms immediate spawns (paddle.z <= ball.z + 0.04m).
   * 2. Requires net forward stroke displacement >= 0.12m over last 150ms.
   * 3. Rejects hand jitter/shaking oscillations and displacement < 0.08m.
   * 4. Allows natural angled sweeps while requiring forward velocity (vel.z >= 1.2 m/s).
   */
  private isServeStrikeRegistered(relativeWristVel: THREE.Vector3): boolean {
    const paddleZ = this.activePaddlePos.z;
    const ballZ = this.ballPos.z;
    // 1. Disarm immediate spawns: Paddle must start behind ball
    if (paddleZ > ballZ + 0.04) {
      return false;
    }

    // 2. Stroke Displacement & Duration Check
    if (this.paddleHistory.length < 2) return false;
    const oldestPos = this.paddleHistory[0].pos;
    const netDz = this.activePaddlePos.z - oldestPos.z;

    // Reject displacement < 0.08m completely
    if (netDz < 0.08) {
      return false;
    }
    // Require net forward stroke displacement >= 0.12m over last 150ms
    if (netDz < 0.12) {
      return false;
    }

    // 3. Reject Jitter / Hand Shaking Oscillations
    let signFlips = 0;
    for (let i = 1; i < this.paddleHistory.length; i++) {
      if (this.paddleHistory[i].velZ * this.paddleHistory[i - 1].velZ < -0.01) {
        signFlips++;
      }
    }
    if (signFlips >= 2) {
      return false;
    }

    // 4. Forward Velocity requirement (>= 1.2 m/s), without blocking lateral sweep (vel.x)
    const forwardVelZ = Math.max(relativeWristVel.z, this.paddleVelocity.z, this.smoothedWristVelocity.z);
    if (forwardVelZ < 1.2) {
      return false;
    }

    return true;
  }

  /**
   * ITTF Two-Bounce Serve Execution (Player):
   * 1st bounce lands solidly on player's near half (Z in [-0.90, -0.60]).
   */
  private executeMotionServe(): void {
    if (this.rallyState !== 'READY_TO_SERVE') return;
    this.serveGestureStage = 'IDLE';
    this.servePullbackTimer = 0;
    this.decideAIInterception();
    this.rallyState = 'IN_SERVE';
    this.servePhase = 'SERVER_BOUNCE';
    this.isBallInPlay = true;
    this.lastHitter = 'player';
    this.bounceCountNear = 0;
    this.bounceCountFar = 0;
    this.scoreState.rallyCount = 1;
    this.ballTrail = [];
    this.wasNetClippedOnServe = false;

    // Satisfying micro hit-stop (0.035s freeze) and audio pop
    this.hitStopTimer = 0.035;
    this.audio.tableTennisPaddleHit(1.2);
    this.flashSweetSpot();
    this.triggerScreenShake(0.04);

    // Apply topspin from forward brush
    this.ballSpin.set(16, -this.paddleVelocity.x * 12, 0);

    // Target 1st bounce on player's own half of table (Z = -0.75m)
    const targetX1 = THREE.MathUtils.clamp(this.playerX * 0.4 + this.paddleVelocity.x * 0.1, -0.38, 0.38);
    const targetZ1 = -0.75;
    this.ballVel = this.solveExactControlledVelocity(this.ballPos, targetX1, targetZ1, 0.05, 2.8);
  }

  /**
   * ITTF Two-Bounce Serve Execution (AI):
   * 1st bounce lands solidly on AI's far half (Z in [0.60, 0.90]).
   */
  private executeAIServe(): void {
    this.rallyState = 'IN_SERVE';
    this.servePhase = 'SERVER_BOUNCE';
    this.isBallInPlay = true;
    this.lastHitter = 'opponent';
    this.bounceCountNear = 0;
    this.bounceCountFar = 0;
    this.scoreState.rallyCount = 1;
    this.ballTrail = [];
    this.wasNetClippedOnServe = false;

    this.ballSpin.set(-15, (Math.random() - 0.5) * 10, 0);

    // Target 1st bounce on AI's own half of table (Z = +0.70m)
    const targetX1 = THREE.MathUtils.clamp((Math.random() - 0.5) * 0.4, -0.30, 0.30);
    const targetZ1 = 0.70;
    this.ballVel = this.solveExactControlledVelocity(this.ballPos, targetX1, targetZ1, 0.05, 2.8);
    this.audio.tableTennisPaddleHit(1.0);
  }

  /**
   * Targeted In-Bounds Return & Controlled Momentum Transfer:
   * Maps lateral hand movement and paddle swipe direction safely within the opponent's court.
   * Calculates the exact launch velocity vector to land in-bounds (X between -0.68m and +0.68m,
   * Z between 0.35m and 1.22m), eliminating accidental over-powered outs and wild baseline flyaways.
   */
  private executePlayerReturn(strokePower = 1.0): void {
    if (this.swingCooldown > 0) return;
    this.swingCooldown = 0.18;

    // The instant the ball hits the paddle (or executePlayerHit fires),
    // immediately cancel all player return timers, floor drop timeouts, and grace timers.
    // Set this.lastHitter = 'player' and reset bounceCount = 0.
    this.lastHitter = 'player';
    this.bounceCountNear = 0;
    this.bounceCountFar = 0;
    if (this.playerBounceTimeout) {
      clearTimeout(this.playerBounceTimeout);
      this.playerBounceTimeout = undefined;
    }
    for (const tid of this.activeTimeouts) clearTimeout(tid);
    this.activeTimeouts = [];
    this.returnGraceTimer = 0;
    this.postureGraceTimer = 0;

    // Roll AI interception probability for this player shot
    this.decideAIInterception();

    // 1. In-Bounds Lateral Target Placement:
    // Moving/swinging to the left steers cross-court left; swinging right steers right.
    // Clamped strictly to [-0.68m, +0.68m] (inside regulation table width +-0.7625m)
    const lateralShift = this.paddleVelocity.x * 0.20;
    const handPlacementX = this.activePaddlePos.x * 0.55;
    const targetX = THREE.MathUtils.clamp(handPlacementX + lateralShift, -0.68, 0.68);

    // 2. In-Bounds Depth Target Placement:
    // Kinematically constrain all legal forward shots to hit opponent's table half
    // between Z = 0.55m and Z = 1.10m (never exceeding back baseline at 1.37m).
    const forwardPush = Math.max(0, this.paddleVelocity.z) * 0.08;
    const depthTargetZ = THREE.MathUtils.clamp(
      0.65 + Math.min(strokePower, 3.0) * 0.10 + forwardPush,
      0.55,
      1.10
    );

    // 3. Controlled Pacing: Exit forward speed Vz in 2.8 to 4.0 m/s range (10 to 14.5 km/h)
    const pacingSpeed = THREE.MathUtils.clamp(
      2.9 + Math.min(strokePower, 3.0) * 0.30 + Math.max(0, this.paddleVelocity.z) * 0.20,
      2.8,
      4.0
    );

    // 4. Spin computation: forward/upward brush imparts topspin; downward slice imparts backspin
    const topspin = THREE.MathUtils.clamp(this.paddleVelocity.y * 20 + 8, -18, 30);
    const sidespin = THREE.MathUtils.clamp(-this.paddleVelocity.x * 18, -25, 25);
    this.ballSpin.set(topspin, sidespin, 0);

    const netClearance = strokePower > 2.0 ? 0.050 : 0.058;

    // 5. Targeted Landing Solver: Guarantees in-bounds arc and landing
    this.ballVel = this.solveExactControlledVelocity(
      this.ballPos,
      targetX,
      depthTargetZ,
      netClearance,
      pacingSpeed
    );

    this.lastHitter = 'player';
    this.bounceCountNear = 0;
    this.bounceCountFar = 0;
    this.scoreState.rallyCount++;

    // Satisfying micro hit-stop (0.04s freeze) and audio feedback
    this.hitStopTimer = 0.04;
    this.audio.tableTennisPaddleHit(strokePower);
    this.flashSweetSpot();
    this.triggerScreenShake(Math.min(0.06, strokePower * 0.018));
  }

  private flashSweetSpot(): void {
    if (this.fpSweetSpotMesh) {
      (this.fpSweetSpotMesh.material as THREE.MeshBasicMaterial).color.setHex(0x39ff14);
      this.sweetSpotFlashTimer = 0.18;
    }
  }

  private triggerScreenShake(intensity = 0.05): void {
    this.screenShakeIntensity = intensity;
  }

  public update(deltaTime: number, motionFrame: MotionFrame | null): void {
    if (!this.isRunning) return;
    const dt = Math.min(deltaTime, 0.05);

    // ─── 1. Strict Leg-Visibility & Standing Posture Gate ───
    // Evaluated at the top of the frame before running any gameplay logic.
    const hasMotionData = !!(motionFrame && motionFrame.worldLandmarks && motionFrame.worldLandmarks.length >= 33);
    const isStanding = hasMotionData
      ? Avatar3D.isFullBodyStanding(motionFrame!.worldLandmarks || [])
      : (!this.isPointerControlled ? false : true);

    const isServeState = this.rallyState === 'READY_TO_SERVE' || this.rallyState === 'IN_SERVE';
    let torsoVelZ = 0;

    // Track torso translational velocity along Z to detect active walking / repositioning
    if (hasMotionData) {
      this.playerAvatar.update(motionFrame!.worldLandmarks!, this.dominantHand, dt);

      const currentHipPos = this.playerAvatar.getHipWorldPosition('center');
      const safeDelta = Math.max(0.008, dt);

      if (this.hasPrevHipPos) {
        const hipVel = currentHipPos.clone().sub(this.prevHipPos).divideScalar(safeDelta);
        torsoVelZ = hipVel.z;
        this.currentHipSpeed = Math.abs(torsoVelZ);
      }
      this.prevHipPos.copy(currentHipPos);
      this.hasPrevHipPos = true;

      // In repositioning detection, measure ONLY depth movement (Z):
      // Do NOT include lateral velocity (Vx) in repositioning so the player can step or lunge left and right freely without triggering warnings.
      const isStanceRepositioning = Math.abs(torsoVelZ) > 0.45;
      this.isStanceRepositioning = isServeState && isStanceRepositioning;
    } else {
      this.isStanceRepositioning = false;
    }

    // Scope Posture Modal Strictly to Pre-Match (Initial Match Startup Only):
    // Only check posture once when the match is first launched from main menu (isInitialStanceSettling === true).
    // Once player starts playing, keep #tt-posture-modal permanently hidden and never pause/freeze mid-rally or mid-match.
    if (this.isInitialStanceSettling) {
      if (!isStanding || this.isStanceRepositioning) {
        this.stableStandingTimer = 0;
        this.isPostureGated = true;
        if (this.postureModalEl) {
          this.postureModalEl.classList.remove('hidden');
        }
        if (this.renderer && this.scene && this.camera) {
          this.renderer.render(this.scene, this.camera);
        }
        return;
      }

      // Posture Stability Debounce: 0.8s continuous standing at match startup
      this.stableStandingTimer += dt;
      if (this.stableStandingTimer < 0.80) {
        this.isPostureGated = true;
        if (this.postureModalEl) {
          this.postureModalEl.classList.remove('hidden');
        }
        if (this.renderer && this.scene && this.camera) {
          this.renderer.render(this.scene, this.camera);
        }
        return;
      }

      this.isPostureGated = false;
      if (this.postureModalEl) {
        this.postureModalEl.classList.add('hidden');
      }
    } else {
      // Permanently keep posture modal hidden during active match / serves
      this.isPostureGated = false;
      if (this.postureModalEl) {
        this.postureModalEl.classList.add('hidden');
      }
    }

    this.animT += dt;

    if (this.hitStopTimer > 0) {
      this.hitStopTimer -= dt;
      // During hit-stop freeze (0.04s), keep 3D paddle tracking responsive and render,
      // but freeze physics integration for tactile impact punch
      if (this.renderer && this.scene && this.camera) {
        this.renderer.render(this.scene, this.camera);
      }
      return;
    }

    if (this.postureGraceTimer > 0) this.postureGraceTimer -= dt;
    if (this.returnGraceTimer > 0) this.returnGraceTimer -= dt;
    if (this.swingCooldown > 0) this.swingCooldown -= dt;
    if (this.aiHitCooldown > 0) this.aiHitCooldown -= dt;

    // Table half surface flash decay
    if (this.playerHalfFlashTimer > 0) {
      this.playerHalfFlashTimer -= dt;
      if (this.playerTableMat) {
        this.playerTableMat.emissiveIntensity = THREE.MathUtils.lerp(0.06, 0.65, Math.max(0, this.playerHalfFlashTimer / 0.30));
      }
    }
    if (this.opponentHalfFlashTimer > 0) {
      this.opponentHalfFlashTimer -= dt;
      if (this.opponentTableMat) {
        this.opponentTableMat.emissiveIntensity = THREE.MathUtils.lerp(0.06, 0.65, Math.max(0, this.opponentHalfFlashTimer / 0.30));
      }
    }

    if (this.sweetSpotFlashTimer > 0) {
      this.sweetSpotFlashTimer -= dt;
      if (this.sweetSpotFlashTimer <= 0 && this.fpSweetSpotMesh) {
        (this.fpSweetSpotMesh.material as THREE.MeshBasicMaterial).color.setHex(0xffffff);
      }
    }

    // Screen Shake decay
    if (this.screenShakeIntensity > 0) {
      this.screenShakeIntensity = Math.max(0, this.screenShakeIntensity - dt * 0.35);
      const rx = (Math.random() - 0.5) * this.screenShakeIntensity;
      const ry = (Math.random() - 0.5) * this.screenShakeIntensity;
      this.camera.position.set(
        this.cameraBasePos.x + rx,
        this.cameraBasePos.y + ry,
        this.cameraBasePos.z
      );
    } else {
      this.camera.position.copy(this.cameraBasePos);
    }

    // 2. 1:1 Lateral Body Shift
    const hasWebcamMotion = hasMotionData;
    if (hasWebcamMotion) {
      const lSh = motionFrame!.rawLandmarks![PoseLandmark.LEFT_SHOULDER];
      const rSh = motionFrame!.rawLandmarks![PoseLandmark.RIGHT_SHOULDER];
      const lHip = motionFrame!.rawLandmarks![PoseLandmark.LEFT_HIP];
      const rHip = motionFrame!.rawLandmarks![PoseLandmark.RIGHT_HIP];

      const hasSh = lSh && rSh && (lSh.visibility ?? 1) > 0.25 && (rSh.visibility ?? 1) > 0.25;
      const hasHips = lHip && rHip && (lHip.visibility ?? 1) > 0.25 && (rHip.visibility ?? 1) > 0.25;

      if (hasSh || hasHips) {
        const topX = hasSh ? (lSh.x + rSh.x) * 0.5 : 0.5;
        const botX = hasHips ? (lHip.x + rHip.x) * 0.5 : 0.5;
        const screenTorsoX = hasSh && hasHips ? (topX * 0.6 + botX * 0.4) : (hasSh ? topX : botX);
        const normalizedOffset = (screenTorsoX - 0.5) * 2.8;
        const targetX = THREE.MathUtils.clamp(normalizedOffset, -1.25, 1.25);
        this.playerX += (targetX - this.playerX) * Math.min(1.0, dt * 18);
        this.playerAvatar.group.position.x = this.playerX;
      }
    } else if (this.isPointerControlled && performance.now() - this.lastPointerEventTime < 2500) {
      // Mouse control fallback
      this.playerX += (this.mouseX * 0.9 - this.playerX) * Math.min(1.0, dt * 18);
      this.playerAvatar.group.position.x = this.playerX;
    }

    // 3. 1:1 Hand-to-Paddle 3D Tracking
    let dominantVel = new THREE.Vector3(0, 0, 0);
    if (motionFrame && motionFrame.worldLandmarks && motionFrame.worldLandmarks.length > 20) {
      this.playerAvatar.update(motionFrame.worldLandmarks, this.dominantHand, dt);
      const batPos = this.playerAvatar.getPaddleWorldPosition();
      dominantVel = this.playerAvatar.getSmoothedDominantWristVelocity();

      const wristIdx = this.dominantHand === 'left' ? PoseLandmark.LEFT_WRIST : PoseLandmark.RIGHT_WRIST;
      const elbowIdx = this.dominantHand === 'left' ? PoseLandmark.LEFT_ELBOW : PoseLandmark.RIGHT_ELBOW;
      const wrist = motionFrame.worldLandmarks[wristIdx];
      const elbow = motionFrame.worldLandmarks[elbowIdx];

      // Instant 1:1 paddle tracking without artificial latency across court width
      const targetX = THREE.MathUtils.clamp(batPos.x, -1.25, 1.25);
      const targetY = THREE.MathUtils.clamp(batPos.y, this.tableHeight + 0.02, 1.35);
      const targetZ = THREE.MathUtils.clamp(batPos.z, -1.65, -1.10);
      this.activePaddlePos.set(targetX, targetY, targetZ);
      this.fpPaddleGroup.position.set(targetX, targetY, targetZ);

      // Exponential smoothing (EMA) on wrist velocities to capture rapid TT forearm flicks while filtering out resting camera jitter
      if (wrist) {
        const currentWrist = new THREE.Vector3(
          -wrist.x * 1.8,
          (1.4 - wrist.y) * 1.6,
          -wrist.z * 1.8 - 1.25
        );
        if (this.hasPrevWrist) {
          const rawWristVel = currentWrist.clone().sub(this.prevWristPos).divideScalar(Math.max(0.008, dt));
          // Filter resting camera jitter with a deadzone (< 0.12 m/s)
          if (rawWristVel.length() < 0.12) {
            rawWristVel.set(0, 0, 0);
          }
          this.smoothedWristVelocity.lerp(rawWristVel, 0.45);
        } else {
          this.hasPrevWrist = true;
          this.smoothedWristVelocity.set(0, 0, 0);
          this.paddleVelocity.set(0, 0, 0);
          this.prevPaddlePos.set(targetX, targetY, targetZ);
          this.prevPaddleHeadPos.set(targetX, targetY, targetZ);
        }
        this.prevWristPos.copy(currentWrist);
      }

      // Natural Table Tennis Posture: In READY_TO_SERVE, tilt paddle face open (~35 deg) so ball visibly rests on rubber
      let forearmAngleX = 0;
      let forearmAngleY = 0;
      if (wrist && elbow) {
        forearmAngleX = THREE.MathUtils.clamp((wrist.x - elbow.x) * 0.6, -0.3, 0.3);
        forearmAngleY = THREE.MathUtils.clamp((wrist.y - elbow.y) * 0.6, -0.25, 0.25);
      }
      const isReadyServe = this.rallyState === 'READY_TO_SERVE' && this.scoreState.currentServer === 1;
      const basePitch = isReadyServe ? -0.58 : -0.24;
      const pitch = basePitch + forearmAngleY + THREE.MathUtils.clamp(this.paddleVelocity.z * 0.04, -0.15, 0.15);
      const yaw = THREE.MathUtils.clamp(-targetX * 0.3 + forearmAngleX, -0.4, 0.4);
      const roll = this.dominantHand === 'left' ? 0.12 : -0.12;
      this.fpPaddleGroup.rotation.set(pitch, yaw, roll);
    } else if (this.isPointerControlled) {
      // Smooth Pointer fallback positioning with 1:1 response
      const targetX = THREE.MathUtils.clamp(this.mouseX, -1.25, 1.25);
      const targetY = THREE.MathUtils.clamp(this.mouseY, this.tableHeight + 0.06, 1.28);
      const targetZ = -1.35;
      this.activePaddlePos.set(targetX, targetY, targetZ);
      this.fpPaddleGroup.position.set(targetX, targetY, targetZ);
      const isReadyServe = this.rallyState === 'READY_TO_SERVE' && this.scoreState.currentServer === 1;
      this.fpPaddleGroup.rotation.set(isReadyServe ? -0.58 : -0.20, -targetX * 0.25, 0);
    }

    // 3D paddle velocity computation with EMA smoothing and resting camera jitter filter
    const rawPaddleVel = new THREE.Vector3().subVectors(this.activePaddlePos, this.prevPaddlePos).divideScalar(Math.max(0.008, dt));
    if (rawPaddleVel.length() < 0.12) {
      rawPaddleVel.set(0, 0, 0);
    }
    this.paddleVelocity.lerp(rawPaddleVel, 0.45);
    this.prevPaddlePos.copy(this.activePaddlePos);

    const paddleGroup = this.playerAvatar.getPaddleGroup();
    if (paddleGroup) paddleGroup.visible = true;

    // Update aim reticle feedback
    if (this.rallyState === 'READY_TO_SERVE' && this.scoreState.currentServer === 1) {
      this.aimReticleMesh.position.set(this.playerX * 0.5, this.tableHeight + 0.002, 0.75);
      this.aimReticleMesh.visible = true;
    } else if ((this.rallyState === 'IN_PLAY' || this.rallyState === 'IN_SERVE') && this.lastHitter !== 'player') {
      const projectedAimX = THREE.MathUtils.clamp(this.activePaddlePos.x * 0.85 + this.paddleVelocity.x * 0.2, -0.60, 0.60);
      this.aimReticleMesh.position.set(projectedAimX, this.tableHeight + 0.002, 0.80);
      this.aimReticleMesh.visible = true;
    } else {
      this.aimReticleMesh.visible = false;
    }

    // 3a. Initial Match Startup Stance Settling Delay (1.8s)
    if (this.isInitialStanceSettling) {
      const isPlayerStill = isStanding && Math.abs(torsoVelZ) < 0.30;
      if (isPlayerStill) {
        this.startupCountdown = Math.max(0, this.startupCountdown - dt);
        if (dominantVel.length() < 1.0) {
          this.wristSettledTimer += dt;
        } else {
          this.wristSettledTimer = 0;
        }
      } else {
        // Pause / reset countdown if player moves back/forth or sits down
        this.startupCountdown = 1.8;
        this.wristSettledTimer = 0;
      }

      this.isServeArmed = false;
      this.setBallVisibility(false);
      this.paddleVelocity.set(0, 0, 0);
      this.smoothedWristVelocity.set(0, 0, 0);
      this.paddleHistory = [];
      if (this.playerAvatar) {
        this.playerAvatar.resetVelocities();
      }

      const displaySecs = Math.max(0.1, this.startupCountdown).toFixed(1);
      this.updateStatusDialog('GET READY', `GET READY — Stand in position (${displaySecs}s)`, 'position', 'MATCH START');

      if (this.startupCountdown <= 0 && this.wristSettledTimer >= 0.25) {
        this.isInitialStanceSettling = false;
        this.isServeArmed = true;
        this.setBallVisibility(true);
        this.resetServe();
        if (this.scoreState.currentServer === 1) {
          this.updateStatusDialog('🏓 READY TO SERVE', 'READY TO SERVE — SWING FORWARD', 'ready', 'PLAYER SERVE');
        }
      }

      // Keep ball docked while settling
      if (this.scoreState.currentServer === 1) {
        this.dockBallToPlayerPaddle();
      }
    }
    // 3b. Mandatory Inter-Point Serve Buffer (1.5s Settled Stance Delay)
    else if (this.rallyState === 'POINT_TRANSITION') {
      const isPlayerStill = isStanding && Math.abs(torsoVelZ) < 0.30;
      if (isPlayerStill) {
        this.pointTransitionTimer = Math.max(0, this.pointTransitionTimer - dt);
        if (dominantVel.length() < 1.0) {
          this.wristSettledTimer += dt;
        } else {
          this.wristSettledTimer = 0;
        }
      } else {
        // Pause / reset countdown to 1.5s if player moves back/forth or sits down
        this.pointTransitionTimer = Math.max(this.pointTransitionTimer, 1.5);
        this.wristSettledTimer = 0;
      }

      this.isServeArmed = false;
      this.setBallVisibility(false);
      this.paddleVelocity.set(0, 0, 0);
      this.smoothedWristVelocity.set(0, 0, 0);
      this.paddleHistory = [];
      this.hasPrevWrist = false;
      this.hasPrevUpperBodyPos = false;
      if (this.playerAvatar) {
        this.playerAvatar.resetVelocities();
      }

      const displaySecs = Math.max(0.1, this.pointTransitionTimer).toFixed(1);
      this.updateStatusDialog('GET READY', `Stand in position for next serve (${displaySecs}s)...`, 'position', 'INTER-POINT');

      // Transition to READY_TO_SERVE only after 1.5s timer reaches 0 AND wrist settled (< 1.0 m/s for 0.25s)
      if (this.pointTransitionTimer <= 0 && this.wristSettledTimer >= 0.25) {
        this.isServeArmed = true;
        this.setBallVisibility(true);
        this.resetServe();
        if (this.scoreState.currentServer === 1) {
          this.updateStatusDialog('🏓 READY TO SERVE', 'READY TO SERVE — SWING FORWARD', 'ready', 'PLAYER SERVE');
        }
      }
    }

    // 4. Firm Toss/Docked Serve & Overhauled Kinematic Serve Strike Gating
    if (!this.isInitialStanceSettling && this.rallyState === 'READY_TO_SERVE' && this.scoreState.currentServer === 1) {
      if (this.serveCountdown > 0) {
        this.serveCountdown -= dt;
      }
      // Ball rests visibly on player's table tennis paddle
      this.dockBallToPlayerPaddle();

      // Measure hand flow relative to shoulder
      const currentWristPos = this.playerAvatar.getHandWorldPosition(this.playerAvatar.dominantArm);
      const currentShoulderPos = this.playerAvatar.getShoulderWorldPosition(this.playerAvatar.dominantArm);
      const safeDelta = Math.max(0.008, dt);

      let relativeWristVel = new THREE.Vector3();
      if (this.hasPrevUpperBodyPos) {
        relativeWristVel = currentWristPos.clone().sub(currentShoulderPos).sub(
          this.prevUpperWrist.clone().sub(this.prevUpperShoulder)
        ).divideScalar(safeDelta);
      }
      this.prevUpperWrist.copy(currentWristPos);
      this.prevUpperShoulder.copy(currentShoulderPos);
      this.hasPrevUpperBodyPos = true;

      // Maintain 150ms position history buffer for stroke displacement and oscillation checks
      const now = performance.now();
      this.paddleHistory.push({ pos: this.activePaddlePos.clone(), velZ: this.paddleVelocity.z, t: now });
      while (this.paddleHistory.length > 0 && now - this.paddleHistory[0].t > 160) {
        this.paddleHistory.shift();
      }

      // Overhauled serve strike check: rejects hand twitching/shaking, enforces starting behind ball,
      // requires net forward displacement >= 0.12m over 150ms and vel.z >= 1.2 m/s while allowing lateral sweeps.
      const canServe = this.isServeArmed && !this.isPostureGated && !this.isStanceRepositioning && this.serveCountdown <= 0;
      if (canServe && this.isServeStrikeRegistered(relativeWristVel)) {
        this.executeMotionServe();
      }
    } else if (this.rallyState === 'IN_PLAY' && this.lastHitter !== 'player') {
      // 5. Swept-Volume Collision Detection during Return
      // Return zone spans the full player half of the table (Z between -1.60m and 0.0m, X between +-0.90m)
      const inContactZone =
        this.ballPos.z <= 0.0 &&
        this.ballPos.z >= -1.60 &&
        Math.abs(this.ballPos.x) <= 0.90 &&
        this.ballVel.z < 0.5;

      if (inContactZone) {
        const closestDist = this.closestApproachSegSeg(
          this.prevPaddleHeadPos, this.activePaddlePos,
          this.prevBallPos,       this.ballPos
        );
        const directDist = this.activePaddlePos.distanceTo(this.ballPos);

        const totalSpeed = Math.max(
          this.paddleVelocity.length(),
          this.smoothedWristVelocity.length(),
          dominantVel.length()
        );

        // Paddle contact triggers return stroke (regardless of whether swing speed is 0 km/h or 15 km/h)
        const isPaddleContact = directDist <= 0.48 || closestDist <= 0.42;

        if (isPaddleContact) {
          this.lastHitter = 'player';
          this.bounceCountNear = 0;
          this.bounceCountFar = 0;
          if (this.playerBounceTimeout) {
            clearTimeout(this.playerBounceTimeout);
            this.playerBounceTimeout = undefined;
          }
          for (const tid of this.activeTimeouts) clearTimeout(tid);
          this.activeTimeouts = [];
          this.returnGraceTimer = 0;
          this.postureGraceTimer = 0;
          this.executePlayerReturn(Math.max(totalSpeed, 1.0));
        }
      }
    }
    this.prevPaddleHeadPos.copy(this.activePaddlePos);

    // 6. Ball Dynamics & ITTF Bounce Rules
    if (this.rallyState === 'IN_PLAY' || this.rallyState === 'IN_SERVE') {
      this.prevBallPos.copy(this.ballPos);

      // Auto-Net Safety Lift for casual player shots heading directly into bottom of net
      if (
        this.lastHitter === 'player' &&
        Math.abs(this.ballPos.z) < 0.35 &&
        this.ballVel.z > 0 &&
        this.ballPos.y < this.tableHeight + this.netHeight + 0.06
      ) {
        this.ballVel.y += 1.8 * dt * 15;
      }

      // ─── Aerodynamic Air Drag & Magnus Spin Effect ───
      const ballSpeed = this.ballVel.length();
      // Air drag deceleration: gentle realistic resistance for lightweight ping-pong ball
      const dragFactor = 0.07 * ballSpeed;
      this.ballVel.x -= this.ballVel.x * dragFactor * dt;
      this.ballVel.y -= this.ballVel.y * dragFactor * dt;
      this.ballVel.z -= this.ballVel.z * dragFactor * dt;

      // Magnus acceleration: a_magnus = C_magnus * (omega x v)
      const magnusCoeff = 0.0035;
      const magX = (this.ballSpin.y * this.ballVel.z - this.ballSpin.z * this.ballVel.y) * magnusCoeff;
      const magY = (this.ballSpin.z * this.ballVel.x - this.ballSpin.x * this.ballVel.z) * magnusCoeff;
      const magZ = (this.ballSpin.x * this.ballVel.y - this.ballSpin.y * this.ballVel.x) * magnusCoeff;

      this.ballVel.x += magX * dt;
      this.ballVel.y += (magY - 9.81) * dt; // Gravity + vertical Magnus
      this.ballVel.z += magZ * dt;

      // Spin decay in flight
      this.ballSpin.multiplyScalar(Math.max(0, 1 - 0.25 * dt));

      // Ball position integration
      this.ballPos.addScaledVector(this.ballVel, dt);

      // Ball visual rotation
      if (ballSpeed > 0.1) {
        this.ballMesh.rotation.x += (this.ballVel.z * 12 + this.ballSpin.x) * dt;
        this.ballMesh.rotation.y += this.ballSpin.y * dt;
        this.ballMesh.rotation.z -= (this.ballVel.x * 12) * dt;
      }

      // ─── Continuous Net Interaction (Plane Z = 0) ───
      const zPrev = this.prevBallPos.z;
      const zCurr = this.ballPos.z;
      const crossesNetPlane = (zPrev < 0 && zCurr >= 0) || (zPrev > 0 && zCurr <= 0);

      if (crossesNetPlane) {
        const alpha = Math.abs(zPrev) / (Math.abs(zCurr - zPrev) || 0.001);
        const yAtNet = THREE.MathUtils.lerp(this.prevBallPos.y, this.ballPos.y, alpha);
        const xAtNet = THREE.MathUtils.lerp(this.prevBallPos.x, this.ballPos.x, alpha);
        const netTopY = this.tableHeight + this.netHeight; // 0.76 + 0.1525 = 0.9125m

        if (Math.abs(xAtNet) <= this.netWidth / 2 && yAtNet <= netTopY) {
          if (yAtNet >= netTopY - 0.02) {
            // Net Tape Clip! Grazes top tape
            this.netHitTimer = 0.35;
            this.ballVel.z *= 0.75;
            this.ballVel.y = Math.max(this.ballVel.y, 0.4);
            this.audio.tableTennisNetClip();

            if (this.servePhase === 'SERVE_BOUNCED_SERVER' || this.servePhase === 'RECEIVER_BOUNCE') {
              this.wasNetClippedOnServe = true;
            }
          } else {
            // Direct Solid Net Collision!
            this.audio.tableTennisNetClip();
            this.netHitTimer = 0.5;
            this.showNetHitBanner();
            this.ballVel.z = -this.ballVel.z * 0.25;
            this.ballVel.y = 0.5;
            const ptWinner = this.lastHitter === 'player' ? 2 : 1;
            this.awardPoint(ptWinner, 'Ball hit net');
            return;
          }
        }
      }

      // ─── Table Bounce & ITTF Bounds Checking ───
      const halfTableW = this.tableWidth / 2;
      const halfTableL = this.tableLength / 2;
      const onTableX = Math.abs(this.ballPos.x) <= halfTableW;
      const onTableZ = Math.abs(this.ballPos.z) <= halfTableL;

      if (onTableX && onTableZ && this.ballPos.y <= this.tableHeight + this.ballRadius && this.ballVel.y < 0) {
        this.ballPos.y = this.tableHeight + this.ballRadius;
        this.spawnBounceRipple(this.ballPos.x, this.ballPos.z, this.ballPos.z < 0);

        // Realistic Table Impact Damping (Maintain forward speed on drives >= 12 km/h: vel.z *= 0.86, vel.x *= 0.86)
        const speedKmh = Math.abs(this.ballVel.z) * 3.6;
        const restitutionZ = speedKmh >= 12 ? 0.86 : 0.78;
        const restitutionX = speedKmh >= 12 ? 0.86 : 0.78;
        this.ballVel.y = -this.ballVel.y * 0.82;
        this.ballVel.z = this.ballVel.z * restitutionZ - this.ballSpin.x * this.ballRadius * 0.08;
        this.ballVel.x = this.ballVel.x * restitutionX + this.ballSpin.y * this.ballRadius * 0.08;

        // Spin exchange on bounce
        this.ballSpin.x *= 0.65;
        this.ballSpin.y *= 0.65;

        if (this.rallyState === 'IN_SERVE') {
          if (this.servePhase === 'SERVER_BOUNCE') {
            // ─── ITTF SERVE BOUNCE 1: Must hit server's own half (mandatory & legal) ───
            if (this.lastHitter === 'player' && this.ballPos.z < 0) {
              // Player serve legally bounced on server half (Z < 0)
              this.audio.tableTennisBounce(true);
              this.bounceCountNear = 1;
              this.servePhase = 'SERVE_BOUNCED_SERVER';
              // Arc over net to receiver's half (Z = +0.82m) with forward speed Vz in 2.8 to 4.0 m/s range
              const targetXOpp = THREE.MathUtils.clamp(this.ballPos.x * 0.75, -0.45, 0.45);
              const targetZOpp = 0.82;
              this.ballVel = this.solveExactControlledVelocity(this.ballPos, targetXOpp, targetZOpp, 0.055, 3.4);
              return;
            } else if (this.lastHitter === 'opponent' && this.ballPos.z > 0) {
              // AI serve legally bounced on server half (Z > 0)
              this.audio.tableTennisBounce(false);
              this.bounceCountFar = 1;
              this.servePhase = 'SERVE_BOUNCED_SERVER';
              // Arc over net to player's half (Z = -0.90m) with forward speed Vz in 2.8 to 4.0 m/s range
              const targetXPlayer = THREE.MathUtils.clamp((Math.random() - 0.5) * 0.5, -0.38, 0.38);
              const targetZPlayer = -0.90;
              this.ballVel = this.solveExactControlledVelocity(this.ballPos, targetXPlayer, targetZPlayer, 0.055, 3.4);
              return;
            } else {
              // Fault: serve missed server's table half
              this.awardPoint(this.lastHitter === 'player' ? 2 : 1, 'Fault: serve must bounce on own side first');
              return;
            }
          } else if (this.servePhase === 'SERVE_BOUNCED_SERVER' || this.servePhase === 'RECEIVER_BOUNCE') {
            // ─── ITTF SERVE BOUNCE 2: Receiver's table half ───
            if (this.lastHitter === 'player') {
              if (this.ballPos.z < 0) {
                // Fault: bounced twice on server's half
                this.awardPoint(2, 'Fault: double bounce on server side');
                return;
              }
              if (this.wasNetClippedOnServe) {
                // ITTF LET RULE: Replay serve!
                this.replayLetServe();
                return;
              }
              // Legal 2nd bounce on receiver (opponent) half! Serve complete!
              this.audio.tableTennisBounce(false);
              this.bounceCountFar = 1;
              this.rallyState = 'IN_PLAY';
              this.servePhase = 'NONE';
              return;
            } else if (this.lastHitter === 'opponent') {
              if (this.ballPos.z > 0) {
                // Fault: bounced twice on AI server's half
                this.awardPoint(1, 'Fault: double bounce on server side');
                return;
              }
              if (this.wasNetClippedOnServe) {
                // ITTF LET RULE: Replay serve!
                this.replayLetServe();
                return;
              }
              // Legal 2nd bounce on player half! Serve complete!
              this.audio.tableTennisBounce(true);
              this.bounceCountNear = 1;
              this.rallyState = 'IN_PLAY';
              this.servePhase = 'NONE';
              return;
            } else {
              // Fault: serve missed receiver court
              this.awardPoint(this.lastHitter === 'player' ? 2 : 1, 'Fault: serve missed receiver court');
              return;
            }
          }
        } else if (this.rallyState === 'IN_PLAY') {
          // ─── ACTIVE RALLIES: Single bounce is a live ball! ───
          if (this.lastHitter === 'player') {
            if (this.ballPos.z > 0) {
              // Return landed on opponent side!
              this.bounceCountFar++;
              this.spawnBounceRipple(this.ballPos.x, this.ballPos.z, false);
              this.audio.tableTennisBounce(false);
              if (this.bounceCountFar > 1) {
                // Bounce 2 on opponent table: bot failed to hit ball before second bounce!
                this.handleRallyPoint(1, 'POINT PLAYER — OPPONENT DOUBLE BOUNCE');
                return;
              }
              // Bounce 1: Legal active bounce. Bot must return it.
            } else {
              // Return bounced on player's own half! Fault!
              this.handleRallyPoint(2, 'Return hit own side of table');
              return;
            }
          } else if (this.lastHitter === 'opponent') {
            if (this.ballPos.z < 0) {
              // AI return landed on player side!
              this.bounceCountNear++;
              this.audio.tableTennisBounce(true);
              if (this.bounceCountNear > 1) {
                this.handleRallyPoint(2, 'Double bounce on player side');
                return;
              }
              // Single bounce: LIVE BALL
            } else {
              // AI return bounced on AI's own half! Fault!
              this.handleRallyPoint(1, 'AI return hit own side of table');
              return;
            }
          }
        }
      }

      // Net ripple animation
      if (this.netHitTimer > 0) {
        this.netHitTimer -= dt;
        const pulse = Math.abs(Math.sin(this.netHitTimer * 30));
        (this.netMesh.material as THREE.MeshStandardMaterial).emissive.setHex(0xff2222);
        (this.netMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = pulse * 1.2;
      } else {
        (this.netMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0;
      }

      // Ball Trail (Pure White 0xffffff, tapering smoothly from 0.75 down to 0.0)
      this.ballTrail.unshift(this.ballPos.clone());
      if (this.ballTrail.length > this.TRAIL_LENGTH) this.ballTrail.pop();
      for (let i = 0; i < this.TRAIL_LENGTH; i++) {
        const tm = this.ballTrailMeshes[i];
        if (!tm) continue;
        if (this.ballTrail[i]) {
          tm.visible = true;
          tm.position.copy(this.ballTrail[i]);
          (tm.material as THREE.MeshBasicMaterial).color.setHex(0xffffff);
          (tm.material as THREE.MeshBasicMaterial).opacity = (1 - i / this.TRAIL_LENGTH) * 0.75;
        } else {
          tm.visible = false;
        }
      }

      // Floor Drop / Out of Bounds
      if (this.ballPos.y < 0.10) {
        if (this.rallyState === 'IN_SERVE') {
          this.awardPoint(this.lastHitter === 'player' ? 2 : 1, 'Fault: serve out of bounds');
          return;
        }
        if (this.lastHitter === 'player') {
          if (this.bounceCountFar >= 1) {
            this.handleRallyPoint(1, 'POINT PLAYER — OPPONENT DOUBLE BOUNCE / MISSED');
          } else {
            this.handleRallyPoint(2, 'Ball out of bounds');
          }
        } else if (this.lastHitter === 'opponent') {
          if (this.bounceCountNear >= 1) {
            this.handleRallyPoint(2, 'POINT OPPONENT — DROPPED ON YOUR SIDE');
          } else {
            this.handleRallyPoint(1, 'AI shot out of bounds');
          }
        } else {
          this.handleRallyPoint(this.lastHitter === 'player' ? 2 : 1, 'Ball out of bounds');
        }
        return;
      }

      // 7. Intelligent TT Bot Opponent with Difficulty Scaling
      if (this.lastHitter !== 'opponent' && this.servePhase === 'NONE') {
        if (this.lastHitter === 'opponent' || this.aiHitCooldown > 0) {
          // AI paddle lockout active, skip AI collision logic
        } else {
          if (!this.hasAiInterceptDecision) {
            this.decideAIInterception();
          }
          const diffLerpSpeed = this.currentDifficulty === 'legend' ? 14 : (this.currentDifficulty === 'pro' ? 9.5 : 6.0);
          // When AI fails interception, it hesitates/reacts slowly, letting the ball bounce cleanly on its side
          const effectiveLerpSpeed = this.aiWillIntercept ? diffLerpSpeed : diffLerpSpeed * 0.35;
          const targetX = THREE.MathUtils.clamp(this.ballPos.x * 0.88, -this.tableWidth / 2, this.tableWidth / 2);
          this.opponentAvatar.group.position.x = THREE.MathUtils.lerp(this.opponentAvatar.group.position.x, targetX, effectiveLerpSpeed * dt);

          // Dynamic Bot Target Z: Allow AI avatar to step forward down to Z = 0.70m (mid-table)
          const desiredZ = this.aiWillIntercept
            ? THREE.MathUtils.clamp(this.ballPos.z + 0.38, 0.70, 1.55)
            : 1.50;
          const zLerpSpeed = this.aiWillIntercept ? Math.max(effectiveLerpSpeed, 10.0) : effectiveLerpSpeed * 0.5;
          this.opponentAvatar.group.position.z = THREE.MathUtils.lerp(this.opponentAvatar.group.position.z, desiredZ, zLerpSpeed * dt);

          // Dynamically reach the arm and paddle towards the ball in 3D
          if (this.ballPos.z > 0) {
            const reachTarget = new THREE.Vector3(
              this.ballPos.x,
              Math.max(this.tableHeight + 0.06, this.ballPos.y),
              this.ballPos.z
            );
            this.opponentAvatar.poseArmsToTargets(reachTarget, undefined, 'right');
          }

          const aiBat = this.opponentAvatar.getPaddleWorldPosition();

          // Strike on the Rise:
          // Command AI to initiate swing immediately as the ball reaches the peak of its first bounce (when vel.y begins turning downward and distance to paddle is within reach <= 0.80m).
          const hitDistance = 0.80;
          const isBounceFar = this.bounceCountFar >= 1;
          const isApexOrDescending = (this.ballVel.y <= 0.45 || (this.ballVel.y > 0 && isBounceFar)) && this.ballPos.y >= this.tableHeight + 0.04;
          const distToBall = aiBat.distanceTo(this.ballPos);
          const isWithinReach = distToBall <= hitDistance ||
            (Math.abs(aiBat.x - this.ballPos.x) < 0.75 && Math.abs(aiBat.z - this.ballPos.z) <= 0.80);

          if (
            this.aiWillIntercept &&
            isBounceFar &&
            (isWithinReach && isApexOrDescending)
          ) {
            let targetXAi: number;
            let targetZAi: number;
            let aiPacing: number;

            if (this.currentDifficulty === 'legend') {
              // Aggressive corner placement and controlled pace (landing deep between -0.88m and -1.15m)
              const cornerSign = Math.random() > 0.5 ? 1 : -1;
              targetXAi = cornerSign * (0.24 + Math.random() * 0.20);
              targetZAi = -0.88 - Math.random() * 0.25;
              aiPacing = 3.6;
              this.ballSpin.set(-16, cornerSign * 10, 0);
            } else if (this.currentDifficulty === 'pro') {
              // Dynamic deep placement (landing between -0.84m and -1.10m)
              targetXAi = THREE.MathUtils.clamp((Math.random() - 0.5) * 0.8, -0.42, 0.42);
              targetZAi = -0.84 - Math.random() * 0.25;
              aiPacing = 3.4;
              this.ballSpin.set(-12, (Math.random() - 0.5) * 6, 0);
            } else {
              // Casual: deep, readable pace (landing between -0.80m and -1.05m)
              targetXAi = THREE.MathUtils.clamp((Math.random() - 0.5) * 0.5, -0.30, 0.30);
              targetZAi = -0.80 - Math.random() * 0.25;
              aiPacing = 3.2;
              this.ballSpin.set(-6, (Math.random() - 0.5) * 3, 0);
            }

            this.ballVel = this.solveExactControlledVelocity(this.ballPos, targetXAi, targetZAi, 0.055, aiPacing);
            this.lastHitter = 'opponent';
            this.aiHitCooldown = 0.40; // Lockout AI paddle collision for 400ms
            this.bounceCountNear = 0;
            this.bounceCountFar = 0;
            this.scoreState.rallyCount++;
            this.hitStopTimer = 0.03;
            this.hasAiInterceptDecision = false;
            this.audio.tableTennisPaddleHit(1.0);

            // Advance ball position forward along exit trajectory by at least BALL_RADIUS * 1.5
            const exitDir = this.ballVel.clone().normalize();
            if (exitDir.lengthSq() > 0) {
              this.ballPos.addScaledVector(exitDir, this.ballRadius * 1.5);
            }
          } else if (this.lastHitter === 'player' && this.bounceCountFar >= 1) {
            // If the bot misses interception and ball passes baseline or drops below table height:
            if (this.ballPos.z > 1.37 || (this.ballPos.z > 1.05 && this.ballPos.y < this.tableHeight - 0.05)) {
              const calloutText = this.bounceCountFar >= 2 ? 'OPPONENT DOUBLE BOUNCE' : 'OPPONENT MISSED';
              this.handleRallyPoint(1, `POINT PLAYER — ${calloutText}`);
              return;
            }
          }
        }
      } else if (this.lastHitter === 'opponent') {
        // Recover smoothly toward baseline when ball is flying towards player
        this.opponentAvatar.group.position.z = THREE.MathUtils.lerp(this.opponentAvatar.group.position.z, 1.50, 3.5 * dt);
        this.opponentAvatar.applyDefaultPose('tabletennis', true);
      }
    } else if (this.rallyState === 'READY_TO_SERVE' && this.scoreState.currentServer === 2) {
      if (!this.isInitialStanceSettling) {
        // AI Serve countdown
        this.serveCountdown -= dt;
        if (this.serveCountdown <= 0) {
          this.executeAIServe();
        }
      }
    } else {
      for (const tm of this.ballTrailMeshes) tm.visible = false;
      this.ballTrail = [];
    }

    // Status Dialogue Update
    if (this.matchOver) {
      const matchWinnerTxt = this.scoreState.winner === 1 ? '🏆 MATCH WON!' : '🤖 AI WON MATCH!';
      this.updateStatusDialog(
        matchWinnerTxt,
        `Final Match: You ${this.player1GamesWon} - ${this.player2GamesWon} AI (Best of 5)`,
        'over',
        'MATCH COMPLETE'
      );
    } else if (this.isInitialStanceSettling) {
      const displaySecs = Math.max(0.1, this.startupCountdown).toFixed(1);
      this.updateStatusDialog('⏳ GET READY...', `Stand in position to begin (${displaySecs}s)`, 'position', 'MATCH START');
    } else if (this.rallyState === 'POINT_TRANSITION') {
      const displaySecs = Math.max(0.1, this.pointTransitionTimer).toFixed(1);
      this.updateStatusDialog('⏳ GET READY', `Stand in position for next serve (${displaySecs}s)...`, 'position', 'INTER-POINT');
    } else if (this.rallyState === 'READY_TO_SERVE') {
      const p1 = this.scoreState.player1Score;
      const p2 = this.scoreState.player2Score;
      const isDeuce = p1 >= 10 && p2 >= 10;
      const gameScoreTxt = `Game ${this.currentGameNumber} · Games: You ${this.player1GamesWon} - ${this.player2GamesWon} AI`;

      if (this.scoreState.currentServer === 1) {
        let serveCue: string;
        let statusTag = 'YOUR SERVE';
        let statusState: 'position' | 'ready' | 'active' = 'ready';

        if (this.isPostureGated) {
          serveCue = 'Please stand in full view of camera to serve';
          statusTag = 'STAND TO SERVE';
          statusState = 'position';
        } else if (this.isStanceRepositioning || this.currentHipSpeed > 0.35) {
          serveCue = '⚠️ Moving front/back — stop walking to serve';
          statusTag = 'REPOSITIONING';
          statusState = 'position';
        } else {
          serveCue = isDeuce
            ? '⚡ DEUCE: Swing hand forward to serve!'
            : '⚡ YOUR SERVE: Swing hand forward to serve!';
          statusTag = 'READY TO SERVE';
          statusState = 'ready';
        }
        this.updateStatusDialog('Ready to Serve', `${gameScoreTxt} · ${serveCue}`, statusState, statusTag);
      } else {
        const serveCue = isDeuce
          ? '⚡ DEUCE: AI Serve — Get ready!'
          : 'AI is preparing to serve... get ready!';
        this.updateStatusDialog('AI Serving', `${gameScoreTxt} · ${serveCue}`, 'ready', 'AI SERVE');
      }
    } else {
      this.updateStatusDialog(
        'Rally Active',
        `Score: You ${this.scoreState.player1Score} — AI ${this.scoreState.player2Score} · Rally: ${this.scoreState.rallyCount}`,
        'active',
        'IN PLAY'
      );
    }

    // Ball Mesh Position Sync & Incoming Scale Boost
    this.ballMesh.position.copy(this.ballPos);

    // Incoming ball visibility boost: scales up slightly when flying towards player from distance
    const isIncomingToPlayer = this.ballVel.z < 0 && this.lastHitter === 'opponent';
    const ballScale = isIncomingToPlayer
      ? THREE.MathUtils.lerp(1.2, 1.5, THREE.MathUtils.clamp((this.ballPos.z + 1.0) / 2.0, 0, 1))
      : 1.0;
    this.ballMesh.scale.setScalar(ballScale);

    // Unified Pure White Ball Material & Glow:
    if (this.ballLight) {
      this.ballLight.color.setHex(0xffffff);
    }
    if (this.ballHaloMat) {
      this.ballHaloMat.color.setHex(0xffffff);
      this.ballHaloMat.opacity = 0.55;
    }
    const ballMat = this.ballMesh.material as THREE.MeshStandardMaterial;
    if (ballMat) {
      ballMat.color.setHex(0xffffff);
      ballMat.emissive.setHex(0xffffff);
      ballMat.emissiveIntensity = 0.35;
      ballMat.roughness = 0.2;
    }

    // 1. Table-Projected Contact Shadow:
    // Pinned directly to the table surface (tableHeight + 0.002m)
    // Scales and fades dynamically with ball's height above the table
    this.ballShadowMesh.position.x = this.ballPos.x;
    this.ballShadowMesh.position.z = this.ballPos.z;
    this.ballShadowMesh.position.y = this.tableHeight + 0.002;

    const heightAboveTable = Math.max(0, this.ballPos.y - this.tableHeight);
    // When ball touches table (height = 0.02m), shadow is crisp, dark, scale ~0.8-1.0, opacity ~0.85
    // When ball is high (height = 0.40m), shadow expands (scale ~2.2) and fades (opacity ~0.20)
    const shadowScale = THREE.MathUtils.clamp(0.80 + heightAboveTable * 2.8, 0.70, 2.4);
    this.ballShadowMesh.scale.setScalar(shadowScale);
    if (this.ballShadowMat) {
      const shadowOpacity = THREE.MathUtils.clamp(0.85 - heightAboveTable * 1.5, 0.15, 0.85);
      this.ballShadowMat.opacity = shadowOpacity;
    }
    const isWithinTableXZ =
      Math.abs(this.ballPos.x) <= this.tableWidth / 2 + 0.04 &&
      Math.abs(this.ballPos.z) <= this.tableLength / 2 + 0.04;
    this.ballShadowMesh.visible = isWithinTableXZ && this.ballPos.y >= this.tableHeight - 0.05;

    // 2. Vertical Drop-Stem Line:
    // Connecting ball down to table surface to eliminate spatial depth ambiguity
    if (this.altitudeStemLine && this.altitudeStemGeo) {
      const isAboveTable = this.ballPos.y > this.tableHeight + 0.01;
      const isPlayingOrServing = this.rallyState === 'IN_PLAY' || this.rallyState === 'IN_SERVE' || this.rallyState === 'READY_TO_SERVE';
      if (isPlayingOrServing && isAboveTable && isWithinTableXZ) {
        this.altitudeStemLine.visible = true;
        this.altitudeStemMat.color.setHex(0xffffff);
        const posAttr = this.altitudeStemGeo.attributes.position as THREE.BufferAttribute;
        posAttr.setXYZ(0, this.ballPos.x, this.ballPos.y - this.ballRadius, this.ballPos.z);
        posAttr.setXYZ(1, this.ballPos.x, this.tableHeight + 0.002, this.ballPos.z);
        posAttr.needsUpdate = true;
      } else {
        this.altitudeStemLine.visible = false;
      }
    }

    // 3. Update expanding table bounce ripples
    this.updateBounceRipples(dt);

    this.renderer.render(this.scene, this.camera);
  }

  private handleRallyPoint(winner: 1 | 2, reason: string): void {
    this.awardPoint(winner, reason);
  }

  private awardPoint(winner: 1 | 2, reason: string): void {
    if (this.matchOver) return;

    // Strict Rule: When ball bounces on opponent's table half (Z > 0) from player return,
    // if bot misses interception, award point to PLAYER. Under no circumstances award this point to opponent.
    if (this.lastHitter === 'player' && this.bounceCountFar >= 1 && this.rallyState === 'IN_PLAY') {
      winner = 1;
      if (!reason.includes('DOUBLE BOUNCE')) {
        reason = 'POINT PLAYER — OPPONENT DOUBLE BOUNCE / MISSED';
      }
    }

    // Safety guard: Never award point to opponent (2) with player winner reasons
    if (winner === 2 && (reason.includes('WINNER') || reason.includes('POINT PLAYER') || reason.includes('OPPONENT DOUBLE BOUNCE'))) {
      reason = 'POINT OPPONENT';
    }

    this.rallyState = 'POINT_AWARDED';
    this.servePhase = 'NONE';
    this.isBallInPlay = false;
    this.ballVel.set(0, 0, 0);

    if (this.playerBounceTimeout) {
      clearTimeout(this.playerBounceTimeout);
      this.playerBounceTimeout = undefined;
    }
    for (const tid of this.activeTimeouts) clearTimeout(tid);
    this.activeTimeouts = [];

    // Never display "DROPPED ON YOUR SIDE" when the ball bounces at Z > 0.
    // Only show "DROPPED ON YOUR SIDE" if the ball failed to clear the net and died on the player's half (Z < 0).
    const isPlayerUnreturnedBounce =
      this.ballPos.z < 0 &&
      winner === 2 &&
      (
        this.bounceCountNear > 1 ||
        (this.bounceCountNear >= 1 && this.ballPos.y < 0.10) ||
        reason.toLowerCase().includes('double bounce on player side') ||
        reason.toLowerCase().includes('dropped on your side')
      );

    if (isPlayerUnreturnedBounce) {
      reason = 'POINT OPPONENT — DROPPED ON YOUR SIDE';
      this.showFaultBanner('POINT OPPONENT — DROPPED ON YOUR SIDE');
    } else if (winner === 1 && (reason.includes('WINNER') || reason.includes('OPPONENT COURT') || reason.includes('DOUBLE BOUNCE') || reason.includes('POINT PLAYER'))) {
      this.showFaultBanner(reason.includes('DOUBLE BOUNCE') || reason.includes('POINT PLAYER') ? 'POINT PLAYER — OPPONENT DOUBLE BOUNCE / MISSED' : 'WINNER — IN OPPONENT COURT');
    }

    if (winner === 1) {
      this.scoreState.player1Score++;
      this.audio.scoreChime();
    } else {
      this.scoreState.player2Score++;
    }

    this.scoreState.lastPointWinner = winner;
    this.scoreState.lastPointReason = reason;

    const p1 = this.scoreState.player1Score;
    const p2 = this.scoreState.player2Score;

    // Match point & Deuce banner text
    if (p1 >= 10 && p2 >= 10) {
      if (p1 === p2) {
        this.scoreState.matchPointText = `DEUCE (${p1} - ${p2}) • WIN BY 2`;
      } else if (p1 > p2) {
        this.scoreState.matchPointText = `GAME POINT: PLAYER (${p1} - ${p2})`;
      } else {
        this.scoreState.matchPointText = `GAME POINT: AI (${p2} - ${p1})`;
      }
    } else if (p1 >= this.targetScore - 1 && p1 > p2) {
      this.scoreState.matchPointText = `GAME POINT: PLAYER (${p1} - ${p2})`;
    } else if (p2 >= this.targetScore - 1 && p2 > p1) {
      this.scoreState.matchPointText = `GAME POINT: AI (${p2} - ${p1})`;
    } else {
      this.scoreState.matchPointText = undefined;
    }

    // Official ITTF Singles Game Win: First to 11, win by 2
    const p1WonGame = p1 >= this.targetScore && p1 - p2 >= 2;
    const p2WonGame = p2 >= this.targetScore && p2 - p1 >= 2;

    if (p1WonGame || p2WonGame) {
      const gameWinner = p1WonGame ? 1 : 2;
      if (gameWinner === 1) this.player1GamesWon++;
      else this.player2GamesWon++;

      // Check Match Win (Best 3 of 5 games)
      if (this.player1GamesWon >= this.gamesToWinMatch || this.player2GamesWon >= this.gamesToWinMatch) {
        this.matchOver = true;
        this.scoreState.isGameOver = true;
        this.scoreState.winner = gameWinner;
        this.notifyScore();
        return;
      }

      // Game completed, prepare next game
      this.updateStatusDialog(
        gameWinner === 1 ? '🎉 Game Won!' : '🤖 AI Won Game',
        `Games: You ${this.player1GamesWon} - ${this.player2GamesWon} AI. Starting Game ${this.currentGameNumber + 1}...`,
        'over',
        'GAME COMPLETE'
      );
      this.notifyScore();

      const timerId = setTimeout(() => {
        this.currentGameNumber++;
        // Switch initial server for next game
        const nextFirstServer: 1 | 2 = this.initialServerForGame === 1 ? 2 : 1;
        this.startNewGame(nextFirstServer);
      }, 2000);
      this.activeTimeouts.push(timerId);
      return;
    }

    this.rallyState = 'POINT_TRANSITION';
    this.pointTransitionTimer = 1.5;
    this.wristSettledTimer = 0;
    this.isServeArmed = false;
    this.setBallVisibility(false);
    this.smoothedWristVelocity.set(0, 0, 0);
    this.paddleVelocity.set(0, 0, 0);
    this.hasPrevWrist = false;
    this.hasPrevUpperBodyPos = false;
    if (this.playerAvatar) {
      this.playerAvatar.resetVelocities();
    }
    this.updateStatusDialog('⏳ GET READY...', 'Stand in position for next serve (1.5s)...', 'position', 'INTER-POINT');
    this.notifyScore();
  }

  public onAction(event: ActionEvent): void {
    if (this.matchOver || this.isInitialStanceSettling) return;

    if (this.rallyState === 'READY_TO_SERVE' && this.scoreState.currentServer === 1 && this.isServeArmed) {
      // Hand flow serve initiation: allowed in standing posture when not moving front/back
      if (!this.isPostureGated && !this.isStanceRepositioning && this.serveCountdown <= 0) {
        if (event.speedMps >= 1.3 || event.type === 'FOREHAND' || event.type === 'BACKHAND') {
          this.executeMotionServe();
        }
      }
      return;
    }

    if (this.rallyState === 'IN_PLAY' && this.lastHitter !== 'player') {
      const speed = event.speedMps || 2.0;
      this.executePlayerReturn(speed);
    }
  }

  public onResize(w: number, h: number): void {
    if (!this.camera || !this.renderer) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  public getScore(): GameScoreState {
    return { ...this.scoreState };
  }

  public onScoreChange(cb: (score: GameScoreState) => void): () => void {
    this.scoreCallbacks.push(cb);
    return () => {
      this.scoreCallbacks = this.scoreCallbacks.filter(c => c !== cb);
    };
  }

  private notifyScore(): void {
    for (const cb of this.scoreCallbacks) {
      cb({ ...this.scoreState });
    }
  }

  /**
   * Playwright / Debug Bridge API surface
   */
  public getDebugState(): any {
    return {
      rallyState: this.rallyState,
      lastHitter: this.lastHitter,
      isBallInPlay: this.isBallInPlay,
      ballPos: { x: this.ballPos.x, y: this.ballPos.y, z: this.ballPos.z },
      ballVel: { x: this.ballVel.x, y: this.ballVel.y, z: this.ballVel.z },
      ballSpin: { x: this.ballSpin.x, y: this.ballSpin.y, z: this.ballSpin.z },
      bounceCountNear: this.bounceCountNear,
      bounceCountFar: this.bounceCountFar,
      servePhase: this.servePhase,
      scorePlayer: this.scoreState.player1Score,
      scoreOpponent: this.scoreState.player2Score,
      currentServer: this.scoreState.currentServer,
      rallyCount: this.scoreState.rallyCount,
      isGameOver: this.scoreState.isGameOver,
      winner: this.scoreState.winner,
      paddlePos: { x: this.activePaddlePos.x, y: this.activePaddlePos.y, z: this.activePaddlePos.z },
      paddleVel: { x: this.paddleVelocity.x, y: this.paddleVelocity.y, z: this.paddleVelocity.z },
      dominantHand: this.dominantHand,
      gameStartingServer: this.gameStartingServer,
      aiHitCooldown: this.aiHitCooldown,
      aiWillIntercept: this.aiWillIntercept,
      isPostureGated: this.isPostureGated,
      isStanceRepositioning: this.isStanceRepositioning,
      isInitialStanceSettling: this.isInitialStanceSettling,
      startupCountdown: this.startupCountdown,
      isServeArmed: this.isServeArmed,
      pointTransitionTimer: this.pointTransitionTimer
    };
  }

  public debugServe(): void {
    if (this.isInitialStanceSettling) {
      this.isInitialStanceSettling = false;
      this.startupCountdown = 0;
      this.wristSettledTimer = 0.30;
      this.isServeArmed = true;
      this.setBallVisibility(true);
      this.resetServe();
    }
    if (this.rallyState === 'POINT_TRANSITION') {
      this.pointTransitionTimer = 0;
      this.wristSettledTimer = 0.30;
      this.isServeArmed = true;
      this.setBallVisibility(true);
      this.resetServe();
    }
    if (this.rallyState === 'READY_TO_SERVE') {
      this.executeMotionServe();
    }
  }

  public destroy(): void {
    this.isRunning = false;
    if (this.playerBounceTimeout) clearTimeout(this.playerBounceTimeout);
    for (const tid of this.activeTimeouts) clearTimeout(tid);
    this.activeTimeouts = [];

    if (this.keydownHandler) {
      window.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = undefined;
    }
    if (this.pointerMoveHandler) {
      this.container.removeEventListener('mousemove', this.pointerMoveHandler);
      this.pointerMoveHandler = undefined;
    }
    if (this.pointerDownHandler) {
      this.container.removeEventListener('mousedown', this.pointerDownHandler);
      this.pointerDownHandler = undefined;
    }
    if (this.statusDialogEl) {
      this.statusDialogEl.remove();
    }
    if (this.postureModalEl) {
      this.postureModalEl.remove();
      this.postureModalEl = undefined;
    }
    if (this.bounceCalloutEl) {
      this.bounceCalloutEl.remove();
      this.bounceCalloutEl = undefined;
    }
    if (this.faultBannerEl) {
      this.faultBannerEl.remove();
      this.faultBannerEl = undefined;
    }
    if (this.netHitBannerEl) {
      this.netHitBannerEl.remove();
      this.netHitBannerEl = undefined;
    }
    if (this.bounceCalloutTimer) clearTimeout(this.bounceCalloutTimer);
    if (this.faultBannerTimer) clearTimeout(this.faultBannerTimer);
    if (this.netHitBannerTimer) clearTimeout(this.netHitBannerTimer);
    if (this.cameraViewBtn) {
      this.cameraViewBtn.remove();
      this.cameraViewBtn = undefined;
    }
    if (this.aimReticleMesh) {
      this.scene.remove(this.aimReticleMesh);
    }
    if (this.altitudeStemLine) {
      this.scene.remove(this.altitudeStemLine);
      this.altitudeStemGeo?.dispose();
      this.altitudeStemMat?.dispose();
    }
    for (const r of this.bounceRipples) {
      this.scene.remove(r.mesh);
      r.mesh.geometry?.dispose();
      r.mat?.dispose();
    }
    this.bounceRipples = [];
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.domElement.remove();
    }
  }
}
