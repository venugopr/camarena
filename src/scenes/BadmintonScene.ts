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
  private shuttleShadow!: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private landingReticle!: THREE.Group;
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
  private readonly dragCoefficient = 0.15;
  private readonly dragCompensation = 1.32;
  private readonly cameraTarget = new THREE.Vector3();
  private readonly neutralPlayerPosition = new THREE.Vector3(0, 0, -3.65);
  private cameraFollowX = 0;
  private plannedNetHeight = 1.88;

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
    this.camera = new THREE.PerspectiveCamera(64, width / height, 0.1, 100);
    this.camera.fov = 64;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(0, 1.72, -4.75);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 1.42, 3.5);

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
    this.buildLandingReticle();

    // Prepare first serve
    this.resetBall(1);
    window.addEventListener('keydown', this.handleKeyDown);
    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);
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
    const corkMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.7,
      roughness: 0.3
    });
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
    this.shuttleGroup.scale.setScalar(1.25);
    this.scene.add(this.shuttleGroup);

    const shadowGeo = new THREE.CircleGeometry(0.2, 32);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x020617,
      transparent: true,
      opacity: 0.5,
      depthWrite: false
    });
    this.shuttleShadow = new THREE.Mesh(shadowGeo, shadowMat);
    this.shuttleShadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.shuttleShadow);
  }

  private buildLandingReticle(): void {
    this.landingReticle = new THREE.Group();
    const outer = new THREE.Mesh(
      new THREE.TorusGeometry(0.28, 0.018, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0x00f2fe, transparent: true, opacity: 0.9 })
    );
    const inner = new THREE.Mesh(
      new THREE.TorusGeometry(0.16, 0.01, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 })
    );
    outer.name = 'arrival-ring';
    inner.name = 'arrival-core';
    outer.rotation.x = Math.PI / 2;
    inner.rotation.x = Math.PI / 2;
    this.landingReticle.add(outer, inner);
    this.landingReticle.visible = false;
    this.scene.add(this.landingReticle);
  }

  private resetBall(server: 1 | 2 = 1): void {
    this.isShuttleInPlay = false;
    this.serveTimer = server === 2 ? 0.8 : 0;

    if (server === 1) {
      // Player serves from near court
      this.shuttlePos.set(0.3, 1.1, -3.8);
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
      this.playerAvatar.update(
        motionFrame.worldLandmarks,
        motionFrame.metrics.dominantArm,
        motionFrame.rawLandmarks
      );

      if (this.playerAvatar.isStandingConfident()) {
        const playerX = THREE.MathUtils.clamp(motionFrame.metrics.hipCenterWorld.x * 2.2, -2.2, 2.2);
        const playerZ = THREE.MathUtils.clamp(
          -4.0 + (motionFrame.metrics.isLungingRight || motionFrame.metrics.isLungingLeft ? 0.6 : 0),
          -4.5,
          -2.8
        );
        this.playerAvatar.group.position.x = THREE.MathUtils.lerp(this.playerAvatar.group.position.x, playerX, 0.08);
        this.playerAvatar.group.position.z = THREE.MathUtils.lerp(this.playerAvatar.group.position.z, playerZ, 0.08);
      } else {
        this.playerAvatar.group.position.lerp(this.neutralPlayerPosition, 0.08);
      }
    }

    this.cameraFollowX = THREE.MathUtils.lerp(this.cameraFollowX, this.playerAvatar.group.position.x * 0.22, 0.012);
    this.camera.position.set(this.cameraFollowX, 1.72, -4.75);
    this.camera.up.set(0, 1, 0);
    this.cameraTarget.set(this.cameraFollowX * 1.14, 1.42, 3.5);
    this.camera.lookAt(this.cameraTarget);

    if (!this.isShuttleInPlay && this.scoreState.currentServer === 1) {
      this.shuttlePos.copy(this.playerAvatar.getSupportHandWorldPosition());
      this.shuttleGroup.position.copy(this.shuttlePos);
    }

    // Serve delay countdown
    if (!this.isShuttleInPlay) {
      this.serveTimer -= deltaTime;
      if (this.serveTimer <= 0) {
        if (this.scoreState.currentServer === 2) {
          // AI serves
          this.isShuttleInPlay = true;
          this.plannedNetHeight = 2.2;
          this.shuttleVel.set((Math.random() - 0.5) * 2, 8.5, -9.5 * this.dragCompensation);
          this.lastHitter = 'opponent';
          this.audio.badmintonHit(50);
        } else {
          this.serveTimer = 0;
        }
      }
    }

    // Shuttlecock Aerodynamics & Flight Physics
    if (this.isShuttleInPlay) {
      const speed = this.shuttleVel.length();

      // Quadratic aerodynamic drag of badminton shuttlecock: F = -0.5 * Cd * rho * A * v^2
      // This causes dramatic deceleration from initial high speed
      const dragMag = this.dragCoefficient * speed * speed;
      const dragVec = speed > 0
        ? this.shuttleVel.clone().normalize().multiplyScalar(-Math.min(dragMag * deltaTime, speed * 0.3))
        : new THREE.Vector3();

      this.shuttleVel.add(dragVec);
      // Gravity
      this.shuttleVel.y -= 9.8 * deltaTime;

      // Update position
      this.shuttlePos.addScaledVector(this.shuttleVel, deltaTime);
      this.shuttleGroup.position.copy(this.shuttlePos);
      this.updateShuttleVisuals();

      // Shuttlecock orientation: head always faces flight direction
      if (speed > 0.5) {
        const targetPoint = this.shuttlePos.clone().add(this.shuttleVel);
        this.shuttleGroup.lookAt(targetPoint);
      }

      // Net Collision Detection
      if (Math.abs(this.shuttlePos.z) < 0.12 && this.shuttlePos.y < this.netHeight) {
        // Compensate numerical drag integration at the net plane instead of
        // turning a valid, compensated arc into an accidental net fault.
        this.shuttlePos.y = Math.max(this.shuttlePos.y, this.plannedNetHeight);
        this.shuttleVel.y = Math.max(Math.abs(this.shuttleVel.y), 1.5);
        this.shuttleGroup.position.copy(this.shuttlePos);
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

    this.updateShuttleVisuals();

    this.renderer.render(this.scene, this.camera);
  }

  public onAction(event: ActionEvent): void {
    const racketDistance = this.playerAvatar.getRacketHeadWorldPosition().distanceTo(this.shuttlePos);
    const contactHeight = this.shuttlePos.y;
    const readyToServe = !this.isShuttleInPlay && this.scoreState.currentServer === 1;
    const inHitWindow = this.shuttlePos.z < -1.5 && this.shuttlePos.z > -5.5 && contactHeight > 0.2;

    if (readyToServe) {
      if (racketDistance <= 0.28 && event.speedMps > 1.2) {
        this.launchPlayerShot(event, true);
      }
      return;
    }

    if (inHitWindow && this.lastHitter === 'opponent' && racketDistance <= 1.4) {
      this.launchPlayerShot(event, false);
    }
  }

  private launchPlayerShot(event: ActionEvent, isServe: boolean): void {
    const contactHeight = this.shuttlePos.y;
    const underhand = contactHeight <= 1.4;
    const isSmash = event.type === 'OVERHEAD_SMASH' && contactHeight > 2.1;
    const directionX = (event.direction.x || 0) * 4.0;
    let forwardSpeed = isServe ? 10.5 : 11 + (event.power / 100) * 8;
    let minimumNetHeight = 1.68;
    let angle = 0;

    if (underhand) {
      angle = THREE.MathUtils.degToRad(40);
      minimumNetHeight = 2.2;
      forwardSpeed = Math.max(forwardSpeed, 9.5);
    } else if (event.type === 'OVERHEAD_CLEAR') {
      minimumNetHeight = 3.6;
      forwardSpeed = Math.max(forwardSpeed, 13);
    } else if (event.type === 'DROP_SHOT') {
      minimumNetHeight = 1.8;
      forwardSpeed = Math.max(forwardSpeed, 7.5);
    } else if (isSmash) {
      forwardSpeed = 19 + (event.power / 100) * 8;
    } else {
      minimumNetHeight = 1.8;
      forwardSpeed = Math.max(forwardSpeed, 14);
    }

    const towardNet = this.shuttlePos.z > 0 ? -1 : 1;
    const compensatedSpeed = forwardSpeed * this.dragCompensation;
    const distanceToNet = Math.max(0.25, Math.abs(this.shuttlePos.z));
    const effectiveForwardSpeed = compensatedSpeed * 0.58;
    const timeToNet = distanceToNet / effectiveForwardSpeed;
    const requiredVy = (minimumNetHeight - contactHeight + 0.5 * 9.8 * timeToNet * timeToNet) / timeToNet;
    const verticalSpeed = isSmash ? -Math.min(3.5, Math.max(0.8, contactHeight - 2.1)) :
      Math.max(angle > 0 ? compensatedSpeed * Math.tan(angle) : requiredVy, requiredVy);

    this.plannedNetHeight = minimumNetHeight;
    this.isShuttleInPlay = true;
    this.lastHitter = 'player';
    this.scoreState.rallyCount++;
    this.shuttleVel.set(directionX, verticalSpeed, towardNet * compensatedSpeed);
    if (isSmash) {
      this.audio.badmintonSmash();
    } else {
      this.audio.badmintonHit(underhand ? 60 : 75);
    }
    this.notifyScore();
  }

  private updateShuttleVisuals(): void {
    if (!this.shuttleShadow || !this.landingReticle) return;
    const altitude = Math.max(0, this.shuttlePos.y);
    const shadowRadius = THREE.MathUtils.clamp(0.32 - altitude * 0.035, 0.1, 0.32);
    const shadowOpacity = THREE.MathUtils.clamp(0.75 - altitude * 0.1, 0.18, 0.75);
    this.shuttleShadow.position.set(this.shuttlePos.x, 0.005, this.shuttlePos.z);
    this.shuttleShadow.scale.setScalar(shadowRadius / 0.2);
    this.shuttleShadow.material.opacity = shadowOpacity;

    const timeToNet = this.shuttleVel.z < 0
      ? (0 - this.shuttlePos.z) / this.shuttleVel.z
      : Number.POSITIVE_INFINITY;
    const showReticle = this.isShuttleInPlay && this.shuttlePos.z > 0 && timeToNet <= 0.6;
    this.landingReticle.visible = showReticle;
    if (showReticle) {
      const t = Math.max(0, timeToNet);
      const predictedX = this.shuttlePos.x + this.shuttleVel.x * t;
      this.landingReticle.position.set(predictedX, 0.008, -3.2);
      const pulse = 0.82 + Math.sin(performance.now() * 0.012) * 0.18;
      this.landingReticle.scale.setScalar(pulse);
    }
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== 'Space') return;
    event.preventDefault();
    if (!this.isShuttleInPlay && this.scoreState.currentServer === 1) {
      this.launchPlayerShot({
        type: 'UNDERHAND_LIFT',
        timestamp: performance.now(),
        speedMps: 2,
        speedKmh: 7.2,
        power: 50,
        arm: 'right',
        wristVelocity: { x: 0, y: 2, z: 1.2 },
        elbowAngleDeg: 90,
        shoulderAngleDeg: 45,
        apexHeightMeters: 2.2,
        lungeDepthMeters: 0,
        direction: { x: 0, y: 0, z: 1 },
        description: 'Keyboard serve'
      }, true);
    }
  };

  private readonly handlePointerDown = (): void => {
    if (!this.isShuttleInPlay && this.scoreState.currentServer === 1) {
      this.handleKeyDown(new KeyboardEvent('keydown', { code: 'Space' }));
    }
  };

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

    const highScore = Math.max(this.scoreState.player1Score, this.scoreState.player2Score);
    const scoreGap = Math.abs(this.scoreState.player1Score - this.scoreState.player2Score);
    if (highScore >= 11 && scoreGap >= 2) {
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
    window.removeEventListener('keydown', this.handleKeyDown);
    if (this.renderer?.domElement) {
      this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    }
    if (this.renderer && this.renderer.domElement) {
      this.renderer.domElement.remove();
      this.renderer.dispose();
    }
  }
}
