import * as THREE from 'three';
import { IGameScene, GameScoreState } from '../core/scene/IGameScene';
import { GameModeId, OpponentMode, DifficultyLevel, MotionFrame, ActionEvent, Vector3D } from '../core/motion/Types';
import { SoundSynthesizer } from '../core/audio/SoundSynthesizer';
import { Avatar3D } from './components/Avatar3D';
import { OpponentAI } from '../core/multiplayer/OpponentAI';

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

  // Shuttlecock
  private shuttleGroup!: THREE.Group;
  private shuttlePos = new THREE.Vector3(0, 2.0, -3.5);
  private shuttleVel = new THREE.Vector3(0, 0, 0);
  private isShuttleInPlay = false;
  private lastHitter: 'player' | 'opponent' | null = null;
  private serveTimer = 0;

  // Court geometry
  private readonly courtLength = 13.4;
  private readonly courtWidth = 6.1;
  private readonly netHeight = 1.55;

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
  private currentOpponentMode: OpponentMode = 'system';

  public init(
    container: HTMLElement,
    audio: SoundSynthesizer,
    config?: { opponentMode: OpponentMode; difficulty: DifficultyLevel }
  ): void {
    this.container = container;
    this.audio = audio;
    if (config) {
      this.currentDifficulty = config.difficulty;
      this.currentOpponentMode = config.opponentMode;
    }

    // Three.js Setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x070c18);
    this.scene.fog = new THREE.FogExp2(0x070c18, 0.035);

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    // Camera positioned behind player looking across the net
    this.camera = new THREE.PerspectiveCamera(52, width / height, 0.1, 100);
    this.camera.position.set(0, 2.2, -6.8);
    this.camera.lookAt(0, 1.4, 1.5);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    container.appendChild(this.renderer.domElement);

    // Arena Lighting
    this.setupLighting();

    // 3D Badminton Court
    this.buildCourt();

    // Player & Opponent Avatars
    this.playerAvatar = new Avatar3D(0x00f2fe, 0x39ff14);
    this.playerAvatar.setEquipment('badminton');
    this.playerAvatar.group.position.set(0, 0, -4.0);
    this.scene.add(this.playerAvatar.group);

    this.opponentAvatar = new Avatar3D(0xff0055, 0xfacc15);
    this.opponentAvatar.setEquipment('badminton');
    this.opponentAvatar.group.position.set(0, 0, 4.0);
    this.opponentAvatar.group.rotation.y = Math.PI; // Face player
    this.scene.add(this.opponentAvatar.group);

    // AI
    this.opponentAI = new OpponentAI(this.currentDifficulty, { x: 0, y: 0, z: 4.2 });

    // Shuttlecock
    this.buildShuttlecock();

    // Prepare first serve
    this.resetBall(1);
  }

  private setupLighting(): void {
    const ambient = new THREE.AmbientLight(0xffffff, 0.85);
    this.scene.add(ambient);

    // Overhead stadium floodlights
    const stadiumLight1 = new THREE.DirectionalLight(0xffffff, 1.4);
    stadiumLight1.position.set(5, 9, 0);
    stadiumLight1.castShadow = true;
    stadiumLight1.shadow.mapSize.width = 1024;
    stadiumLight1.shadow.mapSize.height = 1024;
    this.scene.add(stadiumLight1);

    const stadiumLight2 = new THREE.DirectionalLight(0xffffff, 1.4);
    stadiumLight2.position.set(-5, 9, 0);
    this.scene.add(stadiumLight2);

    // Cyan court edge accent light
    const accentLight = new THREE.PointLight(0x00f2fe, 2, 20);
    accentLight.position.set(0, 4, -4);
    this.scene.add(accentLight);
  }

  private buildCourt(): void {
    // Green athletic badminton court mat
    const courtGeo = new THREE.PlaneGeometry(this.courtWidth, this.courtLength);
    const courtMat = new THREE.MeshStandardMaterial({
      color: 0x0d5c3a,
      roughness: 0.6,
      metalness: 0.1
    });
    const courtMesh = new THREE.Mesh(courtGeo, courtMat);
    courtMesh.rotation.x = -Math.PI / 2;
    courtMesh.receiveShadow = true;
    this.scene.add(courtMesh);

    // Surrounding stadium floor
    const stadiumGeo = new THREE.PlaneGeometry(24, 30);
    const stadiumMat = new THREE.MeshStandardMaterial({
      color: 0x0a101d,
      roughness: 0.8
    });
    const stadiumFloor = new THREE.Mesh(stadiumGeo, stadiumMat);
    stadiumFloor.rotation.x = -Math.PI / 2;
    stadiumFloor.position.y = -0.01;
    this.scene.add(stadiumFloor);

    // Court White Lines (BWF Regulations)
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

    // Perimeter lines
    addLine(this.courtWidth, lineThickness, 0, halfL);
    addLine(this.courtWidth, lineThickness, 0, -halfL);
    addLine(lineThickness, this.courtLength, halfW, 0);
    addLine(lineThickness, this.courtLength, -halfW, 0);

    // Center Net Line
    addLine(this.courtWidth, lineThickness * 1.5, 0, 0);

    // Short Service Lines (1.98m from net on each side)
    addLine(this.courtWidth, lineThickness, 0, 1.98);
    addLine(this.courtWidth, lineThickness, 0, -1.98);

    // Center Service Division Lines
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

    // Net Mesh
    const netMeshGeo = new THREE.PlaneGeometry(this.courtWidth + 0.2, 0.76);
    const netMat = new THREE.MeshStandardMaterial({
      color: 0x242424,
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide
    });
    const netMesh = new THREE.Mesh(netMeshGeo, netMat);
    netMesh.position.set(0, this.netHeight - 0.38, 0);
    this.scene.add(netMesh);

    // White Top Tape of the Net
    const tapeGeo = new THREE.BoxGeometry(this.courtWidth + 0.2, 0.08, 0.03);
    const tapeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const tape = new THREE.Mesh(tapeGeo, tapeMat);
    tape.position.set(0, this.netHeight, 0);
    this.scene.add(tape);
  }

  private buildShuttlecock(): void {
    this.shuttleGroup = new THREE.Group();

    // Cork Head (Semi-sphere)
    const corkGeo = new THREE.SphereGeometry(0.035, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const corkMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.3 });
    const cork = new THREE.Mesh(corkGeo, corkMat);
    cork.rotation.x = Math.PI;
    this.shuttleGroup.add(cork);

    // Feather Skirt (Cone)
    const featherGeo = new THREE.ConeGeometry(0.075, 0.09, 16, 1, true);
    const featherMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      roughness: 0.5
    });
    const feathers = new THREE.Mesh(featherGeo, featherMat);
    feathers.position.y = 0.05;
    this.shuttleGroup.add(feathers);

    // Glow halo for visibility at speed
    const haloGeo = new THREE.SphereGeometry(0.06, 8, 8);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0x00f2fe,
      wireframe: true,
      transparent: true,
      opacity: 0.5
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    this.shuttleGroup.add(halo);

    this.shuttleGroup.castShadow = true;
    this.scene.add(this.shuttleGroup);
  }

  private resetBall(server: 1 | 2 = 1): void {
    this.isShuttleInPlay = false;
    this.serveTimer = 1.0; // 1s ready delay

    if (server === 1) {
      // Player serves from near court
      this.shuttlePos.set(0.3, 1.3, -4.0);
      this.shuttleVel.set(0, 0, 0);
      this.lastHitter = null;
    } else {
      // Opponent serves from far court
      this.shuttlePos.set(0, 1.4, 4.0);
      this.shuttleVel.set(0, 0, 0);
      this.lastHitter = 'opponent';
    }

    this.shuttleGroup.position.copy(this.shuttlePos);
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
    this.opponentAI.reset();
    this.resetBall(1);
    this.notifyScore();
  }

  public update(deltaTime: number, motionFrame: MotionFrame | null): void {
    if (!this.isRunning) return;

    // Update Player Avatar from Motion Tracking
    if (motionFrame && motionFrame.worldLandmarks) {
      this.playerAvatar.update(motionFrame.worldLandmarks, motionFrame.metrics.dominantArm);

      // Mirror player court movement (lateral stepping & lunges)
      const playerX = motionFrame.metrics.hipCenterWorld.x * 2.2;
      const playerZ = -4.0 + (motionFrame.metrics.isLungingRight || motionFrame.metrics.isLungingLeft ? 0.6 : 0);
      this.playerAvatar.group.position.x = THREE.MathUtils.lerp(this.playerAvatar.group.position.x, playerX, 0.2);
      this.playerAvatar.group.position.z = THREE.MathUtils.lerp(this.playerAvatar.group.position.z, playerZ, 0.2);
    }

    // Serve delay countdown
    if (!this.isShuttleInPlay) {
      this.serveTimer -= deltaTime;
      if (this.serveTimer <= 0) {
        if (this.scoreState.currentServer === 2) {
          // AI serves
          this.isShuttleInPlay = true;
          this.shuttleVel.set((Math.random() - 0.5) * 2, 4.8, -9.5);
          this.lastHitter = 'opponent';
          this.audio.badmintonHit(50);
        } else {
          // Auto high serve for player if waiting too long
          this.isShuttleInPlay = true;
          this.shuttleVel.set((Math.random() - 0.5) * 1.5, 5.2, 10.5);
          this.lastHitter = 'player';
          this.audio.badmintonHit(60);
        }
      }
    }

    // Shuttlecock Aerodynamics & Flight Physics
    if (this.isShuttleInPlay) {
      const speed = this.shuttleVel.length();

      // Quadratic aerodynamic drag of badminton shuttlecock: F = -0.5 * Cd * rho * A * v^2
      // This causes dramatic deceleration from initial high speed
      const dragCoeff = 0.045;
      const dragMag = dragCoeff * speed * speed;
      const dragVec = this.shuttleVel.clone().normalize().multiplyScalar(-dragMag * deltaTime);

      this.shuttleVel.add(dragVec);
      // Gravity
      this.shuttleVel.y -= 9.8 * deltaTime;

      // Update position
      this.shuttlePos.addScaledVector(this.shuttleVel, deltaTime);
      this.shuttleGroup.position.copy(this.shuttlePos);

      // Shuttlecock orientation: head always faces flight direction
      if (speed > 0.5) {
        const targetPoint = this.shuttlePos.clone().add(this.shuttleVel);
        this.shuttleGroup.lookAt(targetPoint);
      }

      // Net Collision Detection
      if (Math.abs(this.shuttlePos.z) < 0.12 && this.shuttlePos.y < this.netHeight) {
        // Hit net
        this.audio.badmintonHit(30);
        this.handleRallyPoint(this.lastHitter === 'player' ? 2 : 1, 'Net Hit');
        return;
      }

      // Ground Floor Impact
      if (this.shuttlePos.y <= 0.05) {
        this.shuttlePos.y = 0.05;
        this.isShuttleInPlay = false;

        // Check in vs out
        const halfW = this.courtWidth / 2;
        const halfL = this.courtLength / 2;
        const isInsideWidth = Math.abs(this.shuttlePos.x) <= halfW;
        const isInsideLength = Math.abs(this.shuttlePos.z) <= halfL;

        if (this.shuttlePos.z > 0) {
          // Landed in opponent's court
          if (isInsideWidth && isInsideLength) {
            this.handleRallyPoint(1, 'In! Player Scores');
          } else {
            this.handleRallyPoint(2, 'Out! Opponent Scores');
          }
        } else {
          // Landed in player's court
          if (isInsideWidth && isInsideLength) {
            this.handleRallyPoint(2, 'Opponent Scores');
          } else {
            this.handleRallyPoint(1, 'Out! Player Scores');
          }
        }
        return;
      }

      // AI Opponent Interception
      if (this.lastHitter === 'player' && this.shuttlePos.z > 1.2) {
        const courtBounds = {
          minX: -this.courtWidth * 0.45,
          maxX: this.courtWidth * 0.45,
          minZ: 2.2,
          maxZ: this.courtLength * 0.48
        };

        const aiResult = this.opponentAI.update(
          deltaTime,
          this.shuttlePos,
          this.shuttleVel,
          courtBounds
        );

        // Update opponent avatar
        this.opponentAvatar.group.position.x = this.opponentAI.position.x;
        this.opponentAvatar.group.position.z = this.opponentAI.position.z;

        if (aiResult.didHit && aiResult.hitVelocity) {
          this.shuttleVel.set(aiResult.hitVelocity.x, aiResult.hitVelocity.y, aiResult.hitVelocity.z);
          this.lastHitter = 'opponent';
          this.scoreState.rallyCount++;

          if (aiResult.isSmash) {
            this.audio.badmintonSmash();
          } else {
            this.audio.badmintonHit(70);
          }
        }
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  public onAction(event: ActionEvent): void {
    // Check if player hits shuttlecock
    const distToShuttle = this.playerAvatar.group.position.distanceTo(this.shuttlePos);
    const inHitWindow = this.shuttlePos.z < -1.5 && this.shuttlePos.z > -5.5 && this.shuttlePos.y > 0.2;

    if (inHitWindow && (this.lastHitter === 'opponent' || !this.isShuttleInPlay || distToShuttle < 3.2)) {
      this.isShuttleInPlay = true;
      this.lastHitter = 'player';
      this.scoreState.rallyCount++;

      // Compute return shot trajectory based on stroke type and power
      let returnSpeed = 11.0 + (event.power / 100) * 8.0;
      let returnY = 4.2;
      let returnX = (event.direction.x || 0) * 4.0;

      if (event.type === 'OVERHEAD_SMASH') {
        returnSpeed = 19.0 + (event.power / 100) * 8.0; // Rapid smash trajectory
        returnY = -1.8;                                  // Steep downwards dive
        this.audio.badmintonSmash();
      } else if (event.type === 'OVERHEAD_CLEAR') {
        returnSpeed = 13.0;
        returnY = 6.8;                                  // High defensive lob
        this.audio.badmintonHit(80);
      } else if (event.type === 'DROP_SHOT') {
        returnSpeed = 7.5;
        returnY = 2.4;                                  // Delicate net tumble
        this.audio.badmintonHit(45);
      } else {
        // Drive / Forehand / Backhand
        returnSpeed = 14.0;
        returnY = 3.2;
        this.audio.badmintonHit(65);
      }

      this.shuttleVel.set(returnX, returnY, returnSpeed);
      this.notifyScore();
    }
  }

  private handleRallyPoint(winner: 1 | 2, reason: string): void {
    this.isShuttleInPlay = false;
    this.scoreState.lastPointWinner = winner;

    if (winner === 1) {
      this.scoreState.player1Score++;
      this.scoreState.currentServer = 1;
      this.audio.scoreChime();
    } else {
      this.scoreState.player2Score++;
      this.scoreState.currentServer = 2;
    }

    if (this.scoreState.player1Score >= 11 || this.scoreState.player2Score >= 11) {
      this.scoreState.isGameOver = true;
      this.scoreState.winner = winner;
    }

    this.notifyScore();

    // Prepare next point
    if (!this.scoreState.isGameOver) {
      setTimeout(() => {
        if (this.isRunning) {
          this.resetBall(this.scoreState.currentServer);
        }
      }, 1500);
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
