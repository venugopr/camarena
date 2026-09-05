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

  // Table dimensions (ITTF specs)
  private readonly tableLength = 2.74;
  private readonly tableWidth = 1.525;
  private readonly tableHeight = 0.76;
  private readonly netHeight = 0.1525;

  // Ball physics state
  private ballPos = new THREE.Vector3(0, 0.95, -1.2);
  private ballVel = new THREE.Vector3(0, 0, 0);
  private isBallInPlay = false;
  private lastHitter: 'player' | 'opponent' | null = null;
  private bounceCountNear = 0;
  private bounceCountFar = 0;
  private serveTimer = 0;

  // AI Paddle
  private aiPaddlePos = new THREE.Vector3(0, 0.88, 1.45);

  // Score
  private scoreState: GameScoreState = {
    player1Score: 0,
    player2Score: 0,
    currentServer: 1,
    rallyCount: 0,
    isGameOver: false,
    winner: null,
    lastPointWinner: null
  };

  private scoreCallbacks: ((score: GameScoreState) => void)[] = [];
  private isRunning = false;
  private currentDifficulty: DifficultyLevel = 'casual';

  public init(
    container: HTMLElement,
    audio: SoundSynthesizer,
    config?: { opponentMode: OpponentMode; difficulty: DifficultyLevel }
  ): void {
    this.container = container;
    this.audio = audio;
    if (config) {
      this.currentDifficulty = config.difficulty;
    }

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x080e1a);
    this.scene.fog = new THREE.FogExp2(0x080e1a, 0.05);

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    // First-person / close third-person sports camera
    this.camera = new THREE.PerspectiveCamera(48, width / height, 0.05, 50);
    this.camera.position.set(0, 1.35, -2.1);
    this.camera.lookAt(0, 0.88, 0.2);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    container.appendChild(this.renderer.domElement);

    // Arena Lighting
    this.setupLighting();

    // 3D Table Tennis Table
    this.buildTable();

    // Avatars
    this.playerAvatar = new Avatar3D(0x00f2fe, 0x39ff14);
    this.playerAvatar.setEquipment('tabletennis');
    this.playerAvatar.group.position.set(0, 0, -1.6);
    this.scene.add(this.playerAvatar.group);

    this.opponentAvatar = new Avatar3D(0xff0055, 0xfacc15);
    this.opponentAvatar.setEquipment('tabletennis');
    this.opponentAvatar.group.position.set(0, 0, 1.7);
    this.opponentAvatar.group.rotation.y = Math.PI;
    this.scene.add(this.opponentAvatar.group);

    // Ball
    this.buildBall();

    // Prepare serve
    this.resetBall(1);
  }

  private setupLighting(): void {
    const ambient = new THREE.AmbientLight(0xffffff, 0.9);
    this.scene.add(ambient);

    const overheadLight = new THREE.DirectionalLight(0xffffff, 1.6);
    overheadLight.position.set(0, 4.5, 0);
    overheadLight.castShadow = true;
    overheadLight.shadow.mapSize.width = 1024;
    overheadLight.shadow.mapSize.height = 1024;
    this.scene.add(overheadLight);

    const cyanRim = new THREE.PointLight(0x00f2fe, 2, 8);
    cyanRim.position.set(1.5, 2, -1);
    this.scene.add(cyanRim);
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

    // Net
    const netMeshGeo = new THREE.PlaneGeometry(this.tableWidth + 0.3, this.netHeight);
    const netMat = new THREE.MeshStandardMaterial({
      color: 0x111111,
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide
    });
    const netMesh = new THREE.Mesh(netMeshGeo, netMat);
    netMesh.position.set(0, this.tableHeight + this.netHeight / 2, 0);
    this.scene.add(netMesh);

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

    // Floor
    const floorGeo = new THREE.PlaneGeometry(12, 14);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x070b14, roughness: 0.8 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.01;
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  private buildBall(): void {
    // 40mm ping-pong ball (orange or white)
    const ballGeo = new THREE.SphereGeometry(0.024, 20, 20);
    const ballMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.2,
      emissive: 0xffffff,
      emissiveIntensity: 0.15
    });
    this.ballMesh = new THREE.Mesh(ballGeo, ballMat);
    this.ballMesh.castShadow = true;
    this.scene.add(this.ballMesh);

    // Ball ground shadow decal
    const shadowGeo = new THREE.CircleGeometry(0.035, 16);
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

  private resetBall(server: 1 | 2 = 1): void {
    this.isBallInPlay = false;
    this.bounceCountNear = 0;
    this.bounceCountFar = 0;
    this.serveTimer = 1.0;

    if (server === 1) {
      this.ballPos.set(0.2, 0.95, -1.15);
      this.ballVel.set(0, 0, 0);
      this.lastHitter = null;
    } else {
      this.ballPos.set(-0.2, 0.95, 1.15);
      this.ballVel.set(0, 0, 0);
      this.lastHitter = 'opponent';
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

  public reset(): void {
    this.scoreState = {
      player1Score: 0,
      player2Score: 0,
      currentServer: 1,
      rallyCount: 0,
      isGameOver: false,
      winner: null,
      lastPointWinner: null
    };
    this.resetBall(1);
    this.notifyScore();
  }

  public update(deltaTime: number, motionFrame: MotionFrame | null): void {
    if (!this.isRunning) return;

    // Update Player Avatar from Motion Tracking
    if (motionFrame && motionFrame.worldLandmarks) {
      this.playerAvatar.update(motionFrame.worldLandmarks, motionFrame.metrics.dominantArm);

      const playerX = motionFrame.metrics.hipCenterWorld.x * 1.5;
      this.playerAvatar.group.position.x = THREE.MathUtils.lerp(this.playerAvatar.group.position.x, playerX, 0.25);
    }

    // Serve delay countdown
    if (!this.isBallInPlay) {
      this.serveTimer -= deltaTime;
      if (this.serveTimer <= 0) {
        this.isBallInPlay = true;
        if (this.scoreState.currentServer === 2) {
          // AI serves
          this.ballVel.set((Math.random() - 0.5) * 0.8, 1.8, -4.2);
          this.lastHitter = 'opponent';
          this.audio.tableTennisPaddleHit();
        } else {
          // Player serves
          this.ballVel.set((Math.random() - 0.5) * 0.8, 1.8, 4.2);
          this.lastHitter = 'player';
          this.audio.tableTennisPaddleHit();
        }
      }
    }

    // Ball Dynamics
    if (this.isBallInPlay) {
      // Gravity
      this.ballVel.y -= 9.8 * deltaTime;

      // Update position
      this.ballPos.addScaledVector(this.ballVel, deltaTime);
      this.ballMesh.position.copy(this.ballPos);

      // Update ball shadow projection onto table
      this.ballShadowMesh.position.x = this.ballPos.x;
      this.ballShadowMesh.position.z = this.ballPos.z;
      const heightAboveTable = Math.max(0, this.ballPos.y - this.tableHeight);
      const shadowScale = Math.max(0.3, 1.0 - heightAboveTable * 0.8);
      this.ballShadowMesh.scale.set(shadowScale, shadowScale, shadowScale);
      this.ballShadowMesh.visible = this.ballPos.y >= this.tableHeight - 0.1 && Math.abs(this.ballPos.x) <= this.tableWidth / 2 && Math.abs(this.ballPos.z) <= this.tableLength / 2;

      // Table Bounce Collision
      const halfW = this.tableWidth / 2;
      const halfL = this.tableLength / 2;
      const isOverTable = Math.abs(this.ballPos.x) <= halfW && Math.abs(this.ballPos.z) <= halfL;

      if (isOverTable && this.ballPos.y <= this.tableHeight + 0.024 && this.ballVel.y < 0) {
        this.ballPos.y = this.tableHeight + 0.024;
        this.ballVel.y = -this.ballVel.y * 0.87; // High restitution bounce

        if (this.ballPos.z < 0) {
          this.bounceCountNear++;
          this.audio.tableTennisBounce(true);
        } else {
          this.bounceCountFar++;
          this.audio.tableTennisBounce(false);
        }
      }

      // Net Collision
      if (Math.abs(this.ballPos.z) < 0.04 && this.ballPos.y < this.tableHeight + this.netHeight) {
        this.audio.tableTennisPaddleHit();
        this.handleRallyPoint(this.lastHitter === 'player' ? 2 : 1, 'Net Strike');
        return;
      }

      // Floor Drop / Out
      if (this.ballPos.y <= 0.1) {
        this.isBallInPlay = false;
        if (this.lastHitter === 'player') {
          if (this.bounceCountFar >= 1) {
            this.handleRallyPoint(1, 'Player Scores');
          } else {
            this.handleRallyPoint(2, 'Out! Opponent Scores');
          }
        } else {
          if (this.bounceCountNear >= 1) {
            this.handleRallyPoint(2, 'Opponent Scores');
          } else {
            this.handleRallyPoint(1, 'Out! Player Scores');
          }
        }
        return;
      }

      // AI Opponent Interception
      if (this.lastHitter === 'player' && this.ballPos.z > 0.4 && this.ballVel.z > 0) {
        // Track ball X
        const diffX = this.ballPos.x - this.aiPaddlePos.x;
        this.aiPaddlePos.x += Math.min(Math.abs(diffX), 3.0 * deltaTime) * Math.sign(diffX);
        this.opponentAvatar.group.position.x = this.aiPaddlePos.x;

        // Hit ball when it reaches opponent paddle zone
        if (this.ballPos.z >= 1.25 && this.ballPos.y < 1.3) {
          this.ballVel.z = -(3.8 + Math.random() * 1.5);
          this.ballVel.y = 1.9 + Math.random() * 0.6;
          this.ballVel.x = (Math.random() - 0.5) * 1.8;
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

  public onAction(event: ActionEvent): void {
    // Check if ball is in player's hitting zone
    const inHitZone = this.ballPos.z <= -0.5 && this.ballPos.z >= -1.6 && this.ballPos.y > 0.6;

    if (inHitZone && (this.lastHitter === 'opponent' || !this.isBallInPlay)) {
      this.isBallInPlay = true;
      this.lastHitter = 'player';
      this.bounceCountNear = 0;
      this.bounceCountFar = 0;
      this.scoreState.rallyCount++;

      // Impart velocity from user swing
      const powerRatio = Math.min(1.0, event.power / 100);
      const forwardSpeed = 4.2 + powerRatio * 3.5;
      const verticalArc = event.type === 'OVERHEAD_SMASH' ? 0.9 : 1.75;
      const sideSpinX = (event.direction.x || 0) * 1.6;

      this.ballVel.set(sideSpinX, verticalArc, forwardSpeed);
      this.audio.tableTennisPaddleHit();
      this.notifyScore();
    }
  }

  private handleRallyPoint(winner: 1 | 2, reason: string): void {
    this.isBallInPlay = false;
    this.scoreState.lastPointWinner = winner;

    if (winner === 1) {
      this.scoreState.player1Score++;
      this.audio.scoreChime();
    } else {
      this.scoreState.player2Score++;
    }

    // Switch server every 2 points
    const totalPoints = this.scoreState.player1Score + this.scoreState.player2Score;
    this.scoreState.currentServer = (Math.floor(totalPoints / 2) % 2 === 0) ? 1 : 2;

    if (this.scoreState.player1Score >= 11 || this.scoreState.player2Score >= 11) {
      this.scoreState.isGameOver = true;
      this.scoreState.winner = winner;
    }

    this.notifyScore();

    if (!this.scoreState.isGameOver) {
      setTimeout(() => {
        if (this.isRunning) {
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
