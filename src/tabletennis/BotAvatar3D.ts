import * as THREE from 'three';
import { Avatar3D } from '../badminton/Avatar3D';
import { PoseLandmark } from '../common/Types';

export type BotExpression = 'neutral' | 'shocked' | 'happy' | 'disappointed';

/**
 * Expressive 3D Opponent Bot for Table Tennis.
 * Replaces bare skeleton primitives with a sleek, friendly robot body and
 * an animated LED visor face that reacts dynamically to match events.
 */
export class BotAvatar3D extends Avatar3D {
  private faceCanvas: HTMLCanvasElement;
  private faceCtx: CanvasRenderingContext2D;
  private faceTexture: THREE.CanvasTexture;
  private visorMesh!: THREE.Mesh;
  private robotHeadGroup: THREE.Group;

  private currentExpression: BotExpression = 'neutral';
  private expressionTimer = 0;
  private blinkTimer = 0;
  private isBlinking = false;
  private eyeLookOffset = new THREE.Vector2(0, 0);

  // Robot Body Components
  private torsoMesh!: THREE.Mesh;
  private chestCoreMesh!: THREE.Mesh;
  private shoulderCaps: THREE.Mesh[] = [];
  private jointRings: THREE.Mesh[] = [];
  private robotLimbs: {
    leftUpperArm: THREE.Mesh;
    rightUpperArm: THREE.Mesh;
    leftForearm: THREE.Mesh;
    rightForearm: THREE.Mesh;
    leftThigh: THREE.Mesh;
    rightThigh: THREE.Mesh;
    leftCalf: THREE.Mesh;
    rightCalf: THREE.Mesh;
    pelvis: THREE.Mesh;
  } | null = null;

  // Procedural Reaction State
  private reactionTime = 0;
  private hopAnimTime = 0;
  private targetHeadPitch = 0;
  private currentHeadPitch = 0;

  constructor(primaryColor = 0x8b5cf6, secondaryColor = 0x38bdf8) {
    super(primaryColor, secondaryColor);

    this.robotHeadGroup = new THREE.Group();

    // Create 128x64 Canvas for LED Visor Face
    this.faceCanvas = document.createElement('canvas');
    this.faceCanvas.width = 128;
    this.faceCanvas.height = 64;
    this.faceCtx = this.faceCanvas.getContext('2d')!;

    this.faceTexture = new THREE.CanvasTexture(this.faceCanvas);
    this.faceTexture.minFilter = THREE.LinearFilter;
    this.faceTexture.magFilter = THREE.LinearFilter;

    // Build robot head, visor, and body armor
    this.buildRobotHead();
    this.buildRobotBodyArmor();

    // Initial face render
    this.renderVisorFace();

    // Ensure bot's table tennis paddle is solid tournament matte black
    this.configureAsOpponentPaddle();
  }

  public configureAsOpponentPaddle(): void {
    const paddle = this.getPaddleGroup();
    if (!paddle) return;
    paddle.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
        if (child.material.color.getHex() === 0xdc2626) {
          child.material.color.setHex(0x18181b);
          child.material.emissive.setHex(0x09090b);
        }
      }
    });
  }

  public override setEquipment(type: 'badminton' | 'tabletennis' | 'tennis' | 'none'): void {
    super.setEquipment(type);
    if (type === 'tabletennis') {
      this.configureAsOpponentPaddle();
    }
  }

  /**
   * Constructs a sleek stylized robot helmet and dynamic LED visor screen.
   */
  private buildRobotHead(): void {
    // Hide default head mesh from Avatar3D
    if (this.headMesh) {
      this.headMesh.visible = false;
    }

    // Main Helmet Chassis
    const helmetGeo = new THREE.BoxGeometry(0.24, 0.22, 0.22);
    const helmetMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.35,
      metalness: 0.80
    });
    const helmet = new THREE.Mesh(helmetGeo, helmetMat);
    helmet.castShadow = true;
    this.robotHeadGroup.add(helmet);

    // Beveled Top Crown Accent (Deep Violet)
    const crownGeo = new THREE.CylinderGeometry(0.10, 0.13, 0.04, 16);
    const crownMat = new THREE.MeshStandardMaterial({
      color: this.primaryColor,
      roughness: 0.35,
      metalness: 0.70,
      emissive: this.primaryColor,
      emissiveIntensity: 0.20
    });
    const crown = new THREE.Mesh(crownGeo, crownMat);
    crown.position.set(0, 0.12, 0);
    this.robotHeadGroup.add(crown);

    // Side Ear Nodes / Antennas
    const earGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.06, 12);
    const earMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.4,
      metalness: 0.7
    });

    const leftEar = new THREE.Mesh(earGeo, earMat);
    leftEar.rotation.z = Math.PI / 2;
    leftEar.position.set(0.13, 0, 0);
    this.robotHeadGroup.add(leftEar);

    const rightEar = new THREE.Mesh(earGeo, earMat);
    rightEar.rotation.z = Math.PI / 2;
    rightEar.position.set(-0.13, 0, 0);
    this.robotHeadGroup.add(rightEar);

    // Ear Ring Lights
    const earRingGeo = new THREE.TorusGeometry(0.036, 0.005, 8, 16);
    const earRingMat = new THREE.MeshBasicMaterial({ color: this.secondaryColor });

    const leftRing = new THREE.Mesh(earRingGeo, earRingMat);
    leftRing.rotation.y = Math.PI / 2;
    leftRing.position.set(0.15, 0, 0);
    this.robotHeadGroup.add(leftRing);

    const rightRing = new THREE.Mesh(earRingGeo, earRingMat);
    rightRing.rotation.y = Math.PI / 2;
    rightRing.position.set(-0.15, 0, 0);
    this.robotHeadGroup.add(rightRing);

    // LED Curved Visor Display Screen (Moderate emission to prevent glaring hot spots)
    const visorGeo = new THREE.BoxGeometry(0.20, 0.09, 0.06);
    const visorMat = new THREE.MeshStandardMaterial({
      map: this.faceTexture,
      emissiveMap: this.faceTexture,
      emissive: 0xffffff,
      emissiveIntensity: 0.85,
      roughness: 0.2,
      metalness: 0.1
    });
    this.visorMesh = new THREE.Mesh(visorGeo, visorMat);
    this.visorMesh.position.set(0, 0.01, 0.095);
    this.robotHeadGroup.add(this.visorMesh);

    // Position robot head group at head height
    this.robotHeadGroup.position.set(0, 1.75, 0.08);
    this.group.add(this.robotHeadGroup);
  }

  /**
   * Builds sleek friendly robot body primitives (rounded torso, shoulder caps, joint covers, limb armor).
   * Completely hides raw skeleton joint spheres and bone cylinders.
   */
  private buildRobotBodyArmor(): void {
    // Explicitly hide all 33 skeleton joint spheres so no red/white dots render
    this.joints.forEach((j) => {
      j.visible = false;
    });
    // Explicitly hide raw bone cylinders
    this.bones.forEach((b) => {
      b.visible = false;
    });

    // 1. Sleek Robot Torso Shell
    const torsoGeo = new THREE.BoxGeometry(0.38, 0.44, 0.22);
    const torsoMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.35,
      metalness: 0.75
    });
    this.torsoMesh = new THREE.Mesh(torsoGeo, torsoMat);
    this.torsoMesh.castShadow = true;
    this.group.add(this.torsoMesh);

    // Chest Reactor Core Emblem (Moderate Violet / Cyan glow, no blinding white hot spot)
    const coreGeo = new THREE.CylinderGeometry(0.065, 0.065, 0.02, 24);
    const coreMat = new THREE.MeshStandardMaterial({
      color: this.primaryColor,
      emissive: this.primaryColor,
      emissiveIntensity: 0.28,
      roughness: 0.25
    });
    this.chestCoreMesh = new THREE.Mesh(coreGeo, coreMat);
    this.chestCoreMesh.rotation.x = Math.PI / 2;
    this.chestCoreMesh.position.set(0, 1.25, 0.11);
    this.group.add(this.chestCoreMesh);

    // Primary Color Chest Accent Plates
    const chestPlateGeo = new THREE.BoxGeometry(0.34, 0.18, 0.03);
    const chestPlateMat = new THREE.MeshStandardMaterial({
      color: this.primaryColor,
      roughness: 0.35,
      metalness: 0.60,
      emissive: this.primaryColor,
      emissiveIntensity: 0.15
    });
    const chestPlate = new THREE.Mesh(chestPlateGeo, chestPlateMat);
    chestPlate.position.set(0, 1.34, 0.10);
    this.group.add(chestPlate);

    // 2. Shoulder Armor Caps
    const shoulderCapGeo = new THREE.SphereGeometry(0.085, 16, 16, 0, Math.PI * 2, 0, Math.PI * 0.65);
    const capMat = new THREE.MeshStandardMaterial({
      color: this.primaryColor,
      emissive: this.primaryColor,
      emissiveIntensity: 0.18,
      roughness: 0.35,
      metalness: 0.70
    });

    const leftCap = new THREE.Mesh(shoulderCapGeo, capMat);
    const rightCap = new THREE.Mesh(shoulderCapGeo, capMat);
    leftCap.castShadow = true;
    rightCap.castShadow = true;
    this.shoulderCaps = [leftCap, rightCap];
    this.group.add(leftCap);
    this.group.add(rightCap);

    // 3. Segmented Joint Covers (Slim Rings for Elbows, Knees, Wrists)
    const ringGeo = new THREE.TorusGeometry(0.046, 0.010, 10, 20);
    const ringMat = new THREE.MeshStandardMaterial({
      color: this.secondaryColor,
      emissive: this.secondaryColor,
      emissiveIntensity: 0.22,
      roughness: 0.30
    });

    for (let i = 0; i < 6; i++) {
      const ring = new THREE.Mesh(ringGeo, ringMat);
      this.jointRings.push(ring);
      this.group.add(ring);
    }

    // 4. Stylized Robot Limbs (Replaces bare wireframe bone cylinders)
    const limbMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.40,
      metalness: 0.75
    });

    const createLimb = (topR: number, botR: number) => {
      const geo = new THREE.CylinderGeometry(topR, botR, 1, 14);
      const mesh = new THREE.Mesh(geo, limbMat);
      mesh.castShadow = true;
      this.group.add(mesh);
      return mesh;
    };

    const pelvisGeo = new THREE.BoxGeometry(0.36, 0.12, 0.18);
    const pelvisMesh = new THREE.Mesh(pelvisGeo, limbMat);
    pelvisMesh.castShadow = true;
    this.group.add(pelvisMesh);

    this.robotLimbs = {
      leftUpperArm: createLimb(0.040, 0.035),
      rightUpperArm: createLimb(0.040, 0.035),
      leftForearm: createLimb(0.035, 0.028),
      rightForearm: createLimb(0.035, 0.028),
      leftThigh: createLimb(0.052, 0.042),
      rightThigh: createLimb(0.052, 0.042),
      leftCalf: createLimb(0.044, 0.036),
      rightCalf: createLimb(0.044, 0.036),
      pelvis: pelvisMesh
    };
  }

  /**
   * Overrides updateBones to guarantee bare wireframe skeleton cylinders & spheres
   * stay permanently hidden while updating stylized robot limb armor.
   */
  protected override updateBones(): void {
    for (let b = 0; b < this.bones.length; b++) {
      this.bones[b].visible = false;
    }
    for (let j = 0; j < this.joints.length; j++) {
      this.joints[j].visible = false;
    }
    this.updateRobotLimbs();
  }

  /**
   * Positions and orients sleek robot limb armor segments between joints.
   */
  private updateRobotLimbs(): void {
    if (!this.robotLimbs) return;
    const upVector = new THREE.Vector3(0, 1, 0);

    const alignLimb = (mesh: THREE.Mesh, p1: THREE.Vector3, p2: THREE.Vector3) => {
      const dist = p1.distanceTo(p2);
      mesh.scale.set(1, Math.max(0.001, dist), 1);
      mesh.position.copy(p1).add(p2).multiplyScalar(0.5);
      const dir = new THREE.Vector3().subVectors(p2, p1).normalize();
      mesh.quaternion.setFromUnitVectors(upVector, dir);
    };

    const j = this.joints;
    alignLimb(this.robotLimbs.leftUpperArm, j[PoseLandmark.LEFT_SHOULDER].position, j[PoseLandmark.LEFT_ELBOW].position);
    alignLimb(this.robotLimbs.rightUpperArm, j[PoseLandmark.RIGHT_SHOULDER].position, j[PoseLandmark.RIGHT_ELBOW].position);
    alignLimb(this.robotLimbs.leftForearm, j[PoseLandmark.LEFT_ELBOW].position, j[PoseLandmark.LEFT_WRIST].position);
    alignLimb(this.robotLimbs.rightForearm, j[PoseLandmark.RIGHT_ELBOW].position, j[PoseLandmark.RIGHT_WRIST].position);
    alignLimb(this.robotLimbs.leftThigh, j[PoseLandmark.LEFT_HIP].position, j[PoseLandmark.LEFT_KNEE].position);
    alignLimb(this.robotLimbs.rightThigh, j[PoseLandmark.RIGHT_HIP].position, j[PoseLandmark.RIGHT_KNEE].position);
    alignLimb(this.robotLimbs.leftCalf, j[PoseLandmark.LEFT_KNEE].position, j[PoseLandmark.LEFT_ANKLE].position);
    alignLimb(this.robotLimbs.rightCalf, j[PoseLandmark.RIGHT_KNEE].position, j[PoseLandmark.RIGHT_ANKLE].position);

    // Pelvis
    const lHip = j[PoseLandmark.LEFT_HIP].position;
    const rHip = j[PoseLandmark.RIGHT_HIP].position;
    this.robotLimbs.pelvis.position.copy(lHip).add(rHip).multiplyScalar(0.5);
  }

  /**
   * Triggers a dynamic facial expression on the bot's visor.
   */
  public setExpression(expr: BotExpression, durationSec = 2.0): void {
    this.currentExpression = expr;
    this.expressionTimer = durationSec;

    if (expr === 'happy') {
      this.reactionTime = durationSec;
      this.hopAnimTime = 0;
      this.targetHeadPitch = 0;
    } else if (expr === 'disappointed') {
      this.reactionTime = durationSec;
      this.targetHeadPitch = 0.35; // Head droop down
    } else if (expr === 'shocked') {
      this.targetHeadPitch = -0.10; // Head tilt up in shock
    } else {
      this.targetHeadPitch = 0;
    }

    this.renderVisorFace();
  }

  /**
   * Render dynamic 2D LED facial expression onto visor CanvasTexture.
   */
  private renderVisorFace(): void {
    const ctx = this.faceCtx;
    const w = this.faceCanvas.width;
    const h = this.faceCanvas.height;

    // Dark slate visor background grid
    ctx.fillStyle = '#060a14';
    ctx.fillRect(0, 0, w, h);

    // Subtle cyan visor scanlines
    ctx.fillStyle = 'rgba(56, 189, 248, 0.05)';
    for (let y = 0; y < h; y += 4) {
      ctx.fillRect(0, y, w, 2);
    }

    // Eye positions with pupil look offsets
    const leftEyeX = 36 + this.eyeLookOffset.x;
    const rightEyeX = 92 + this.eyeLookOffset.x;
    const eyeY = 32 + this.eyeLookOffset.y;

    if (this.isBlinking) {
      // Blinking: Flat horizontal LED bars
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';

      ctx.beginPath();
      ctx.moveTo(24, 32);
      ctx.lineTo(48, 32);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(80, 32);
      ctx.lineTo(104, 32);
      ctx.stroke();
    } else {
      switch (this.currentExpression) {
        case 'shocked': {
          // Shocked / Wide eyes (O_O) with warm amber glow
          ctx.strokeStyle = '#f59e0b';
          ctx.fillStyle = '#ffffff';
          ctx.lineWidth = 4;

          // Wide left eye
          ctx.beginPath();
          ctx.arc(36, 32, 14, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(36, 32, 5, 0, Math.PI * 2);
          ctx.fill();

          // Wide right eye
          ctx.beginPath();
          ctx.arc(92, 32, 14, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(92, 32, 5, 0, Math.PI * 2);
          ctx.fill();

          // Shock indicators
          ctx.fillStyle = '#a855f7';
          ctx.font = 'bold 16px sans-serif';
          ctx.fillText('!', 62, 22);
          break;
        }

        case 'happy': {
          // Happy crescent eyes (^_^ / ^ ^) with emerald glow
          ctx.strokeStyle = '#10b981';
          ctx.lineWidth = 5;
          ctx.lineCap = 'round';

          // Left crescent ^
          ctx.beginPath();
          ctx.arc(leftEyeX, eyeY + 6, 12, Math.PI * 1.15, Math.PI * 1.85);
          ctx.stroke();

          // Right crescent ^
          ctx.beginPath();
          ctx.arc(rightEyeX, eyeY + 6, 12, Math.PI * 1.15, Math.PI * 1.85);
          ctx.stroke();

          // Cheerful mouth curve
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(64, 42, 10, 0.1 * Math.PI, 0.9 * Math.PI);
          ctx.stroke();
          break;
        }

        case 'disappointed': {
          // Dizzy / disappointed eyes (x_x or v_v) with soft purple
          ctx.strokeStyle = '#a855f7';
          ctx.lineWidth = 4;
          ctx.lineCap = 'round';

          // Left X
          ctx.beginPath();
          ctx.moveTo(leftEyeX - 9, eyeY - 9);
          ctx.lineTo(leftEyeX + 9, eyeY + 9);
          ctx.moveTo(leftEyeX + 9, eyeY - 9);
          ctx.lineTo(leftEyeX - 9, eyeY + 9);
          ctx.stroke();

          // Right X
          ctx.beginPath();
          ctx.moveTo(rightEyeX - 9, eyeY - 9);
          ctx.lineTo(rightEyeX + 9, eyeY + 9);
          ctx.moveTo(rightEyeX + 9, eyeY - 9);
          ctx.lineTo(rightEyeX - 9, eyeY + 9);
          ctx.stroke();

          // Disappointed mouth line
          ctx.strokeStyle = '#818cf8';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(54, 46);
          ctx.lineTo(74, 46);
          ctx.stroke();
          break;
        }

        case 'neutral':
        default: {
          // Neutral attentive tracking eyes (sky cyan)
          ctx.fillStyle = '#38bdf8';

          // Outer glowing eye capsules
          ctx.beginPath();
          ctx.arc(leftEyeX, eyeY, 11, 0, Math.PI * 2);
          ctx.fill();

          ctx.beginPath();
          ctx.arc(rightEyeX, eyeY, 11, 0, Math.PI * 2);
          ctx.fill();

          // Dark inner pupils
          ctx.fillStyle = '#0f172a';
          ctx.beginPath();
          ctx.arc(leftEyeX + this.eyeLookOffset.x * 0.5, eyeY + this.eyeLookOffset.y * 0.5, 4, 0, Math.PI * 2);
          ctx.fill();

          ctx.beginPath();
          ctx.arc(rightEyeX + this.eyeLookOffset.x * 0.5, eyeY + this.eyeLookOffset.y * 0.5, 4, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
      }
    }

    this.faceTexture.needsUpdate = true;
  }

  /**
   * Updates bot expressions, ball tracking, and procedural reaction animations.
   */
  public updateBotState(dt: number, ballPos?: THREE.Vector3, ballVelKmh?: number): void {
    // 0. Ensure raw skeleton joint spheres and bone cylinders NEVER render
    for (let i = 0; i < this.joints.length; i++) this.joints[i].visible = false;
    for (let i = 0; i < this.bones.length; i++) this.bones[i].visible = false;

    // 1. Visor Blinking & Eye Ball Tracking
    this.blinkTimer += dt;
    if (this.blinkTimer > 3.5 && !this.isBlinking) {
      this.isBlinking = true;
      this.renderVisorFace();
      setTimeout(() => {
        this.isBlinking = false;
        this.blinkTimer = 0;
        this.renderVisorFace();
      }, 150);
    }

    // Ball tracking eye pupils
    if (ballPos && this.currentExpression === 'neutral') {
      const relX = THREE.MathUtils.clamp((ballPos.x - this.group.position.x) * 4, -6, 6);
      const relY = THREE.MathUtils.clamp((-ballPos.y + 1.2) * 4, -4, 4);
      if (Math.abs(relX - this.eyeLookOffset.x) > 0.5 || Math.abs(relY - this.eyeLookOffset.y) > 0.5) {
        this.eyeLookOffset.set(relX, relY);
        this.renderVisorFace();
      }
    }

    // 2. High-Velocity Ball Shock Reaction (> 12 km/h coming towards bot)
    if (ballVelKmh && ballVelKmh > 12 && ballPos && ballPos.z > 0 && this.currentExpression === 'neutral') {
      this.setExpression('shocked', 0.8);
    }

    // 3. Expression Timer Decay
    if (this.expressionTimer > 0) {
      this.expressionTimer -= dt;
      if (this.expressionTimer <= 0) {
        this.currentExpression = 'neutral';
        this.targetHeadPitch = 0;
        this.renderVisorFace();
      }
    }

    // 4. Procedural Reactions
    // Smooth head pitch droop / tilt
    this.currentHeadPitch = THREE.MathUtils.lerp(this.currentHeadPitch, this.targetHeadPitch, 6 * dt);
    this.robotHeadGroup.rotation.x = this.currentHeadPitch;

    // Happy Hop / Victory Bounce
    if (this.currentExpression === 'happy' && this.reactionTime > 0) {
      this.reactionTime -= dt;
      this.hopAnimTime += dt;
      const hopOffset = Math.max(0, Math.sin(this.hopAnimTime * 14) * 0.08);
      this.robotHeadGroup.position.y = 1.75 + hopOffset;
    } else {
      this.robotHeadGroup.position.y = 1.75;
    }

    // Sync Robot Torso position with skeleton chest
    const lSh = this.joints[PoseLandmark.LEFT_SHOULDER].position;
    const rSh = this.joints[PoseLandmark.RIGHT_SHOULDER].position;
    const lHip = this.joints[PoseLandmark.LEFT_HIP].position;
    const rHip = this.joints[PoseLandmark.RIGHT_HIP].position;

    if (lSh && rSh && lHip && rHip) {
      // Mid-chest position
      const chestX = (lSh.x + rSh.x) * 0.5;
      const chestY = (lSh.y + lHip.y) * 0.5;
      const chestZ = (lSh.z + rSh.z) * 0.5;

      this.torsoMesh.position.set(chestX, chestY, chestZ);
      this.chestCoreMesh.position.set(chestX, chestY + 0.04, chestZ + 0.11);

      // Shoulder Caps
      this.shoulderCaps[0].position.copy(lSh);
      this.shoulderCaps[1].position.copy(rSh);

      // Joint Rings (Elbows, Knees, Wrists)
      if (this.jointRings.length >= 6) {
        this.jointRings[0].position.copy(this.joints[PoseLandmark.LEFT_ELBOW].position);
        this.jointRings[1].position.copy(this.joints[PoseLandmark.RIGHT_ELBOW].position);
        this.jointRings[2].position.copy(this.joints[PoseLandmark.LEFT_KNEE].position);
        this.jointRings[3].position.copy(this.joints[PoseLandmark.RIGHT_KNEE].position);
        this.jointRings[4].position.copy(this.joints[PoseLandmark.LEFT_WRIST].position);
        this.jointRings[5].position.copy(this.joints[PoseLandmark.RIGHT_WRIST].position);
      }

      // Update robot limbs
      this.updateRobotLimbs();
    }
  }
}
