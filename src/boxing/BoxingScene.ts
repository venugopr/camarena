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

export type BoxingCameraPreset = 'classic_side' | 'wide_arena' | 'fighter_pov';

export type KineticPunchState = 'GUARD' | 'EXTENDING' | 'CONTACT' | 'RETRACTING';

export interface KineticArmRig {
  arm: 'left' | 'right';
  state: KineticPunchState;
  timer: number;
  extendingDuration: number; // 115ms forward strike projection
  contactDuration: number;   // 40ms contact hold
  retractingDuration: number;// 110ms return to guard
  startPos: THREE.Vector3;
  arcControlPos: THREE.Vector3; // Quadratic Bezier control point for curved boxing arcs
  targetPos: THREE.Vector3;
  currentPos: THREE.Vector3;
  targetZone: 'head' | 'body';
  punchEvent: PunchEvent | null;
  hitResolved: boolean;
}

export type OpponentGuardState = 'HIGH_GUARD' | 'LOW_GUARD' | 'OPEN' | 'WINDUP';
export type BoxingDifficulty = DifficultyLevel | 'starter' | 'easy' | 'medium' | 'hard';

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
  private difficulty: BoxingDifficulty = 'medium';
  private dominantHand: 'right' | 'left' = 'right';

  // 2. True Sports Side-Profile Camera Presets:
  //    1) Classic Side Cam (default): viewing the X-axis engagement line from the side ropes (z = -4.65)
  //       so both Player (Screen Left, blue/cyan) and IRON TITAN (Screen Right, crimson red) are 100% visible side-by-side.
  //    2) Wide Arena Cam: farther cinematic broadcast angle (x = 0, y = 3.2, z = -9.2, looking at 0, 1.2, 0)
  //    3) Fighter POV Cam: first-person corner view from the player's eyes looking across at IRON TITAN
  private cameraPreset: BoxingCameraPreset = 'classic_side';
  private readonly classicSideCameraPos = new THREE.Vector3(0.0, 2.05, -4.65);
  private readonly classicSideLookTarget = new THREE.Vector3(0.0, 1.25, 0.0);
  private readonly wideArenaCameraPos = new THREE.Vector3(0.0, 3.20, -9.20);
  private readonly wideArenaLookTarget = new THREE.Vector3(0.0, 1.20, 0.0);
  private readonly fighterPovCameraPos = new THREE.Vector3(0.40, 1.58, 0.0);
  private readonly fighterPovLookTarget = new THREE.Vector3(-0.46, 1.48, 0.0);

  private currentCameraPos = new THREE.Vector3(0.0, 2.05, -4.65);
  private currentLookTarget = new THREE.Vector3(0.0, 1.25, 0.0);
  private cameraTrauma = 0;
  private cameraHeadOffset = new THREE.Vector3(0, 0, 0);

  // Strict maximum human arm reach limit (0.72m from shoulder to glove tip)
  // 2-Bone Articulated Arm segment lengths (Shoulder -> Elbow = 0.29m, Elbow -> Wrist = 0.28m)
  private readonly MAX_ARM_REACH = 0.72;
  private readonly UPPER_ARM_LEN = 0.29;
  private readonly FOREARM_LEN = 0.28;

  // 3. Fighter Roots: Symmetrical X-Axis Engagement Line
  //    Player at (+0.46, 0, 0) stands on Screen Left facing Opponent at (-0.46, 0, 0) on Screen Right.
  //    At 0.92m torso separation, a clamped 0.72m arm extension reaches cleanly to the opponent's chin/body.
  private readonly playerRoot = new THREE.Vector3(0.46, 0, 0.0);
  private readonly opponentRoot = new THREE.Vector3(-0.46, 0, 0.0);

  private playerGroup = new THREE.Group();
  private opponentGroup = new THREE.Group();

  // Procedural Boxer Models (2-Bone Articulated Athletic Rigs with Upper Arm, Elbow Joint, Forearm & Curved Glove)
  // Player Meshes
  private playerTorsoGroup!: THREE.Group;
  private playerTorsoMesh!: THREE.Mesh;
  private playerHeadMesh!: THREE.Mesh;
  private playerHeadGroup!: THREE.Group;
  private playerLeftArmGroup!: THREE.Group;
  private playerRightArmGroup!: THREE.Group;
  private playerGloveL!: THREE.Group;
  private playerGloveR!: THREE.Group;
  private playerUpperArmLMesh!: THREE.Mesh;
  private playerUpperArmRMesh!: THREE.Mesh;
  private playerElbowLMesh!: THREE.Mesh;
  private playerElbowRMesh!: THREE.Mesh;
  private playerForearmLMesh!: THREE.Mesh;
  private playerForearmRMesh!: THREE.Mesh;
  private playerMatSkin!: THREE.MeshStandardMaterial;
  private playerHeadgearMat!: THREE.MeshStandardMaterial;
  private playerGloveMat!: THREE.MeshStandardMaterial;
  private playerGuardShieldMesh!: THREE.Mesh;
  private playerLabelSprite!: THREE.Sprite;

  // Live Tracking & Pose State (100% Player Controlled, Zero Auto-Play)
  private isGuarding = false;
  private leftWristNearChin = false;
  private rightWristNearChin = false;
  private headSlipX = 0;
  private headDuckY = 0;
  private playerTorsoTwistY = 0;
  private playerIdleTime = 0;
  private activeAction = 'IDLE_BOUNCE';
  private hasInitializedWristTracking = false;
  private trackedLeftGloveOffset = new THREE.Vector3(-0.12, 0.05, 0.32);
  private trackedRightGloveOffset = new THREE.Vector3(0.13, 0.02, 0.24);
  private playerLeftElbowPole = new THREE.Vector3(0.32, -0.92, -0.18);
  private playerRightElbowPole = new THREE.Vector3(-0.32, -0.92, -0.18);
  private playerLeftElbowPos = new THREE.Vector3(0.06, -0.22, 0.14);
  private playerRightElbowPos = new THREE.Vector3(-0.06, -0.22, 0.12);
  private prevLeftWristZ = 0;
  private prevRightWristZ = 0;
  private prevLeftExtension = 0;
  private prevRightExtension = 0;
  private lastDirectPunchTime = 0;

  // Opponent Meshes
  private oppTorsoMesh!: THREE.Mesh;
  private oppTorsoGroup!: THREE.Group;
  private oppHeadMesh!: THREE.Mesh;
  private oppHeadGroup!: THREE.Group;
  private oppLeftArmGroup!: THREE.Group;
  private oppRightArmGroup!: THREE.Group;
  private oppGloveL!: THREE.Group;
  private oppGloveR!: THREE.Group;
  private oppUpperArmLMesh!: THREE.Mesh;
  private oppUpperArmRMesh!: THREE.Mesh;
  private oppElbowLMesh!: THREE.Mesh;
  private oppElbowRMesh!: THREE.Mesh;
  private oppForearmLMesh!: THREE.Mesh;
  private oppForearmRMesh!: THREE.Mesh;
  private oppLeftElbowPos = new THREE.Vector3(0.06, -0.22, 0.14);
  private oppRightElbowPos = new THREE.Vector3(-0.06, -0.22, 0.12);
  private oppTelegraphGlow!: THREE.Mesh;
  private oppSkinMat!: THREE.MeshStandardMaterial;
  private oppGloveMat!: THREE.MeshStandardMaterial;
  private oppLabelSprite!: THREE.Sprite;
  private oppTorsoTwistY = 0;

  // 4. Kinetic Glove Projection State Machine (Curved Boxing Trajectories + 2-Bone IK)
  private leftHand: KineticArmRig = {
    arm: 'left',
    state: 'GUARD',
    timer: 0,
    extendingDuration: 0.115, // 115ms
    contactDuration: 0.040,   // 40ms
    retractingDuration: 0.110,// 110ms
    startPos: new THREE.Vector3(-0.12, 0.05, 0.32),
    arcControlPos: new THREE.Vector3(-0.10, 0.12, 0.48),
    targetPos: new THREE.Vector3(-0.10, 0.15, 0.56),
    currentPos: new THREE.Vector3(-0.12, 0.05, 0.32),
    targetZone: 'head',
    punchEvent: null,
    hitResolved: false,
  };

  private rightHand: KineticArmRig = {
    arm: 'right',
    state: 'GUARD',
    timer: 0,
    extendingDuration: 0.115,
    contactDuration: 0.040,
    retractingDuration: 0.110,
    startPos: new THREE.Vector3(0.13, 0.02, 0.24),
    arcControlPos: new THREE.Vector3(0.10, 0.12, 0.45),
    targetPos: new THREE.Vector3(0.10, 0.15, 0.56),
    currentPos: new THREE.Vector3(0.13, 0.02, 0.24),
    targetZone: 'head',
    punchEvent: null,
    hitResolved: false,
  };

  // Natural Boxing Guard Offsets (Lead hand forward at cheek/brow, Rear hand tucked by jaw)
  private readonly playerGuardL = new THREE.Vector3(-0.12, 0.05, 0.32);
  private readonly playerGuardR = new THREE.Vector3(0.13, 0.02, 0.24);

  // 5. Opponent Guard AI & Reactions
  private oppGuardState: OpponentGuardState = 'HIGH_GUARD';
  private oppGuardTimer = 2.8;
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

  // 6. Combat Lifecycle, Stagger Cooldown ($i$-frames) & AI Defensive Retreat
  private readonly MAX_HEALTH = 200;
  private playerHealth = 200;
  private opponentHealth = 200;
  private playerStamina = 100;
  private playerInvulnTimer = 0; // 0.45s stagger / hit cooldown after taking a clean hit
  private oppInvulnTimer = 0;    // 0.45s stagger / hit cooldown after taking a clean hit
  private opponentVulnerableTimer = 0; // 1.4s counter window after slip/block
  private oppConsecutiveCleanHits = 0; // Tracks consecutive unblocked player hits on AI
  private oppRetreatTimer = 0;         // 1.2s AI defensive step-back / clinch recovery timer

  // 3-Second Pre-Round Countdown & Round Progression
  private roundCountdown = 3.0;
  private fightBannerTimer = 0;
  private isRoundActive = false;
  private isMatchOver = false;
  private matchWinner: 1 | 2 | null = null;
  private currentRound = 1;
  private maxRounds = 3;
  private roundTimeRemaining = 50;
  private playerRoundsWon = 0;
  private oppRoundsWon = 0;

  // Opponent Attack AI (with difficulty-scaled warning windup tell)
  private oppAttackTimer = 1.2;
  private oppTelegraphDuration = 0.40;
  private oppTelegraphTimer = 0;
  private aiIsTelegraphing = false;
  private aiIsStriking = false;
  private aiStrikeProgress = 0;
  private aiAttackArm: 'left' | 'right' = 'right';
  private aiAttackType: 'JAB' | 'CROSS' | 'HOOK' | 'BODY_BLOW' = 'HOOK';

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
  private navDiffChangeListener?: (e: Event) => void;

  // Scratch vectors
  private readonly scratchVecA = new THREE.Vector3();
  private readonly scratchVecB = new THREE.Vector3();
  private readonly scratchVecC = new THREE.Vector3();

  init(
    container: HTMLElement,
    audio: SoundSynthesizer,
    config?: {
      opponentMode: OpponentMode;
      difficulty: BoxingDifficulty;
      targetScore?: number;
      dominantHand?: 'right' | 'left';
    }
  ): void {
    this.container = container;
    this.audio = audio;
    if (config?.opponentMode) this.opponentMode = config.opponentMode;
    this.difficulty = config?.difficulty || 'medium';
    if (config?.dominantHand) this.dominantHand = config.dominantHand;

    this.buildThreeScene();
    this.buildBoxingArena();
    this.buildStylizedFighters();
    this.buildImpactParticleSystems();

    this.punchClassifier = new PunchClassifier(this.dominantHand);
    this.hud = new BoxingHUD(
      this.container,
      () => this.cycleCameraPreset(),
      (tier) => {
        this.setDifficulty(tier);
        const navSelect = document.getElementById('difficulty-select') as HTMLSelectElement | null;
        if (navSelect) {
          navSelect.value = tier === 'starter' ? 'learner' : tier === 'hard' ? 'pro' : 'casual';
        }
        const label =
          tier === 'starter' ? 'STARTER / EASY' : tier === 'hard' ? 'HARD' : 'MEDIUM (DEFAULT)';
        this.hud.showCallout(`⚙️ AI TIER: ${label}`, '#00f2fe');
      }
    );

    // Sync with top-nav difficulty selector if present
    const navSelect = document.getElementById('difficulty-select') as HTMLSelectElement | null;
    if (navSelect) {
      if (!config?.difficulty && navSelect.value) {
        this.difficulty = navSelect.value as BoxingDifficulty;
      }
      if (this.navDiffChangeListener) {
        navSelect.removeEventListener('change', this.navDiffChangeListener);
      }
      this.navDiffChangeListener = (e: Event) => {
        const val = (e.target as HTMLSelectElement).value as BoxingDifficulty;
        this.setDifficulty(val);
      };
      navSelect.addEventListener('change', this.navDiffChangeListener);
    }

    this.setDifficulty(this.difficulty);
    this.bindKeyboardShortcuts();
    this.reset();
  }

  public setDifficulty(difficulty: BoxingDifficulty): void {
    this.difficulty = difficulty || 'medium';
    const params = this.getDifficultyParams();
    this.oppTelegraphDuration = params.telegraphDuration;
    this.oppAttackTimer = Math.min(this.oppAttackTimer, params.attackInterval);
    if (this.hud) {
      this.hud.setActiveDifficultyButton(params.tier);
    }
  }

  private getDifficultyParams(): {
    tier: 'starter' | 'medium' | 'hard';
    attackInterval: number;
    telegraphDuration: number;
    guardFrequency: number;
    playerDamageMult: number;
    strikeSpeedMult: number;
    aiJabDamage: number;
    aiCrossDamage: number;
    aiHookDamage: number;
    aiBodyBlowDamage: number;
  } {
    const d = (this.difficulty || 'medium').toLowerCase();
    if (d === 'starter' || d === 'easy' || d === 'learner') {
      return {
        tier: 'starter',
        attackInterval: 3.5,     // Starter / Easy: AI attacks every 3.5s
        telegraphDuration: 0.65, // Telegraph window is 0.65s
        guardFrequency: 0.20,    // 20% block chance
        playerDamageMult: 1.0,
        strikeSpeedMult: 3.2,
        aiJabDamage: 6,          // AI deals 6–10 HP damage
        aiCrossDamage: 8,
        aiHookDamage: 9,
        aiBodyBlowDamage: 10,
      };
    }
    if (d === 'hard' || d === 'pro' || d === 'legend') {
      return {
        tier: 'hard',
        attackInterval: 1.2,     // Hard: AI attacks aggressively every 1.2s
        telegraphDuration: 0.20, // Lightning-fast telegraph window (0.20s)
        guardFrequency: 0.80,    // Actively blocks/slips 80% of unshielded player attacks
        playerDamageMult: 1.0,
        strikeSpeedMult: 5.5,
        aiJabDamage: 16,         // AI deals 16–22 HP damage
        aiCrossDamage: 18,
        aiHookDamage: 20,
        aiBodyBlowDamage: 22,
      };
    }
    // Default: Medium ('medium' | 'casual')
    return {
      tier: 'medium',
      attackInterval: 2.2,     // Medium: AI attacks every 2.2s
      telegraphDuration: 0.40, // Telegraph window is 0.40s
      guardFrequency: 0.50,    // 50% block chance
      playerDamageMult: 1.0,
      strikeSpeedMult: 4.3,
      aiJabDamage: 10,         // AI deals 10–14 HP damage
      aiCrossDamage: 12,
      aiHookDamage: 13,
      aiBodyBlowDamage: 14,
    };
  }

  public setDominantHand(hand: 'right' | 'left'): void {
    this.dominantHand = hand;
    if (this.punchClassifier) {
      this.punchClassifier.setDominantHand(hand);
    }
  }

  public setDominantArm(arm: 'right' | 'left'): void {
    this.setDominantHand(arm);
  }

  // ─── 1. Three.js Scene & Classic Side-Profile Default Camera ──────────────

  private buildThreeScene(): void {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x060812);
    this.scene.fog = new THREE.FogExp2(0x060812, 0.025);

    this.camera = new THREE.PerspectiveCamera(
      46,
      this.container.clientWidth / this.container.clientHeight,
      0.05,
      100
    );
    this.camera.position.copy(this.classicSideCameraPos);
    this.camera.lookAt(this.classicSideLookTarget);
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
      { x:  2.5, z: -2.5, mat: postMatBlue }, // Player corner (Screen Left)
      { x: -2.5, z:  2.5, mat: postMatRed  }, // Opponent corner (Screen Right)
      { x: -2.5, z: -2.5, mat: postMatWhite },
      { x:  2.5, z:  2.5, mat: postMatWhite },
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
    const ambLight = new THREE.AmbientLight(0xffffff, 0.78);
    this.scene.add(ambLight);

    const keyLight = new THREE.SpotLight(0xfff5e6, 3.4, 28, Math.PI / 3, 0.42, 1.2);
    keyLight.position.set(0, 7.2, -1.8);
    keyLight.target.position.set(0, 1.2, 0.0);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    this.scene.add(keyLight);
    this.scene.add(keyLight.target);

    // Cyan & Red Accent Rim Lights
    const rimPlayer = new THREE.PointLight(0x00f2fe, 2.6, 8);
    rimPlayer.position.set(2.8, 2.4, -1.5);
    this.scene.add(rimPlayer);

    const rimOpp = new THREE.PointLight(0xff0044, 2.8, 8);
    rimOpp.position.set(-2.8, 2.4, -1.5);
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
    const diff = this.opponentRoot.clone().sub(this.playerRoot);
    const angleToOpponent = Math.atan2(diff.x, diff.z);
    const angleToPlayer = Math.atan2(-diff.x, -diff.z);

    // A. Player Rig (Stationed on Screen Left at x = +0.46, z = 0, facing -X toward IRON TITAN)
    this.playerGroup.position.copy(this.playerRoot);
    this.playerGroup.rotation.y = angleToOpponent;
    this.scene.add(this.playerGroup);

    this.playerMatSkin = new THREE.MeshStandardMaterial({
      color: 0xdeb887,
      roughness: 0.45,
      metalness: 0.12,
    });
    // Vibrant Cyan/Neon-Green Player Gloves for instant visual distinction
    this.playerGloveMat = new THREE.MeshStandardMaterial({
      color: 0x00f2fe, // Vibrant Electric Cyan
      emissive: 0x00f2fe,
      emissiveIntensity: 0.35,
      roughness: 0.18,
      metalness: 0.65,
    });
    const playerNeonTrimMat = new THREE.MeshStandardMaterial({
      color: 0x39ff14, // Neon Green Accent Cuff
      emissive: 0x39ff14,
      emissiveIntensity: 0.45,
      roughness: 0.2,
    });
    const playerTrunksMat = new THREE.MeshStandardMaterial({
      color: 0x003566,
      roughness: 0.32,
      metalness: 0.45,
    });
    this.playerHeadgearMat = new THREE.MeshStandardMaterial({
      color: 0x0096c7,
      emissive: 0x0077b6,
      emissiveIntensity: 0.18,
      roughness: 0.30,
      metalness: 0.45,
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
      this.playerHeadgearMat,
      goldWaistbandMat,
      playerNeonTrimMat,
      bootMat,
      true // isPlayer
    );

    // Floating 3D Text Sprite above Blue Boxer: "👤 YOU (PLAYER)" (Bright Cyan glow)
    this.playerLabelSprite = this.createFighterLabelSprite('👤 YOU (PLAYER)', '#00f2fe', 'rgba(6, 22, 40, 0.90)');
    this.playerLabelSprite.position.set(0, 1.98, 0);
    this.playerGroup.add(this.playerLabelSprite);

    // Player Active Guard Visual Indicator (Cyan translucent barrier in front of chin)
    const guardShieldGeo = new THREE.RingGeometry(0.16, 0.28, 28);
    const guardShieldMat = new THREE.MeshBasicMaterial({
      color: 0x00f2fe,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
    });
    this.playerGuardShieldMesh = new THREE.Mesh(guardShieldGeo, guardShieldMat);
    this.playerGuardShieldMesh.position.set(0, 1.48, 0.38);
    this.playerGuardShieldMesh.visible = false;
    this.playerGroup.add(this.playerGuardShieldMesh);

    // B. Opponent Rig (Stationed on Screen Right at x = -0.46, z = 0, facing +X toward Player)
    this.opponentGroup.position.copy(this.opponentRoot);
    this.opponentGroup.rotation.y = angleToPlayer;
    this.scene.add(this.opponentGroup);

    this.oppSkinMat = new THREE.MeshStandardMaterial({
      color: 0xc68642,
      roughness: 0.45,
      metalness: 0.12,
    });
    // Crimson Red Opponent Gloves
    this.oppGloveMat = new THREE.MeshStandardMaterial({
      color: 0xdc2626, // Crimson Red
      emissive: 0xb91c1c,
      emissiveIntensity: 0.32,
      roughness: 0.20,
      metalness: 0.55,
    });
    const oppTrunksMat = new THREE.MeshStandardMaterial({
      color: 0x990000,
      roughness: 0.30,
      metalness: 0.45,
    });
    const oppHeadgearMat = new THREE.MeshStandardMaterial({
      color: 0xba181b,
      emissive: 0x7f1d1d,
      emissiveIntensity: 0.18,
      roughness: 0.32,
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

    // Floating 3D Text Sprite above Red Boxer: "🤖 IRON TITAN (AI)" (Bright Magenta/Red glow)
    this.oppLabelSprite = this.createFighterLabelSprite('🤖 IRON TITAN (AI)', '#ff0055', 'rgba(42, 6, 18, 0.90)');
    this.oppLabelSprite.position.set(0, 1.98, 0);
    this.opponentGroup.add(this.oppLabelSprite);

    // Opponent Red Glowing Windup Tell (450ms warning tell)
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
   * Builds a high-DPI 3D billboard Sprite displaying the fighter's identity badge above their head.
   */
  private createFighterLabelSprite(text: string, glowColor: string, bgFill: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 112;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 18;
      ctx.fillStyle = bgFill;
      ctx.strokeStyle = glowColor;
      ctx.lineWidth = 4;

      const rx = 20;
      const ry = 18;
      const rw = canvas.width - 40;
      const rh = canvas.height - 36;
      const rad = 36;
      ctx.beginPath();
      ctx.moveTo(rx + rad, ry);
      ctx.lineTo(rx + rw - rad, ry);
      ctx.quadraticCurveTo(rx + rw, ry, rx + rw, ry + rad);
      ctx.lineTo(rx + rw, ry + rh - rad);
      ctx.quadraticCurveTo(rx + rw, ry + rh, rx + rw - rad, ry + rh);
      ctx.lineTo(rx + rad, ry + rh);
      ctx.quadraticCurveTo(rx, ry + rh, rx, ry + rh - rad);
      ctx.lineTo(rx, ry + rad);
      ctx.quadraticCurveTo(rx, ry, rx + rad, ry);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.font = '900 32px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 12;
      ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 1);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const mat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.92, 0.20, 1.0);
    return sprite;
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
    wrapMat: THREE.Material,
    bootMat: THREE.MeshStandardMaterial,
    isPlayer: boolean
  ): void {
    const eyeWhiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

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

    const eyeL = new THREE.Mesh(eyeGeo, eyeWhiteMat);
    eyeL.position.set(-0.045, 0.03, 0.13);
    const pupL = new THREE.Mesh(pupilGeo, pupilMat);
    pupL.position.set(-0.045, 0.03, 0.144);

    const eyeR = new THREE.Mesh(eyeGeo, eyeWhiteMat);
    eyeR.position.set(0.045, 0.03, 0.13);
    const pupR = new THREE.Mesh(pupilGeo, pupilMat);
    pupR.position.set(0.045, 0.03, 0.144);

    headGroup.add(eyeL, pupL, eyeR, pupR);

    // Boxer Jaw & Mouthguard
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.065, 0.09), skinMat);
    jaw.position.set(0, -0.085, 0.07);
    const mouthguard = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.025), eyeWhiteMat);
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

    // 4. 2-Bone Articulated Boxing Arms (Upper Arm Bicep + Elbow Joint + Forearm + Curved 16oz Glove)
    // Attached to torsoGroup at the deltoid shoulder sockets so arms move cohesively with torso lean & shoulder twist
    const leftArmGroup = new THREE.Group();
    leftArmGroup.position.set(0.26, 0.22, 0.02);
    torsoGroup.add(leftArmGroup);

    const rightArmGroup = new THREE.Group();
    rightArmGroup.position.set(-0.26, 0.22, 0.02);
    torsoGroup.add(rightArmGroup);

    const armSkinMat = isPlayer
      ? new THREE.MeshStandardMaterial({ color: 0xdeb887, roughness: 0.45, metalness: 0.12 })
      : skinMat;

    // Tapered muscular Upper Arm (Bicep/Tricep) — unit height 1.0, scaled by UPPER_ARM_LEN in IK
    const upperArmGeo = new THREE.CylinderGeometry(0.044, 0.055, 1.0, 14);
    const upperArmL = new THREE.Mesh(upperArmGeo, armSkinMat);
    const upperArmR = new THREE.Mesh(upperArmGeo, armSkinMat);
    leftArmGroup.add(upperArmL);
    rightArmGroup.add(upperArmR);

    // Rounded Elbow Joint Spheres — eliminates any rectangular kinks or gaps at the bend
    const elbowGeo = new THREE.SphereGeometry(0.045, 12, 12);
    const elbowL = new THREE.Mesh(elbowGeo, armSkinMat);
    const elbowR = new THREE.Mesh(elbowGeo, armSkinMat);
    leftArmGroup.add(elbowL);
    rightArmGroup.add(elbowR);

    // Tapered muscular Forearm — unit height 1.0, scaled by FOREARM_LEN in IK
    const forearmGeo = new THREE.CylinderGeometry(0.036, 0.046, 1.0, 14);
    const forearmL = new THREE.Mesh(forearmGeo, armSkinMat);
    const forearmR = new THREE.Mesh(forearmGeo, armSkinMat);
    leftArmGroup.add(forearmL);
    rightArmGroup.add(forearmR);

    // Anatomically mirrored 16oz Curved Boxing Gloves
    const gloveL = this.createErgonomicGlove(gloveMat, wrapMat, true);
    const gloveR = this.createErgonomicGlove(gloveMat, wrapMat, false);

    // Natural Orthodox Guard Rest Positions (+Z forward, lead left hand out, rear right hand tucked by chin)
    gloveL.position.set(-0.12, 0.05, 0.32);
    gloveR.position.set(0.13, 0.02, 0.24);
    leftArmGroup.add(gloveL);
    rightArmGroup.add(gloveR);

    // Assign References
    if (isPlayer) {
      this.playerTorsoGroup = torsoGroup;
      this.playerTorsoMesh = torsoMesh;
      this.playerHeadMesh = headMesh;
      this.playerHeadGroup = headGroup;
      this.playerLeftArmGroup = leftArmGroup;
      this.playerRightArmGroup = rightArmGroup;
      this.playerGloveL = gloveL;
      this.playerGloveR = gloveR;
      this.playerUpperArmLMesh = upperArmL;
      this.playerUpperArmRMesh = upperArmR;
      this.playerElbowLMesh = elbowL;
      this.playerElbowRMesh = elbowR;
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
      this.oppUpperArmLMesh = upperArmL;
      this.oppUpperArmRMesh = upperArmR;
      this.oppElbowLMesh = elbowL;
      this.oppElbowRMesh = elbowR;
      this.oppForearmLMesh = forearmL;
      this.oppForearmRMesh = forearmR;
    }
  }

  /**
   * Creates an ergonomic curved 16oz boxing glove with padded knuckles, anatomical inward thumb,
   * metacarpal arch, and wrist wrap collar aligned seamlessly along the forearm axis (+Z).
   */
  private createErgonomicGlove(
    gloveMat: THREE.Material,
    wrapMat: THREE.Material,
    isLeft = true
  ): THREE.Group {
    const group = new THREE.Group();

    // Wrist Wrap Cuff at the wrist pivot (connects seamlessly to the forearm cylinder tip)
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.044, 0.068, 16), wrapMat);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.set(0, 0, 0.015);
    group.add(cuff);

    // Metacarpal Back-of-Hand Bridge
    const backHand = new THREE.Mesh(new THREE.SphereGeometry(0.068, 14, 14), gloveMat);
    backHand.scale.set(0.95, 0.85, 1.15);
    backHand.position.set(0, 0.012, 0.055);
    group.add(backHand);

    // Knuckle & Hand Main Cushion (Curved 16oz Profile)
    const mainPillow = new THREE.Mesh(new THREE.SphereGeometry(0.092, 18, 18), gloveMat);
    mainPillow.scale.set(0.94, 1.08, 1.22);
    mainPillow.position.set(0, 0.006, 0.105);
    group.add(mainPillow);

    // Anatomically Mirrored Curved Boxing Thumb (tucked on the inside of each fist)
    const thumbSign = isLeft ? -1 : 1;
    const thumb = new THREE.Mesh(new THREE.SphereGeometry(0.042, 12, 12), gloveMat);
    thumb.position.set(thumbSign * 0.068, -0.014, 0.082);
    thumb.rotation.y = thumbSign * 0.25;
    thumb.scale.set(1.1, 0.82, 1.45);
    group.add(thumb);

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

  private cycleCameraPreset(): void {
    const order: BoxingCameraPreset[] = ['classic_side', 'wide_arena', 'fighter_pov'];
    const nextIdx = (order.indexOf(this.cameraPreset) + 1) % order.length;
    this.cameraPreset = order[nextIdx];

    const labelMap: Record<BoxingCameraPreset, string> = {
      classic_side: '📷 CLASSIC SIDE CAM',
      wide_arena: '📷 WIDE ARENA CAM',
      fighter_pov: '📷 FIGHTER POV CAM',
    };
    this.hud.showCallout(labelMap[this.cameraPreset], '#00f2fe');
  }

  private bindKeyboardShortcuts(): void {
    this.keydownListener = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'c') {
        this.cycleCameraPreset();
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
        this.hud.showCallout('🛡️ BLOCKED!', '#00f2fe');
      } else if (k === 's') {
        this.punchClassifier.triggerSyntheticDefense('SLIP_LEFT');
        this.hud.showCallout('💨 SLIPPED!', '#ffd700');
      }
    };
    window.addEventListener('keydown', this.keydownListener);
  }

  // ─── 6. Reset & Pre-Round Countdown ───────────────────────────────────────

  reset(): void {
    this.playerHealth = this.MAX_HEALTH;
    this.opponentHealth = this.MAX_HEALTH;
    this.playerStamina = 100;
    this.playerInvulnTimer = 0;
    this.oppInvulnTimer = 0;
    this.opponentVulnerableTimer = 0;
    this.oppConsecutiveCleanHits = 0;
    this.oppRetreatTimer = 0;

    this.roundCountdown = 3.0; // 3-second pre-fight countdown
    this.fightBannerTimer = 0;
    this.isRoundActive = false;
    this.isMatchOver = false;
    this.matchWinner = null;
    this.currentRound = 1;
    this.roundTimeRemaining = 50;
    this.playerRoundsWon = 0;
    this.oppRoundsWon = 0;

    this.isGuarding = false;
    this.leftWristNearChin = false;
    this.rightWristNearChin = false;
    this.headSlipX = 0;
    this.headDuckY = 0;
    this.playerIdleTime = 0;
    this.activeAction = 'IDLE_BOUNCE';
    this.hasInitializedWristTracking = false;
    this.opponentMode = 'system'; // Enforce Player vs. System (AI) mode

    const diffParams = this.getDifficultyParams();
    this.oppGuardState = 'HIGH_GUARD';
    this.oppGuardTimer = 1.8;
    this.oppTelegraphDuration = diffParams.telegraphDuration;
    this.oppAttackTimer = this.getInitialAttackCooldown();
    this.oppTelegraphTimer = 0;
    this.aiIsTelegraphing = false;
    this.aiIsStriking = false;
    this.aiStrikeProgress = 0;
    if (this.oppTelegraphGlow) this.oppTelegraphGlow.visible = false;
    if (this.playerGuardShieldMesh) this.playerGuardShieldMesh.visible = false;
    this.hud.hideTelegraph();
    this.hud.setActiveDifficultyButton(diffParams.tier);

    // Reset Kinetic Hands to natural Orthodox/Southpaw bent-elbow guard positions
    const isRightHanded = this.dominantHand === 'right';
    this.playerGuardL.set(-0.12, isRightHanded ? 0.05 : 0.02, isRightHanded ? 0.32 : 0.24);
    this.playerGuardR.set(0.12, isRightHanded ? 0.02 : 0.05, isRightHanded ? 0.24 : 0.32);

    this.leftHand.state = 'GUARD';
    this.leftHand.timer = 0;
    this.leftHand.punchEvent = null;
    this.rightHand.state = 'GUARD';
    this.rightHand.timer = 0;
    this.rightHand.punchEvent = null;

    this.trackedLeftGloveOffset.copy(this.playerGuardL);
    this.trackedRightGloveOffset.copy(this.playerGuardR);
    this.playerLeftElbowPole.set(0.34, -0.92, -0.18);
    this.playerRightElbowPole.set(-0.34, -0.92, -0.18);
    this.playerLeftElbowPos.set(0.06, -0.22, 0.14);
    this.playerRightElbowPos.set(-0.06, -0.22, 0.12);
    this.oppLeftElbowPos.set(0.06, -0.22, 0.14);
    this.oppRightElbowPos.set(-0.06, -0.22, 0.12);
    this.playerTorsoTwistY = isRightHanded ? -0.08 : 0.08;
    this.oppTorsoTwistY = -0.08;

    if (this.playerGloveL && this.playerUpperArmLMesh && this.playerElbowLMesh && this.playerForearmLMesh) {
      this.playerGloveL.position.copy(this.trackedLeftGloveOffset);
      this.solveTwoBoneArmIK(
        this.playerUpperArmLMesh,
        this.playerElbowLMesh,
        this.playerForearmLMesh,
        this.playerGloveL,
        this.playerGloveL.position,
        this.playerLeftElbowPole,
        true,
        0,
        0,
        this.playerLeftElbowPos,
        this.dominantHand
      );
    }
    if (this.playerGloveR && this.playerUpperArmRMesh && this.playerElbowRMesh && this.playerForearmRMesh) {
      this.playerGloveR.position.copy(this.trackedRightGloveOffset);
      this.solveTwoBoneArmIK(
        this.playerUpperArmRMesh,
        this.playerElbowRMesh,
        this.playerForearmRMesh,
        this.playerGloveR,
        this.playerGloveR.position,
        this.playerRightElbowPole,
        false,
        0,
        0,
        this.playerRightElbowPos,
        this.dominantHand
      );
    }

    // Reset Opponent Staggers & Orientation
    this.oppHeadSnapRot.set(0, 0, 0);
    this.oppTorsoHunchRot.set(0, 0, 0);
    this.oppStaggerOffset.set(0, 0, 0);
    if (this.opponentGroup) {
      this.opponentGroup.rotation.x = 0;
      this.opponentGroup.position.copy(this.opponentRoot);
    }
    if (this.oppGloveL && this.oppUpperArmLMesh && this.oppElbowLMesh && this.oppForearmLMesh) {
      this.oppGloveL.position.set(-0.12, 0.05, 0.31);
      this.solveTwoBoneArmIK(
        this.oppUpperArmLMesh,
        this.oppElbowLMesh,
        this.oppForearmLMesh,
        this.oppGloveL,
        this.oppGloveL.position,
        this.scratchVecB.set(0.34, -0.92, -0.18),
        true,
        0,
        0,
        this.oppLeftElbowPos,
        'right'
      );
    }
    if (this.oppGloveR && this.oppUpperArmRMesh && this.oppElbowRMesh && this.oppForearmRMesh) {
      this.oppGloveR.position.set(0.12, 0.02, 0.24);
      this.solveTwoBoneArmIK(
        this.oppUpperArmRMesh,
        this.oppElbowRMesh,
        this.oppForearmRMesh,
        this.oppGloveR,
        this.oppGloveR.position,
        this.scratchVecB.set(-0.34, -0.92, -0.18),
        false,
        0,
        0,
        this.oppRightElbowPos,
        'right'
      );
    }

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

  private getInitialAttackCooldown(): number {
    // Initiate IRON TITAN's first attack ~1.1s after FIGHT! so the opponent is immediately active
    const params = this.getDifficultyParams();
    return Math.min(1.15, params.attackInterval * 0.55);
  }

  /**
   * Enforces a strict maximum human arm reach limit (default 0.72m) from the shoulder origin (0,0,0).
   * Eliminates rubber-banding and unnatural arm stretching during fast punches or tracking spikes.
   */
  private clampArmReach(offset: THREE.Vector3, maxReach = this.MAX_ARM_REACH): THREE.Vector3 {
    const dist = offset.length();
    if (dist > maxReach && dist > 1e-5) {
      offset.normalize().multiplyScalar(maxReach);
    }
    return offset;
  }

  // ─── 7. Simulation Frame Loop (60+ FPS) ───────────────────────────────────

  update(dt: number, frame: MotionFrame | null): void {
    // Clamp frame delta so browser tab switches or webcam init pauses don't cause jumps
    const safeDt = Math.min(Math.max(dt, 0), 0.1);

    // Hit-Stop Micro-Freeze (40ms)
    if (this.hitStopTimer > 0) {
      this.hitStopTimer -= safeDt;
      if (this.renderer && this.scene && this.camera) {
        this.renderer.render(this.scene, this.camera);
      }
      return;
    }

    this.playerIdleTime += safeDt;
    this.oppIdleTime += safeDt;

    // 1. Pre-Round 3-Second Countdown & Match Timer State Machine
    // Never gated behind Avatar3D.isFullBodyStanding or motionFrame presence
    if (!this.isMatchOver) {
      if (this.roundCountdown > 0 && safeDt > 0) {
        this.roundCountdown -= safeDt;
        if (this.roundCountdown <= 0) {
          this.roundCountdown = 0;
          this.isRoundActive = true;
          this.fightBannerTimer = 0.65;
          this.hud.showCountdown(this.currentRound, 'FIGHT!');
          this.audio.boxingBellRing(1);
          this.audio.boxingCrowdRoar(0.9);
          this.hud.showCallout(`🔔 ROUND ${this.currentRound} — FIGHT!`, '#ffd700');
        } else if (this.roundCountdown > 2.0) {
          this.hud.showCountdown(this.currentRound, '3');
        } else if (this.roundCountdown > 1.0) {
          this.hud.showCountdown(this.currentRound, '2');
        } else {
          this.hud.showCountdown(this.currentRound, '1');
        }
      } else if (this.roundCountdown <= 0) {
        if (!this.isRoundActive && safeDt > 0) {
          this.isRoundActive = true;
        }
        if (this.fightBannerTimer > 0) {
          this.fightBannerTimer -= safeDt;
          if (this.fightBannerTimer <= 0) {
            this.hud.hideCountdown();
          }
        } else {
          this.hud.hideCountdown();
        }

        if (this.isRoundActive && safeDt > 0) {
          this.roundTimeRemaining = Math.max(0, this.roundTimeRemaining - safeDt);
          if (this.roundTimeRemaining <= 0) {
            this.advanceRound();
          }
        }
      }
    }

    // 2. Hit Cooldown / Stagger ($i$-frame) & Defensive Retreat Timer Decays
    if (this.playerInvulnTimer > 0) {
      this.playerInvulnTimer = Math.max(0, this.playerInvulnTimer - safeDt);
    }
    if (this.oppInvulnTimer > 0) {
      this.oppInvulnTimer = Math.max(0, this.oppInvulnTimer - safeDt);
      if (this.oppInvulnTimer <= 0) {
        this.oppSkinMat.color.setHex(0xc68642);
      }
    }
    if (this.opponentVulnerableTimer > 0) {
      this.opponentVulnerableTimer = Math.max(0, this.opponentVulnerableTimer - safeDt);
    }
    if (this.oppRetreatTimer > 0) {
      this.oppRetreatTimer = Math.max(0, this.oppRetreatTimer - safeDt);
    }

    // 3. Live 1:1 Webcam Landmark Binding (Player vs. System AI — Zero Player Auto-Play)
    const nowMs = performance.now();
    // Only pass frame to classifier if landmarks have high confidence, while still allowing synthetic key presses
    const hasConfidentPose = this.isFramePoseConfident(frame);
    const { punch: classifiedPunch, defense } = this.punchClassifier.update(
      hasConfidentPose ? frame : null,
      nowMs,
      this.isRoundActive && !this.isMatchOver
    );

    const directPunch = this.updatePlayerLiveTracking(safeDt, frame, defense, nowMs, hasConfidentPose);
    const activePunch = directPunch || classifiedPunch;

    if (this.isRoundActive && !this.isMatchOver && activePunch) {
      this.triggerKineticPunch(activePunch);
    }

    // 4. Stamina Regeneration (when not throwing an extending punch)
    if (
      this.isRoundActive &&
      !this.isMatchOver &&
      this.leftHand.state === 'GUARD' &&
      this.rightHand.state === 'GUARD'
    ) {
      const regenRate = this.isGuarding ? 14.0 : 18.0; // % per second
      this.playerStamina = Math.min(100, this.playerStamina + regenRate * safeDt);
    }

    // 5. Update Kinetic Punches & 2-Bone Articulated Arm IK (Shoulder -> Elbow -> Wrist/Glove)
    this.updateKineticArm(
      this.leftHand,
      safeDt,
      this.playerUpperArmLMesh,
      this.playerElbowLMesh,
      this.playerForearmLMesh,
      this.playerGloveL,
      this.trackedLeftGloveOffset,
      this.playerLeftElbowPole,
      this.playerLeftElbowPos,
      true
    );
    this.updateKineticArm(
      this.rightHand,
      safeDt,
      this.playerUpperArmRMesh,
      this.playerElbowRMesh,
      this.playerForearmRMesh,
      this.playerGloveR,
      this.trackedRightGloveOffset,
      this.playerRightElbowPole,
      this.playerRightElbowPos,
      false
    );

    // 6. Dynamic AI Guard & Attacks (Drives ONLY the Red Opponent IRON TITAN)
    if (this.isRoundActive && !this.isMatchOver) {
      this.updateOpponentAI(safeDt, defense);
    }

    // 7. Visual Mesh Animations & Camera Framing
    this.updateOpponentVisuals(safeDt);
    this.updateParticlesAndShaders(safeDt);
    this.updateCamera(safeDt);
    this.updateProjectedFighterMarkers();

    // 8. Update Broadcast HUD (200 HP Health Pools)
    this.hud.update({
      playerHealth: this.playerHealth,
      maxPlayerHealth: this.MAX_HEALTH,
      opponentHealth: this.opponentHealth,
      maxOpponentHealth: this.MAX_HEALTH,
      stamina: this.playerStamina,
      round: this.currentRound,
      maxRounds: this.maxRounds,
      roundTimeLeft: this.roundTimeRemaining,
      comboCount: this.comboCount,
      cameraPreset: this.cameraPreset,
      difficulty: this.getDifficultyParams().tier,
    });

    // 9. Render Frame
    this.renderer.render(this.scene, this.camera);
  }

  private isFramePoseConfident(frame: MotionFrame | null): boolean {
    if (!frame || !frame.rawLandmarks || frame.rawLandmarks.length < 17) return false;
    const raw = frame.rawLandmarks;
    const lSh = raw[PoseLandmark.LEFT_SHOULDER];
    const rSh = raw[PoseLandmark.RIGHT_SHOULDER];
    const lWr = raw[PoseLandmark.LEFT_WRIST];
    const rWr = raw[PoseLandmark.RIGHT_WRIST];
    if (!lSh || !rSh || !lWr || !rWr) return false;

    const shVis = ((lSh.visibility ?? 1) + (rSh.visibility ?? 1)) * 0.5;
    const wrVis = Math.max(lWr.visibility ?? 1, rWr.visibility ?? 1);
    return shVis >= 0.45 && wrVis >= 0.45;
  }

  private updateProjectedFighterMarkers(): void {
    if (!this.camera) return;

    // Hide duplicate 3D canvas sprites so only the crisp screen-clamped HUD markers display
    if (this.playerLabelSprite) this.playerLabelSprite.visible = false;
    if (this.oppLabelSprite) this.oppLabelSprite.visible = false;

    // Hide floating labels during pre-round countdowns, FIGHT! banner transitions, or match end
    // so they never block the central round banner or overlap top health bars
    const isBannerTransitionActive =
      this.roundCountdown > 0 || this.fightBannerTimer > 0 || this.isMatchOver;

    const projectWorldPoint = (
      worldPos: THREE.Vector3,
      isVisible: boolean,
      minX: number,
      maxX: number
    ) => {
      const ndc = worldPos.clone().project(this.camera);
      const inFrustum =
        isVisible && !isBannerTransitionActive && ndc.z >= -1 && ndc.z <= 1;
      const xPct = THREE.MathUtils.clamp((ndc.x * 0.5 + 0.5) * 100, minX, maxX);
      // Clamp yPct to [30, 82] so labels stay safely below the top health bars and AI tier selector
      const yPct = THREE.MathUtils.clamp((-ndc.y * 0.5 + 0.5) * 100, 30, 82);
      return { xPct, yPct, visible: inFrustum };
    };

    // Offset markers slightly toward each fighter's outer flank so the central arena stays clear
    const pHeadFlank = this.playerGroup.position.clone().add(new THREE.Vector3(0.24, 1.82, 0));
    const oHeadFlank = this.opponentGroup.position.clone().add(new THREE.Vector3(-0.24, 1.82, 0));

    const showPlayerMarker = this.cameraPreset !== 'fighter_pov';

    this.hud.updateFighterMarkers(
      projectWorldPoint(pHeadFlank, showPlayerMarker, 12, 35),
      projectWorldPoint(oHeadFlank, true, 65, 88)
    );
  }

  // ─── 7B. Continuous 1:1 Webcam Landmark Binding & Natural Boxing Kinematics ─

  private updatePlayerLiveTracking(
    dt: number,
    frame: MotionFrame | null,
    defense: DefensiveState,
    nowMs: number,
    hasConfidentPose: boolean
  ): PunchEvent | null {
    const safeDt = dt > 0 ? dt : 0.016;
    const lerpRate = Math.min(1.0, safeDt * 18.0);
    const isRightHanded = this.dominantHand === 'right';

    // Update Orthodox/Southpaw base guard targets with subtle figure-8 boxing rhythm weave
    const t = this.playerIdleTime * 3.8;
    const weaveLX = Math.sin(t) * 0.014;
    const weaveLY = Math.cos(t * 2.0) * 0.016;
    const weaveLZ = Math.sin(t + 0.8) * 0.018;
    const weaveRX = Math.cos(t) * 0.014;
    const weaveRY = Math.sin(t * 2.0) * 0.015;
    const weaveRZ = Math.cos(t + 0.8) * 0.016;

    this.playerGuardL.set(
      -0.12 + weaveLX,
      (isRightHanded ? 0.05 : 0.02) + weaveLY,
      (isRightHanded ? 0.32 : 0.24) + weaveLZ
    );
    this.playerGuardR.set(
      0.12 + weaveRX,
      (isRightHanded ? 0.02 : 0.05) + weaveRY,
      (isRightHanded ? 0.24 : 0.32) + weaveRZ
    );

    // If motionFrame is null or low-confidence, hold player in natural bent-elbow boxing stance
    if (!frame || !hasConfidentPose || !frame.rawLandmarks || frame.rawLandmarks.length < 17) {
      this.hasInitializedWristTracking = false;
      this.isGuarding = defense.isHighGuard || defense.isBodyGuard;
      this.leftWristNearChin = this.isGuarding;
      this.rightWristNearChin = this.isGuarding;
      this.headSlipX = THREE.MathUtils.lerp(this.headSlipX, defense.slipRatio * 0.28, lerpRate);
      this.headDuckY = THREE.MathUtils.lerp(this.headDuckY, defense.isDucking ? -0.18 : 0, lerpRate);
      this.trackedLeftGloveOffset.lerp(this.playerGuardL, lerpRate);
      this.trackedRightGloveOffset.lerp(this.playerGuardR, lerpRate);
      this.playerLeftElbowPole.lerp(
        this.scratchVecA.set(isRightHanded ? 0.30 : 0.36, -0.92, -0.18),
        lerpRate
      );
      this.playerRightElbowPole.lerp(
        this.scratchVecB.set(isRightHanded ? -0.36 : -0.30, -0.92, -0.18),
        lerpRate
      );
      this.clampArmReach(this.trackedLeftGloveOffset, this.MAX_ARM_REACH);
      this.clampArmReach(this.trackedRightGloveOffset, this.MAX_ARM_REACH);
      if (this.leftHand.state === 'GUARD' && this.rightHand.state === 'GUARD') {
        this.activeAction = this.isGuarding ? 'GUARD' : 'IDLE_BOUNCE';
      }
      this.applyPlayerBodyPose(lerpRate);
      return null;
    }

    const raw = frame.rawLandmarks;
    const world = frame.worldLandmarks || [];
    const vels = frame.velocities || [];

    const nose = raw[PoseLandmark.NOSE];
    const lShoulder = raw[PoseLandmark.LEFT_SHOULDER];
    const rShoulder = raw[PoseLandmark.RIGHT_SHOULDER];
    const lElbow = raw[PoseLandmark.LEFT_ELBOW];
    const rElbow = raw[PoseLandmark.RIGHT_ELBOW];
    const lWrist = raw[PoseLandmark.LEFT_WRIST];
    const rWrist = raw[PoseLandmark.RIGHT_WRIST];

    if (!nose || !lShoulder || !rShoulder || !lWrist || !rWrist) {
      this.applyPlayerBodyPose(lerpRate);
      return null;
    }

    // 1. SLIP / DUCK: Track NOSE.x and shoulder midpoint X relative to 0.5 (and vertical head drop)
    const shoulderMidX = (lShoulder.x + rShoulder.x) * 0.5;
    const shoulderMidY = (lShoulder.y + rShoulder.y) * 0.5;
    const noseDeviationX = (nose.x - 0.5) * 1.15 + (nose.x - shoulderMidX) * 1.35;
    const targetSlipX = THREE.MathUtils.clamp(noseDeviationX, -0.42, 0.42);
    this.headSlipX = THREE.MathUtils.lerp(this.headSlipX, targetSlipX, lerpRate);

    // Vertical head drop: in normalized 2D coords, larger Y means lower on screen
    const noseToShoulderY = shoulderMidY - nose.y; // normally ~0.18..0.24 upright
    const isDuckingPose = nose.y > 0.56 || noseToShoulderY < 0.11 || defense.isDucking;
    const targetDuckY = isDuckingPose ? -0.20 : 0.0;
    this.headDuckY = THREE.MathUtils.lerp(this.headDuckY, targetDuckY, lerpRate);

    // 2. Right-Handed / Left-Handed Alignment & Continuous 1:1 Arm/Glove Tracking
    const physLeftWrist = lWrist;
    const physRightWrist = rWrist;
    const physLeftShoulder = lShoulder;
    const physRightShoulder = rShoulder;
    const physLeftElbow = lElbow || lShoulder;
    const physRightElbow = rElbow || rShoulder;

    const worldLWrist = world[PoseLandmark.LEFT_WRIST];
    const worldRWrist = world[PoseLandmark.RIGHT_WRIST];
    const worldLShoulder = world[PoseLandmark.LEFT_SHOULDER];
    const worldRShoulder = world[PoseLandmark.RIGHT_SHOULDER];

    // Update dynamic elbow pole vectors from webcam elbow landmarks + dominant arm stance
    const leadBiasL = isRightHanded ? 0.30 : 0.36;
    const rearBiasR = isRightHanded ? -0.36 : -0.30;
    const lElbowFlareX = THREE.MathUtils.clamp(
      leadBiasL + Math.max(0, physLeftElbow.x - physLeftShoulder.x) * 1.5,
      0.20,
      0.84
    );
    const lElbowFlareY = THREE.MathUtils.clamp(
      -0.90 + Math.max(0, physLeftShoulder.y - physLeftElbow.y) * 1.15,
      -0.95,
      -0.18
    );
    const rElbowFlareX = THREE.MathUtils.clamp(
      rearBiasR - Math.max(0, physRightShoulder.x - physRightElbow.x) * 1.5,
      -0.84,
      -0.20
    );
    const rElbowFlareY = THREE.MathUtils.clamp(
      -0.90 + Math.max(0, physRightShoulder.y - physRightElbow.y) * 1.15,
      -0.95,
      -0.18
    );
    this.playerLeftElbowPole.lerp(
      this.scratchVecA.set(lElbowFlareX, lElbowFlareY, -0.18).normalize(),
      lerpRate
    );
    this.playerRightElbowPole.lerp(
      this.scratchVecB.set(rElbowFlareX, rElbowFlareY, -0.18).normalize(),
      lerpRate
    );

    // 3. GUARD Detection: Check LEFT_WRIST and RIGHT_WRIST heights near chin/nose height
    const chinY = nose.y + Math.max(0.05, (shoulderMidY - nose.y) * 0.45);
    this.leftWristNearChin =
      physLeftWrist.y < physLeftShoulder.y + 0.06 || Math.abs(physLeftWrist.y - chinY) < 0.14;
    this.rightWristNearChin =
      physRightWrist.y < physRightShoulder.y + 0.06 || Math.abs(physRightWrist.y - chinY) < 0.14;

    const lDistNose = Math.hypot(physLeftWrist.x - nose.x, physLeftWrist.y - nose.y);
    const rDistNose = Math.hypot(physRightWrist.x - nose.x, physRightWrist.y - nose.y);
    const wristsCloseTogether = Math.abs(physLeftWrist.x - physRightWrist.x) < 0.30;

    const rawGuardDetected =
      this.leftWristNearChin &&
      this.rightWristNearChin &&
      ((lDistNose < 0.30 && rDistNose < 0.30) || wristsCloseTogether);

    this.isGuarding = rawGuardDetected || defense.isHighGuard;

    // Map live wrist positions to 3D glove offsets in Left/Right ArmGroup local space
    // anchored around a natural bent-elbow boxing stance and clamped to MAX_ARM_REACH = 0.72m
    if (this.isGuarding) {
      // High Peek-a-Boo Guard: elbows tucked tight to ribs, gloves raised in front of temples/cheeks
      const guardL = this.clampArmReach(new THREE.Vector3(-0.14, 0.10, 0.27), this.MAX_ARM_REACH);
      const guardR = this.clampArmReach(new THREE.Vector3(0.14, 0.10, 0.27), this.MAX_ARM_REACH);
      this.trackedLeftGloveOffset.lerp(guardL, lerpRate);
      this.trackedRightGloveOffset.lerp(guardR, lerpRate);
      this.playerLeftElbowPole.lerp(this.scratchVecA.set(0.22, -0.95, -0.12), lerpRate);
      this.playerRightElbowPole.lerp(this.scratchVecB.set(-0.22, -0.95, -0.12), lerpRate);
      this.activeAction = 'GUARD';
    } else {
      // Compute 3D shoulder-to-wrist vectors from worldLandmarks (meters) with rawLandmarks fallback
      const lShoulderToWristWorld =
        worldLWrist && worldLShoulder
          ? this.clampArmReach(
              new THREE.Vector3(
                worldLWrist.x - worldLShoulder.x,
                worldLShoulder.y - worldLWrist.y,
                Math.max(0, worldLShoulder.z - worldLWrist.z)
              ),
              this.MAX_ARM_REACH
            )
          : new THREE.Vector3(0, 0, 0);

      const rShoulderToWristWorld =
        worldRWrist && worldRShoulder
          ? this.clampArmReach(
              new THREE.Vector3(
                worldRWrist.x - worldRShoulder.x,
                worldRShoulder.y - worldRWrist.y,
                Math.max(0, worldRShoulder.z - worldRWrist.z)
              ),
              this.MAX_ARM_REACH
            )
          : new THREE.Vector3(0, 0, 0);

      // Naturally bound left/right hand deltas around the boxer's bent-elbow guard posture
      const lRelX = THREE.MathUtils.clamp(
        worldLWrist && worldLShoulder
          ? lShoulderToWristWorld.x * 0.85
          : (physLeftWrist.x - physLeftShoulder.x) * 0.95,
        -0.24,
        0.24
      );
      const lRelY = THREE.MathUtils.clamp(
        worldLWrist && worldLShoulder
          ? (lShoulderToWristWorld.y + 0.08) * 0.92
          : (physLeftShoulder.y + 0.05 - physLeftWrist.y) * 1.15,
        -0.26,
        0.28
      );
      const lSpan = Math.hypot(
        physLeftWrist.x - physLeftShoulder.x,
        physLeftWrist.y - physLeftShoulder.y
      );
      const lForwardZ = Math.max(lShoulderToWristWorld.z * 0.85, Math.max(0, -(physLeftWrist.z || 0) * 0.60));
      const lDepthZ = THREE.MathUtils.clamp(
        this.playerGuardL.z + Math.max(0, lSpan - 0.15) * 0.72 + lForwardZ * 0.78,
        0.20,
        0.55
      );

      const rRelX = THREE.MathUtils.clamp(
        worldRWrist && worldRShoulder
          ? rShoulderToWristWorld.x * 0.85
          : (physRightWrist.x - physRightShoulder.x) * 0.95,
        -0.24,
        0.24
      );
      const rRelY = THREE.MathUtils.clamp(
        worldRWrist && worldRShoulder
          ? (rShoulderToWristWorld.y + 0.08) * 0.92
          : (physRightShoulder.y + 0.05 - physRightWrist.y) * 1.15,
        -0.26,
        0.28
      );
      const rSpan = Math.hypot(
        physRightWrist.x - physRightShoulder.x,
        physRightWrist.y - physRightShoulder.y
      );
      const rForwardZ = Math.max(rShoulderToWristWorld.z * 0.85, Math.max(0, -(physRightWrist.z || 0) * 0.60));
      const rDepthZ = THREE.MathUtils.clamp(
        this.playerGuardR.z + Math.max(0, rSpan - 0.15) * 0.72 + rForwardZ * 0.78,
        0.20,
        0.55
      );

      const lTargetVec = this.clampArmReach(
        new THREE.Vector3(
          this.playerGuardL.x + lRelX * 0.85,
          this.playerGuardL.y + lRelY * 0.88,
          lDepthZ
        ),
        this.MAX_ARM_REACH
      );
      const rTargetVec = this.clampArmReach(
        new THREE.Vector3(
          this.playerGuardR.x + rRelX * 0.85,
          this.playerGuardR.y + rRelY * 0.88,
          rDepthZ
        ),
        this.MAX_ARM_REACH
      );

      this.trackedLeftGloveOffset.lerp(lTargetVec, lerpRate);
      this.trackedRightGloveOffset.lerp(rTargetVec, lerpRate);
      this.clampArmReach(this.trackedLeftGloveOffset, this.MAX_ARM_REACH);
      this.clampArmReach(this.trackedRightGloveOffset, this.MAX_ARM_REACH);

      // Subtle shoulder socket elevation response (in torsoGroup local space where shoulder base Y = 0.22)
      if (this.playerLeftArmGroup && this.playerRightArmGroup) {
        const lElbowLift = THREE.MathUtils.clamp((physLeftShoulder.y - physLeftElbow.y) * 0.16, -0.04, 0.07);
        const rElbowLift = THREE.MathUtils.clamp((physRightShoulder.y - physRightElbow.y) * 0.16, -0.04, 0.07);
        this.playerLeftArmGroup.position.y = THREE.MathUtils.lerp(this.playerLeftArmGroup.position.y, 0.22 + lElbowLift, lerpRate);
        this.playerRightArmGroup.position.y = THREE.MathUtils.lerp(this.playerRightArmGroup.position.y, 0.22 + rElbowLift, lerpRate);
      }

      if (Math.abs(this.headSlipX) > 0.14) {
        this.activeAction = this.headSlipX > 0 ? 'SLIP_LEFT' : 'SLIP_RIGHT';
      } else if (isDuckingPose) {
        this.activeAction = 'DUCK';
      } else if (this.leftHand.state === 'GUARD' && this.rightHand.state === 'GUARD') {
        this.activeAction = 'IDLE_BOUNCE';
      }
    }

    this.applyPlayerBodyPose(lerpRate);

    // 4. Direct Punch Detection (JAB / CROSS & BODY BLOW) from live wrist velocities & extension
    const lVel = vels[PoseLandmark.LEFT_WRIST] || { x: 0, y: 0, z: 0 };
    const rVel = vels[PoseLandmark.RIGHT_WRIST] || { x: 0, y: 0, z: 0 };
    const lWorldSpeed = Math.hypot(lVel.x, lVel.y, lVel.z);
    const rWorldSpeed = Math.hypot(rVel.x, rVel.y, rVel.z);

    const lExt = Math.hypot(
      physLeftWrist.x - physLeftShoulder.x,
      physLeftWrist.y - physLeftShoulder.y,
      (physLeftWrist.z || 0) - (physLeftShoulder.z || 0)
    );
    const rExt = Math.hypot(
      physRightWrist.x - physRightShoulder.x,
      physRightWrist.y - physRightShoulder.y,
      (physRightWrist.z || 0) - (physRightShoulder.z || 0)
    );

    const curLWristZ = worldLWrist?.z ?? 0;
    const curRWristZ = worldRWrist?.z ?? 0;

    if (!this.hasInitializedWristTracking) {
      this.prevLeftExtension = lExt;
      this.prevRightExtension = rExt;
      this.prevLeftWristZ = curLWristZ;
      this.prevRightWristZ = curRWristZ;
      this.hasInitializedWristTracking = true;
      return null;
    }

    const dtStep = Math.max(dt, 0.012);
    const lExtRate = Math.max(0, (lExt - this.prevLeftExtension) / dtStep);
    const rExtRate = Math.max(0, (rExt - this.prevRightExtension) / dtStep);
    const lZRate = Math.max(0, (this.prevLeftWristZ - curLWristZ) / dtStep);
    const rZRate = Math.max(0, (this.prevRightWristZ - curRWristZ) / dtStep);

    this.prevLeftExtension = lExt;
    this.prevRightExtension = rExt;
    this.prevLeftWristZ = curLWristZ;
    this.prevRightWristZ = curRWristZ;

    const lEffectiveSpeed = Math.max(lWorldSpeed, lExtRate * 1.35, lZRate * 1.15);
    const rEffectiveSpeed = Math.max(rWorldSpeed, rExtRate * 1.35, rZRate * 1.15);

    if (
      this.isRoundActive &&
      !this.isMatchOver &&
      !this.isGuarding &&
      nowMs - this.lastDirectPunchTime >= 260
    ) {
      const useRight = rEffectiveSpeed >= lEffectiveSpeed;
      const bestSpeed = useRight ? rEffectiveSpeed : lEffectiveSpeed;
      const activeWrist2D = useRight ? physRightWrist : physLeftWrist;
      const activeShoulder2D = useRight ? physRightShoulder : physLeftShoulder;
      const activeExt = useRight ? rExt : lExt;
      const activeArm: 'left' | 'right' = useRight ? 'right' : 'left';
      const activeVis = activeWrist2D.visibility ?? 1.0;

      if (bestSpeed > 1.75 && activeExt > 0.15 && activeVis >= 0.50) {
        this.lastDirectPunchTime = nowMs;
        // BODY BLOW: thrown lower (wrist.y > shoulder.y + 0.08 in normalized webcam coords)
        const isLowBodyBlow = activeWrist2D.y > activeShoulder2D.y + 0.08;
        const isLeadHand = this.dominantHand === 'right' ? activeArm === 'left' : activeArm === 'right';
        const punchType = isLowBodyBlow
          ? (activeArm === 'left' ? 'LEFT_HOOK' : 'RIGHT_HOOK')
          : (isLeadHand ? 'JAB' : 'CROSS');

        return {
          type: punchType,
          arm: activeArm,
          speedMps: Math.min(9.5, bestSpeed),
          speedKmh: Math.min(9.5, bestSpeed) * 3.6,
          damage: isLowBodyBlow ? 14 : isLeadHand ? 8 : 12,
          target: isLowBodyBlow ? 'body' : 'head',
          timestamp: nowMs,
          velocity: useRight ? rVel : lVel,
        };
      }
    }

    return null;
  }

  private applyPlayerBodyPose(lerpRate: number): void {
    // Gentle athletic IDLE_BOUNCE when player is in neutral guarded stance
    const idleBounceY = Math.sin(this.playerIdleTime * 4.2) * 0.015;
    // Slight forward step-in (-X toward opponent) when throwing a punch
    const leftPunching = this.leftHand.state !== 'GUARD';
    const rightPunching = this.rightHand.state !== 'GUARD';
    const isPunching = leftPunching || rightPunching;
    const punchStepInX = isPunching ? -0.11 : 0.0;

    // Authentic Boxing Shoulder Roll / Torso Twist around Y axis when punching or in stance
    const baseStanceYaw = this.dominantHand === 'right' ? -0.10 : 0.10;
    const targetTwistY = leftPunching
      ? -0.28 // Rotate left shoulder forward into Jab / Left Hook
      : rightPunching
        ? 0.30 // Rotate right shoulder forward into Cross / Right Hook
        : baseStanceYaw + Math.sin(this.playerIdleTime * 2.1) * 0.04;
    this.playerTorsoTwistY = THREE.MathUtils.lerp(this.playerTorsoTwistY, targetTwistY, lerpRate);

    this.playerGroup.position.x = THREE.MathUtils.lerp(
      this.playerGroup.position.x,
      this.playerRoot.x + punchStepInX + this.headSlipX * 0.42,
      lerpRate
    );
    this.playerGroup.position.z = THREE.MathUtils.lerp(
      this.playerGroup.position.z,
      this.playerRoot.z - this.headSlipX * 0.60,
      lerpRate
    );
    this.playerGroup.position.y = THREE.MathUtils.lerp(
      this.playerGroup.position.y,
      this.playerRoot.y + idleBounceY + this.headDuckY * 0.65,
      lerpRate
    );

    if (this.playerTorsoGroup) {
      // Lean torso visibly in side profile (pitch X), shoulder-roll twist (yaw Y), and lateral weave (roll Z)
      this.playerTorsoGroup.rotation.x = THREE.MathUtils.lerp(
        this.playerTorsoGroup.rotation.x,
        (isPunching ? 0.08 : 0.03) - this.headSlipX * 0.30 - this.headDuckY * 0.45,
        lerpRate
      );
      this.playerTorsoGroup.rotation.y = this.playerTorsoTwistY;
      this.playerTorsoGroup.rotation.z = THREE.MathUtils.lerp(
        this.playerTorsoGroup.rotation.z,
        -this.headSlipX * 0.45,
        lerpRate
      );
      this.playerTorsoGroup.position.y = THREE.MathUtils.lerp(
        this.playerTorsoGroup.position.y,
        1.15 + this.headDuckY * 0.4,
        lerpRate
      );
    }

    // Keep head counter-rotated toward opponent when shoulders twist
    if (this.playerHeadGroup) {
      this.playerHeadGroup.rotation.y = -this.playerTorsoTwistY * 0.75;
    }

    if (this.playerGuardShieldMesh) {
      this.playerGuardShieldMesh.visible = this.isGuarding;
    }
  }

  // ─── 8. Curved Boxing Strike Trajectories & 2-Bone Analytical Arm IK ──────

  private triggerKineticPunch(event: PunchEvent): void {
    const isLeft = event.arm === 'left';
    const rig = isLeft ? this.leftHand : this.rightHand;

    // Reject if already in active punch
    if (rig.state !== 'GUARD') return;

    // Stamina consumption (6-10% per punch)
    const staminaCost = event.type === 'JAB' ? 6 : event.target === 'body' ? 9 : 8;
    this.playerStamina = Math.max(0, this.playerStamina - staminaCost);

    rig.punchEvent = event;
    rig.state = 'EXTENDING';
    rig.timer = 0;
    rig.hitResolved = false;

    const isHead = event.target === 'head' || event.target === 'chin' || event.target === 'jaw';
    const isHook = event.type === 'LEFT_HOOK' || event.type === 'RIGHT_HOOK';
    rig.targetZone = isHead ? 'head' : 'body';
    this.activeAction = isHead ? event.type : 'BODY_BLOW';

    // Start from current live bent-elbow glove position
    rig.startPos.copy(isLeft ? this.trackedLeftGloveOffset : this.trackedRightGloveOffset);
    this.clampArmReach(rig.startPos, this.MAX_ARM_REACH);

    // Target wrist position in ArmGroup local space (within 2-Bone IK reach so elbow retains natural biomechanics)
    const targetY = isHead ? 0.12 : -0.18;
    const targetLocalX = isLeft ? -0.18 - this.headSlipX * 0.20 : 0.18 - this.headSlipX * 0.20;
    rig.targetPos.set(targetLocalX, targetY, 0.55);
    this.clampArmReach(rig.targetPos, this.MAX_ARM_REACH);

    // Curved 3D Quadratic Bezier Control Point for natural boxing punch arcs:
    // - Hooks swing wide laterally with elevated elbow
    // - Body blows dip downward first before driving up into the ribs
    // - Jabs & Crosses travel along a crisp cheek-to-chin arc
    if (!isHead) {
      rig.arcControlPos.set(isLeft ? 0.08 : -0.08, -0.26, 0.38);
    } else if (isHook) {
      rig.arcControlPos.set(isLeft ? 0.16 : -0.16, 0.14, 0.40);
    } else {
      rig.arcControlPos.set(targetLocalX * 0.5, 0.11, 0.44);
    }
    this.clampArmReach(rig.arcControlPos, this.MAX_ARM_REACH);

    this.audio.boxingPunchWhoosh(event.speedMps / 6.0);
  }

  private updateKineticArm(
    rig: KineticArmRig,
    dt: number,
    upperArmMesh: THREE.Mesh,
    elbowMesh: THREE.Mesh,
    forearmMesh: THREE.Mesh,
    gloveMesh: THREE.Group,
    liveTrackedOffset: THREE.Vector3,
    basePoleVector: THREE.Vector3,
    smoothedElbowPos: THREE.Vector3,
    isLeft: boolean
  ): void {
    let pronationBoost = 0;
    const activePole = this.scratchVecC.copy(basePoleVector);
    const otherRig = isLeft ? this.rightHand : this.leftHand;

    if (rig.state === 'GUARD') {
      // When the OTHER hand is throwing a punch, automatically tuck this guard hand tightly to the chin!
      if (otherRig.state !== 'GUARD') {
        const protectChinPos = this.scratchVecA.set(isLeft ? -0.15 : 0.15, 0.08, 0.25);
        gloveMesh.position.lerp(protectChinPos, Math.min(1.0, (dt > 0 ? dt : 0.016) * 20));
      } else {
        gloveMesh.position.lerp(liveTrackedOffset, Math.min(1.0, (dt > 0 ? dt : 0.016) * 18));
      }
    } else if (rig.state === 'EXTENDING') {
      rig.timer += dt;
      const rawProgress = Math.min(1.0, rig.timer / rig.extendingDuration);
      const t = Math.sin(rawProgress * Math.PI * 0.5);
      const invT = 1.0 - t;

      // Evaluate Quadratic Bezier curve: B(t) = (1-t)^2 * startPos + 2(1-t)t * arcControlPos + t^2 * targetPos
      gloveMesh.position.set(
        invT * invT * rig.startPos.x + 2 * invT * t * rig.arcControlPos.x + t * t * rig.targetPos.x,
        invT * invT * rig.startPos.y + 2 * invT * t * rig.arcControlPos.y + t * t * rig.targetPos.y,
        invT * invT * rig.startPos.z + 2 * invT * t * rig.arcControlPos.z + t * t * rig.targetPos.z
      );
      pronationBoost = t * 0.35;

      // Lift elbow horizontally on Hooks for authentic hook biomechanics
      if (rig.punchEvent?.type === 'LEFT_HOOK' || rig.punchEvent?.type === 'RIGHT_HOOK') {
        activePole.lerp(this.scratchVecA.set(isLeft ? 0.85 : -0.85, -0.18, -0.08).normalize(), t);
      }

      if (rawProgress >= 1.0) {
        rig.state = 'CONTACT';
        rig.timer = 0;
        this.resolvePlayerPunchContact(rig);
      }
    } else if (rig.state === 'CONTACT') {
      rig.timer += dt;
      gloveMesh.position.copy(rig.targetPos);
      pronationBoost = 0.35;
      if (rig.punchEvent?.type === 'LEFT_HOOK' || rig.punchEvent?.type === 'RIGHT_HOOK') {
        activePole.set(isLeft ? 0.85 : -0.85, -0.18, -0.08).normalize();
      }
      if (rig.timer >= rig.contactDuration) {
        rig.state = 'RETRACTING';
        rig.timer = 0;
      }
    } else if (rig.state === 'RETRACTING') {
      rig.timer += dt;
      const progress = Math.min(1.0, rig.timer / rig.retractingDuration);
      // Smoothly retract along the lower elbow-tucked recovery path back to guard
      gloveMesh.position.lerpVectors(rig.targetPos, liveTrackedOffset, progress);
      gloveMesh.position.y -= Math.sin(progress * Math.PI) * 0.04;
      pronationBoost = (1.0 - progress) * 0.35;

      if (progress >= 1.0) {
        rig.state = 'GUARD';
        rig.timer = 0;
        rig.punchEvent = null;
      }
    }

    // Solve 2-Bone Upper-Body Inverse Kinematics (Shoulder -> Elbow -> Wrist/Glove) with dt smoothing
    this.solveTwoBoneArmIK(
      upperArmMesh,
      elbowMesh,
      forearmMesh,
      gloveMesh,
      gloveMesh.position,
      activePole,
      isLeft,
      pronationBoost,
      dt,
      smoothedElbowPos,
      this.dominantHand
    );
  }

  /**
   * Natural Upper-Body Inverse Kinematics (IK) Solver for Boxing Arms.
   * 1. Calculates the midpoint between the shoulder (0,0,0) and target hand position (wristLocalPos).
   * 2. Applies an inward/downward elbow bend offset based on the dominant arm stance & pole direction.
   * 3. Projects onto the 2-bone anatomical triangle (Upper Arm L1 = 0.29m, Forearm L2 = 0.28m) and
   *    smooths both the elbow joint position and 16oz glove rotation using frame delta (dt).
   */
  private solveTwoBoneArmIK(
    upperArmMesh: THREE.Mesh,
    elbowMesh: THREE.Mesh,
    forearmMesh: THREE.Mesh,
    gloveGroup: THREE.Group,
    wristLocalPos: THREE.Vector3,
    poleDir: THREE.Vector3,
    isLeft: boolean,
    pronationBoost = 0,
    dt = 0.016,
    smoothedElbowPos?: THREE.Vector3,
    stanceDominantHand: 'right' | 'left' = this.dominantHand
  ): void {
    if (!upperArmMesh || !elbowMesh || !forearmMesh || !gloveGroup) return;

    const L1 = this.UPPER_ARM_LEN; // 0.29m
    const L2 = this.FOREARM_LEN;   // 0.28m
    const maxWristDist = Math.min(this.MAX_ARM_REACH - 0.14, L1 + L2 - 0.008); // 0.562m wrist + 0.14m glove <= 0.702m
    const minWristDist = 0.15;

    // Clamp wrist position within anatomical 2-bone reach
    const distRaw = wristLocalPos.length();
    if (distRaw > maxWristDist && distRaw > 1e-5) {
      wristLocalPos.multiplyScalar(maxWristDist / distRaw);
    } else if (distRaw < minWristDist && distRaw > 1e-5) {
      wristLocalPos.multiplyScalar(minWristDist / distRaw);
    } else if (distRaw <= 1e-5) {
      wristLocalPos.set(isLeft ? -0.12 : 0.12, 0.04, 0.28);
    }

    const d = THREE.MathUtils.clamp(wristLocalPos.length(), minWristDist, maxWristDist);
    const uHat = wristLocalPos.clone().divideScalar(d);

    // Step 1: Midpoint between Shoulder (0,0,0) and Target Hand/Wrist Position
    const midpoint = wristLocalPos.clone().multiplyScalar(0.5);

    // Step 2: Inward/downward elbow bend offset based on dominant arm stance (Orthodox vs Southpaw)
    const isLeadArm = stanceDominantHand === 'right' ? isLeft : !isLeft;
    const inwardSign = isLeft ? 1 : -1;
    const stanceInwardOffset = inwardSign * (isLeadArm ? 0.065 : 0.085); // Rear power elbow tucks tighter to ribs
    const stanceDownwardOffset = isLeadArm ? -0.19 : -0.22;              // Natural downward gravity hang on elbow
    const stanceBackOffset = isLeadArm ? -0.05 : -0.08;

    const stanceElbowTarget = midpoint
      .clone()
      .add(new THREE.Vector3(stanceInwardOffset, stanceDownwardOffset, stanceBackOffset));

    // Blend stance midpoint bend direction with live webcam elbow pole vector
    const blendedPole = stanceElbowTarget
      .sub(midpoint)
      .normalize()
      .lerp(poleDir.clone().normalize(), 0.55)
      .normalize();

    // Law of Cosines: exact elbow hinge offset from shoulder->wrist axis
    const cosAlpha = THREE.MathUtils.clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1.0, 1.0);
    const sinAlpha = Math.sqrt(Math.max(0.0, 1.0 - cosAlpha * cosAlpha));

    // Gram-Schmidt orthonormal bend direction perpendicular to uHat
    const proj = blendedPole.dot(uHat);
    const bendDir = blendedPole.sub(uHat.clone().multiplyScalar(proj));
    if (bendDir.lengthSq() < 1e-5) {
      bendDir.set(inwardSign * 0.34, -0.92, -0.15);
    }
    bendDir.normalize();

    // Target 3D Elbow Position E in ArmGroup local space
    const targetElbowPos = uHat
      .clone()
      .multiplyScalar(L1 * cosAlpha)
      .add(bendDir.multiplyScalar(L1 * sinAlpha));

    // Step 3: Smooth the elbow joint transition using frame delta (dt)
    let elbowPos = targetElbowPos;
    if (smoothedElbowPos) {
      if (dt > 0) {
        const elbowLerp = Math.min(1.0, dt * 24.0);
        smoothedElbowPos.lerp(targetElbowPos, elbowLerp);
        if (smoothedElbowPos.length() > 1e-4) {
          smoothedElbowPos.normalize().multiplyScalar(L1);
        }
      } else {
        smoothedElbowPos.copy(targetElbowPos);
      }
      elbowPos = smoothedElbowPos;
    }

    const yAxis = new THREE.Vector3(0, 1, 0);

    // 1. Upper Arm (Shoulder (0,0,0) -> Elbow E)
    upperArmMesh.position.copy(elbowPos).multiplyScalar(0.5);
    const upperLen = Math.max(0.05, elbowPos.length());
    upperArmMesh.scale.set(1, upperLen, 1);
    upperArmMesh.quaternion.setFromUnitVectors(yAxis, elbowPos.clone().divideScalar(upperLen));

    // 2. Elbow Joint Sphere at E
    elbowMesh.position.copy(elbowPos);

    // 3. Forearm (Elbow E -> Wrist W)
    const forearmVec = wristLocalPos.clone().sub(elbowPos);
    const forearmLen = Math.max(0.05, forearmVec.length());
    const forearmDir = forearmVec.divideScalar(forearmLen);

    forearmMesh.position.copy(elbowPos).addScaledVector(forearmDir, forearmLen * 0.5);
    forearmMesh.scale.set(1, forearmLen, 1);
    forearmMesh.quaternion.setFromUnitVectors(yAxis, forearmDir);

    // 4. 16oz Glove Orientation: align local +Z with forearmDir + natural boxing corkscrew pronation
    const zAxis = new THREE.Vector3(0, 0, 1);
    const alignQuat = new THREE.Quaternion().setFromUnitVectors(zAxis, forearmDir);

    // Extension ratio (0 in tight guard -> 1 at full punch extension)
    const extRatio = THREE.MathUtils.clamp((d - 0.25) / 0.29, 0.0, 1.0);
    const sideSign = isLeft ? 1 : -1;
    // In guard: palms face slightly inward toward chin; on extension: fist corkscrews horizontal
    const guardRoll = sideSign * 0.22;
    const punchRoll = sideSign * (1.30 + pronationBoost);
    const rollAngle = THREE.MathUtils.lerp(guardRoll, punchRoll, extRatio);
    const rollQuat = new THREE.Quaternion().setFromAxisAngle(zAxis, rollAngle);
    const targetGloveQuat = alignQuat.multiply(rollQuat);

    if (dt > 0) {
      gloveGroup.quaternion.slerp(targetGloveQuat, Math.min(1.0, dt * 26.0));
    } else {
      gloveGroup.quaternion.copy(targetGloveQuat);
    }
  }

  // ─── 9. Dual Hurtbox, Stagger I-Frames & Guard Collision Resolution ─────────

  private resolvePlayerPunchContact(rig: KineticArmRig): void {
    if (rig.hitResolved) return;
    rig.hitResolved = true;

    const diffParams = this.getDifficultyParams();
    const isTargetingHead = rig.targetZone === 'head';

    // Contact position in world coordinates
    const worldImpact = this.opponentGroup.position.clone();
    worldImpact.y = isTargetingHead ? 1.58 : 1.15;

    // 1. Stagger / Hit Cooldown ($i$-frames) & Defensive Step-Back Check:
    // While IRON TITAN is in stagger hit-recovery (0.45s) or executing a 1.2s Defensive Step-Back,
    // subsequent incoming punches automatically register as BLOCKED or SLIPPED (0 HP damage),
    // preventing spam multi-hit K.O.s in seconds.
    if (this.oppRetreatTimer > 0) {
      this.audio.boxingPunchWhoosh(1.2);
      this.triggerShieldRipple(worldImpact);
      this.hud.showCallout('💨 AI STEP-BACK — SLIPPED!', '#94a3b8');
      return;
    }

    if (this.oppInvulnTimer > 0) {
      this.audio.boxingGloveBlock();
      this.triggerShieldRipple(worldImpact);
      this.hud.showCallout(
        diffParams.tier === 'hard' ? '💨 SLIPPED!' : '🛡️ BLOCKED!',
        '#94a3b8'
      );
      return;
    }

    // Counter window only triggers when player has genuinely slipped or blocked an AI strike
    const isCounter = this.opponentVulnerableTimer > 0;
    const staminaScale = this.playerStamina < 15 ? 0.75 : 1.0;

    // Evaluate AI block/slip probability based on selected difficulty tier:
    // Starter: 20% block chance | Medium: 50% block chance | Hard: 80% block/slip chance
    // Plus adaptive pressure bonus when AI has already taken consecutive hits
    const pressureGuardBonus = this.oppConsecutiveCleanHits * 0.12;
    const effectiveGuardFreq = Math.min(0.90, diffParams.guardFrequency + pressureGuardBonus);
    const aiReflexBlock = Math.random() < effectiveGuardFreq;

    const aiBlocksHead =
      !isCounter &&
      !this.aiIsStriking &&
      (aiReflexBlock ||
        (this.oppGuardState === 'HIGH_GUARD' && Math.random() < effectiveGuardFreq + 0.15));

    const aiBlocksBody =
      !isCounter &&
      !this.aiIsStriking &&
      (aiReflexBlock ||
        (this.oppGuardState === 'LOW_GUARD' && Math.random() < effectiveGuardFreq + 0.15));

    if (isTargetingHead) {
      if (aiBlocksHead) {
        // Head punch blocked/slipped by Opponent's Defense (0 HP dealt, resets consecutive hit counter)
        this.oppConsecutiveCleanHits = 0;
        this.oppInvulnTimer = 0.42;
        this.audio.boxingGloveBlock();
        this.triggerShieldRipple(worldImpact);
        this.hud.showCallout(
          diffParams.tier === 'hard' && Math.random() < 0.45 ? '💨 SLIPPED!' : '🛡️ BLOCKED!',
          '#94a3b8'
        );
        return;
      }

      // Clean Head Strike (Scaled for 200 HP Pool):
      // Standard Jabs: 6–9 HP | Crosses / Uppercuts / Hooks: 10–14 HP
      const isJab = rig.punchEvent?.type === 'JAB';
      const speedNorm = THREE.MathUtils.clamp(
        ((rig.punchEvent?.speedMps ?? 4.2) - 1.8) / 5.5,
        0,
        1
      );
      const baseDmg = isJab
        ? Math.round(6 + speedNorm * 3) // 6–9 HP
        : Math.round(10 + speedNorm * 4); // 10–14 HP
      const counterBonus = isCounter ? 2 : 0;
      const dmg = isJab
        ? THREE.MathUtils.clamp(
            Math.round((baseDmg + counterBonus) * staminaScale * diffParams.playerDamageMult),
            6,
            isCounter ? 11 : 9
          )
        : THREE.MathUtils.clamp(
            Math.round((baseDmg + counterBonus) * staminaScale * diffParams.playerDamageMult),
            10,
            isCounter ? 16 : 14
          );

      this.opponentHealth = Math.max(0, this.opponentHealth - dmg);
      this.oppInvulnTimer = 0.45; // 0.45s stagger / hit cooldown i-frames
      this.opponentVulnerableTimer = 0;
      this.oppConsecutiveCleanHits++;
      this.totalPlayerHits++;
      this.comboCount++;
      this.scoreState.player1Score++;
      this.scoreState.lastPointWinner = 1;
      this.scoreCallbacks.forEach((cb) => cb(this.scoreState));

      // AI dynamically raises High Guard after taking a clean head hit & prepares counter-pressure
      this.oppGuardState = 'HIGH_GUARD';
      this.oppGuardTimer = 1.4;
      this.oppAttackTimer = Math.min(this.oppAttackTimer, 0.90);

      this.oppSkinMat.color.setHex(0xffffff); // White flash
      this.audio.boxingPunchImpact(1.15, true, isCounter);
      this.triggerSweatBurst(worldImpact, isCounter);
      this.oppHeadSnapRot.x = -0.35; // Head snaps back
      this.oppHeadSnapRot.z = rig.arm === 'left' ? -0.18 : 0.18;
      this.oppStaggerOffset.x -= 0.09; // Knockback along -X (away from player)
      this.hitStopTimer = 0.040; // 40ms hit freeze
      this.addCameraTrauma(0.25);

      const banner = isCounter
        ? `⚡ COUNTER! -${dmg} HP`
        : isJab
          ? `💥 CLEAN JAB! -${dmg} HP`
          : `💥 CLEAN CROSS! -${dmg} HP`;
      this.hud.showCallout(banner, isCounter ? '#ffd700' : '#00f2fe');
      this.hud.showCombo(this.comboCount);
    } else {
      // Targeting Body
      if (aiBlocksBody) {
        // Body punch blocked by Opponent's Low Guard (0 HP dealt, resets consecutive hit counter)
        this.oppConsecutiveCleanHits = 0;
        this.oppInvulnTimer = 0.42;
        this.audio.boxingGloveBlock();
        this.triggerShieldRipple(worldImpact);
        this.hud.showCallout('🛡️ BLOCKED!', '#94a3b8');
        return;
      }

      // Clean Body Blow (Scaled for 200 HP Pool):
      // Body Blows: 12–16 HP
      const speedNorm = THREE.MathUtils.clamp(
        ((rig.punchEvent?.speedMps ?? 4.5) - 1.8) / 5.5,
        0,
        1
      );
      const baseDmg = Math.round(12 + speedNorm * 4); // 12–16 HP
      const counterBonus = isCounter ? 2 : 0;
      const dmg = THREE.MathUtils.clamp(
        Math.round((baseDmg + counterBonus) * staminaScale * diffParams.playerDamageMult),
        12,
        isCounter ? 18 : 16
      );

      this.opponentHealth = Math.max(0, this.opponentHealth - dmg);
      this.oppInvulnTimer = 0.45; // 0.45s stagger / hit cooldown i-frames
      this.opponentVulnerableTimer = 0;
      this.oppConsecutiveCleanHits++;
      this.totalPlayerHits++;
      this.comboCount++;
      this.scoreState.player1Score++;
      this.scoreState.lastPointWinner = 1;
      this.scoreCallbacks.forEach((cb) => cb(this.scoreState));

      // AI dynamically drops to Low Guard after taking a clean body hit & prepares counter-pressure
      this.oppGuardState = 'LOW_GUARD';
      this.oppGuardTimer = 1.4;
      this.oppAttackTimer = Math.min(this.oppAttackTimer, 0.90);

      this.oppSkinMat.color.setHex(0xffffff);
      this.audio.boxingPunchImpact(0.95, false, isCounter);
      this.triggerBodyShockwave(worldImpact);
      this.oppTorsoHunchRot.x = 0.25; // Torso doubles over
      this.oppStaggerOffset.x -= 0.07; // Knockback along -X (away from player)
      this.hitStopTimer = 0.040;
      this.addCameraTrauma(0.32);

      const banner = isCounter ? `⚡ COUNTER! -${dmg} HP` : `💥 BODY BLOW! -${dmg} HP`;
      this.hud.showCallout(banner, isCounter ? '#ffd700' : '#f59e0b');
      this.hud.showCombo(this.comboCount);
    }

    // 3. Smart AI Defensive Retreat & Guarding:
    // When IRON TITAN takes 3 consecutive clean hits without blocking, trigger an automatic
    // 1.2s Defensive Step-Back / Clinch where the AI jumps backward out of punch range to recover guard!
    if (this.oppConsecutiveCleanHits >= 3 && this.opponentHealth > 0) {
      this.oppConsecutiveCleanHits = 0;
      this.oppRetreatTimer = 1.2;
      this.oppInvulnTimer = 1.2;
      this.oppGuardState = 'HIGH_GUARD';
      this.oppGuardTimer = 1.5;
      this.aiIsTelegraphing = false;
      this.aiIsStriking = false;
      this.aiStrikeProgress = 0;
      if (this.oppTelegraphGlow) this.oppTelegraphGlow.visible = false;
      this.hud.hideTelegraph();
      this.oppAttackTimer = Math.max(0.85, diffParams.attackInterval * 0.55);
      this.audio.boxingPunchWhoosh(1.3);
      this.hud.showCallout('💨 IRON TITAN STEP-BACK! GUARD RECOVERED!', '#ffd700');
    }

    if (this.opponentHealth <= 0) {
      if (this.currentRound < this.maxRounds) {
        // Round Knockdown in Round 1 or Round 2: award the round to Player and progress to next round!
        this.playerRoundsWon++;
        this.audio.boxingBellRing(2);
        this.audio.boxingCrowdRoar(1.2);
        this.hud.showCallout(`🥊 ROUND ${this.currentRound} KNOCKDOWN! NEXT ROUND!`, '#00f2fe');
        this.playerHealth = this.MAX_HEALTH;
        this.opponentHealth = this.MAX_HEALTH;
        this.playerStamina = 100;
        this.advanceRound();
      } else {
        this.triggerOpponentKnockout();
      }
    }
  }

  // ─── 10. Dynamic Opponent Guard & Attack AI (Difficulty Scaled) ───────────

  private updateOpponentAI(dt: number, defense: DefensiveState): void {
    // Difficulty parameters for IRON TITAN:
    // Starter / Easy: attackInterval = 3.5s, telegraph = 0.65s, dmg = 6–10 HP, block = 20%
    // Medium (Default): attackInterval = 2.2s, telegraph = 0.40s, dmg = 10–14 HP, block = 50%
    // Hard:           attackInterval = 1.2s, telegraph = 0.20s, dmg = 16–22 HP, block/slip = 80%
    const diffParams = this.getDifficultyParams();
    this.oppTelegraphDuration = diffParams.telegraphDuration;

    // While executing a 1.2s Defensive Step-Back / Clinch recovery, hold tight High Guard
    if (this.oppRetreatTimer > 0) {
      this.oppGuardState = 'HIGH_GUARD';
      return;
    }

    // A. Guard Cycle AI: scales with difficulty guardFrequency (20% Starter, 50% Medium, 80% Hard)
    if (!this.aiIsTelegraphing && !this.aiIsStriking) {
      this.oppGuardTimer -= dt;
      if (this.oppGuardTimer <= 0) {
        this.oppGuardTimer = (diffParams.tier === 'starter' ? 2.4 : 1.5) + Math.random() * 0.6;
        const guardRoll = Math.random();
        if (guardRoll > diffParams.guardFrequency && this.oppConsecutiveCleanHits === 0) {
          this.oppGuardState = 'OPEN';
        } else if (Math.random() < 0.58) {
          this.oppGuardState = 'HIGH_GUARD';
        } else {
          this.oppGuardState = 'LOW_GUARD';
        }
      }
    }

    // B. Active Opponent Attack Cadence & Telegraphing (Jab, Cross, Hook, or Body Blow)
    if (!this.aiIsStriking) {
      this.oppAttackTimer -= dt;

      if (this.oppAttackTimer <= this.oppTelegraphDuration && !this.aiIsTelegraphing) {
        this.aiIsTelegraphing = true;
        this.oppGuardState = 'WINDUP';
        this.oppTelegraphTimer = this.oppTelegraphDuration;
        this.aiAttackArm = Math.random() > 0.5 ? 'right' : 'left';
        const attackRoll = Math.random();
        this.aiAttackType =
          attackRoll < 0.28
            ? 'JAB'
            : attackRoll < 0.56
              ? 'CROSS'
              : attackRoll < 0.80
                ? 'HOOK'
                : 'BODY_BLOW';

        // Attach visible red telegraph glow to the attacking arm
        const windupArmGroup = this.aiAttackArm === 'right' ? this.oppRightArmGroup : this.oppLeftArmGroup;
        if (this.oppTelegraphGlow) {
          windupArmGroup.add(this.oppTelegraphGlow);
          this.oppTelegraphGlow.position.set(0, 0, 0.22);
          this.oppTelegraphGlow.visible = true;
        }

        const warningLabel =
          this.aiAttackType === 'BODY_BLOW'
            ? '⚠️ INCOMING BODY BLOW — GUARD!'
            : this.aiAttackType === 'JAB'
              ? '⚠️ INCOMING JAB — SLIP OR GUARD!'
              : this.aiAttackType === 'CROSS'
                ? '⚠️ INCOMING CROSS — GUARD!'
                : '⚠️ INCOMING HOOK — BLOCK OR SLIP!';
        this.hud.showTelegraph(warningLabel);
        this.audio.boxingPunchWhoosh(0.7);
      }

      // Animate natural cocked-elbow pullback windup on telegraphing glove
      if (this.aiIsTelegraphing) {
        const isRight = this.aiAttackArm === 'right';
        const windupGlove = isRight ? this.oppGloveR : this.oppGloveL;
        const cockedX = isRight ? 0.16 : -0.16;
        const cockedY = this.aiAttackType === 'BODY_BLOW' ? -0.10 : 0.04;
        windupGlove.position.x = THREE.MathUtils.lerp(windupGlove.position.x, cockedX, dt * 12);
        windupGlove.position.y = THREE.MathUtils.lerp(windupGlove.position.y, cockedY, dt * 12);
        windupGlove.position.z = THREE.MathUtils.lerp(windupGlove.position.z, 0.16, dt * 12);
        this.clampArmReach(windupGlove.position, this.MAX_ARM_REACH);
      }

      if (this.oppAttackTimer <= 0) {
        // Schedule next attack around the difficulty's attack interval (3.5s Starter, 2.2s Medium, 1.2s Hard)
        const jitter = (Math.random() - 0.5) * 0.20;
        this.oppAttackTimer = Math.max(0.95, diffParams.attackInterval + jitter);
        this.aiIsTelegraphing = false;
        this.oppGuardState = Math.random() <= diffParams.guardFrequency ? 'HIGH_GUARD' : 'OPEN';
        if (this.oppTelegraphGlow) this.oppTelegraphGlow.visible = false;
        this.hud.hideTelegraph();
        this.aiIsStriking = true;
        this.aiStrikeProgress = 0;
        this.audio.boxingPunchWhoosh(1.15);
      }
    } else {
      // Strike active: curved 3D boxing punch path within 2-bone arm reach
      const prevProgress = this.aiStrikeProgress;
      this.aiStrikeProgress += dt * diffParams.strikeSpeedMult;
      const isRight = this.aiAttackArm === 'right';
      const glove = isRight ? this.oppGloveR : this.oppGloveL;
      const restX = isRight ? 0.12 : -0.12;
      const restZ = isRight ? 0.24 : 0.31;
      const targetY = this.aiAttackType === 'BODY_BLOW' ? -0.16 : 0.12;

      if (this.aiStrikeProgress <= 0.5) {
        const t = this.aiStrikeProgress * 2.0;
        const arcFlareX =
          this.aiAttackType === 'HOOK'
            ? (isRight ? -0.16 : 0.16) * Math.sin(t * Math.PI)
            : 0;
        glove.position.x = THREE.MathUtils.lerp(restX, isRight ? 0.16 : -0.16, t) + arcFlareX;
        glove.position.y = THREE.MathUtils.lerp(0.02, targetY, t);
        glove.position.z = THREE.MathUtils.lerp(0.16, 0.55, t);
      } else if (this.aiStrikeProgress <= 1.0) {
        if (prevProgress < 0.52 && this.aiStrikeProgress >= 0.52) {
          this.resolveOpponentAttackOnPlayer(defense);
        }
        const t = (this.aiStrikeProgress - 0.5) * 2.0;
        // Retract along bent-elbow recovery path back to guard
        glove.position.x = THREE.MathUtils.lerp(isRight ? 0.16 : -0.16, restX, t);
        glove.position.y = THREE.MathUtils.lerp(targetY, 0.04, t) - Math.sin(t * Math.PI) * 0.04;
        glove.position.z = THREE.MathUtils.lerp(0.55, restZ, t);
      } else {
        this.aiIsStriking = false;
        this.aiStrikeProgress = 0;
        glove.position.set(restX, 0.04, restZ);
      }
      this.clampArmReach(glove.position, this.MAX_ARM_REACH);
    }
  }

  private resolveOpponentAttackOnPlayer(defense: DefensiveState): void {
    // If player is currently in stagger hit-recovery (0.45s i-frames), register incoming hit as BLOCKED!
    if (this.playerInvulnTimer > 0) {
      this.audio.boxingGloveBlock();
      this.triggerShieldRipple(this.playerRoot.clone().setY(1.45));
      this.hud.showCallout('🛡️ BLOCKED!', '#00f2fe');
      return;
    }

    const diffParams = this.getDifficultyParams();

    const isSlipping =
      Math.abs(this.headSlipX) > 0.15 ||
      this.headDuckY < -0.10 ||
      defense.isSlippingLeft ||
      defense.isSlippingRight ||
      defense.isDucking ||
      Math.abs(defense.slipRatio) > 0.35;

    // Check player's current wrist heights (LEFT_WRIST and RIGHT_WRIST near chin height) or active guard state
    const wristsAtChinGuard = this.leftWristNearChin && this.rightWristNearChin;
    const isPlayerGuarding =
      this.isGuarding ||
      wristsAtChinGuard ||
      defense.isHighGuard ||
      defense.isBodyGuard ||
      defense.stance === 'HIGH_GUARD';

    if (isSlipping && this.aiAttackType !== 'BODY_BLOW') {
      // Player slipped or ducked incoming head punch!
      this.opponentVulnerableTimer = 1.5; // 1.5s Critical Counter window
      this.audio.boxingPunchWhoosh(1.4);
      this.hud.showCallout('💨 SLIPPED! ⚡ COUNTER READY!', '#ffd700');
    } else if (isPlayerGuarding) {
      // If Guarding (LEFT_WRIST & RIGHT_WRIST near chin height):
      // Block incoming damage entirely (0 HP dealt, "🛡️ BLOCKED!" badge shown, 0 points to AI).
      this.playerStamina = Math.max(0, this.playerStamina - 6);
      this.playerInvulnTimer = 0.45;
      this.opponentVulnerableTimer = 0.85; // Counter window after clean block
      this.audio.boxingGloveBlock();
      this.triggerShieldRipple(this.playerRoot.clone().setY(1.45));
      this.addCameraTrauma(0.14);
      this.hud.showCallout('🛡️ BLOCKED!', '#00f2fe');
    } else {
      // If NOT Guarding: AI hit lands clean!
      // Deduct health (6–10 HP Starter, 10–14 HP Medium, 16–22 HP Hard), play impact sound & spark burst,
      // show red damage callout, and award point to AI.
      const dmg =
        this.aiAttackType === 'BODY_BLOW'
          ? diffParams.aiBodyBlowDamage
          : this.aiAttackType === 'HOOK'
            ? diffParams.aiHookDamage
            : this.aiAttackType === 'CROSS'
              ? diffParams.aiCrossDamage
              : diffParams.aiJabDamage;

      this.playerHealth = Math.max(0, this.playerHealth - dmg);
      this.playerInvulnTimer = 0.45; // 0.45s stagger / hit cooldown i-frames
      this.comboCount = 0;
      this.oppConsecutiveCleanHits = 0;

      // Award point to opponent (IRON TITAN)
      this.scoreState.player2Score++;
      this.scoreState.lastPointWinner = 2;
      this.scoreCallbacks.forEach((cb) => cb(this.scoreState));

      const playerHitPos = this.playerRoot.clone().setY(this.aiAttackType === 'BODY_BLOW' ? 1.18 : 1.52);
      this.audio.boxingPunchImpact(1.15, this.aiAttackType !== 'BODY_BLOW', false);
      this.triggerSweatBurst(playerHitPos, false);
      this.hud.triggerPlayerDamageFlash();
      this.addCameraTrauma(0.48);

      const strikeName =
        this.aiAttackType === 'BODY_BLOW'
          ? 'BODY BLOW'
          : this.aiAttackType === 'HOOK'
            ? 'CLEAN HOOK'
            : this.aiAttackType === 'CROSS'
              ? 'CLEAN CROSS'
              : 'CLEAN JAB';
      this.hud.showCallout(`💥 ${strikeName}: -${dmg} HP`, '#ff0055');

      if (this.playerHealth <= 0) {
        if (this.currentRound < this.maxRounds) {
          this.oppRoundsWon++;
          this.audio.boxingBellRing(2);
          this.audio.boxingCrowdRoar(1.0);
          this.hud.showCallout(`⚡ ROUND ${this.currentRound} LOST! NEXT ROUND!`, '#ff0055');
          this.playerHealth = this.MAX_HEALTH;
          this.opponentHealth = this.MAX_HEALTH;
          this.playerStamina = 100;
          this.advanceRound();
        } else {
          this.triggerPlayerKnockout();
        }
      }
    }
  }

  private updateOpponentVisuals(dt: number): void {
    // Active footwork stepping, lunge during strikes, and 1.2s Defensive Step-Back (-0.65m along -X)
    const bobY = Math.sin(this.oppIdleTime * 4.5) * 0.018;
    const retreatBackX =
      this.oppRetreatTimer > 0
        ? -0.65 * Math.sin(Math.min(1.0, this.oppRetreatTimer / 1.2) * Math.PI * 0.85 + 0.15)
        : 0.0;
    const strikeLungeX = this.aiIsStriking
      ? Math.sin(Math.min(1.0, this.aiStrikeProgress) * Math.PI) * 0.22
      : this.aiIsTelegraphing
        ? -0.04
        : 0.0;
    const stepX = Math.cos(this.oppIdleTime * 2.1) * 0.045 + strikeLungeX + retreatBackX;
    const stepZ = Math.sin(this.oppIdleTime * 1.8) * 0.055;

    // Rhythmic boxing hand weave + Dynamic Guard Glove Height
    const t = this.oppIdleTime * 3.6;
    const weaveLY = Math.sin(t * 2.0) * 0.014;
    const weaveRY = Math.cos(t * 2.0) * 0.014;
    const baseGuardY =
      this.oppRetreatTimer > 0 || this.oppGuardState === 'HIGH_GUARD'
        ? 0.09
        : this.oppGuardState === 'LOW_GUARD'
          ? -0.14
          : 0.01;

    if (!this.aiIsStriking && !this.aiIsTelegraphing) {
      this.oppGloveL.position.x = THREE.MathUtils.lerp(
        this.oppGloveL.position.x,
        -0.12 + Math.sin(t) * 0.012,
        dt * 7.0
      );
      this.oppGloveL.position.y = THREE.MathUtils.lerp(
        this.oppGloveL.position.y,
        baseGuardY + 0.02 + weaveLY,
        dt * 7.0
      );
      this.oppGloveL.position.z = THREE.MathUtils.lerp(
        this.oppGloveL.position.z,
        0.31 + Math.cos(t) * 0.015,
        dt * 7.0
      );

      this.oppGloveR.position.x = THREE.MathUtils.lerp(
        this.oppGloveR.position.x,
        0.12 + Math.cos(t) * 0.012,
        dt * 7.0
      );
      this.oppGloveR.position.y = THREE.MathUtils.lerp(
        this.oppGloveR.position.y,
        baseGuardY + weaveRY,
        dt * 7.0
      );
      this.oppGloveR.position.z = THREE.MathUtils.lerp(
        this.oppGloveR.position.z,
        0.24 + Math.sin(t) * 0.014,
        dt * 7.0
      );
    }

    // Solve 2-Bone Analytical Arm IK for Opponent (IRON TITAN) so both arms bend naturally at the elbows
    const oppLeftPole = this.scratchVecA.set(
      this.aiIsStriking && this.aiAttackArm === 'left' && this.aiAttackType === 'HOOK' ? 0.82 : 0.34,
      -0.90,
      -0.18
    );
    const oppRightPole = this.scratchVecB.set(
      this.aiIsStriking && this.aiAttackArm === 'right' && this.aiAttackType === 'HOOK' ? -0.82 : -0.34,
      -0.90,
      -0.18
    );

    this.solveTwoBoneArmIK(
      this.oppUpperArmLMesh,
      this.oppElbowLMesh,
      this.oppForearmLMesh,
      this.oppGloveL,
      this.oppGloveL.position,
      oppLeftPole,
      true,
      this.aiIsStriking && this.aiAttackArm === 'left' ? 0.35 : 0,
      dt,
      this.oppLeftElbowPos,
      'right'
    );
    this.solveTwoBoneArmIK(
      this.oppUpperArmRMesh,
      this.oppElbowRMesh,
      this.oppForearmRMesh,
      this.oppGloveR,
      this.oppGloveR.position,
      oppRightPole,
      false,
      this.aiIsStriking && this.aiAttackArm === 'right' ? 0.35 : 0,
      dt,
      this.oppRightElbowPos,
      'right'
    );

    // Opponent Shoulder Roll / Torso Twist during strikes & stance
    const targetOppYaw = this.aiIsStriking
      ? this.aiAttackArm === 'left'
        ? -0.28
        : 0.30
      : this.aiIsTelegraphing
        ? this.aiAttackArm === 'left'
          ? 0.18
          : -0.20
        : -0.08 + Math.sin(this.oppIdleTime * 2.0) * 0.04;
    this.oppTorsoTwistY = THREE.MathUtils.lerp(this.oppTorsoTwistY, targetOppYaw, dt * 12.0);
    this.oppTorsoGroup.rotation.y = this.oppTorsoTwistY;

    // Decay staggers and head/torso recoil reactions
    this.oppHeadSnapRot.x = THREE.MathUtils.lerp(this.oppHeadSnapRot.x, 0, dt * 8.0);
    this.oppHeadSnapRot.z = THREE.MathUtils.lerp(this.oppHeadSnapRot.z, 0, dt * 8.0);
    this.oppHeadSnapRot.y = -this.oppTorsoTwistY * 0.75;
    this.oppTorsoHunchRot.x = THREE.MathUtils.lerp(this.oppTorsoHunchRot.x, 0, dt * 8.0);
    this.oppStaggerOffset.lerp(this.scratchVecA.set(0, 0, 0), dt * 6.0);

    if (!this.isMatchOver) {
      this.opponentGroup.position.set(
        this.opponentRoot.x + stepX + this.oppStaggerOffset.x,
        this.opponentRoot.y + bobY + this.oppStaggerOffset.y,
        this.opponentRoot.z + stepZ + this.oppStaggerOffset.z
      );
    }

    this.oppHeadGroup.rotation.copy(this.oppHeadSnapRot);
    this.oppTorsoGroup.rotation.x = this.oppTorsoHunchRot.x;
  }

  private updateParticlesAndShaders(dt: number): void {
    // A. Update Sparks
    for (let i = 0; i < this.activeSparkCount; i++) {
      this.sparkLifetimes[i] -= dt;
      if (this.sparkLifetimes[i] <= 0) {
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

      this.sparkVelocities[i * 3 + 1] -= 9.8 * dt;
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

  // ─── 11. Camera Spring-Damper & Side-Profile Perspective Framing ───────────

  private addCameraTrauma(amount: number): void {
    this.cameraTrauma = Math.min(1.0, this.cameraTrauma + amount);
  }

  private updateCamera(dt: number): void {
    const safeLerp = Math.min(1.0, (dt > 0 ? dt : 0.016) * 10);

    let targetPos = this.classicSideCameraPos;
    let targetLook = this.classicSideLookTarget;
    let targetFov = 50;

    if (this.cameraPreset === 'wide_arena') {
      targetPos = this.wideArenaCameraPos;
      targetLook = this.wideArenaLookTarget;
      targetFov = 52;
    } else if (this.cameraPreset === 'fighter_pov') {
      targetPos = this.fighterPovCameraPos;
      targetLook = this.fighterPovLookTarget;
      targetFov = 62;
    }

    // Subtle camera tracking response (stronger in Fighter POV, gentle broadcast framing in Side/Wide Cam)
    const offsetScale = this.cameraPreset === 'fighter_pov' ? 0.45 : 0.12;
    this.cameraHeadOffset.x = THREE.MathUtils.lerp(
      this.cameraHeadOffset.x,
      this.headSlipX * offsetScale,
      safeLerp
    );
    this.cameraHeadOffset.y = THREE.MathUtils.lerp(
      this.cameraHeadOffset.y,
      this.headDuckY * (this.cameraPreset === 'fighter_pov' ? 0.65 : 0.15),
      safeLerp
    );

    // Ensure both boxers are 100% solid and visible in Classic Side Cam and Wide Arena Cam;
    // hide player's own head/torso only in Fighter POV Cam so it doesn't obstruct first-person sightlines.
    if (this.playerHeadGroup && this.playerTorsoGroup) {
      const showPlayerBody = this.cameraPreset !== 'fighter_pov';
      this.playerHeadGroup.visible = showPlayerBody;
      this.playerTorsoGroup.visible = showPlayerBody;

      if (this.playerMatSkin) {
        this.playerMatSkin.transparent = false;
        this.playerMatSkin.opacity = 1.0;
      }
      if (this.playerHeadgearMat) {
        this.playerHeadgearMat.transparent = false;
        this.playerHeadgearMat.opacity = 1.0;
      }
    }

    this.currentCameraPos.lerp(targetPos, safeLerp);
    this.currentLookTarget.lerp(targetLook, safeLerp);

    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, safeLerp);
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
      if (this.roundTimeRemaining <= 0) {
        if (this.playerHealth >= this.opponentHealth) {
          this.playerRoundsWon++;
        } else {
          this.oppRoundsWon++;
        }
      }
      this.currentRound++;
      this.roundTimeRemaining = 50;
      this.roundCountdown = 3.0;
      this.isRoundActive = false;
      this.oppConsecutiveCleanHits = 0;
      this.oppRetreatTimer = 0;
      this.oppInvulnTimer = 0;
      this.playerInvulnTimer = 0;
      // Corner recovery between rounds (up to 200 HP max)
      this.playerHealth = Math.min(this.MAX_HEALTH, this.playerHealth + 50);
      this.opponentHealth = Math.min(this.MAX_HEALTH, this.opponentHealth + 50);
      this.playerStamina = 100;
      this.oppAttackTimer = this.getInitialAttackCooldown();
      this.aiIsTelegraphing = false;
      this.aiIsStriking = false;
      this.hud.hideTelegraph();
      this.audio.boxingBellRing(2);
      this.hud.showCallout(`🔔 ROUND ${this.currentRound}!`, '#ffd700');
    } else {
      if (this.playerHealth >= this.opponentHealth) {
        this.playerRoundsWon++;
      } else {
        this.oppRoundsWon++;
      }
      const didWin =
        this.playerRoundsWon > this.oppRoundsWon ||
        (this.playerRoundsWon === this.oppRoundsWon && this.playerHealth >= this.opponentHealth);
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
      player1Score: winner === 1 ? Math.max(3, this.scoreState.player1Score) : this.scoreState.player1Score,
      player2Score: winner === 2 ? Math.max(3, this.scoreState.player2Score) : this.scoreState.player2Score,
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
    matchState: 'COUNTDOWN' | 'FIGHTING' | 'MATCH_OVER';
    round: number;
    roundTimer: number;
    playerHp: number;
    opponentHp: number;
    playerStamina: number;
    isGuarding: boolean;
    headSlipX: number;
    leftGlovePos: { x: number; y: number; z: number };
    rightGlovePos: { x: number; y: number; z: number };
    activeAction: string;
    isRoundActive: boolean;
    currentRound: number;
    playerHealth: number;
    opponentHealth: number;
    stamina: number;
    cameraPreset: string;
    roundCountdown: number;
    totalPlayerHits: number;
  } {
    const lPos = new THREE.Vector3();
    const rPos = new THREE.Vector3();
    if (this.playerGloveL) this.playerGloveL.getWorldPosition(lPos);
    if (this.playerGloveR) this.playerGloveR.getWorldPosition(rPos);

    const matchState = this.isMatchOver
      ? 'MATCH_OVER'
      : this.roundCountdown > 0
        ? 'COUNTDOWN'
        : 'FIGHTING';

    return {
      matchState,
      round: this.currentRound,
      roundTimer: Number(this.roundTimeRemaining.toFixed(2)),
      playerHp: this.playerHealth,
      opponentHp: this.opponentHealth,
      playerStamina: Math.round(this.playerStamina),
      isGuarding: this.isGuarding,
      headSlipX: Number(this.headSlipX.toFixed(3)),
      leftGlovePos: {
        x: Number(lPos.x.toFixed(3)),
        y: Number(lPos.y.toFixed(3)),
        z: Number(lPos.z.toFixed(3)),
      },
      rightGlovePos: {
        x: Number(rPos.x.toFixed(3)),
        y: Number(rPos.y.toFixed(3)),
        z: Number(rPos.z.toFixed(3)),
      },
      activeAction: this.activeAction,
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
    if (this.navDiffChangeListener) {
      const navSelect = document.getElementById('difficulty-select');
      if (navSelect) {
        navSelect.removeEventListener('change', this.navDiffChangeListener);
      }
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
