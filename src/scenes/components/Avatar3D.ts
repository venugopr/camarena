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
  private supportHandPosition = new THREE.Vector3(-0.32, 1.1, -0.15);
  private racketHeadPosition = new THREE.Vector3(0.42, 1.15, -0.15);
  private racketRestPosition = new THREE.Vector3(0.42, 0.41, -0.15);
  private standingConfident = false;
  private readonly jointSmoothing = 0.18;

  private primaryColor: number;
  private jointMat: THREE.MeshStandardMaterial;
  private boneMat: THREE.MeshStandardMaterial;

  constructor(primaryColor = 0x00f2fe, secondaryColor = 0x39ff14) {
    this.primaryColor = primaryColor;
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

    // Build Badminton Racket
    this.buildBadmintonRacket();
    // Build Table Tennis Paddle
    this.buildTableTennisPaddle();
  }

  private buildBadmintonRacket(): void {
    this.racketGroup = new THREE.Group();

    // Racket handle
    const handleGeo = new THREE.CylinderGeometry(0.015, 0.018, 0.25, 8);
    const handleMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });
    const handle = new THREE.Mesh(handleGeo, handleMat);
    handle.position.y = 0.12;
    this.racketGroup.add(handle);

    // Shaft
    const shaftGeo = new THREE.CylinderGeometry(0.007, 0.007, 0.38, 8);
    const shaftMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.9, roughness: 0.1 });
    const shaft = new THREE.Mesh(shaftGeo, shaftMat);
    shaft.position.y = 0.42;
    this.racketGroup.add(shaft);

    // Head frame (torus oval)
    const frameGeo = new THREE.TorusGeometry(0.14, 0.01, 8, 24);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x00f2fe, emissive: 0x00f2fe, emissiveIntensity: 0.4 });
    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.scale.set(0.85, 1.15, 1);
    frame.position.y = 0.74;
    this.racketGroup.add(frame);

    // Strings mesh
    const stringGeo = new THREE.CircleGeometry(0.12, 16);
    const stringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.35,
      wireframe: true
    });
    const strings = new THREE.Mesh(stringGeo, stringMat);
    strings.scale.set(0.85, 1.15, 1);
    strings.position.y = 0.74;
    this.racketGroup.add(strings);

    this.racketGroup.visible = false;
    this.group.add(this.racketGroup);
  }

  private buildTableTennisPaddle(): void {
    this.paddleGroup = new THREE.Group();

    // Handle
    const handleGeo = new THREE.CylinderGeometry(0.018, 0.022, 0.15, 8);
    const handleMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.7 });
    const handle = new THREE.Mesh(handleGeo, handleMat);
    handle.position.y = 0.075;
    this.paddleGroup.add(handle);

    // Blade & Rubber
    const bladeGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.02, 24);
    const rubberMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.3 });
    const blade = new THREE.Mesh(bladeGeo, rubberMat);
    blade.position.y = 0.22;
    blade.rotation.x = Math.PI / 2;
    this.paddleGroup.add(blade);

    this.paddleGroup.visible = false;
    this.group.add(this.paddleGroup);
  }

  public setEquipment(type: 'badminton' | 'tabletennis' | 'none'): void {
    if (this.racketGroup) this.racketGroup.visible = type === 'badminton';
    if (this.paddleGroup) this.paddleGroup.visible = type === 'tabletennis';
  }

  /**
   * Update 3D avatar joint and bone positions from tracked world landmarks
   */
  public update(
    landmarks: Landmark3D[],
    dominantArm: 'right' | 'left' = 'right',
    rawLandmarks: Landmark3D[] = landmarks
  ): void {
    if (!landmarks || landmarks.length < 33) return;

    // Invert Y and adjust scale for Three.js coordinate system (Y is up, Z is depth)
    const toThree = (lm: Landmark3D): THREE.Vector3 => {
      return new THREE.Vector3(lm.x, -lm.y, lm.z);
    };

    // Position joints
    for (let i = 0; i < 33; i++) {
      const pos = toThree(landmarks[i]);
      this.joints[i].position.lerp(pos, this.jointSmoothing);
    }

    // Position and orient bones
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

    // Position head
    const nose = this.joints[PoseLandmark.NOSE].position;
    this.headMesh.position.copy(nose);

    const hipsVisible = (landmarks[PoseLandmark.LEFT_HIP].visibility ?? 0) >= 0.65 &&
      (landmarks[PoseLandmark.RIGHT_HIP].visibility ?? 0) >= 0.65;
    const lowerBodyVisible = [PoseLandmark.LEFT_KNEE, PoseLandmark.RIGHT_KNEE,
      PoseLandmark.LEFT_ANKLE, PoseLandmark.RIGHT_ANKLE]
      .every(index => (rawLandmarks[index]?.visibility ?? 0) >= 0.45);
    this.standingConfident = hipsVisible && lowerBodyVisible;

    // Keep equipment in the peripheral strike plane. Raw landmarks are mirrored
    // screen coordinates, so 1 - x preserves the camera's mirror orientation.
    const wristIdx = dominantArm === 'right' ? PoseLandmark.RIGHT_WRIST : PoseLandmark.LEFT_WRIST;
    const elbowIdx = dominantArm === 'right' ? PoseLandmark.RIGHT_ELBOW : PoseLandmark.LEFT_ELBOW;

    const wristPos = this.joints[wristIdx].position;
    const elbowPos = this.joints[elbowIdx].position;
    const forearmDir = new THREE.Vector3().subVectors(wristPos, elbowPos).normalize();

    const rawWrist = rawLandmarks[wristIdx];
    const rawSupport = rawLandmarks[PoseLandmark.LEFT_WRIST];
    const trackingNeutral = !rawWrist || ((1 - rawWrist.x) > 0.38 && (1 - rawWrist.x) < 0.62);
    if (this.racketGroup && this.racketGroup.visible) {
      const target = trackingNeutral
        ? this.racketRestPosition
        : new THREE.Vector3(
          THREE.MathUtils.clamp((1 - rawWrist.x - 0.5) * 2.4, -0.9, 0.9),
          THREE.MathUtils.clamp((1 - rawWrist.y) * 2.1, 0.55, 2.5),
          -0.15
        );
      this.racketGroup.position.lerp(target, 0.22);
      const quat = new THREE.Quaternion().setFromUnitVectors(upVector, forearmDir);
      this.racketGroup.setRotationFromQuaternion(quat);
      this.racketHeadPosition.set(
        this.racketGroup.position.x,
        this.racketGroup.position.y + 0.74,
        this.racketGroup.position.z
      );
    }

    if (this.paddleGroup && this.paddleGroup.visible) {
      this.paddleGroup.position.copy(wristPos);
      const quat = new THREE.Quaternion().setFromUnitVectors(upVector, forearmDir);
      this.paddleGroup.setRotationFromQuaternion(quat);
    }

    if (rawSupport) {
      this.supportHandPosition.lerp(new THREE.Vector3(
        THREE.MathUtils.clamp((1 - rawSupport.x - 0.5) * 1.8, -1.0, 1.0),
        THREE.MathUtils.clamp((1 - rawSupport.y) * 2.0, 0.65, 2.2),
        -0.15
      ), 0.25);
    }
  }

  public getSupportHandWorldPosition(): THREE.Vector3 {
    return this.supportHandPosition.clone().add(this.group.position);
  }

  public getRacketHeadWorldPosition(): THREE.Vector3 {
    return this.racketHeadPosition.clone().add(this.group.position);
  }

  public isStandingConfident(): boolean {
    return this.standingConfident;
  }

  public setJointColor(colorHex: number): void {
    this.jointMat.color.setHex(colorHex);
    this.jointMat.emissive.setHex(colorHex);
  }
}
