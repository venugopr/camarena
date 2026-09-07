import * as THREE from 'three';
import { Landmark3D, PoseLandmark, Vector3D } from '../../core/motion/Types';

// Standard 33-landmark skeleton connection pairs
export const SKELETON_CONNECTIONS: [number, number][] = [
  // Head / Face
  [PoseLandmark.LEFT_EAR, PoseLandmark.LEFT_EYE],
  [PoseLandmark.LEFT_EYE, PoseLandmark.NOSE],
  [PoseLandmark.NOSE, PoseLandmark.RIGHT_EYE],
  [PoseLandmark.RIGHT_EYE, PoseLandmark.RIGHT_EAR],
  // Shoulders & Torso
  [PoseLandmark.LEFT_SHOULDER, PoseLandmark.RIGHT_SHOULDER],
  [PoseLandmark.LEFT_SHOULDER, PoseLandmark.LEFT_HIP],
  [PoseLandmark.RIGHT_SHOULDER, PoseLandmark.RIGHT_HIP],
  [PoseLandmark.LEFT_HIP, PoseLandmark.RIGHT_HIP],
  // Left Arm
  [PoseLandmark.LEFT_SHOULDER, PoseLandmark.LEFT_ELBOW],
  [PoseLandmark.LEFT_ELBOW, PoseLandmark.LEFT_WRIST],
  [PoseLandmark.LEFT_WRIST, PoseLandmark.LEFT_INDEX],
  // Right Arm
  [PoseLandmark.RIGHT_SHOULDER, PoseLandmark.RIGHT_ELBOW],
  [PoseLandmark.RIGHT_ELBOW, PoseLandmark.RIGHT_WRIST],
  [PoseLandmark.RIGHT_WRIST, PoseLandmark.RIGHT_INDEX],
  // Left Leg
  [PoseLandmark.LEFT_HIP, PoseLandmark.LEFT_KNEE],
  [PoseLandmark.LEFT_KNEE, PoseLandmark.LEFT_ANKLE],
  [PoseLandmark.LEFT_ANKLE, PoseLandmark.LEFT_FOOT_INDEX],
  // Right Leg
  [PoseLandmark.RIGHT_HIP, PoseLandmark.RIGHT_KNEE],
  [PoseLandmark.RIGHT_KNEE, PoseLandmark.RIGHT_ANKLE],
  [PoseLandmark.RIGHT_ANKLE, PoseLandmark.RIGHT_FOOT_INDEX],
];

export class Avatar3D {
  public group: THREE.Group;
  private joints: THREE.Mesh[] = [];
  private bones: THREE.Mesh[] = [];
  private racketGroup: THREE.Group | null = null;
  private paddleGroup: THREE.Group | null = null;
  private headMesh: THREE.Mesh;
  private readonly jointSmoothing = 0.18;

  private primaryColor: number;
  private secondaryColor: number;
  private jointMat: THREE.MeshStandardMaterial;
  private boneMat: THREE.MeshStandardMaterial;
  private racketFrameMat?: THREE.MeshStandardMaterial;
  private dominantHandGroup: THREE.Group = new THREE.Group();
  private supportHandGroup: THREE.Group = new THREE.Group();
  private lastRightWrist = new THREE.Vector3();
  private lastLeftWrist = new THREE.Vector3();
  private hasRightWrist = false;
  private hasLeftWrist = false;

  constructor(primaryColor = 0x00f2fe, secondaryColor = 0x39ff14) {
    this.primaryColor = primaryColor;
    this.secondaryColor = secondaryColor;
    this.group = new THREE.Group();

    this.jointMat = new THREE.MeshStandardMaterial({
      color: primaryColor,
      emissive: primaryColor,
      emissiveIntensity: 0.6,
      roughness: 0.2,
      metalness: 0.8
    });

    this.boneMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.4,
      metalness: 0.6
    });

    // Create joint spheres
    const jointGeo = new THREE.SphereGeometry(0.045, 12, 12);
    for (let i = 0; i < 33; i++) {
      const mesh = new THREE.Mesh(jointGeo, this.jointMat.clone());
      mesh.castShadow = true;
      this.joints.push(mesh);
      this.group.add(mesh);
    }

    // Create bone cylinders
    const boneGeo = new THREE.CylinderGeometry(0.022, 0.022, 1, 8);
    for (let i = 0; i < SKELETON_CONNECTIONS.length; i++) {
      const bone = new THREE.Mesh(boneGeo, this.boneMat.clone());
      bone.castShadow = true;
      this.bones.push(bone);
      this.group.add(bone);
    }

    // Create stylized head / visor
    const headGeo = new THREE.SphereGeometry(0.12, 16, 16);
    const headMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.1,
      metalness: 0.9
    });
    this.headMesh = new THREE.Mesh(headGeo, headMat);
    this.headMesh.castShadow = true;

    // Cyber visor strip
    const visorGeo = new THREE.BoxGeometry(0.18, 0.05, 0.1);
    const visorMat = new THREE.MeshBasicMaterial({ color: secondaryColor });
    const visor = new THREE.Mesh(visorGeo, visorMat);
    visor.position.set(0, 0, 0.08);
    this.headMesh.add(visor);
    this.group.add(this.headMesh);

    // Build Hand Models
    this.buildHandModels();

    // Build Badminton Racket
    this.buildBadmintonRacket();
    // Build Table Tennis Paddle
    this.buildTableTennisPaddle();
  }

  private buildHandModels(): void {
    const gloveMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.5,
      metalness: 0.3
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: this.secondaryColor,
      emissive: this.secondaryColor,
      emissiveIntensity: 0.4,
      roughness: 0.3
    });

    const palmGeo = new THREE.BoxGeometry(0.045, 0.07, 0.032);
    const palm = new THREE.Mesh(palmGeo, gloveMat);
    this.supportHandGroup.add(palm);

    for (let f = 0; f < 4; f++) {
      const fGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.035, 8);
      const finger = new THREE.Mesh(fGeo, accentMat);
      finger.position.set(-0.016 + f * 0.011, 0.045, 0.01);
      finger.rotation.x = 0.25;
      this.supportHandGroup.add(finger);
    }
    const thumbGeo = new THREE.CylinderGeometry(0.007, 0.007, 0.028, 8);
    const thumb = new THREE.Mesh(thumbGeo, accentMat);
    thumb.position.set(0.022, 0.02, -0.01);
    thumb.rotation.z = -0.4;
    this.supportHandGroup.add(thumb);

    this.group.add(this.supportHandGroup);
  }

  private buildBadmintonRacket(): void {
    this.racketGroup = new THREE.Group();

    // Racket handle grip with ribbed texture rings
    const handleGeo = new THREE.CylinderGeometry(0.016, 0.019, 0.26, 12);
    const handleMat = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      roughness: 0.85,
      metalness: 0.1
    });
    const handle = new THREE.Mesh(handleGeo, handleMat);
    handle.position.y = 0.13;
    this.racketGroup.add(handle);

    // Grip tape wrap ring accent
    const gripTapeGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.02, 12);
    const gripTapeMat = new THREE.MeshStandardMaterial({ color: 0x39ff14, roughness: 0.4 });
    const gripTape = new THREE.Mesh(gripTapeGeo, gripTapeMat);
    gripTape.position.y = 0.25;
    this.racketGroup.add(gripTape);

    // High-modulus carbon graphite shaft
    const shaftGeo = new THREE.CylinderGeometry(0.007, 0.008, 0.42, 12);
    const shaftMat = new THREE.MeshStandardMaterial({
      color: 0x0ea5e9,
      metalness: 0.85,
      roughness: 0.15,
      emissive: 0x0284c7,
      emissiveIntensity: 0.25
    });
    const shaft = new THREE.Mesh(shaftGeo, shaftMat);
    shaft.position.y = 0.47;
    this.racketGroup.add(shaft);

    // Sculpted athletic glove/hand wrapping around racket handle
    const handGloveMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.5,
      metalness: 0.3
    });
    const palmGeo = new THREE.BoxGeometry(0.048, 0.082, 0.042);
    const palmMesh = new THREE.Mesh(palmGeo, handGloveMat);
    palmMesh.position.set(-0.012, 0.13, 0);
    this.racketGroup.add(palmMesh);

    // Curled fingers wrapping handle
    const fingerMat = new THREE.MeshStandardMaterial({
      color: this.primaryColor,
      emissive: this.primaryColor,
      emissiveIntensity: 0.4,
      roughness: 0.3
    });
    for (let f = 0; f < 4; f++) {
      const fingerGeo = new THREE.CylinderGeometry(0.007, 0.007, 0.038, 8);
      const finger = new THREE.Mesh(fingerGeo, fingerMat);
      finger.rotation.z = Math.PI / 2;
      finger.position.set(0.012, 0.095 + f * 0.024, 0.015);
      this.racketGroup.add(finger);
    }
    // Opposing thumb
    const thumbGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.032, 8);
    const thumb = new THREE.Mesh(thumbGeo, fingerMat);
    thumb.rotation.x = Math.PI / 3;
    thumb.position.set(-0.015, 0.15, -0.018);
    this.racketGroup.add(thumb);

    // Aerodynamic isometric racket head frame — bright vibrant neon
    const frameGeo = new THREE.TorusGeometry(0.17, 0.014, 12, 36);
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x00f2fe,
      emissive: 0x00f2fe,
      emissiveIntensity: 1.1,
      metalness: 0.6,
      roughness: 0.15
    });
    this.racketFrameMat = frameMat;
    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.scale.set(0.88, 1.22, 1);
    frame.position.y = 0.83;
    this.racketGroup.add(frame);

    // High tension nano-mesh string bed
    const stringGeo = new THREE.CircleGeometry(0.16, 24);
    const stringMat = new THREE.MeshBasicMaterial({
      color: 0xe0f2fe,
      transparent: true,
      opacity: 0.6,
      wireframe: true
    });
    const strings = new THREE.Mesh(stringGeo, stringMat);
    strings.scale.set(0.88, 1.22, 1);
    strings.position.y = 0.83;
    this.racketGroup.add(strings);

    this.racketGroup.scale.set(1.15, 1.15, 1.15);
    this.racketGroup.visible = false;
    this.group.add(this.racketGroup);
  }

  private buildTableTennisPaddle(): void {
    this.paddleGroup = new THREE.Group();

    // Flared ergonomic wooden handle
    const handleGeo = new THREE.CylinderGeometry(0.018, 0.024, 0.18, 16);
    const handleMat = new THREE.MeshStandardMaterial({
      color: 0xb45309,
      roughness: 0.5,
      metalness: 0.1
    });
    const handle = new THREE.Mesh(handleGeo, handleMat);
    handle.position.y = 0.09;
    this.paddleGroup.add(handle);

    // Grip neck collar
    const collarGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.025, 16);
    const collarMat = new THREE.MeshStandardMaterial({ color: 0x78350f });
    const collar = new THREE.Mesh(collarGeo, collarMat);
    collar.position.y = 0.17;
    this.paddleGroup.add(collar);

    // Multi-ply wood blade base (diameter 26cm)
    const bladeGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.014, 36);
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.4 });
    const blade = new THREE.Mesh(bladeGeo, bladeMat);
    blade.position.y = 0.27;
    blade.rotation.x = Math.PI / 2;
    this.paddleGroup.add(blade);

    // High-contrast white edge tape perimeter
    const edgeTapeGeo = new THREE.TorusGeometry(0.13, 0.009, 8, 36);
    const edgeTapeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.35,
      roughness: 0.3
    });
    const edgeTape = new THREE.Mesh(edgeTapeGeo, edgeTapeMat);
    edgeTape.position.y = 0.27;
    this.paddleGroup.add(edgeTape);

    // Vibrant red forehand rubber sheet
    const redRubberGeo = new THREE.CylinderGeometry(0.125, 0.125, 0.006, 36);
    const redRubberMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      roughness: 0.2,
      emissive: 0xdc2626,
      emissiveIntensity: 0.4
    });
    const redRubber = new THREE.Mesh(redRubberGeo, redRubberMat);
    redRubber.position.set(0, 0.27, 0.008);
    redRubber.rotation.x = Math.PI / 2;
    this.paddleGroup.add(redRubber);

    // White sweet-spot center badge
    const spotGeo = new THREE.CircleGeometry(0.028, 16);
    const spotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
    const spot = new THREE.Mesh(spotGeo, spotMat);
    spot.position.set(0, 0.27, 0.012);
    this.paddleGroup.add(spot);

    // Sleek black backhand rubber sheet
    const blackRubberMat = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      roughness: 0.25,
      emissive: 0x27272a,
      emissiveIntensity: 0.15
    });
    const blackRubber = new THREE.Mesh(redRubberGeo, blackRubberMat);
    blackRubber.position.set(0, 0.27, -0.008);
    blackRubber.rotation.x = Math.PI / 2;
    this.paddleGroup.add(blackRubber);

    this.paddleGroup.visible = false;
    this.group.add(this.paddleGroup);
  }

  public setEquipment(type: 'badminton' | 'tabletennis' | 'none'): void {
    if (this.racketGroup) this.racketGroup.visible = type === 'badminton';
    if (this.paddleGroup) this.paddleGroup.visible = type === 'tabletennis';
    this.applyDefaultPose(type === 'none' ? 'tabletennis' : type);
  }

  /**
   * Poses the avatar in a natural, athletic sports ready stance
   */
  public applyDefaultPose(sport: 'badminton' | 'tabletennis' | 'sandbox' = 'tabletennis', isOpponent = false): void {
    const hipY = 0.95;
    const shoulderY = hipY + 0.40; // 1.35m
    const headY = shoulderY + 0.22; // 1.63m

    // Set joints to athletic ready pose
    this.joints[PoseLandmark.LEFT_HIP].position.set(-0.16, hipY, 0);
    this.joints[PoseLandmark.RIGHT_HIP].position.set(0.16, hipY, 0);

    this.joints[PoseLandmark.LEFT_SHOULDER].position.set(-0.24, shoulderY, 0);
    this.joints[PoseLandmark.RIGHT_SHOULDER].position.set(0.24, shoulderY, 0);

    this.headMesh.position.set(0, headY, 0.08);
    this.joints[PoseLandmark.NOSE].position.set(0, headY, 0.08);

    // Knees slightly bent in ready athletic crouch
    this.joints[PoseLandmark.LEFT_KNEE].position.set(-0.19, 0.52, 0.06);
    this.joints[PoseLandmark.RIGHT_KNEE].position.set(0.19, 0.52, 0.06);
    this.joints[PoseLandmark.LEFT_ANKLE].position.set(-0.22, 0.08, -0.02);
    this.joints[PoseLandmark.RIGHT_ANKLE].position.set(0.22, 0.08, -0.02);

    if (sport === 'tabletennis') {
      // Arms forward in TT stance holding paddle over table height
      this.joints[PoseLandmark.LEFT_ELBOW].position.set(-0.32, 1.1, 0.22);
      this.joints[PoseLandmark.LEFT_WRIST].position.set(-0.22, 0.96, 0.36);

      // Dominant arm holding TT bat
      this.joints[PoseLandmark.RIGHT_ELBOW].position.set(0.32, 1.06, 0.22);
      this.joints[PoseLandmark.RIGHT_WRIST].position.set(0.28, 0.96, 0.44);

      if (this.paddleGroup) {
        this.paddleGroup.position.set(0.28, 0.96, 0.44);
        this.paddleGroup.rotation.set(0.35, 0, -0.2);
      }
    } else {
      // Badminton ready pose
      this.joints[PoseLandmark.LEFT_ELBOW].position.set(-0.32, 1.15, 0.15);
      this.joints[PoseLandmark.LEFT_WRIST].position.set(-0.24, 1.18, 0.32);

      this.joints[PoseLandmark.RIGHT_ELBOW].position.set(0.36, 1.25, 0.18);
      this.joints[PoseLandmark.RIGHT_WRIST].position.set(0.32, 1.48, 0.28);

      if (this.racketGroup) {
        this.racketGroup.position.set(0.32, 1.48, 0.28);
        this.racketGroup.rotation.set(0.2, 0, 0);
      }
      if (this.supportHandGroup) {
        this.supportHandGroup.position.set(-0.24, 1.18, 0.32);
        this.supportHandGroup.rotation.set(-0.2, 0.2, 0);
      }
    }

    this.updateBones();
  }

  /**
   * Dynamically pose avatar arms towards world targets (for mouse/keyboard or procedural reach)
   */
  public poseArmsToTargets(
    dominantWorldTarget: THREE.Vector3,
    supportWorldTarget?: THREE.Vector3,
    dominantArm: 'right' | 'left' = 'right'
  ): void {
    const upVector = new THREE.Vector3(0, 1, 0);

    // 1. Dominant arm reaching towards racket target
    const dShoulderIdx = PoseLandmark.RIGHT_SHOULDER;
    const dElbowIdx = PoseLandmark.RIGHT_ELBOW;
    const dWristIdx = PoseLandmark.RIGHT_WRIST;

    const shoulderPos = this.joints[dShoulderIdx].position;
    const localTarget = this.group.worldToLocal(dominantWorldTarget.clone());

    const armVector = new THREE.Vector3().subVectors(localTarget, shoulderPos);
    const armLength = Math.min(0.85, Math.max(0.28, armVector.length()));
    const armDir = armVector.normalize();

    const wristPos = new THREE.Vector3().copy(shoulderPos).addScaledVector(armDir, armLength);
    wristPos.y = Math.min(wristPos.y, 1.78);
    this.joints[dWristIdx].position.copy(wristPos);

    const sideOffset = 0.09;
    this.joints[dElbowIdx].position.copy(shoulderPos).add(wristPos).multiplyScalar(0.5);
    this.joints[dElbowIdx].position.x += sideOffset;
    this.joints[dElbowIdx].position.y -= 0.04;

    const forearmDir = new THREE.Vector3().subVectors(wristPos, this.joints[dElbowIdx].position).normalize();
    if (this.racketGroup && this.racketGroup.visible) {
      this.racketGroup.position.copy(wristPos);
      const quat = new THREE.Quaternion().setFromUnitVectors(upVector, forearmDir);
      this.racketGroup.setRotationFromQuaternion(quat);
    }
    if (this.paddleGroup && this.paddleGroup.visible) {
      this.paddleGroup.position.copy(wristPos);
      const quat = new THREE.Quaternion().setFromUnitVectors(upVector, forearmDir);
      this.paddleGroup.setRotationFromQuaternion(quat);
    }

    // 2. Support arm (cradling/holding shuttlecock or athletic balance)
    if (supportWorldTarget) {
      const sShoulderIdx = PoseLandmark.LEFT_SHOULDER;
      const sElbowIdx = PoseLandmark.LEFT_ELBOW;
      const sWristIdx = PoseLandmark.LEFT_WRIST;

      const sShoulderPos = this.joints[sShoulderIdx].position;
      const localSTarget = this.group.worldToLocal(supportWorldTarget.clone());
      const sArmVector = new THREE.Vector3().subVectors(localSTarget, sShoulderPos);
      
      // Relax reach limit, especially when reaching across torso to the right (localSTarget.x > 0)
      const isCrossBody = localSTarget.x > 0;
      const maxReach = isCrossBody ? 0.95 : 0.78;
      const sArmLength = Math.min(maxReach, Math.max(0.20, sArmVector.length()));
      const sArmDir = sArmVector.normalize();

      const sWristPos = new THREE.Vector3().copy(sShoulderPos).addScaledVector(sArmDir, sArmLength);
      // Ensure cross-body target can reach at least +0.50m to the right of avatar root
      if (isCrossBody && sWristPos.x < Math.min(localSTarget.x, 0.50)) {
        sWristPos.x = Math.min(localSTarget.x, 0.50);
      }
      this.joints[sWristIdx].position.copy(sWristPos);

      // Adaptive elbow inflection: when reaching across the body to the right,
      // allow elbow to tuck inward/forward rather than forcing it outward left (-0.07)
      const sSideOffset = isCrossBody ? THREE.MathUtils.lerp(-0.04, 0.08, Math.min(1, localSTarget.x / 0.50)) : -0.07;
      this.joints[sElbowIdx].position.copy(sShoulderPos).add(sWristPos).multiplyScalar(0.5);
      this.joints[sElbowIdx].position.x += sSideOffset;
      this.joints[sElbowIdx].position.y -= 0.04;

      const sForearmDir = new THREE.Vector3().subVectors(sWristPos, this.joints[sElbowIdx].position).normalize();
      if (this.supportHandGroup) {
        this.supportHandGroup.position.copy(sWristPos);
        this.supportHandGroup.setRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(upVector, sForearmDir));
      }
    }

    this.updateBones();
  }

  /**
   * Validates if full-body standing pose is confident enough for footwork court mapping.
   * Prevents tracking collapse during seated desk testing.
   */
  public static isFullBodyStanding(landmarks: Landmark3D[]): boolean {
    if (!landmarks || landmarks.length < 33) return false;
    const leftHip = landmarks[PoseLandmark.LEFT_HIP];
    const rightHip = landmarks[PoseLandmark.RIGHT_HIP];
    const leftAnkle = landmarks[PoseLandmark.LEFT_ANKLE];
    const rightAnkle = landmarks[PoseLandmark.RIGHT_ANKLE];

    // Visibility gate: hips must have good visibility
    const hipVis = ((leftHip.visibility ?? 1) + (rightHip.visibility ?? 1)) * 0.5;
    if (hipVis < 0.65) return false;

    // Presence/visibility of lower body: if ankles are completely out of view, user is seated
    const ankleVis = ((leftAnkle?.visibility ?? 0) + (rightAnkle?.visibility ?? 0)) * 0.5;
    if (ankleVis < 0.25) return false;

    // Close-up check: shoulder width in camera space
    const leftShoulder = landmarks[PoseLandmark.LEFT_SHOULDER];
    const rightShoulder = landmarks[PoseLandmark.RIGHT_SHOULDER];
    const shoulderSpan = Math.abs(rightShoulder.x - leftShoulder.x);
    // If shoulders span > 0.55 of the frame, user is sitting too close to camera
    if (shoulderSpan > 0.55) return false;

    return true;
  }

  public setActionOTSVisibility(enabled: boolean): void {
    const lowerBody = new Set<number>([
      PoseLandmark.LEFT_HIP,
      PoseLandmark.RIGHT_HIP,
      PoseLandmark.LEFT_KNEE,
      PoseLandmark.RIGHT_KNEE,
      PoseLandmark.LEFT_ANKLE,
      PoseLandmark.RIGHT_ANKLE,
      PoseLandmark.LEFT_HEEL,
      PoseLandmark.RIGHT_HEEL,
      PoseLandmark.LEFT_FOOT_INDEX,
      PoseLandmark.RIGHT_FOOT_INDEX
    ]);

    for (const joint of this.joints) joint.visible = !enabled;
    this.headMesh.visible = !enabled;
    for (const index of lowerBody) this.joints[index].visible = !enabled;
    for (let i = 0; i < SKELETON_CONNECTIONS.length; i++) {
      const [start, end] = SKELETON_CONNECTIONS[i];
      this.bones[i].visible = !enabled || (!lowerBody.has(start) && !lowerBody.has(end));
    }
    if (enabled) {
      for (const bone of this.bones) bone.visible = false;
      if (this.racketGroup) this.racketGroup.visible = true;
      this.supportHandGroup.visible = true;
    }
  }

  /**
   * Procedural IK swing animation for athletic strokes (smash, drive, clear)
   */
  public playSwingAnimation(
    targetWorld: THREE.Vector3,
    progress: number, // 0 to 1
    isSmash = false,
    dominantArm: 'right' | 'left' = 'right'
  ): void {
    const dShoulderIdx = dominantArm === 'right' ? PoseLandmark.RIGHT_SHOULDER : PoseLandmark.LEFT_SHOULDER;
    const shoulderPos = this.joints[dShoulderIdx].position.clone();
    this.group.localToWorld(shoulderPos);

    let strikeTarget: THREE.Vector3;
    if (progress < 0.3) {
      // Wind-up: pull arm back and up
      const windupOffset = new THREE.Vector3(dominantArm === 'right' ? 0.35 : -0.35, isSmash ? 0.6 : 0.3, 0.4);
      strikeTarget = shoulderPos.clone().add(windupOffset);
    } else if (progress < 0.6) {
      // Strike phase: whip racket head forward into ball target
      const t = (progress - 0.3) / 0.3;
      const windupPos = shoulderPos.clone().add(new THREE.Vector3(dominantArm === 'right' ? 0.35 : -0.35, isSmash ? 0.6 : 0.3, 0.4));
      strikeTarget = new THREE.Vector3().lerpVectors(windupPos, targetWorld, t);
    } else {
      // Follow-through: sweep across body downwards
      const t = (progress - 0.6) / 0.4;
      const followOffset = new THREE.Vector3(dominantArm === 'right' ? -0.28 : 0.28, -0.25, -0.35);
      const followPos = shoulderPos.clone().add(followOffset);
      strikeTarget = new THREE.Vector3().lerpVectors(targetWorld, followPos, t);
    }

    this.poseArmsToTargets(strikeTarget, undefined, dominantArm);
  }

  /**
   * Update bone cylinders to match current joint positions
   */
  private updateBones(): void {
    const upVector = new THREE.Vector3(0, 1, 0);
    for (let b = 0; b < SKELETON_CONNECTIONS.length; b++) {
      const [i1, i2] = SKELETON_CONNECTIONS[b];
      const p1 = this.joints[i1].position;
      const p2 = this.joints[i2].position;

      const bone = this.bones[b];
      const dist = p1.distanceTo(p2);
      bone.scale.set(1, Math.max(0.001, dist), 1);

      // Position bone at midpoint
      bone.position.copy(p1).add(p2).multiplyScalar(0.5);

      // Rotate bone to look from p1 to p2
      const direction = new THREE.Vector3().subVectors(p2, p1).normalize();
      const quaternion = new THREE.Quaternion().setFromUnitVectors(upVector, direction);
      bone.setRotationFromQuaternion(quaternion);
    }
  }

  /**
   * Update 3D avatar joint and bone positions from tracked world landmarks
   */
  public update(landmarks: Landmark3D[], dominantArm: 'right' | 'left' = 'right'): void {
    if (!landmarks || landmarks.length < 33) return;

    // Invert Y and adjust scale for Three.js coordinate system (Y is up, Z is depth)
    const toThree = (lm: Landmark3D): THREE.Vector3 => {
      return new THREE.Vector3(lm.x, -lm.y, lm.z);
    };

    // Keep equipment roles tied to landmark identity, never screen position.
    for (let i = 0; i < 33; i++) {
      const pos = toThree(landmarks[i]);
      this.joints[i].position.lerp(pos, this.jointSmoothing);
    }

    const deadReckonWrist = (
      wristIndex: PoseLandmark,
      elbowIndex: PoseLandmark,
      previous: THREE.Vector3,
      hasPrevious: boolean
    ): boolean => {
      const wrist = this.joints[wristIndex].position;
      const elbow = this.joints[elbowIndex].position;
      const visibility = landmarks[wristIndex]?.visibility ?? 1;
      if (visibility >= 0.35 || !hasPrevious) return visibility >= 0.35;

      const armDirection = previous.clone().sub(elbow).normalize();
      wrist.copy(elbow).addScaledVector(armDirection, 0.42);
      return false;
    };

    const rightVisible = deadReckonWrist(
      PoseLandmark.RIGHT_WRIST,
      PoseLandmark.RIGHT_ELBOW,
      this.lastRightWrist,
      this.hasRightWrist
    );
    const leftVisible = deadReckonWrist(
      PoseLandmark.LEFT_WRIST,
      PoseLandmark.LEFT_ELBOW,
      this.lastLeftWrist,
      this.hasLeftWrist
    );
    if (rightVisible) {
      this.lastRightWrist.copy(this.joints[PoseLandmark.RIGHT_WRIST].position);
      this.hasRightWrist = true;
    }
    if (leftVisible) {
      this.lastLeftWrist.copy(this.joints[PoseLandmark.LEFT_WRIST].position);
      this.hasLeftWrist = true;
    }

    // Position and orient bones
    this.updateBones();

    // Position head
    const nose = this.joints[PoseLandmark.NOSE].position;
    this.headMesh.position.copy(nose);

    // Position equipment on active wrist
    const wristIdx = PoseLandmark.RIGHT_WRIST;
    const elbowIdx = PoseLandmark.RIGHT_ELBOW;

    const wristPos = this.joints[wristIdx].position;
    const elbowPos = this.joints[elbowIdx].position;
    const forearmDir = new THREE.Vector3().subVectors(wristPos, elbowPos).normalize();
    const upVector = new THREE.Vector3(0, 1, 0);

    if (this.racketGroup && this.racketGroup.visible) {
      this.racketGroup.position.copy(wristPos);
      const quat = new THREE.Quaternion().setFromUnitVectors(upVector, forearmDir);
      this.racketGroup.setRotationFromQuaternion(quat);
    }

    if (this.paddleGroup && this.paddleGroup.visible) {
      this.paddleGroup.position.copy(wristPos);
      const quat = new THREE.Quaternion().setFromUnitVectors(upVector, forearmDir);
      this.paddleGroup.setRotationFromQuaternion(quat);
    }

    // Position support / non-dominant hand
    const supportWristIdx = PoseLandmark.LEFT_WRIST;
    const supportElbowIdx = PoseLandmark.LEFT_ELBOW;
    const sWristPos = this.joints[supportWristIdx].position;
    const sElbowPos = this.joints[supportElbowIdx].position;
    const sForearmDir = new THREE.Vector3().subVectors(sWristPos, sElbowPos).normalize();
    this.supportHandGroup.position.copy(sWristPos);
    this.supportHandGroup.setRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(upVector, sForearmDir));

    // Smoothly decay racket frame pulse
    if (this.racketFrameMat && this.racketFrameMat.emissiveIntensity > 0.7) {
      this.racketFrameMat.emissiveIntensity = THREE.MathUtils.lerp(this.racketFrameMat.emissiveIntensity, 0.7, 0.08);
    }
  }

  public getHandWorldPosition(hand: 'left' | 'right'): THREE.Vector3 {
    const index = hand === 'left' ? PoseLandmark.LEFT_WRIST : PoseLandmark.RIGHT_WRIST;
    return this.group.localToWorld(this.joints[index].position.clone());
  }

  public pulseImpact(type: 'smash' | 'hit' | 'serve' = 'hit'): void {
    if (this.racketFrameMat) {
      this.racketFrameMat.emissiveIntensity = type === 'smash' ? 3.2 : (type === 'serve' ? 2.4 : 2.0);
    }
  }

  public getNonDominantHandWorldPosition(dominantArm: 'right' | 'left' = 'right'): THREE.Vector3 {
    const pos = this.joints[PoseLandmark.LEFT_WRIST].position.clone();
    this.group.localToWorld(pos);
    return pos;
  }

  public getSupportHandWorldPosition(): THREE.Vector3 {
    return this.getNonDominantHandWorldPosition('right');
  }

  public getPaddleWorldPosition(): THREE.Vector3 {
    if (this.paddleGroup && this.paddleGroup.visible) {
      const pos = new THREE.Vector3();
      this.paddleGroup.getWorldPosition(pos);
      const bladeOffset = new THREE.Vector3(0, 0.27, 0);
      bladeOffset.applyQuaternion(this.paddleGroup.quaternion);
      pos.add(bladeOffset);
      return pos;
    }
    const fallback = new THREE.Vector3();
    this.group.getWorldPosition(fallback);
    fallback.y += 0.95;
    return fallback;
  }

  public getPaddleGroup(): THREE.Group | null {
    return this.paddleGroup;
  }

  public getRacketWorldPosition(): THREE.Vector3 {
    if (this.racketGroup && this.racketGroup.visible) {
      const pos = new THREE.Vector3();
      this.racketGroup.getWorldPosition(pos);
      const headOffsetY = 0.83 * (this.racketGroup.scale.y || 1);
      const headOffset = new THREE.Vector3(0, headOffsetY, 0);
      const quat = new THREE.Quaternion();
      this.racketGroup.getWorldQuaternion(quat);
      headOffset.applyQuaternion(quat);
      pos.add(headOffset);
      return pos;
    }
    const fallback = new THREE.Vector3();
    this.group.getWorldPosition(fallback);
    fallback.y += 1.48;
    fallback.z += 0.28;
    return fallback;
  }

  public getRacketContactPoint(): THREE.Vector3 {
    return this.getRacketWorldPosition();
  }

  public getRacketHeadWorldPosition(): THREE.Vector3 {
    return this.getRacketWorldPosition();
  }

  public keepRacketInViewport(camera: THREE.PerspectiveCamera, maxNdcY = 0.82): void {
    if (!this.racketGroup || !this.racketGroup.visible) return;

    const head = this.getRacketWorldPosition();
    const projected = head.clone().project(camera);
    if (projected.y > maxNdcY) {
      const viewSpaceHead = head.clone().applyMatrix4(camera.matrixWorldInverse);
      const worldPerNdcY = Math.max(0.01, -viewSpaceHead.z) * Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5);
      const correction = (projected.y - maxNdcY) * worldPerNdcY * 1.02;
      this.racketGroup.position.addScaledVector(camera.up, -correction);
    }
  }

  public getRacketStringNormal(): THREE.Vector3 {
    if (this.racketGroup && this.racketGroup.visible) {
      const normal = new THREE.Vector3(0, 0, 1);
      const quat = new THREE.Quaternion();
      this.racketGroup.getWorldQuaternion(quat);
      normal.applyQuaternion(quat);
      return normal.normalize();
    }
    return new THREE.Vector3(0, 0, 1);
  }

  /**
   * Precise Oriented Bounding Disc (OBD) and swept collision check
   * Tests whether a ball/shuttlecock intersected the circular string bed plane
   */
  public checkRacketDiscIntersection(
    ballPos: THREE.Vector3,
    ballRadius = 0.06,
    ballPrevPos?: THREE.Vector3
  ): { hit: boolean; impactPoint: THREE.Vector3; normal: THREE.Vector3; distanceToCenter: number } {
    if (!this.racketGroup || !this.racketGroup.visible) {
      return { hit: false, impactPoint: ballPos.clone(), normal: new THREE.Vector3(0, 0, 1), distanceToCenter: 999 };
    }

    const headCenter = this.getRacketWorldPosition();
    const normal = this.getRacketStringNormal();
    const headRadius = 0.22 * (this.racketGroup.scale.x || 1.15); // ~0.25m string radius
    const halfThickness = 0.10;

    const toBall = new THREE.Vector3().subVectors(ballPos, headCenter);
    const distPerp = toBall.dot(normal);
    const inPlaneVec = new THREE.Vector3().copy(toBall).addScaledVector(normal, -distPerp);
    const distParallel = inPlaneVec.length();

    // 1. Swept trajectory test between previous and current positions to prevent tunneling
    if (ballPrevPos) {
      const toPrev = new THREE.Vector3().subVectors(ballPrevPos, headCenter);
      const distPrevPerp = toPrev.dot(normal);

      // Check if trajectory crossed string plane in this delta step
      if ((distPrevPerp > 0 && distPerp <= 0) || (distPrevPerp < 0 && distPerp >= 0)) {
        const denom = distPrevPerp - distPerp;
        const t = Math.abs(denom) > 1e-5 ? Math.max(0, Math.min(1, distPrevPerp / denom)) : 0.5;
        const crossPoint = new THREE.Vector3().lerpVectors(ballPrevPos, ballPos, t);
        const crossInPlane = new THREE.Vector3().subVectors(crossPoint, headCenter);
        crossInPlane.addScaledVector(normal, -crossInPlane.dot(normal));
        if (crossInPlane.length() <= headRadius + ballRadius) {
          return { hit: true, impactPoint: crossPoint, normal, distanceToCenter: crossInPlane.length() };
        }
      }
    }

    // 2. Instantaneous bounded disc volume test
    if (Math.abs(distPerp) <= halfThickness + ballRadius && distParallel <= headRadius + ballRadius) {
      const impactPoint = new THREE.Vector3().copy(headCenter).add(inPlaneVec);
      return { hit: true, impactPoint, normal, distanceToCenter: distParallel };
    }

    return { hit: false, impactPoint: ballPos.clone(), normal, distanceToCenter: distParallel };
  }

  /**
   * Projects 2D/3D screen space coordinates to a 3D Strike Plane directly in front of the camera.
   * Ensures 1:1 tracking in the near frustum (0.7m to 1.2m).
   * Safeguard 2: Properly mirrors webcam horizontal coordinate (1.0 - x)
   * so physical right-hand movements map 1:1 to virtual right along camera right vector R in OTS perspective.
   */
  public static mapScreenToStrikePlane(
    camera: THREE.PerspectiveCamera,
    screenX: number, // [0, 1] webcam raw normalized OR [-1, 1] NDC if isRawWebcam is false
    screenY: number, // [0, 1] webcam raw normalized OR [-1, 1] NDC if isRawWebcam is false
    screenZ = 0,
    isRawWebcam = true,
    distance = 0.95,
    sideOffset = 0.12
  ): THREE.Vector3 {
    let normX: number;
    let normY: number;

    if (isRawWebcam) {
      // Safeguard 2: Mirror inversion for webcam feed (1.0 - screenX)
      // Moving right in real world moves right on screen along R
      normX = ((1.0 - screenX) - 0.5) * 2.0;
      // Invert Y so upward hand movement in webcam increases Three.js world Y
      normY = (0.5 - screenY) * 2.0;
    } else {
      normX = screenX;
      normY = screenY;
    }

    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);

    const fovRad = THREE.MathUtils.degToRad(camera.fov);
    const dStrike = THREE.MathUtils.clamp(distance + screenZ * 0.25, 0.70, 1.20);
    const halfH = dStrike * Math.tan(fovRad * 0.5);
    const halfW = halfH * camera.aspect;

    return new THREE.Vector3()
      .copy(camera.position)
      .addScaledVector(forward, dStrike)
      .addScaledVector(right, normX * halfW * 0.85 + sideOffset)
      .addScaledVector(up, normY * halfH * 0.85);
  }

  public setGhostMode(isGhost: boolean): void {

    const opacity = isGhost ? 0.28 : 1.0;
    this.jointMat.transparent = isGhost;
    this.jointMat.opacity = opacity;
    this.boneMat.transparent = isGhost;
    this.boneMat.opacity = isGhost ? 0.2 : 1.0;
    if (this.headMesh && this.headMesh.material) {
      (this.headMesh.material as THREE.Material).transparent = isGhost;
      (this.headMesh.material as THREE.Material).opacity = isGhost ? 0.2 : 1.0;
    }
  }

  public setJointColor(colorHex: number): void {
    this.jointMat.color.setHex(colorHex);
    this.jointMat.emissive.setHex(colorHex);
  }
}
