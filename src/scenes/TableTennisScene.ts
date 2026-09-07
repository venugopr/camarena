import * as THREE from 'three';
import { IGameScene, GameScoreState } from '../core/scene/IGameScene';
import { GameModeId, OpponentMode, DifficultyLevel, MotionFrame, ActionEvent } from '../core/motion/Types';
import { SoundSynthesizer } from '../core/audio/SoundSynthesizer';
import { Avatar3D } from './components/Avatar3D';

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
  private ballShadowMesh!: THREE.Mesh;
  private fpPaddleGroup!: THREE.Group; // First-person high-visibility bat

  // Table dimensions (ITTF specs)
  private readonly tableLength = 2.74;
  private readonly tableWidth = 1.525;
  private readonly tableHeight = 0.76;
  private readonly netHeight = 0.1525;

  // Ball physics state
  private ballPos = new THREE.Vector3(0, 0.95, -1.35);
  private ballVel = new THREE.Vector3(0, 0, 0);
  private isBallInPlay = false;
  private rallyState: 'READY_TO_SERVE' | 'IN_PLAY' | 'POINT_AWARDED' | 'GAME_OVER' = 'READY_TO_SERVE';
  private lastHitter: 'player' | 'opponent' | null = null;
  private bounceCountNear = 0;
  private bounceCountFar = 0;
  private serveTimer = 1.2;

  // Active Paddle Control Position (combined from motion tracking and mouse/pointer)
  private activePaddlePos = new THREE.Vector3(0.25, 0.95, -1.45);
  private mousePaddleTarget = new THREE.Vector3(0.25, 0.95, -1.45);
  private isUsingMouse = false;

  // AI Paddle
  private aiPaddlePos = new THREE.Vector3(0, 0.88, 1.45);

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
    gameModeTitle: 'Table Tennis 3D Pro'
  };

  private scoreCallbacks: ((score: GameScoreState) => void)[] = [];
  private isRunning = false;
  private currentDifficulty: DifficultyLevel = 'casual';

  // Camera presets
  private cameraViewBtn?: HTMLButtonElement;
  private currentCameraPreset: 'bat_focus' | 'broadcast' | 'over_shoulder' = 'bat_focus';

  // Serve guidance banner
  private serveBanner?: HTMLElement;

  // Net mesh reference (for ripple effect)
  private netMesh!: THREE.Mesh;
  private netHitTimer = 0;
  private netHitBanner?: HTMLElement;

  // Ball trail system
  private readonly TRAIL_LENGTH = 12;
  private ballTrail: THREE.Vector3[] = [];
  private ballTrailMeshes: THREE.Mesh[] = [];

  // Event handlers for pointer controls
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
      if (config.targetScore) {
        this.targetScore = config.targetScore;
        this.scoreState.targetScore = config.targetScore;
      }
    }

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x080e1a);
    this.scene.fog = new THREE.FogExp2(0x080e1a, 0.04);

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    // Wider FOV for better full-table spatial awareness
    this.camera = new THREE.PerspectiveCamera(62, width / height, 0.05, 50);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    container.appendChild(this.renderer.domElement);

    // Arena Lighting
    this.setupLighting();

    // 3D Table Tennis Table
    this.buildTable();

    // Build Avatars
    this.playerAvatar = new Avatar3D(0x00f2fe, 0x39ff14);
    this.playerAvatar.setEquipment('tabletennis');
    this.playerAvatar.setGhostMode(true); // Ghost mode ensures player body never occludes table
    this.playerAvatar.group.position.set(0, 0, -1.85);
    this.scene.add(this.playerAvatar.group);

    this.opponentAvatar = new Avatar3D(0xff0055, 0xfacc15);
    this.opponentAvatar.setEquipment('tabletennis');
    this.opponentAvatar.group.position.set(0, 0, 1.82);
    this.opponentAvatar.group.rotation.y = Math.PI;
    this.opponentAvatar.applyDefaultPose('tabletennis', true);
    this.scene.add(this.opponentAvatar.group);

    // Build Dedicated High-Visibility First-Person Paddle
    this.buildFirstPersonPaddle();

    // Apply default camera preset: 'bat_focus' (First-Person Table & Bat View)
    this.applyCameraPreset('bat_focus');

    // Mount Camera View Selector Button
    this.buildCameraViewButton();

    // Ball + trail
    this.buildBall();
    this.buildBallTrail();

    // Serve guidance banner
    this.buildServeBanner();

    // Net hit notification banner
    this.buildNetHitBanner();

    // Prepare serve
    this.resetBall(1);

    // Setup interactive mouse / touch controls
    this.setupPointerControls();
  }

  private buildFirstPersonPaddle(): void {
    this.fpPaddleGroup = new THREE.Group();

    // Flared ergonomic wooden handle
    const handleGeo = new THREE.CylinderGeometry(0.018, 0.024, 0.18, 16);
    const handleMat = new THREE.MeshStandardMaterial({
      color: 0xb45309,
      roughness: 0.5,
      metalness: 0.1
    });
    const handle = new THREE.Mesh(handleGeo, handleMat);
    handle.position.y = 0.09;
    this.fpPaddleGroup.add(handle);

    // Multi-ply wood blade base
    const bladeGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.014, 36);
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.4 });
    const blade = new THREE.Mesh(bladeGeo, bladeMat);
    blade.position.y = 0.27;
    blade.rotation.x = Math.PI / 2;
    this.fpPaddleGroup.add(blade);

    // High-contrast white edge tape perimeter with glow
    const edgeTapeGeo = new THREE.TorusGeometry(0.13, 0.009, 8, 36);
    const edgeTapeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.4,
      roughness: 0.2
    });
    const edgeTape = new THREE.Mesh(edgeTapeGeo, edgeTapeMat);
    edgeTape.position.y = 0.27;
    this.fpPaddleGroup.add(edgeTape);

    // Vibrant red forehand rubber sheet
    const redRubberGeo = new THREE.CylinderGeometry(0.125, 0.125, 0.006, 36);
    const redRubberMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      roughness: 0.2,
      emissive: 0xdc2626,
      emissiveIntensity: 0.45
    });
    const redRubber = new THREE.Mesh(redRubberGeo, redRubberMat);
    redRubber.position.set(0, 0.27, 0.008);
    redRubber.rotation.x = Math.PI / 2;
    this.fpPaddleGroup.add(redRubber);

    // White sweet-spot center circle
    const spotGeo = new THREE.CircleGeometry(0.03, 16);
    const spotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
    const spot = new THREE.Mesh(spotGeo, spotMat);
    spot.position.set(0, 0.27, 0.012);
    this.fpPaddleGroup.add(spot);

    // Black backhand rubber sheet
    const blackRubberMat = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      roughness: 0.25,
      emissive: 0x27272a,
      emissiveIntensity: 0.2
    });
    const blackRubber = new THREE.Mesh(redRubberGeo, blackRubberMat);
    blackRubber.position.set(0, 0.27, -0.008);
    blackRubber.rotation.x = Math.PI / 2;
    this.fpPaddleGroup.add(blackRubber);

    this.fpPaddleGroup.position.copy(this.activePaddlePos);
    this.fpPaddleGroup.rotation.set(0.35, 0, -0.15);
    this.scene.add(this.fpPaddleGroup);
  }

  private applyCameraPreset(preset: 'bat_focus' | 'broadcast' | 'over_shoulder'): void {
    this.currentCameraPreset = preset;
    if (preset === 'bat_focus') {
      // Full table view: player sees complete table width and net clearly.
      // Camera is pulled back and slightly elevated to capture full 2.74m table length.
      this.camera.position.set(0, 1.44, -2.55);
      this.camera.lookAt(0, 0.76, 0.42);
      this.playerAvatar.group.visible = false;
      this.fpPaddleGroup.visible = true;
    } else if (preset === 'broadcast') {
      // Elevated third-person view looking down over the player onto the table
      this.camera.position.set(0, 2.6, -3.8);
      this.camera.lookAt(0, 0.72, 0.15);
      this.playerAvatar.group.visible = true;
      this.playerAvatar.setGhostMode(true);
      this.fpPaddleGroup.visible = false;
    } else if (preset === 'over_shoulder') {
      // Over the right shoulder view focusing on forehand bat swing
      this.camera.position.set(0.65, 1.65, -2.85);
      this.camera.lookAt(0.08, 0.74, 0.25);
      this.playerAvatar.group.visible = true;
      this.playerAvatar.setGhostMode(true);
      this.fpPaddleGroup.visible = false;
    }
  }

  private buildServeBanner(): void {
    this.serveBanner = document.createElement('div');
    this.serveBanner.className = 'serve-guidance-banner';
    this.serveBanner.id = 'tt-serve-banner';
    this.serveBanner.style.cssText = `
      position: absolute; bottom: 18%; left: 50%; transform: translateX(-50%);
      background: rgba(0, 242, 254, 0.12); border: 1.5px solid rgba(0, 242, 254, 0.5);
      border-radius: 12px; padding: 10px 28px; color: #00f2fe;
      font-family: 'Inter', sans-serif; font-size: 15px; font-weight: 700;
      letter-spacing: 0.06em; text-align: center; backdrop-filter: blur(8px);
      pointer-events: none; z-index: 30; display: none;
      animation: servePulse 1.4s ease-in-out infinite;
    `;
    this.container.appendChild(this.serveBanner);
  }

  private showServeBanner(text: string): void {
    if (!this.serveBanner) return;
    this.serveBanner.textContent = text;
    this.serveBanner.style.display = 'block';
  }

  private hideServeBanner(): void {
    if (!this.serveBanner) return;
    this.serveBanner.style.display = 'none';
  }

  private buildCameraViewButton(): void {
    this.cameraViewBtn = document.createElement('button');
    this.cameraViewBtn.className = 'icon-btn camera-view-toggle-btn glass-panel';
    this.cameraViewBtn.id = 'btn-tt-camera-view';
    this.cameraViewBtn.innerHTML = '<span>🎥</span><span>View: Bat Focus</span>';
    this.cameraViewBtn.title = 'Switch Camera View: Bat Focus (First-Person) / Broadcast / Over Shoulder [Key: C]';
    this.cameraViewBtn.onclick = () => {
      this.cycleCameraView();
    };
    this.container.appendChild(this.cameraViewBtn);
  }

  private cycleCameraView(): void {
    if (this.currentCameraPreset === 'bat_focus') {
      this.applyCameraPreset('broadcast');
      if (this.cameraViewBtn) this.cameraViewBtn.innerHTML = '<span>🎥</span><span>View: Broadcast</span>';
    } else if (this.currentCameraPreset === 'broadcast') {
      this.applyCameraPreset('over_shoulder');
      if (this.cameraViewBtn) this.cameraViewBtn.innerHTML = '<span>🎥</span><span>View: Over Shoulder</span>';
    } else {
      this.applyCameraPreset('bat_focus');
      if (this.cameraViewBtn) this.cameraViewBtn.innerHTML = '<span>🎥</span><span>View: Bat Focus</span>';
    }
  }

  private setupPointerControls(): void {
    this.pointerMoveHandler = (e: MouseEvent) => {
      const rect = this.container.getBoundingClientRect();
      const normX = ((e.clientX - rect.left) / rect.width) * 2 - 1; // -1 to 1
      const normY = ((e.clientY - rect.top) / rect.height) * 2 - 1; // -1 to 1

      // Map to realistic baseline position
      this.mousePaddleTarget.x = normX * (this.tableWidth / 2 + 0.35);
      this.mousePaddleTarget.y = 0.76 + 0.16 - normY * 0.45;
      this.isUsingMouse = true;
    };

    this.pointerDownHandler = () => {
      this.triggerSwing(true);
    };

    this.keydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'c' || e.key === 'C') {
        this.cycleCameraView();
      } else if (e.key === ' ') {
        this.triggerSwing(true);
      }
    };

    this.container.addEventListener('mousemove', this.pointerMoveHandler);
    this.container.addEventListener('mousedown', this.pointerDownHandler);
    window.addEventListener('keydown', this.keydownHandler);
  }

  private triggerSwing(isClick = false): void {
    const paddlePos = this.getPaddleWorldPos();
    if (this.rallyState === 'READY_TO_SERVE' && this.scoreState.currentServer === 1) {
      // Player serves on swing / click!
      this.executeHit(paddlePos, isClick);
      return;
    }

    if (this.rallyState === 'IN_PLAY' && this.lastHitter !== 'player') {
      const inHitZone = this.ballPos.z <= -0.4 && this.ballPos.z >= -2.05 && this.ballPos.y > 0.5;
      if (inHitZone) {
        this.executeHit(paddlePos, isClick);
      }
    }
  }

  private setupLighting(): void {
    const ambient = new THREE.AmbientLight(0xffffff, 0.95);
    this.scene.add(ambient);

    const overheadLight = new THREE.DirectionalLight(0xffffff, 1.8);
    overheadLight.position.set(0, 4.5, 0);
    overheadLight.castShadow = true;
    overheadLight.shadow.mapSize.width = 1024;
    overheadLight.shadow.mapSize.height = 1024;
    this.scene.add(overheadLight);

    const cyanRim = new THREE.PointLight(0x00f2fe, 2.5, 9);
    cyanRim.position.set(1.5, 2.2, -1.2);
    this.scene.add(cyanRim);

    const pinkRim = new THREE.PointLight(0xff0055, 2, 8);
    pinkRim.position.set(-1.5, 2.2, 1.2);
    this.scene.add(pinkRim);
  }

  private buildTable(): void {
    // ITTF Blue Table Top
    const tableGeo = new THREE.BoxGeometry(this.tableWidth, 0.05, this.tableLength);
    const tableMat = new THREE.MeshStandardMaterial({
      color: 0x1d4ed8,
      roughness: 0.35,
      metalness: 0.1
    });
    const tableTop = new THREE.Mesh(tableGeo, tableMat);
    tableTop.position.set(0, this.tableHeight - 0.025, 0);
    tableTop.receiveShadow = true;
    this.scene.add(tableTop);

    // White Boundary Lines
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const halfW = this.tableWidth / 2;
    const halfL = this.tableLength / 2;
    const lineY = this.tableHeight + 0.001;

    // Edge borders
    const addBorder = (w: number, l: number, x: number, z: number) => {
      const bGeo = new THREE.PlaneGeometry(w, l);
      const b = new THREE.Mesh(bGeo, lineMat);
      b.rotation.x = -Math.PI / 2;
      b.position.set(x, lineY, z);
      this.scene.add(b);
    };

    const borderThickness = 0.02;
    addBorder(this.tableWidth, borderThickness, 0, halfL);
    addBorder(this.tableWidth, borderThickness, 0, -halfL);
    addBorder(borderThickness, this.tableLength, halfW, 0);
    addBorder(borderThickness, this.tableLength, -halfW, 0);

    // Center divider line
    addBorder(0.006, this.tableLength, 0, 0);

    // Net — stored for ripple effect on collision
    const netMeshGeo = new THREE.PlaneGeometry(this.tableWidth + 0.3, this.netHeight);
    const netMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      emissive: 0x000000,
      emissiveIntensity: 0,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide
    });
    this.netMesh = new THREE.Mesh(netMeshGeo, netMat);
    this.netMesh.position.set(0, this.tableHeight + this.netHeight / 2, 0);
    this.scene.add(this.netMesh);

    // Top white tape
    const tapeGeo = new THREE.BoxGeometry(this.tableWidth + 0.3, 0.015, 0.01);
    const tape = new THREE.Mesh(tapeGeo, lineMat);
    tape.position.set(0, this.tableHeight + this.netHeight, 0);
    this.scene.add(tape);

    // Table Legs & Underframe
    const legGeo = new THREE.CylinderGeometry(0.03, 0.03, this.tableHeight - 0.05, 8);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8 });

    const legPositions = [
      [-halfW + 0.15, -halfL + 0.2],
      [halfW - 0.15, -halfL + 0.2],
      [-halfW + 0.15, halfL - 0.2],
      [halfW - 0.15, halfL - 0.2]
    ];

    for (const [lx, lz] of legPositions) {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(lx, (this.tableHeight - 0.05) / 2, lz);
      this.scene.add(leg);
    }

    // Arena Floor
    const floorGeo = new THREE.PlaneGeometry(14, 16);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x070b14, roughness: 0.8 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.01;
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  private buildBall(): void {
    // Slightly larger, glowing white ball for visibility
    const ballGeo = new THREE.SphereGeometry(0.026, 20, 20);
    const ballMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.15,
      emissive: 0xffffff,
      emissiveIntensity: 0.55
    });
    this.ballMesh = new THREE.Mesh(ballGeo, ballMat);
    this.ballMesh.castShadow = true;
    this.scene.add(this.ballMesh);

    // Ball ground shadow decal
    const shadowGeo = new THREE.CircleGeometry(0.04, 16);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.4
    });
    this.ballShadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    this.ballShadowMesh.rotation.x = -Math.PI / 2;
    this.ballShadowMesh.position.y = this.tableHeight + 0.002;
    this.scene.add(this.ballShadowMesh);
  }

  private buildBallTrail(): void {
    // Neon yellow-white motion trail: 12 spheres of decreasing size and opacity
    for (let i = 0; i < this.TRAIL_LENGTH; i++) {
      const t = i / this.TRAIL_LENGTH;
      const trailGeo = new THREE.SphereGeometry(0.026 * (1 - t * 0.75), 8, 8);
      const trailMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color().lerpColors(new THREE.Color(0xffffff), new THREE.Color(0xfacc15), t),
        transparent: true,
        opacity: 0
      });
      const trailMesh = new THREE.Mesh(trailGeo, trailMat);
      trailMesh.visible = false;
      this.ballTrailMeshes.push(trailMesh);
      this.scene.add(trailMesh);
    }
  }

  private buildNetHitBanner(): void {
    this.netHitBanner = document.createElement('div');
    this.netHitBanner.id = 'tt-net-hit-banner';
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
    if (this.currentDifficulty === 'casual') return 0.60;
    if (this.currentDifficulty === 'pro') return 0.80;
    return 1.0; // legend
  }

  private resetBall(server: 1 | 2 = 1): void {
    this.isBallInPlay = false;
    this.rallyState = 'READY_TO_SERVE';
    this.bounceCountNear = 0;
    this.bounceCountFar = 0;
    this.serveTimer = 2.0; // Fair 2s countdown for AI serve

    if (server === 1) {
      this.ballPos.set(this.activePaddlePos.x, this.tableHeight + 0.22, -1.35);
      this.ballVel.set(0, 0, 0);
      this.lastHitter = null;
      this.showServeBanner('🏓 YOUR SERVE — Click or press SPACE to serve!');
    } else {
      this.ballPos.set(-0.2, this.tableHeight + 0.25, 1.35);
      this.ballVel.set(0, 0, 0);
      this.lastHitter = 'opponent';
      this.showServeBanner('🤖 OPPONENT SERVING — Get ready!');
    }

    this.ballMesh.position.copy(this.ballPos);
  }

  public start(): void {
    this.isRunning = true;
  }

  public pause(): void {
    this.isRunning = false;
  }

  public resume(): void {
    this.isRunning = true;
  }

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
      gameModeTitle: 'Table Tennis 3D Pro'
    };
    this.rallyState = 'READY_TO_SERVE';
    this.resetBall(1);
    this.notifyScore();
  }

  private getPaddleWorldPos(): THREE.Vector3 {
    if (this.currentCameraPreset === 'bat_focus') {
      return this.fpPaddleGroup.position;
    }
    return this.playerAvatar.getPaddleWorldPosition();
  }

  public update(deltaTime: number, motionFrame: MotionFrame | null): void {
    if (!this.isRunning) return;

    // 1. Update Player Paddle & Avatar Position
    if (motionFrame && motionFrame.worldLandmarks) {
      this.playerAvatar.update(motionFrame.worldLandmarks, motionFrame.metrics.dominantArm);

      const wristIdx = motionFrame.metrics.dominantArm === 'left' ? 15 : 16;
      const rawWrist = motionFrame.worldLandmarks[wristIdx];
      if (rawWrist) {
        const trackedX = (rawWrist.x || 0) * 1.6;
        const trackedY = this.tableHeight + 0.16 + (-rawWrist.y - 0.9) * 0.8;
        this.activePaddlePos.x = THREE.MathUtils.lerp(this.activePaddlePos.x, trackedX, 0.35);
        this.activePaddlePos.y = THREE.MathUtils.lerp(this.activePaddlePos.y, Math.max(0.76, trackedY), 0.35);
      }

      const playerX = motionFrame.metrics.hipCenterWorld.x * 1.4;
      this.playerAvatar.group.position.x = THREE.MathUtils.lerp(this.playerAvatar.group.position.x, playerX, 0.25);
    } else if (this.isUsingMouse) {
      this.activePaddlePos.x = THREE.MathUtils.lerp(this.activePaddlePos.x, this.mousePaddleTarget.x, 0.35);
      this.activePaddlePos.y = THREE.MathUtils.lerp(this.activePaddlePos.y, this.mousePaddleTarget.y, 0.35);
      this.playerAvatar.group.position.x = this.activePaddlePos.x * 0.7;
    }

    // Update First-Person Paddle
    this.fpPaddleGroup.position.set(this.activePaddlePos.x, this.activePaddlePos.y, -1.45);

    // 2. Real-Time Physical Paddle-to-Ball Collision Detection
    if (this.rallyState === 'IN_PLAY') {
      const paddlePos = this.getPaddleWorldPos();
      const distToPaddle = this.ballPos.distanceTo(paddlePos);

      // Hit zone covers defensive table edge
      const inHitZone = this.ballPos.z <= -0.65 && this.ballPos.z >= -1.95 && this.ballPos.y >= this.tableHeight - 0.05;

      if (distToPaddle < 0.28 && inHitZone && this.lastHitter !== 'player') {
        this.executeHit(paddlePos);
      }
    }

    // 3. Serve Logic
    if (this.rallyState === 'READY_TO_SERVE' && !this.scoreState.isGameOver) {
      if (this.scoreState.currentServer === 1) {
        // Player serves: ball hovers right beside the bat waiting for swing
        const paddlePos = this.getPaddleWorldPos();
        this.ballPos.set(paddlePos.x, this.tableHeight + 0.22, -1.35);
        this.ballMesh.position.copy(this.ballPos);
      } else {
        // AI serves
        this.serveTimer -= deltaTime;
        if (this.serveTimer <= 0) {
          this.rallyState = 'IN_PLAY';
          this.isBallInPlay = true;
          const sm = this.speedMultiplier();
          this.ballVel.set((Math.random() - 0.5) * 0.7 * sm, 1.85, -4.2 * sm);
          this.lastHitter = 'opponent';
          this.hideServeBanner();
          this.audio.tableTennisPaddleHit();
        }
      }
    }

    // 4. Ball Dynamics & Table Physics
    if (this.rallyState === 'IN_PLAY') {
      // Gravity
      this.ballVel.y -= 9.8 * deltaTime;

      // Position update
      this.ballPos.addScaledVector(this.ballVel, deltaTime);
      this.ballMesh.position.copy(this.ballPos);

      // Ball shadow projection onto table
      this.ballShadowMesh.position.x = this.ballPos.x;
      this.ballShadowMesh.position.z = this.ballPos.z;
      const heightAboveTable = Math.max(0, this.ballPos.y - this.tableHeight);
      const shadowScale = Math.max(0.3, 1.0 - heightAboveTable * 0.8);
      this.ballShadowMesh.scale.set(shadowScale, shadowScale, shadowScale);
      this.ballShadowMesh.visible =
        this.ballPos.y >= this.tableHeight - 0.1 &&
        Math.abs(this.ballPos.x) <= this.tableWidth / 2 &&
        Math.abs(this.ballPos.z) <= this.tableLength / 2;

      // Table Bounce Collision
      const halfW = this.tableWidth / 2;
      const halfL = this.tableLength / 2;
      const isOverTable = Math.abs(this.ballPos.x) <= halfW && Math.abs(this.ballPos.z) <= halfL;

      if (isOverTable && this.ballPos.y <= this.tableHeight + 0.024 && this.ballVel.y < 0) {
        this.ballPos.y = this.tableHeight + 0.024;
        this.ballVel.y = -this.ballVel.y * 0.87; // High restitution table bounce

        if (this.ballPos.z < 0) {
          this.bounceCountNear++;
          this.audio.tableTennisBounce(true);
        } else {
          this.bounceCountFar++;
          this.audio.tableTennisBounce(false);
        }
      }

      // Net Collision — with ripple effect and banner
      if (Math.abs(this.ballPos.z) < 0.04 && this.ballPos.y < this.tableHeight + this.netHeight) {
        this.audio.tableTennisPaddleHit();
        // Trigger net ripple animation
        this.netHitTimer = 0.6;
        this.showNetHitBanner();
        // Bounce ball back slightly
        this.ballVel.z = -this.ballVel.z * 0.35;
        this.ballVel.x *= 0.5;
        const ptWinner = this.lastHitter === 'player' ? 2 : 1;
        const faultReason = this.lastHitter === 'player'
          ? 'Net Strike! Ball hit net on Player shot (+1 Opponent)'
          : 'Net Strike! Opponent hit ball into net (+1 Player)';
        this.handleRallyPoint(ptWinner, faultReason);
        return;
      }

      // Net ripple animation
      if (this.netHitTimer > 0) {
        this.netHitTimer -= deltaTime;
        const pulse = Math.abs(Math.sin(this.netHitTimer * 30));
        (this.netMesh.material as THREE.MeshStandardMaterial).emissive.setHex(0xff2222);
        (this.netMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = pulse * 1.2;
      } else {
        (this.netMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0;
      }

      // Ball trail update
      if (this.rallyState === 'IN_PLAY') {
        this.ballTrail.unshift(this.ballPos.clone());
        if (this.ballTrail.length > this.TRAIL_LENGTH) this.ballTrail.pop();
        for (let i = 0; i < this.TRAIL_LENGTH; i++) {
          const tm = this.ballTrailMeshes[i];
          if (!tm) continue;
          if (this.ballTrail[i]) {
            tm.visible = true;
            tm.position.copy(this.ballTrail[i]);
            (tm.material as THREE.MeshBasicMaterial).opacity = (1 - i / this.TRAIL_LENGTH) * 0.62;
          } else {
            tm.visible = false;
          }
        }
      } else {
        // Hide trail when not in play
        for (const tm of this.ballTrailMeshes) tm.visible = false;
        this.ballTrail = [];
      }

      // Floor Drop / Out of Bounds
      if (this.ballPos.y <= 0.1) {
        this.isBallInPlay = false;
        if (this.lastHitter === 'player') {
          if (this.bounceCountFar >= 1) {
            this.handleRallyPoint(1, 'Table Point! Clean return landed on opponent table (+1 Player)');
          } else {
            this.handleRallyPoint(2, 'Out of Bounds! Player shot missed opponent table (+1 Opponent)');
          }
        } else {
          if (this.bounceCountNear >= 1) {
            this.handleRallyPoint(2, 'Floor Drop! Ball dropped on Player court (+1 Opponent)');
          } else {
            this.handleRallyPoint(1, 'Out of Bounds! Opponent shot sailed long (+1 Player)');
          }
        }
        return;
      }

      // 5. AI Opponent Tracking & Interception
      if (this.lastHitter === 'player' && this.ballPos.z > 0.25 && this.ballVel.z > 0) {
        // Track ball X
        const diffX = this.ballPos.x - this.aiPaddlePos.x;
        const aiSpeed = this.currentDifficulty === 'casual' ? 3.5 : this.currentDifficulty === 'pro' ? 4.8 : 6.2;
        this.aiPaddlePos.x += Math.min(Math.abs(diffX), aiSpeed * deltaTime) * Math.sign(diffX);
        this.opponentAvatar.group.position.x = this.aiPaddlePos.x;

        // Hit ball when it reaches opponent baseline and has bounced
        const inAiZone = this.ballPos.z >= 1.05 && this.ballPos.z <= 1.55;
        const hasBounced = this.bounceCountFar >= 1 || this.ballPos.z > 1.35;

        if (inAiZone && hasBounced && this.ballPos.y < 1.6 && this.ballPos.y > 0.6) {
          const targetX = (Math.random() - 0.5) * (this.tableWidth * 0.75);
          const sm = this.speedMultiplier();
          const returnSpeed = (this.currentDifficulty === 'casual' ? 2.8 : this.currentDifficulty === 'pro' ? 3.8 : 5.0) * sm;
          this.ballVel.set(targetX * 0.7, 1.5 + Math.random() * 0.3, -returnSpeed);
          this.lastHitter = 'opponent';
          this.bounceCountNear = 0;
          this.bounceCountFar = 0;
          this.scoreState.rallyCount++;
          this.audio.tableTennisPaddleHit();
        }
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  private executeHit(paddlePos: THREE.Vector3, isSmash = false): void {
    this.rallyState = 'IN_PLAY';
    this.isBallInPlay = true;
    this.lastHitter = 'player';
    this.bounceCountNear = 0;
    this.bounceCountFar = 0;
    this.scoreState.rallyCount++;
    this.hideServeBanner();
    this.ballTrail = []; // Clear trail on new hit

    // Speed multiplier scales with difficulty: Casual = 60%, Pro = 80%, Legend = 100%
    const sm = this.speedMultiplier();
    const hitOffsetX = (this.ballPos.x - paddlePos.x) * 3.0;
    const speed = (isSmash ? 5.5 : 3.2 + Math.random() * 0.6) * sm;
    const arcY = isSmash ? 1.1 : 1.55;

    this.ballVel.set(hitOffsetX, arcY, speed);
    this.audio.tableTennisPaddleHit();
    this.notifyScore();
  }

  public onAction(event: ActionEvent): void {
    const paddlePos = this.getPaddleWorldPos();
    if (this.rallyState === 'READY_TO_SERVE' && this.scoreState.currentServer === 1) {
      this.executeHit(paddlePos, event.type === 'OVERHEAD_SMASH');
      return;
    }

    if (this.rallyState !== 'IN_PLAY') return;

    // Check if ball is in player's hitting zone
    const inHitZone = this.ballPos.z <= -0.4 && this.ballPos.z >= -2.05 && this.ballPos.y > 0.55;
    if (inHitZone && this.lastHitter !== 'player') {
      this.executeHit(paddlePos, event.type === 'OVERHEAD_SMASH');
    }
  }

  private handleRallyPoint(winner: 1 | 2, reason: string): void {
    if (this.rallyState !== 'IN_PLAY') return;
    this.rallyState = 'POINT_AWARDED';
    this.isBallInPlay = false;
    this.ballVel.set(0, 0, 0);

    this.scoreState.lastPointWinner = winner;
    this.scoreState.lastPointReason = reason;

    if (winner === 1) {
      this.scoreState.player1Score++;
      this.audio.scoreChime();
    } else {
      this.scoreState.player2Score++;
    }

    const p1 = this.scoreState.player1Score;
    const p2 = this.scoreState.player2Score;
    const totalPoints = p1 + p2;
    const target = this.targetScore;
    const maxCap = target === 11 ? 15 : 30;

    // Service rotation according to official ITTF rules:
    // If in deuce (>= 10-10 for 11pt game), service switches after every point.
    // Otherwise, service switches after every 2 points.
    const isDeuce = p1 >= target - 1 && p2 >= target - 1;
    if (isDeuce) {
      this.scoreState.currentServer = totalPoints % 2 === 0 ? 1 : 2;
    } else {
      const serveBlock = Math.floor(totalPoints / 2);
      this.scoreState.currentServer = serveBlock % 2 === 0 ? 1 : 2;
    }

    // Win / Defeat condition
    const p1Wins = (p1 >= target && p1 - p2 >= 2) || p1 === maxCap;
    const p2Wins = (p2 >= target && p2 - p1 >= 2) || p2 === maxCap;

    if (p1Wins || p2Wins) {
      this.scoreState.isGameOver = true;
      this.scoreState.winner = p1Wins ? 1 : 2;
      this.rallyState = 'GAME_OVER';
      this.audio.whistle();
    } else {
      const isMatchPointP1 = (p1 === target - 1 && p1 > p2) || (p1 >= target - 1 && p1 - p2 === 1);
      const isMatchPointP2 = (p2 === target - 1 && p2 > p1) || (p2 >= target - 1 && p2 - p1 === 1);

      if (isDeuce && p1 === p2) {
        this.scoreState.matchPointText = `DEUCE (${p1}-${p2}) — WIN BY 2 TO CLAIM VICTORY`;
      } else if (isMatchPointP1) {
        this.scoreState.matchPointText = 'MATCH POINT — PLAYER';
      } else if (isMatchPointP2) {
        this.scoreState.matchPointText = 'MATCH POINT — OPPONENT';
      } else {
        this.scoreState.matchPointText = undefined;
      }
    }

    this.notifyScore();

    // Next serve delay
    if (!this.scoreState.isGameOver) {
      setTimeout(() => {
        if (this.isRunning && this.rallyState === 'POINT_AWARDED') {
          this.resetBall(this.scoreState.currentServer);
        }
      }, 1400);
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
      this.scoreCallbacks = this.scoreCallbacks.filter((c) => c !== callback);
    };
  }

  private notifyScore(): void {
    for (const cb of this.scoreCallbacks) {
      cb(this.scoreState);
    }
  }

  public destroy(): void {
    this.isRunning = false;
    this.hideServeBanner();
    if (this.serveBanner) {
      this.serveBanner.remove();
      this.serveBanner = undefined;
    }
    if (this.netHitBanner) {
      this.netHitBanner.remove();
      this.netHitBanner = undefined;
    }
    // Remove trail meshes from scene
    for (const tm of this.ballTrailMeshes) this.scene.remove(tm);
    this.ballTrailMeshes = [];
    this.ballTrail = [];
    if (this.cameraViewBtn) {
      this.cameraViewBtn.remove();
      this.cameraViewBtn = undefined;
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
