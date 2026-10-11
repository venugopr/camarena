import * as THREE from 'three';
import { IGameScene, GameScoreState } from '../common/IGameScene';
import {
  GameModeId,
  OpponentMode,
  DifficultyLevel,
  MotionFrame,
  ActionEvent,
  PoseLandmark,
} from '../common/Types';
import { SoundSynthesizer } from '../util/audio/SoundSynthesizer';
import { PunchClassifier, PunchEvent, DefensiveState } from './PunchClassifier';
import { BoxingHUD } from './BoxingHUD';

export type BoxingCameraPreset = 'arcade_ots' | 'first_person';

export type KineticPunchState = 'GUARD' | 'EXTENDING' | 'CONTACT' | 'RETRACTING';

export interface KineticArmRig {
  arm: 'left' | 'right';
  state: KineticPunchState;
  timer: number;
  extendingDuration: number; // 105ms forward strike projection
  contactDuration: number;   // 35ms contact hold
  retractingDuration: number;// 90ms return to guard
  startPos: THREE.Vector3;
  targetPos: THREE.Vector3;
  currentPos: THREE.Vector3;
  targetZone: 'head' | 'body';
  punchEvent: PunchEvent | null;
  hitResolved: boolean;
}

export type OpponentGuardState = 'HIGH_GUARD' | 'LOW_GUARD' | 'WINDUP';

export class BoxingScene implements IGameScene {
  public readonly id: GameModeId = 'boxing';
  public readonly title = 'Arcade Boxing 3D Pro';

  // 1. Rendering & Scene
  private container!: HTMLElement;
  private audio!: SoundSynthesizer;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private animFrameId = 0;

  private opponentMode: OpponentMode = 'system';
  private difficulty: DifficultyLevel = 'casual';
  private dominantHand: 'right' | 'left' = 'right';

  // 2. Horizontal Ringside Broadcast Camera (Televised Side Angle)
  // Positioned at X = -2.25, looking perpendicular to engagement line so both fighters are side-by-side
  private cameraPreset: BoxingCameraPreset = 'arcade_ots';
  private readonly ringsideCameraPos = new THREE.Vector3(-2.60, 1.62, 0.45);
  private readonly ringsideLookTarget = new THREE.Vector3(0.05, 1.35, 0.45);
  private readonly fpCameraPos = new THREE.Vector3(-0.45, 1.58, -0.35);
  private readonly fpLookTarget = new THREE.Vector3(0.45, 1.48, 1.25);

  private currentCameraPos = new THREE.Vector3(-2.60, 1.62, 0.45);
  private currentLookTarget = new THREE.Vector3(0.05, 1.35, 0.45);
  private cameraTrauma = 0;
  private cameraHeadOffset = new THREE.Vector3(0, 0, 0);

  // 3. Fighter Roots (Engagement Line: Player on Left, Opponent on Right)
  // Player at (-0.45, 0, -0.35) angled toward Opponent at (0.45, 0, 1.25)
  private readonly playerRoot = new THREE.Vector3(-0.45, 0, -0.35);
  private readonly opponentRoot = new THREE.Vector3(0.45, 0, 1.25);

  private playerGroup = new THREE.Group();
  private opponentGroup = new THREE.Group();

  // Procedural Boxer Models (Lego-Beveled Athletic Rigs)
  // Player Meshes
  private playerTorsoMesh!: THREE.Mesh;
  private playerHeadMesh!: THREE.Mesh;
  private playerHeadGroup!: THREE.Group;
  private playerLeftArmGroup!: THREE.Group;
  private playerRightArmGroup!: THREE.Group;
  private playerGloveL!: THREE.Group;
  private playerGloveR!: THREE.Group;
  private playerForearmLMesh!: THREE.Mesh;
  private playerForearmRMesh!: THREE.Mesh;
  private playerMatSkin!: THREE.MeshStandardMaterial;
  private playerGloveMat!: THREE.MeshStandardMaterial;

  // Opponent Meshes
  private oppTorsoMesh!: THREE.Mesh;
  private oppTorsoGroup!: THREE.Group;
  private oppHeadMesh!: THREE.Mesh;
  private oppHeadGroup!: THREE.Group;
  private oppLeftArmGroup!: THREE.Group;
  private oppRightArmGroup!: THREE.Group;
  private oppGloveL!: THREE.Group;
  private oppGloveR!: THREE.Group;
  private oppTelegraphGlow!: THREE.Mesh;
  private oppSkinMat!: THREE.MeshStandardMaterial;
  private oppGloveMat!: THREE.MeshStandardMaterial;

  // 4. Kinetic Glove Projection State Machine
  private leftHand: KineticArmRig = {
    arm: 'left',
    state: 'GUARD',
    timer: 0,
    extendingDuration: 0.105, // 105ms
    contactDuration: 0.035,   // 35ms
    retractingDuration: 0.090,// 90ms
    startPos: new THREE.Vector3(-0.16, 1.38, 0.28),
    targetPos: new THREE.Vector3(0.45, 1.58, 1.25),
    currentPos: new THREE.Vector3(-0.16, 1.38, 0.28),
    targetZone: 'head',
    punchEvent: null,
    hitResolved: false,
  };

  private rightHand: KineticArmRig = {
    arm: 'right',
    state: 'GUARD',
    timer: 0,
    extendingDuration: 0.105,
    contactDuration: 0.035,
    retractingDuration: 0.090,
    startPos: new THREE.Vector3(0.16, 1.38, 0.28),
    targetPos: new THREE.Vector3(0.45, 1.58, 1.25),
    currentPos: new THREE.Vector3(0.16, 1.38, 0.28),
    targetZone: 'head',
    punchEvent: null,
    hitResolved: false,
  };

  // Rest Guard Offsets (in Left/Right Arm Group local space)
  private readonly playerGuardL = new THREE.Vector3(0.10, 0.0, 0.32);
  private readonly playerGuardR = new THREE.Vector3(-0.10, 0.0, 0.32);

  // 5. Opponent Guard AI & Reactions
  private oppGuardState: OpponentGuardState = 'HIGH_GUARD';
  private oppGuardTimer = 3.0;
  private oppHeadSnapRot = new THREE.Euler(0, 0, 0);
  private oppTorsoHunchRot = new THREE.Euler(0, 0, 0);
  private oppStaggerOffset = new THREE.Vector3(0, 0, 0);
  private oppIdleTime = 0;
  private oppFlashWhiteTimer = 0;

  // Dual Hurtboxes:
  // - Head Hurtbox: Sphere at (opp.x, 1.58, opp.z), radius = 0.24m
  // - Body Hurtbox: Cylinder at (opp.x, 1.15, opp.z), height = 0.42m, radius = 0.28m
  private readonly headHurtboxRadius = 0.24;
  private readonly bodyHurtboxRadius = 0.28;
  private readonly bodyHurtboxHeight = 0.42;

  // 6. Combat Lifecycle & Invulnerability ($i$-frames)
  private playerHealth = 100;
  private opponentHealth = 100;
  private playerStamina = 100;
  private playerInvulnTimer = 0; // 0.85s grace after taking damage
  private oppInvulnTimer = 0;    // 0.65s grace after taking damage
  private opponentVulnerableTimer = 0; // 1.2s counter window after slip/block

  // 3-Second Pre-Round Countdown
  private roundCountdown = 3.0;
  private isRoundActive = false;
  private isMatchOver = false;
  private matchWinner: 1 | 2 | null = null;
  private currentRound = 1;
  private maxRounds = 3;
  private roundTimeRemaining = 50;

  // Opponent Attack AI (Strikes every 3.0s - 3.8s with 650ms warning tell)
  private oppAttackTimer = 3.4;
  private readonly oppTelegraphDuration = 0.65;
  private oppTelegraphTimer = 0;
  private aiIsTelegraphing = false;
  private aiIsStriking = false;
  private aiStrikeProgress = 0;
  private aiAttackArm: 'left' | 'right' = 'right';

  // 7. Visual FX (Sparks, Yellow Shockwave, Grey Shield Ripple)
  private sparkGeo!: THREE.BufferGeometry;
  private sparkParticles!: THREE.Points;
  private sparkPositions!: Float32Array;
  private sparkVelocities!: Float32Array;
  private sparkColors!: Float32Array;
  private sparkLifetimes!: Float32Array;
  private activeSparkCount = 0;
  private readonly MAX_SPARKS = 140;

  private yellowShockwaveMesh!: THREE.Mesh;
  private yellowShockwaveProgress = 1.0;

  private shieldRippleMesh!: THREE.Mesh;
  private shieldRippleProgress = 1.0;

  private hitStopTimer = 0; // 40ms micro freeze on clean hit

  // 8. Punch Classifier & Broadcast HUD
  private punchClassifier!: PunchClassifier;
  private hud!: BoxingHUD;

  // Stats & Combos
  private comboCount = 0;
  private lastHitTimestamp = 0;
  private totalPlayerHits = 0;

  // 9. Score State
  private scoreState: GameScoreState = {
    player1Score: 0,
    player2Score: 0,
    currentServer: 1,
    rallyCount: 0,
    isGameOver: false,
    winner: null,
    lastPointWinner: null,
    targetScore: 3,
    winByTwo: false,
    gameModeTitle: 'Arcade Boxing 3D Pro',
  };
  private scoreCallbacks: ((score: GameScoreState) => void)[] = [];
  private keydownListener?: (e: KeyboardEvent) => void;

  // Scratch vectors
  private readonly scratchVecA = new THREE.Vector3();
  private readonly scratchVecB = new THREE.Vector3();
  private readonly scratchVecC = new THREE.Vector3();

  init(
    container: HTMLElement,
    audio: SoundSynthesizer,
    config?: {
      opponentMode: OpponentMode;
      difficulty: DifficultyLevel;
      targetScore?: number;
      dominantHand?: 'right' | 'left';
    }
  ): void {
    this.container = container;
    this.audio = audio;
    if (config?.opponentMode) this.opponentMode = config.opponentMode;
    if (config?.difficulty) this.difficulty = config.difficulty;
    if (config?.dominantHand) this.dominantHand = config.dominantHand;

    this.buildThreeScene();
    this.buildBoxingArena();
    this.buildStylizedFighters();
    this.buildImpactParticleSystems();

    this.punchClassifier = new PunchClassifier(this.dominantHand);
    this.hud = new BoxingHUD(this.container);

    this.bindKeyboardShortcuts();
    this.reset();
  }

  // ─── 1. Three.js Scene & Horizontal Ringside Broadcast Camera ─────────────

  private buildThreeScene(): void {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x060812);
    this.scene.fog = new THREE.FogExp2(0x060812, 0.035);

    // Elevated horizontal ringside broadcast perspective (48°-55° off-axis):
    // camera.position.set(-2.05, 1.62, -1.10); lookAt(0.12, 1.35, 0.40); fov: 50
    this.camera = new THREE.PerspectiveCamera(
      50,
      this.container.clientWidth / this.container.clientHeight,
      0.05,
      100
    );
    this.camera.position.copy(this.ringsideCameraPos);
    this.camera.lookAt(this.ringsideLookTarget);
  }

  // ─── 2. 3D Championship Boxing Arena ──────────────────────────────────────

  private buildBoxingArena(): void {
    // Canvas Mat (5.8m x 5.8m square)
    const matGeo = new THREE.PlaneGeometry(5.8, 5.8);
    const matMat = new THREE.MeshStandardMaterial({
      color: 0x181c2b,
      roughness: 0.88,
      metalness: 0.08,
    });
    const matMesh = new THREE.Mesh(matGeo, matMat);
    matMesh.rotation.x = -Math.PI / 2;
    matMesh.receiveShadow = true;
    this.scene.add(matMesh);

    // Outer Wooden Apron
    const apronGeo = new THREE.BoxGeometry(6.6, 0.40, 6.6);
    const apronMat = new THREE.MeshStandardMaterial({ color: 0x0a0c16, roughness: 0.65 });
    const apronMesh = new THREE.Mesh(apronGeo, apronMat);
    apronMesh.position.y = -0.20;
    apronMesh.receiveShadow = true;
    this.scene.add(apronMesh);

    // Center CamArena Ring Decal
    const ringCircle = new THREE.Mesh(
      new THREE.RingGeometry(1.65, 1.72, 48),
      new THREE.MeshBasicMaterial({ color: 0x00f2fe, side: THREE.DoubleSide, opacity: 0.5, transparent: true })
    );
    ringCircle.rotation.x = -Math.PI / 2;
    ringCircle.position.y = 0.005;
    this.scene.add(ringCircle);

    // 4 Corner Turnbuckle Posts
    const postMatRed = new THREE.MeshStandardMaterial({ color: 0xd62828, metalness: 0.65, roughness: 0.25 });
    const postMatBlue = new THREE.MeshStandardMaterial({ color: 0x0077b6, metalness: 0.65, roughness: 0.25 });
    const postMatWhite = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.45, roughness: 0.35 });

    const postCorners = [
      { x: -2.5, z: -2.5, mat: postMatBlue }, // Player corner
      { x:  2.5, z:  2.5, mat: postMatRed  }, // Opponent corner
      { x: -2.5, z:  2.5, mat: postMatWhite },
      { x:  2.5, z: -2.5, mat: postMatWhite },
    ];

    postCorners.forEach((c) => {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.95, 16), c.mat);
      post.position.set(c.x, 0.975, c.z);
      post.castShadow = true;
      this.scene.add(post);

      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1.45, 16), c.mat);
      pad.position.set(c.x * 0.96, 0.95, c.z * 0.96);
      this.scene.add(pad);
    });

    // 4 Rows of Heavy Ring Ropes
    const ropeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 });
    const ropeHeights = [0.48, 0.82, 1.16, 1.50];
    const half = 2.40;

    ropeHeights.forEach((rh) => {
      const segs = [
        { start: new THREE.Vector3(-half, rh, -half), end: new THREE.Vector3(half, rh, -half) },
        { start: new THREE.Vector3(half, rh, -half), end: new THREE.Vector3(half, rh, half) },
        { start: new THREE.Vector3(half, rh, half), end: new THREE.Vector3(-half, rh, half) },
        { start: new THREE.Vector3(-half, rh, half), end: new THREE.Vector3(-half, rh, -half) },
      ];

      segs.forEach((s) => {
        const len = s.start.distanceTo(s.end);
        const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, len, 12), ropeMat);
        const mid = s.start.clone().add(s.end).multiplyScalar(0.5);
        rope.position.copy(mid);
        rope.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), s.end.clone().sub(s.start).normalize());
        this.scene.add(rope);
      });
    });

    // Overhead Stadium Lighting
    const ambLight = new THREE.AmbientLight(0xffffff, 0.72);
    this.scene.add(ambLight);

    const keyLight = new THREE.SpotLight(0xfff5e6, 3.2, 28, Math.PI / 4, 0.42, 1.2);
    keyLight.position.set(0, 7.2, 0.4);
    keyLight.target.position.set(0, 1.2, 0.4);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    this.scene.add(keyLight);
    this.scene.add(keyLight.target);

    // Cyan & Red Accent Rim Lights
    const rimPlayer = new THREE.PointLight(0x00f2fe, 2.4, 8);
    rimPlayer.position.set(-2.8, 2.4, -1.2);
    this.scene.add(rimPlayer);

    const rimOpp = new THREE.PointLight(0xff0044, 2.8, 8);
    rimOpp.position.set(2.8, 2.4, 2.2);
    this.scene.add(rimOpp);

    // Atmospheric Stadium Floating Dust Particles
    const dustCount = 80;
    const dustGeo = new THREE.BufferGeometry();
    const dustPos = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      dustPos[i * 3 + 0] = (Math.random() - 0.5) * 6.5;
      dustPos[i * 3 + 1] = 0.5 + Math.random() * 3.5;
      dustPos[i * 3 + 2] = (Math.random() - 0.5) * 6.5;
    }
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    const dustMat = new THREE.PointsMaterial({
      color: 0xffe082,
      size: 0.045,
      transparent: true,
      opacity: 0.65,
    });
    const dustPoints = new THREE.Points(dustGeo, dustMat);
    this.scene.add(dustPoints);
  }

  // ─── 3. Stylized Athletic / Lego-Beveled Boxer Geometries ──────────────────

  private buildStylizedFighters(): void {
    // Engagement line vector: from player (-0.32, 0, -0.20) to opponent (0.32, 0, 1.05)
    const diff = this.opponentRoot.clone().sub(this.playerRoot);
    const angleToOpponent = Math.atan2(diff.x, diff.z);
    const angleToPlayer = Math.atan2(-diff.x, -diff.z);

    // A. Player Rig (Stationed on Left side: -0.32, 0, -0.20)
    this.playerGroup.position.copy(this.playerRoot);
    this.playerGroup.rotation.y = angleToOpponent;
    this.scene.add(this.playerGroup);

    this.playerMatSkin = new THREE.MeshStandardMaterial({
      color: 0xdeb887,
      roughness: 0.45,
      metalness: 0.12,
    });
    this.playerGloveMat = new THREE.MeshStandardMaterial({
      color: 0x00f2fe, // Metallic Cyan
      roughness: 0.22,
      metalness: 0.65,
    });
    const playerTrunksMat = new THREE.MeshStandardMaterial({
      color: 0x003566,
      roughness: 0.32,
      metalness: 0.45,
    });
    const playerHeadgearMat = new THREE.MeshStandardMaterial({
      color: 0x0077b6,
      roughness: 0.35,
      metalness: 0.40,
    });
    const goldWaistbandMat = new THREE.MeshStandardMaterial({
      color: 0xffd166,
      roughness: 0.25,
      metalness: 0.75,
    });
    const whiteWrapMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const bootMat = new THREE.MeshStandardMaterial({ color: 0x111116, roughness: 0.6 });

    this.buildBoxerModel(
      this.playerGroup,
      this.playerMatSkin,
      this.playerGloveMat,
      playerTrunksMat,
      playerHeadgearMat,
      goldWaistbandMat,
      whiteWrapMat,
      bootMat,
      true // isPlayer
    );

    // B. Opponent Rig (Stationed on Right side: 0.32, 0, 1.05)
    this.opponentGroup.position.copy(this.opponentRoot);
    this.opponentGroup.rotation.y = angleToPlayer;
    this.scene.add(this.opponentGroup);

    this.oppSkinMat = new THREE.MeshStandardMaterial({
      color: 0xc68642,
      roughness: 0.45,
      metalness: 0.12,
    });
    this.oppGloveMat = new THREE.MeshStandardMaterial({
      color: 0xdc2626, // Crimson Red
      roughness: 0.22,
      metalness: 0.55,
    });
    const oppTrunksMat = new THREE.MeshStandardMaterial({
      color: 0x990000,
      roughness: 0.30,
      metalness: 0.45,
    });
    const oppHeadgearMat = new THREE.MeshStandardMaterial({
      color: 0xba181b,
      roughness: 0.35,
      metalness: 0.40,
    });

    this.buildBoxerModel(
      this.opponentGroup,
      this.oppSkinMat,
      this.oppGloveMat,
      oppTrunksMat,
      oppHeadgearMat,
      goldWaistbandMat,
      whiteWrapMat,
      bootMat,
      false // isOpponent
    );

    // Opponent Red Glowing Windup Tell (650ms warning tell)
    const glowGeo = new THREE.SphereGeometry(0.24, 16, 16);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xff1100,
      transparent: true,
      opacity: 0.85,
      wireframe: true,
    });
    this.oppTelegraphGlow = new THREE.Mesh(glowGeo, glowMat);
    this.oppTelegraphGlow.visible = false;
    this.oppRightArmGroup.add(this.oppTelegraphGlow);
  }

  /**
   * Constructs an athletic, Lego-beveled stylized boxer with sculpted V-taper torso,
   * contoured headgear, cheek guards, deltoid caps, and curved boxing gloves.
   */
  private buildBoxerModel(
    rootGroup: THREE.Group,
    skinMat: THREE.MeshStandardMaterial,
    gloveMat: THREE.MeshStandardMaterial,
    trunksMat: THREE.MeshStandardMaterial,
    headgearMat: THREE.MeshStandardMaterial,
    waistbandMat: THREE.MeshStandardMaterial,
    whiteMat: THREE.Material,
    bootMat: THREE.MeshStandardMaterial,
    isPlayer: boolean
  ): void {
    // 1. Torso Group
    const torsoGroup = new THREE.Group();
    torsoGroup.position.y = 1.15;
    rootGroup.add(torsoGroup);

    // Sculpted V-Taper Athletic Upper Torso
    const torsoMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.18, 0.42, 18),
      skinMat
    );
    torsoMesh.position.y = 0.08;
    torsoGroup.add(torsoMesh);

    // Sculpted Pectoral Muscles (+Z forward in boxer local space)
    const pecGeo = new THREE.BoxGeometry(0.15, 0.11, 0.08);
    const pecL = new THREE.Mesh(pecGeo, skinMat);
    pecL.position.set(-0.085, 0.14, 0.14);
    const pecR = new THREE.Mesh(pecGeo, skinMat);
    pecR.position.set(0.085, 0.14, 0.14);
    torsoGroup.add(pecL, pecR);

    // Sculpted 6-Pack Abdominals
    const abGeo = new THREE.BoxGeometry(0.07, 0.065, 0.05);
    for (let r = 0; r < 3; r++) {
      const y = 0.03 - r * 0.075;
      const abL = new THREE.Mesh(abGeo, skinMat);
      abL.position.set(-0.045, y, 0.13);
      const abR = new THREE.Mesh(abGeo, skinMat);
      abR.position.set(0.045, y, 0.13);
      torsoGroup.add(abL, abR);
    }

    // Broad Deltoid Shoulders
    const deltoidGeo = new THREE.SphereGeometry(0.11, 16, 16);
    const deltoidL = new THREE.Mesh(deltoidGeo, skinMat);
    deltoidL.position.set(-0.27, 0.22, 0);
    const deltoidR = new THREE.Mesh(deltoidGeo, skinMat);
    deltoidR.position.set(0.27, 0.22, 0);
    torsoGroup.add(deltoidL, deltoidR);

    // 2. Neck & Head Group
    const headGroup = new THREE.Group();
    headGroup.position.y = 0.46;

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.14, 14), skinMat);
    neck.position.y = -0.10;
    headGroup.add(neck);

    // Rounded Cranium Head
    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.135, 18, 18), skinMat);
    headMesh.scale.set(1.0, 1.12, 1.05);
    headGroup.add(headMesh);

    // Boxing Headgear (Helmet Crown + Cheek Guards)
    const crown = new THREE.Mesh(
      new THREE.SphereGeometry(0.142, 18, 18, 0, Math.PI * 2, 0, Math.PI * 0.58),
      headgearMat
    );
    crown.position.y = 0.01;
    headGroup.add(crown);

    const cheekGeo = new THREE.BoxGeometry(0.05, 0.12, 0.11);
    const cheekL = new THREE.Mesh(cheekGeo, headgearMat);
    cheekL.position.set(-0.115, -0.02, 0.08);
    const cheekR = new THREE.Mesh(cheekGeo, headgearMat);
    cheekR.position.set(0.115, -0.02, 0.08);
    headGroup.add(cheekL, cheekR);

    // Eyes with Pupils
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    const eyeGeo = new THREE.SphereGeometry(0.018, 10, 10);
    const pupilGeo = new THREE.SphereGeometry(0.009, 8, 8);

    const eyeL = new THREE.Mesh(eyeGeo, whiteMat);
    eyeL.position.set(-0.045, 0.03, 0.13);
    const pupL = new THREE.Mesh(pupilGeo, pupilMat);
    pupL.position.set(-0.045, 0.03, 0.144);

    const eyeR = new THREE.Mesh(eyeGeo, whiteMat);
    eyeR.position.set(0.045, 0.03, 0.13);
    const pupR = new THREE.Mesh(pupilGeo, pupilMat);
    pupR.position.set(0.045, 0.03, 0.144);

    headGroup.add(eyeL, pupL, eyeR, pupR);

    // Boxer Jaw & Mouthguard
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.065, 0.09), skinMat);
    jaw.position.set(0, -0.085, 0.07);
    const mouthguard = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.025), whiteMat);
    mouthguard.position.set(0, -0.045, 0.135);
    headGroup.add(jaw, mouthguard);

    torsoGroup.add(headGroup);

    // 3. Satin Trunks & Athletic Legs
    const waistband = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.21, 0.09, 18), waistbandMat);
    waistband.position.y = 0.94;
    rootGroup.add(waistband);

    const trunks = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.25, 0.34, 18), trunksMat);
    trunks.position.y = 0.74;
    rootGroup.add(trunks);

    const legGeo = new THREE.CylinderGeometry(0.08, 0.068, 0.42, 14);
    const bootGeo = new THREE.BoxGeometry(0.12, 0.15, 0.22);

    const legL = new THREE.Mesh(legGeo, skinMat);
    legL.position.set(-0.115, 0.36, 0);
    const bootL = new THREE.Mesh(bootGeo, bootMat);
    bootL.position.set(-0.115, 0.075, 0.03);
    rootGroup.add(legL, bootL);

    const legR = new THREE.Mesh(legGeo, skinMat);
    legR.position.set(0.115, 0.36, 0);
    const bootR = new THREE.Mesh(bootGeo, bootMat);
    bootR.position.set(0.115, 0.075, 0.03);
    rootGroup.add(legR, bootR);

    // 4. Arms & 16oz Boxing Gloves
    const leftArmGroup = new THREE.Group();
    leftArmGroup.position.set(-0.25, 1.38, 0);
    rootGroup.add(leftArmGroup);

    const rightArmGroup = new THREE.Group();
    rightArmGroup.position.set(0.25, 1.38, 0);
    rootGroup.add(rightArmGroup);

    const gloveL = this.createErgonomicGlove(gloveMat, whiteMat);
    const gloveR = this.createErgonomicGlove(gloveMat, whiteMat);

    // Guard Rest Positions (+Z forward in boxer local space)
    gloveL.position.set(0.10, 0.0, 0.28);
    gloveR.position.set(-0.10, 0.0, 0.28);
    leftArmGroup.add(gloveL);
    rightArmGroup.add(gloveR);

    // Forearms linking shoulders to gloves
    const forearmGeo = new THREE.CylinderGeometry(0.042, 0.048, 0.30, 12);
    const forearmL = new THREE.Mesh(forearmGeo, skinMat);
    forearmL.position.set(0.05, 0.0, 0.14);
    forearmL.rotation.x = Math.PI / 2;
    leftArmGroup.add(forearmL);

    const forearmR = new THREE.Mesh(forearmGeo, skinMat);
    forearmR.position.set(-0.05, 0.0, 0.14);
    forearmR.rotation.x = Math.PI / 2;
    rightArmGroup.add(forearmR);

    // Assign References
    if (isPlayer) {
      this.playerTorsoMesh = torsoMesh;
      this.playerHeadMesh = headMesh;
      this.playerHeadGroup = headGroup;
      this.playerLeftArmGroup = leftArmGroup;
      this.playerRightArmGroup = rightArmGroup;
      this.playerGloveL = gloveL;
      this.playerGloveR = gloveR;
      this.playerForearmLMesh = forearmL;
      this.playerForearmRMesh = forearmR;
    } else {
      this.oppTorsoMesh = torsoMesh;
      this.oppTorsoGroup = torsoGroup;
      this.oppHeadMesh = headMesh;
      this.oppHeadGroup = headGroup;
      this.oppLeftArmGroup = leftArmGroup;
      this.oppRightArmGroup = rightArmGroup;
      this.oppGloveL = gloveL;
      this.oppGloveR = gloveR;
    }
  }

  /**
   * Creates an ergonomic curved 16oz boxing glove with padded knuckles, curved thumb,
   * palm contour, and white laced wrist wrap collar.
   */
  private createErgonomicGlove(gloveMat: THREE.Material, wrapMat: THREE.Material): THREE.Group {
    const group = new THREE.Group();

    // Knuckle & Hand Main Cushion (Radius 0.11m)
    const mainPillow = new THREE.Mesh(new THREE.SphereGeometry(0.11, 18, 18), gloveMat);
    mainPillow.scale.set(1.0, 1.15, 1.25);
    group.add(mainPillow);

    // Curved Boxing Thumb
    const thumb = new THREE.Mesh(new THREE.SphereGeometry(0.046, 12, 12), gloveMat);
    thumb.position.set(-0.075, -0.02, 0.04);
    thumb.scale.set(1.2, 0.8, 1.5);
    group.add(thumb);

    // White Wrist Wrap Cuff
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.075, 16), wrapMat);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.z = -0.09;
    group.add(cuff);

    return group;
  }

  // ─── 4. Particle Systems & Impact Shaders ─────────────────────────────────

  private buildImpactParticleSystems(): void {
    // A. Sweat & Spark Particles
    this.sparkGeo = new THREE.BufferGeometry();
    this.sparkPositions = new Float32Array(this.MAX_SPARKS * 3);
    this.sparkVelocities = new Float32Array(this.MAX_SPARKS * 3);
    this.sparkColors = new Float32Array(this.MAX_SPARKS * 3);
    this.sparkLifetimes = new Float32Array(this.MAX_SPARKS);

    this.sparkGeo.setAttribute('position', new THREE.BufferAttribute(this.sparkPositions, 3));
    this.sparkGeo.setAttribute('color', new THREE.BufferAttribute(this.sparkColors, 3));

    const sparkMat = new THREE.PointsMaterial({
      size: 0.075,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
    });
    this.sparkParticles = new THREE.Points(this.sparkGeo, sparkMat);
    this.scene.add(this.sparkParticles);

    // B. Yellow Body Shockwave Ring
    const yellowRingGeo = new THREE.RingGeometry(0.05, 0.16, 24);
    const yellowRingMat = new THREE.MeshBasicMaterial({
      color: 0xffd700,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
    });
    this.yellowShockwaveMesh = new THREE.Mesh(yellowRingGeo, yellowRingMat);
    this.yellowShockwaveMesh.visible = false;
    this.scene.add(this.yellowShockwaveMesh);

    // C. Grey/Blue Shield Ripple on Guarded Hits
    const shieldRingGeo = new THREE.RingGeometry(0.05, 0.18, 24);
    const shieldRingMat = new THREE.MeshBasicMaterial({
      color: 0x94a3b8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
    });
    this.shieldRippleMesh = new THREE.Mesh(shieldRingGeo, shieldRingMat);
    this.shieldRippleMesh.visible = false;
    this.scene.add(this.shieldRippleMesh);
  }

  private triggerSweatBurst(origin: THREE.Vector3, isCrit = false): void {
    const count = isCrit ? 40 : 22;
    const baseColor = isCrit ? [1.0, 0.85, 0.2] : [0.95, 0.95, 1.0];

    for (let i = 0; i < count; i++) {
      if (this.activeSparkCount >= this.MAX_SPARKS) break;
      const idx = this.activeSparkCount;

      this.sparkPositions[idx * 3 + 0] = origin.x;
      this.sparkPositions[idx * 3 + 1] = origin.y;
      this.sparkPositions[idx * 3 + 2] = origin.z;

      const angle = Math.random() * Math.PI * 2;
      const speed = 2.0 + Math.random() * (isCrit ? 5.5 : 3.5);
      this.sparkVelocities[idx * 3 + 0] = Math.cos(angle) * speed;
      this.sparkVelocities[idx * 3 + 1] = 0.8 + Math.random() * 2.5;
      this.sparkVelocities[idx * 3 + 2] = Math.sin(angle) * speed;

      this.sparkColors[idx * 3 + 0] = baseColor[0];
      this.sparkColors[idx * 3 + 1] = baseColor[1];
      this.sparkColors[idx * 3 + 2] = baseColor[2];

      this.sparkLifetimes[idx] = 0.35 + Math.random() * 0.25;
      this.activeSparkCount++;
    }
    this.sparkGeo.attributes.position.needsUpdate = true;
    this.sparkGeo.attributes.color.needsUpdate = true;
  }

  private triggerBodyShockwave(pos: THREE.Vector3): void {
    this.yellowShockwaveMesh.position.copy(pos);
    this.yellowShockwaveMesh.quaternion.copy(this.camera.quaternion);
    this.yellowShockwaveMesh.scale.set(1, 1, 1);
    this.yellowShockwaveMesh.visible = true;
    this.yellowShockwaveProgress = 0.0;
  }

  private triggerShieldRipple(pos: THREE.Vector3): void {
    this.shieldRippleMesh.position.copy(pos);
    this.shieldRippleMesh.quaternion.copy(this.camera.quaternion);
    this.shieldRippleMesh.scale.set(1, 1, 1);
    this.shieldRippleMesh.visible = true;
    this.shieldRippleProgress = 0.0;
  }

  // ─── 5. Keyboard & Synthetic Controls ─────────────────────────────────────

  private bindKeyboardShortcuts(): void {
    this.keydownListener = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'c') {
        this.cameraPreset = this.cameraPreset === 'arcade_ots' ? 'first_person' : 'arcade_ots';
        this.hud.showCallout(
          this.cameraPreset === 'first_person' ? '📷 FIRST-PERSON VIEW' : '📷 RINGSIDE BROADCAST VIEW',
          '#00f2fe'
        );
      } else if (k === 'r') {
        this.reset();
      } else if (k === '1') {
        this.punchClassifier.triggerSyntheticPunch('JAB', 5.5, 'left', 'head');
      } else if (k === '2') {
        this.punchClassifier.triggerSyntheticPunch('CROSS', 6.2, 'right', 'head');
      } else if (k === '3') {
        this.punchClassifier.triggerSyntheticPunch('LEFT_HOOK', 5.8, 'left', 'body');
      } else if (k === '4') {
        this.punchClassifier.triggerSyntheticPunch('RIGHT_HOOK', 6.0, 'right', 'body');
      } else if (k === 'b') {
        this.punchClassifier.triggerSyntheticDefense('HIGH_GUARD');
        this.hud.showCallout('🛡️ HIGH GUARD RAISED', '#00f2fe');
      } else if (k === 's') {
        this.punchClassifier.triggerSyntheticDefense('SLIP_LEFT');
        this.hud.showCallout('⚡ SLIPPED LATERAL EVASION!', '#ffd700');
      }
    };
    window.addEventListener('keydown', this.keydownListener);
  }

  // ─── 6. Reset & Pre-Round Countdown ───────────────────────────────────────

  reset(): void {
    this.playerHealth = 100;
    this.opponentHealth = 100;
    this.playerStamina = 100;
    this.playerInvulnTimer = 0;
    this.oppInvulnTimer = 0;
    this.opponentVulnerableTimer = 0;

    this.roundCountdown = 3.0; // 3-second pre-fight countdown
    this.isRoundActive = false;
    this.isMatchOver = false;
    this.matchWinner = null;
    this.currentRound = 1;
    this.roundTimeRemaining = 50;

    this.oppGuardState = 'HIGH_GUARD';
    this.oppGuardTimer = 3.0;
    this.oppAttackTimer = 3.4;
    this.oppTelegraphTimer = 0;
    this.aiIsTelegraphing = false;
    this.aiIsStriking = false;
    this.aiStrikeProgress = 0;
    if (this.oppTelegraphGlow) this.oppTelegraphGlow.visible = false;
    this.hud.hideTelegraph();

    // Reset Kinetic Hands to guard positions
    this.leftHand.state = 'GUARD';
    this.leftHand.timer = 0;
    this.leftHand.punchEvent = null;
    this.rightHand.state = 'GUARD';
    this.rightHand.timer = 0;
    this.rightHand.punchEvent = null;

    if (this.playerGloveL) this.playerGloveL.position.copy(this.playerGuardL);
    if (this.playerGloveR) this.playerGloveR.position.copy(this.playerGuardR);

    // Reset Opponent Staggers
    this.oppHeadSnapRot.set(0, 0, 0);
    this.oppTorsoHunchRot.set(0, 0, 0);
    this.oppStaggerOffset.set(0, 0, 0);

    // Reset Scoreboard State
    this.scoreState = {
      player1Score: 0,
      player2Score: 0,
      currentServer: 1,
      rallyCount: 0,
      isGameOver: false,
      winner: null,
      lastPointWinner: null,
      targetScore: 3,
      winByTwo: false,
      gameModeTitle: 'Arcade Boxing 3D Pro',
    };
    this.scoreCallbacks.forEach((cb) => cb(this.scoreState));

    // Dismiss any modals and ensure clean top-nav
    const victoryModal = document.getElementById('victory-modal-overlay');
    if (victoryModal) victoryModal.style.display = 'none';

    const topNav = document.querySelector('.top-nav');
    if (topNav) topNav.classList.add('in-match');

    const scoreWrapper = document.querySelector('.score-wrapper') as HTMLElement;
    if (scoreWrapper) scoreWrapper.style.display = 'none';
  }

  // ─── 7. Simulation Frame Loop (60+ FPS) ───────────────────────────────────

  update(dt: number, frame: MotionFrame | null): void {
    // Hit-Stop Micro-Freeze (40ms)
    if (this.hitStopTimer > 0) {
      this.hitStopTimer -= dt;
      if (this.renderer && this.scene && this.camera) {
        this.renderer.render(this.scene, this.camera);
      }
      return;
    }

    this.oppIdleTime += dt;

    // 1. Pre-Round 3-Second Countdown
    if (this.roundCountdown > 0) {
      this.roundCountdown -= dt;
      if (this.roundCountdown <= 0) {
        this.roundCountdown = 0;
        this.isRoundActive = true;
        this.hud.showCountdown(this.currentRound, 'FIGHT!');
        this.audio.boxingBellRing(1);
        this.audio.boxingCrowdRoar(0.9);
        setTimeout(() => this.hud.hideCountdown(), 750);
        this.hud.showCallout('🔔 ROUND 1 — FIGHT!', '#ffd700');
      } else if (this.roundCountdown > 2.0) {
        this.hud.showCountdown(this.currentRound, '3');
      } else if (this.roundCountdown > 1.0) {
        this.hud.showCountdown(this.currentRound, '2');
      } else {
        this.hud.showCountdown(this.currentRound, '1');
      }
    } else if (this.isRoundActive && !this.isMatchOver) {
      this.roundTimeRemaining = Math.max(0, this.roundTimeRemaining - dt);
      if (this.roundTimeRemaining <= 0) {
        this.advanceRound();
      }
    }

    // 2. Invulnerability Timer Decays
    if (this.playerInvulnTimer > 0) {
      this.playerInvulnTimer = Math.max(0, this.playerInvulnTimer - dt);
    }
    if (this.oppInvulnTimer > 0) {
      this.oppInvulnTimer = Math.max(0, this.oppInvulnTimer - dt);
      if (this.oppInvulnTimer <= 0) {
        this.oppSkinMat.color.setHex(0xc68642);
      }
    }
    if (this.opponentVulnerableTimer > 0) {
      this.opponentVulnerableTimer = Math.max(0, this.opponentVulnerableTimer - dt);
    }

    // 3. Pose Evaluation & Punch Classification
    const { punch, defense } = this.punchClassifier.update(
      frame,
      performance.now(),
      this.isRoundActive && !this.isMatchOver
    );

    if (this.isRoundActive && !this.isMatchOver && punch) {
      this.triggerKineticPunch(punch);
    }

    // 4. Update Kinetic Punches
    this.updateKineticArm(this.leftHand, dt, this.playerGloveL, this.playerForearmLMesh);
    this.updateKineticArm(this.rightHand, dt, this.playerGloveR, this.playerForearmRMesh);

    // 5. Dynamic AI Guard & Attacks
    if (this.isRoundActive && !this.isMatchOver) {
      this.updateOpponentAI(dt, defense);
    }

    // 6. Visual Mesh Animations
    this.updateOpponentVisuals(dt);
    this.updateParticlesAndShaders(dt);
    this.updateCamera(dt, defense);

    // 7. Update Broadcast HUD
    this.hud.update({
      playerHealth: this.playerHealth,
      maxPlayerHealth: 100,
      opponentHealth: this.opponentHealth,
      maxOpponentHealth: 100,
      stamina: this.playerStamina,
      round: this.currentRound,
      maxRounds: this.maxRounds,
      roundTimeLeft: this.roundTimeRemaining,
      comboCount: this.comboCount,
      cameraPreset: this.cameraPreset,
    });

    // 8. Render Frame
    this.renderer.render(this.scene, this.camera);
  }

  // ─── 8. Kinetic Strike Extension (Z/X Reach Projection) ───────────────────

  private triggerKineticPunch(event: PunchEvent): void {
    const isLeft = event.arm === 'left';
    const rig = isLeft ? this.leftHand : this.rightHand;

    // Reject if already in active punch
    if (rig.state !== 'GUARD') return;

    rig.punchEvent = event;
    rig.state = 'EXTENDING';
    rig.timer = 0;
    rig.hitResolved = false;

    // Directional Height Routing:
    // High punch (Y >= 1.38m): targets Opponent Head Hurtbox (Y = 1.58m)
    // Low punch (Y < 1.38m): targets Opponent Body Hurtbox (Y = 1.15m)
    const isHead = event.target === 'head' || event.target === 'chin' || event.target === 'jaw';
    rig.targetZone = isHead ? 'head' : 'body';

    // Target position in Boxer Local Space
    // Opponent is at distance ~1.83m along +Z in player's local space
    const targetY = isHead ? 0.20 : -0.23;
    rig.targetPos.set(isLeft ? -0.06 : 0.06, targetY, 1.76);

    this.audio.boxingPunchWhoosh(event.speedMps / 6.0);
  }

  private updateKineticArm(
    rig: KineticArmRig,
    dt: number,
    gloveMesh: THREE.Group,
    forearmMesh: THREE.Mesh
  ): void {
    const restPos = rig.arm === 'left' ? this.playerGuardL : this.playerGuardR;

    if (rig.state === 'GUARD') {
      gloveMesh.position.lerp(restPos, dt * 10);
    } else if (rig.state === 'EXTENDING') {
      rig.timer += dt;
      const progress = Math.min(1.0, rig.timer / rig.extendingDuration);
      gloveMesh.position.lerpVectors(restPos, rig.targetPos, Math.sin(progress * Math.PI * 0.5));

      if (progress >= 1.0) {
        rig.state = 'CONTACT';
        rig.timer = 0;
        this.resolvePlayerPunchContact(rig);
      }
    } else if (rig.state === 'CONTACT') {
      rig.timer += dt;
      gloveMesh.position.copy(rig.targetPos);
      if (rig.timer >= rig.contactDuration) {
        rig.state = 'RETRACTING';
        rig.timer = 0;
      }
    } else if (rig.state === 'RETRACTING') {
      rig.timer += dt;
      const progress = Math.min(1.0, rig.timer / rig.retractingDuration);
      gloveMesh.position.lerpVectors(rig.targetPos, restPos, progress);

      if (progress >= 1.0) {
        rig.state = 'GUARD';
        rig.timer = 0;
        rig.punchEvent = null;
      }
    }

    // Forearm extends from shoulder (0,0,0) to glove
    const midX = gloveMesh.position.x * 0.5;
    const midY = gloveMesh.position.y * 0.5;
    const midZ = gloveMesh.position.z * 0.5;
    forearmMesh.position.set(midX, midY, midZ);
    const armLen = gloveMesh.position.length();
    forearmMesh.scale.set(1, Math.max(0.4, armLen / 0.32), 1);
    forearmMesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      gloveMesh.position.clone().normalize()
    );
  }

  // ─── 9. Dual Hurtbox & Guard Collision Resolution ─────────────────────────

  private resolvePlayerPunchContact(rig: KineticArmRig): void {
    if (rig.hitResolved) return;
    rig.hitResolved = true;

    // Check Opponent Invulnerability Window ($i-frame)
    if (this.oppInvulnTimer > 0) return;

    const isTargetingHead = rig.targetZone === 'head';
    const isCrit = this.opponentVulnerableTimer > 0 || this.oppGuardState === 'WINDUP';
    const critMult = isCrit ? 2.0 : 1.0;

    // Contact position in world coordinates
    const worldImpact = this.opponentRoot.clone();
    worldImpact.y = isTargetingHead ? 1.58 : 1.15;

    if (isTargetingHead) {
      if (this.oppGuardState === 'HIGH_GUARD') {
        // Head punch blocked by High Guard!
        const dmg = 3;
        this.opponentHealth = Math.max(0, this.opponentHealth - dmg);
        this.oppInvulnTimer = 0.55;
        this.audio.boxingGloveBlock();
        this.triggerShieldRipple(worldImpact);
        this.hud.showCallout('🛡️ GUARDED -3 HP', '#94a3b8');
      } else {
        // Clean Head Strike!
        const dmg = Math.round(18 * critMult);
        this.opponentHealth = Math.max(0, this.opponentHealth - dmg);
        this.oppInvulnTimer = 0.65;
        this.totalPlayerHits++;
        this.comboCount++;
        this.oppSkinMat.color.setHex(0xffffff); // White flash
        this.audio.boxingPunchImpact(1.15, true, isCrit);
        this.triggerSweatBurst(worldImpact, isCrit);
        this.oppHeadSnapRot.x = -0.32; // Head snaps back
        this.oppStaggerOffset.z += 0.08;
        this.hitStopTimer = 0.040; // 40ms hit freeze
        this.addCameraTrauma(0.25);

        const banner = isCrit ? `🔥 CRITICAL HEAD JAB -${dmg} HP!` : `💥 HEAD JAB -${dmg} HP`;
        this.hud.showCallout(banner, isCrit ? '#ffd700' : '#00f2fe');
        this.hud.showCombo(this.comboCount);
      }
    } else {
      // Targeting Body
      if (this.oppGuardState === 'LOW_GUARD') {
        // Body punch blocked by Low Guard!
        const dmg = 3;
        this.opponentHealth = Math.max(0, this.opponentHealth - dmg);
        this.oppInvulnTimer = 0.55;
        this.audio.boxingGloveBlock();
        this.triggerShieldRipple(worldImpact);
        this.hud.showCallout('🛡️ GUARDED -3 HP', '#94a3b8');
      } else {
        // Clean Body Blow!
        const dmg = Math.round(22 * critMult);
        this.opponentHealth = Math.max(0, this.opponentHealth - dmg);
        this.oppInvulnTimer = 0.65;
        this.totalPlayerHits++;
        this.comboCount++;
        this.oppSkinMat.color.setHex(0xffffff);
        this.audio.boxingPunchImpact(0.85, false, isCrit);
        this.triggerBodyShockwave(worldImpact);
        this.oppTorsoHunchRot.x = 0.22; // Torso doubles over
        this.oppStaggerOffset.z += 0.06;
        this.hitStopTimer = 0.040;
        this.addCameraTrauma(0.32);

        const banner = isCrit ? `🔥 CRITICAL BODY BLOW -${dmg} HP!` : `🥊 BODY BLOW -${dmg} HP`;
        this.hud.showCallout(banner, isCrit ? '#ffd700' : '#f59e0b');
        this.hud.showCombo(this.comboCount);
      }
    }

    if (this.opponentHealth <= 0) {
      this.triggerOpponentKnockout();
    }
  }

  // ─── 10. Dynamic Opponent Guard & Attack AI ───────────────────────────────

  private updateOpponentAI(dt: number, defense: DefensiveState): void {
    // A. Guard Cycle AI: HIGH_GUARD (45%), LOW_GUARD (35%), WINDUP (20%)
    this.oppGuardTimer -= dt;
    if (this.oppGuardTimer <= 0) {
      this.oppGuardTimer = 2.5 + Math.random() * 1.0;
      const roll = Math.random();
      if (roll < 0.45) {
        this.oppGuardState = 'HIGH_GUARD';
        if (this.oppTelegraphGlow) this.oppTelegraphGlow.visible = false;
        this.hud.hideTelegraph();
      } else if (roll < 0.80) {
        this.oppGuardState = 'LOW_GUARD';
        if (this.oppTelegraphGlow) this.oppTelegraphGlow.visible = false;
        this.hud.hideTelegraph();
      } else {
        this.oppGuardState = 'WINDUP';
        this.oppTelegraphTimer = this.oppTelegraphDuration;
        this.aiIsTelegraphing = true;
        if (this.oppTelegraphGlow) this.oppTelegraphGlow.visible = true;
        this.hud.showTelegraph('⚠️ INCOMING HOOK — BLOCK OR SLIP!');
        this.audio.boxingPunchWhoosh(0.7);
      }
    }

    // B. Opponent Attack Cadence (Every 3.0s - 3.8s)
    if (!this.aiIsStriking) {
      this.oppAttackTimer -= dt;
      if (this.oppAttackTimer <= this.oppTelegraphDuration && !this.aiIsTelegraphing) {
        this.aiIsTelegraphing = true;
        this.oppTelegraphTimer = this.oppTelegraphDuration;
        if (this.oppTelegraphGlow) this.oppTelegraphGlow.visible = true;
        this.hud.showTelegraph('⚠️ INCOMING HOOK — BLOCK OR SLIP!');
      }

      if (this.oppAttackTimer <= 0) {
        this.oppAttackTimer = 3.0 + Math.random() * 0.8;
        this.aiIsTelegraphing = false;
        if (this.oppTelegraphGlow) this.oppTelegraphGlow.visible = false;
        this.hud.hideTelegraph();
        this.aiIsStriking = true;
        this.aiStrikeProgress = 0;
        this.aiAttackArm = Math.random() > 0.5 ? 'right' : 'left';
        this.audio.boxingPunchWhoosh(1.1);
      }
    } else {
      // Strike active
      this.aiStrikeProgress += dt * 4.2;
      const strikeArmGroup = this.aiAttackArm === 'right' ? this.oppRightArmGroup : this.oppLeftArmGroup;
      const glove = this.aiAttackArm === 'right' ? this.oppGloveR : this.oppGloveL;

      if (this.aiStrikeProgress <= 0.5) {
        // Thrust forward
        glove.position.z = THREE.MathUtils.lerp(0.28, 1.68, this.aiStrikeProgress * 2);
      } else if (this.aiStrikeProgress <= 1.0) {
        if (!this.aiIsTelegraphing && this.aiStrikeProgress >= 0.52 && this.aiStrikeProgress <= 0.65) {
          this.resolveOpponentAttackOnPlayer(defense);
        }
        // Retract
        glove.position.z = THREE.MathUtils.lerp(1.68, 0.28, (this.aiStrikeProgress - 0.5) * 2);
      } else {
        this.aiIsStriking = false;
        this.aiStrikeProgress = 0;
        glove.position.z = 0.28;
      }
    }
  }

  private resolveOpponentAttackOnPlayer(defense: DefensiveState): void {
    if (this.playerInvulnTimer > 0) return;

    const isSlipping = defense.isSlippingLeft || defense.isSlippingRight || Math.abs(defense.slipRatio) > 0.35;
    const isPlayerHighGuard = defense.isHighGuard || defense.stance === 'HIGH_GUARD';

    if (isSlipping) {
      // Player slipped!
      this.opponentVulnerableTimer = 1.2; // 1.2s Critical Counter window
      this.audio.boxingPunchWhoosh(1.4);
      this.hud.showCallout('⚡ SLIPPED & COUNTERED! 2X CRIT READY!', '#ffd700');
    } else if (isPlayerHighGuard) {
      // Player blocks, taking only 2 HP
      this.playerHealth = Math.max(0, this.playerHealth - 2);
      this.playerInvulnTimer = 0.85; // 0.85s player i-frame
      this.audio.boxingGloveBlock();
      this.triggerShieldRipple(this.playerRoot.clone().setY(1.40));
      this.addCameraTrauma(0.18);
      this.hud.showCallout('🛡️ GUARDED -2 HP', '#00f2fe');
    } else {
      // Unblocked hit deals 12 HP (out of 100 HP)
      const dmg = 12;
      this.playerHealth = Math.max(0, this.playerHealth - dmg);
      this.playerInvulnTimer = 0.85; // 0.85s player i-frame prevents multi-hit rapid KO
      this.audio.boxingPunchImpact(1.1, true, false);
      this.hud.triggerPlayerDamageFlash();
      this.addCameraTrauma(0.55);
      this.hud.showCallout('⚠️ OPPONENT HOOK -12 HP!', '#ff0055');

      if (this.playerHealth <= 0) {
        this.triggerPlayerKnockout();
      }
    }
  }

  private updateOpponentVisuals(dt: number): void {
    // Breathing idle & subtle weight transfer
    const bobY = Math.sin(this.oppIdleTime * 4.2) * 0.016;
    const weaveX = Math.cos(this.oppIdleTime * 2.4) * 0.024;

    // Dynamic Guard Glove Height (High Guard Y = 1.55m vs Low Guard Y = 1.15m)
    if (!this.aiIsStriking) {
      const isHigh = this.oppGuardState === 'HIGH_GUARD';
      const targetY = isHigh ? 0.08 : -0.22;
      this.oppGloveL.position.y = THREE.MathUtils.lerp(this.oppGloveL.position.y, targetY, dt * 6.0);
      this.oppGloveR.position.y = THREE.MathUtils.lerp(this.oppGloveR.position.y, targetY, dt * 6.0);
    }

    // Decay staggers and reactions
    this.oppHeadSnapRot.x = THREE.MathUtils.lerp(this.oppHeadSnapRot.x, 0, dt * 8.0);
    this.oppTorsoHunchRot.x = THREE.MathUtils.lerp(this.oppTorsoHunchRot.x, 0, dt * 8.0);
    this.oppStaggerOffset.lerp(this.scratchVecA.set(0, 0, 0), dt * 6.0);

    this.opponentGroup.position.set(
      this.opponentRoot.x + weaveX + this.oppStaggerOffset.x,
      this.opponentRoot.y + bobY + this.oppStaggerOffset.y,
      this.opponentRoot.z + this.oppStaggerOffset.z
    );

    this.oppHeadGroup.rotation.copy(this.oppHeadSnapRot);
    this.oppTorsoGroup.rotation.x = this.oppTorsoHunchRot.x;
  }

  private updateParticlesAndShaders(dt: number): void {
    // A. Update Sparks
    for (let i = 0; i < this.activeSparkCount; i++) {
      this.sparkLifetimes[i] -= dt;
      if (this.sparkLifetimes[i] <= 0) {
        // Swap with last active
        const last = this.activeSparkCount - 1;
        this.sparkPositions[i * 3 + 0] = this.sparkPositions[last * 3 + 0];
        this.sparkPositions[i * 3 + 1] = this.sparkPositions[last * 3 + 1];
        this.sparkPositions[i * 3 + 2] = this.sparkPositions[last * 3 + 2];
        this.sparkVelocities[i * 3 + 0] = this.sparkVelocities[last * 3 + 0];
        this.sparkVelocities[i * 3 + 1] = this.sparkVelocities[last * 3 + 1];
        this.sparkVelocities[i * 3 + 2] = this.sparkVelocities[last * 3 + 2];
        this.sparkColors[i * 3 + 0] = this.sparkColors[last * 3 + 0];
        this.sparkColors[i * 3 + 1] = this.sparkColors[last * 3 + 1];
        this.sparkColors[i * 3 + 2] = this.sparkColors[last * 3 + 2];
        this.sparkLifetimes[i] = this.sparkLifetimes[last];
        this.activeSparkCount--;
        i--;
        continue;
      }

      this.sparkVelocities[i * 3 + 1] -= 9.8 * dt; // Gravity
      this.sparkPositions[i * 3 + 0] += this.sparkVelocities[i * 3 + 0] * dt;
      this.sparkPositions[i * 3 + 1] += this.sparkVelocities[i * 3 + 1] * dt;
      this.sparkPositions[i * 3 + 2] += this.sparkVelocities[i * 3 + 2] * dt;
    }
    this.sparkGeo.setDrawRange(0, this.activeSparkCount);
    this.sparkGeo.attributes.position.needsUpdate = true;

    // B. Yellow Shockwave Expand
    if (this.yellowShockwaveProgress < 1.0) {
      this.yellowShockwaveProgress += dt * 3.8;
      const s = 1.0 + this.yellowShockwaveProgress * 3.5;
      this.yellowShockwaveMesh.scale.set(s, s, s);
      const mat = this.yellowShockwaveMesh.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, 1.0 - this.yellowShockwaveProgress);
      if (this.yellowShockwaveProgress >= 1.0) {
        this.yellowShockwaveMesh.visible = false;
      }
    }

    // C. Shield Ripple Expand
    if (this.shieldRippleProgress < 1.0) {
      this.shieldRippleProgress += dt * 4.0;
      const s = 1.0 + this.shieldRippleProgress * 2.8;
      this.shieldRippleMesh.scale.set(s, s, s);
      const mat = this.shieldRippleMesh.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, 0.85 - this.shieldRippleProgress);
      if (this.shieldRippleProgress >= 1.0) {
        this.shieldRippleMesh.visible = false;
      }
    }
  }

  // ─── 11. Camera Spring-Damper & Shake ──────────────────────────────────────

  private addCameraTrauma(amount: number): void {
    this.cameraTrauma = Math.min(1.0, this.cameraTrauma + amount);
  }

  private updateCamera(dt: number, defense: DefensiveState): void {
    const targetHeadX = defense.slipRatio * 0.12;
    const targetHeadY = defense.isDucking ? -0.14 : 0.0;
    this.cameraHeadOffset.x = THREE.MathUtils.lerp(this.cameraHeadOffset.x, targetHeadX, dt * 10);
    this.cameraHeadOffset.y = THREE.MathUtils.lerp(this.cameraHeadOffset.y, targetHeadY, dt * 10);

    const targetPos = this.cameraPreset === 'arcade_ots' ? this.ringsideCameraPos : this.fpCameraPos;
    const targetLook = this.cameraPreset === 'arcade_ots' ? this.ringsideLookTarget : this.fpLookTarget;
    const targetFov = this.cameraPreset === 'arcade_ots' ? 50 : 60;

    // In first person mode, hide player torso and head to prevent near-plane clipping
    if (this.playerHeadGroup && this.playerTorsoMesh) {
      const showPlayerBody = this.cameraPreset !== 'first_person';
      this.playerHeadGroup.visible = showPlayerBody;
      this.playerTorsoMesh.visible = showPlayerBody;
    }

    this.currentCameraPos.lerp(targetPos, dt * 8.0);
    this.currentLookTarget.lerp(targetLook, dt * 8.0);

    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, dt * 8.0);
      this.camera.updateProjectionMatrix();
    }

    // Trauma Shake
    let shakeX = 0;
    let shakeY = 0;
    if (this.cameraTrauma > 0) {
      const shakeAmp = this.cameraTrauma * this.cameraTrauma * 0.10;
      const t = performance.now() * 0.04;
      shakeX = Math.sin(t * 1.5) * shakeAmp;
      shakeY = Math.cos(t * 2.0) * shakeAmp;
      this.cameraTrauma = Math.max(0, this.cameraTrauma - dt * 2.5);
    }

    this.camera.position.set(
      this.currentCameraPos.x + this.cameraHeadOffset.x + shakeX,
      this.currentCameraPos.y + this.cameraHeadOffset.y + shakeY,
      this.currentCameraPos.z
    );
    this.camera.lookAt(this.currentLookTarget);
  }

  // ─── 12. Round Advancements & Knockout Endings ─────────────────────────────

  private advanceRound(): void {
    if (this.currentRound < this.maxRounds) {
      this.currentRound++;
      this.roundTimeRemaining = 50;
      this.roundCountdown = 3.0;
      this.isRoundActive = false;
      this.audio.boxingBellRing(2);
      this.hud.showCallout(`🔔 ROUND ${this.currentRound}!`, '#ffd700');
    } else {
      const didWin = this.playerHealth >= this.opponentHealth;
      this.concludeMatch(didWin ? 1 : 2, didWin ? 'DECISION VICTORY (POINTS)' : 'DECISION DEFEAT');
    }
  }

  private triggerOpponentKnockout(): void {
    this.isMatchOver = true;
    this.isRoundActive = false;
    this.opponentGroup.rotation.x = Math.PI / 2;
    this.opponentGroup.position.y = -0.4;
    this.audio.boxingBellRing(3);
    this.audio.boxingCrowdRoar(1.5);
    this.hud.showCallout('👑 KNOCKOUT! K.O. VICTORY! 🏆', '#00f2fe');

    setTimeout(() => {
      this.concludeMatch(1, 'KNOCKOUT VICTORY (K.O.)');
    }, 1200);
  }

  private triggerPlayerKnockout(): void {
    this.isMatchOver = true;
    this.isRoundActive = false;
    this.audio.boxingBellRing(3);
    this.audio.boxingCrowdRoar(1.2);
    this.hud.showCallout('⚡ KNOCKOUT DEFEAT (K.O.)', '#ff0055');

    setTimeout(() => {
      this.concludeMatch(2, 'KNOCKOUT DEFEAT (K.O.)');
    }, 1200);
  }

  private concludeMatch(winner: 1 | 2, reason: string): void {
    this.matchWinner = winner;
    this.scoreState = {
      player1Score: winner === 1 ? 3 : 1,
      player2Score: winner === 2 ? 3 : 1,
      currentServer: 1,
      rallyCount: this.totalPlayerHits,
      isGameOver: true,
      winner,
      lastPointWinner: winner,
      targetScore: 3,
      winByTwo: false,
      lastPointReason: reason,
      gameModeTitle: 'Arcade Boxing 3D Pro',
    };
    this.scoreCallbacks.forEach((cb) => cb(this.scoreState));
  }

  // ─── 13. Playwright & Developer Debug Bridge ───────────────────────────────

  public getDebugState(): {
    isRoundActive: boolean;
    currentRound: number;
    playerHealth: number;
    opponentHealth: number;
    stamina: number;
    cameraPreset: string;
    roundCountdown: number;
    totalPlayerHits: number;
  } {
    return {
      isRoundActive: this.isRoundActive,
      currentRound: this.currentRound,
      playerHealth: this.playerHealth,
      opponentHealth: this.opponentHealth,
      stamina: this.playerStamina,
      cameraPreset: this.cameraPreset,
      roundCountdown: this.roundCountdown,
      totalPlayerHits: this.totalPlayerHits,
    };
  }

  public debugServe(): void {
    this.punchClassifier.triggerSyntheticPunch('JAB', 5.5, 'left', 'head');
  }

  // ─── 14. IGameScene Contract ───────────────────────────────────────────────

  start(): void {
    const topNav = document.querySelector('.top-nav');
    if (topNav) topNav.classList.add('in-match');
    const scoreWrapper = document.querySelector('.score-wrapper') as HTMLElement;
    if (scoreWrapper) scoreWrapper.style.display = 'none';
    if (this.roundCountdown <= 0) {
      this.isRoundActive = true;
    }
  }

  pause(): void {
    const topNav = document.querySelector('.top-nav');
    if (topNav) topNav.classList.remove('in-match');
    this.isRoundActive = false;
  }

  resume(): void {
    const topNav = document.querySelector('.top-nav');
    if (topNav) topNav.classList.add('in-match');
    const scoreWrapper = document.querySelector('.score-wrapper') as HTMLElement;
    if (scoreWrapper) scoreWrapper.style.display = 'none';
    if (!this.isMatchOver && this.roundCountdown <= 0) {
      this.isRoundActive = true;
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

  getScore(): GameScoreState {
    return { ...this.scoreState };
  }

  onScoreChange(callback: (score: GameScoreState) => void): () => void {
    this.scoreCallbacks.push(callback);
    return () => {
      this.scoreCallbacks = this.scoreCallbacks.filter((c) => c !== callback);
    };
  }

  destroy(): void {
    cancelAnimationFrame(this.animFrameId);
    if (this.keydownListener) {
      window.removeEventListener('keydown', this.keydownListener);
    }
    const topNav = document.querySelector('.top-nav');
    if (topNav) topNav.classList.remove('in-match');
    if (this.hud) {
      this.hud.destroy();
    }
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.domElement.remove();
    }
  }
}
