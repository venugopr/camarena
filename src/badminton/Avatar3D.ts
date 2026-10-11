import * as THREE from 'three';
import { Landmark3D, PoseLandmark, Vector3D } from '../common/Types';

// Standard 33-landmark skeleton connection pairs
export const SKELETON_CONNECTIONS: [number, number][] = [
  // Head / Face
  [PoseLandmark.LEFT_EAR, PoseLandmark.LEFT_EYE],
  [PoseLandmark.LEFT_EYE, PoseLandmark.NOSE],
  [PoseLandmark.NOSE, PoseLandmark.RIGHT_EYE],
  [PoseLandmark.RIGHT_EYE, PoseLandmark.RIGHT_EAR],
  [PoseLandmark.NOSE, PoseLandmark.LEFT_SHOULDER],
  [PoseLandmark.NOSE, PoseLandmark.RIGHT_SHOULDER],
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
  [PoseLandmark.LEFT_ANKLE, PoseLandmark.LEFT_HEEL],
  [PoseLandmark.LEFT_ANKLE, PoseLandmark.LEFT_FOOT_INDEX],
  // Right Leg
  [PoseLandmark.RIGHT_HIP, PoseLandmark.RIGHT_KNEE],
  [PoseLandmark.RIGHT_KNEE, PoseLandmark.RIGHT_ANKLE],
  [PoseLandmark.RIGHT_ANKLE, PoseLandmark.RIGHT_HEEL],
  [PoseLandmark.RIGHT_ANKLE, PoseLandmark.RIGHT_FOOT_INDEX],
];

export type AvatarStyle = 'humanoid' | 'cyber_skeleton';

export class Avatar3D {
  public group: THREE.Group;
  protected joints: THREE.Mesh[] = [];
  protected bones: THREE.Mesh[] = [];
  protected racketGroup: THREE.Group | null = null;
  public racketMesh?: THREE.Mesh;
  protected paddleGroup: THREE.Group | null = null;
  protected tennisRacketGroup: THREE.Group | null = null;
  public tennisRacketMesh?: THREE.Mesh;
  public currentEquipment: 'badminton' | 'tabletennis' | 'tennis' | 'none' = 'badminton';
  public avatarStyle: 'humanoid' | 'cyber_skeleton' = 'humanoid';
  protected headMesh: THREE.Mesh;
  private readonly jointSmoothing = 0.18;

  protected primaryColor: number;
  protected secondaryColor: number;
  protected jointMat: THREE.MeshStandardMaterial;
  protected boneMat: THREE.MeshStandardMaterial;
  protected racketFrameMat?: THREE.MeshStandardMaterial;
  protected racketStringMat?: THREE.MeshBasicMaterial;
  protected tennisRacketFrameMat?: THREE.MeshStandardMaterial;
  protected tennisRacketStringMat?: THREE.MeshBasicMaterial;
  public dominantArm: 'right' | 'left' = 'right';
  private trackedForwardZ = 0;
  protected supportHandGroup: THREE.Group = new THREE.Group();
  private lastRightWrist = new THREE.Vector3();
  private lastLeftWrist = new THREE.Vector3();
  private smoothedRightWristVel = new THREE.Vector3();
  private smoothedRacketVel = new THREE.Vector3();
  private prevRightWristPos = new THREE.Vector3();
  private prevRacketWorldPos = new THREE.Vector3();
  private isVelocitiesInitialized = false;

  // Tracking flags
  protected hasRightWrist = false;
  protected hasLeftWrist = false;
  protected hasPrevRightWristPos = false;
  protected hasPrevRacketPos = false;

  // Procedural Lower-Body Footwork & Weight Transfer State
  private footworkVel = new THREE.Vector3();
  private footworkTimer = 0;
  private footworkLungeDir: 'left' | 'right' | 'none' = 'none';
  private footworkIsSplitStep = false;

  public setFootworkKinematics(vel: THREE.Vector3, isSplitStep = false, lungeDir: 'left' | 'right' | 'none' = 'none'): void {
    this.footworkVel.copy(vel);
    this.footworkIsSplitStep = isSplitStep;
    this.footworkLungeDir = lungeDir;
  }

  // Humanoid Body Group & Materials
  protected humanoidGroup: THREE.Group = new THREE.Group();
  protected humanoidBodyMat!: THREE.MeshStandardMaterial;
  protected humanoidTrimMat!: THREE.MeshStandardMaterial;
  protected humanoidGlowMat!: THREE.MeshStandardMaterial;
  protected humanoidShoeMat!: THREE.MeshStandardMaterial;
  protected humanoidShoeSoleMat!: THREE.MeshStandardMaterial;

  // Humanoid Anatomical Components
  protected chestMesh!: THREE.Mesh;
  protected coreMesh!: THREE.Mesh;
  protected pelvisMesh!: THREE.Mesh;
  protected neckMesh!: THREE.Mesh;
  protected humanoidHeadGroup!: THREE.Group;
  protected humanoidHeadMesh!: THREE.Mesh;
  protected humanoidVisorMesh!: THREE.Mesh;

  // Humanoid Limbs
  protected leftUpperArmMesh!: THREE.Mesh;
  protected rightUpperArmMesh!: THREE.Mesh;
  protected leftForearmMesh!: THREE.Mesh;
  protected rightForearmMesh!: THREE.Mesh;
  protected leftThighMesh!: THREE.Mesh;
  protected rightThighMesh!: THREE.Mesh;
  protected leftCalfMesh!: THREE.Mesh;
  protected rightCalfMesh!: THREE.Mesh;

  // Humanoid Joints / Cuffs
  protected leftShoulderCap!: THREE.Mesh;
  protected rightShoulderCap!: THREE.Mesh;
  protected leftElbowRing!: THREE.Mesh;
  protected rightElbowRing!: THREE.Mesh;
  protected leftKneeCap!: THREE.Mesh;
  protected rightKneeCap!: THREE.Mesh;

  // Humanoid Shoes
  protected leftShoeGroup!: THREE.Group;
  protected rightShoeGroup!: THREE.Group;

  // Zero-allocation scratch objects for 60+ FPS inverse arm kinematics
  private static readonly scratchUpVector = new THREE.Vector3(0, 1, 0);
  private static readonly scratchLocalTarget = new THREE.Vector3();
  private static readonly scratchArmVector = new THREE.Vector3();
  private static readonly scratchWristPos = new THREE.Vector3();
  private static readonly scratchForearmDir = new THREE.Vector3();
  private static readonly scratchLocalSTarget = new THREE.Vector3();
  private static readonly scratchSArmVector = new THREE.Vector3();
  private static readonly scratchSWristPos = new THREE.Vector3();
  private static readonly scratchSForearmDir = new THREE.Vector3();
  private static readonly scratchQuat = new THREE.Quaternion();
  private static readonly defaultVelocity = new THREE.Vector3(0, 0, 0);

  // Scratch objects for humanoid anatomical alignment
  private static readonly scratchMid = new THREE.Vector3();
  private static readonly scratchDir = new THREE.Vector3();
  private static readonly scratchLateral = new THREE.Vector3();
  private static readonly scratchSpine = new THREE.Vector3();
  private static readonly scratchNormal = new THREE.Vector3();
  private static readonly scratchBasisMat = new THREE.Matrix4();

  constructor(
    primaryColorOrOptions: number | { primaryColor?: number; secondaryColor?: number; avatarStyle?: AvatarStyle } = 0x00f2fe,
    secondaryColor = 0x39ff14
  ) {
    let primaryColor = 0x00f2fe;
    if (typeof primaryColorOrOptions === 'object') {
      if (primaryColorOrOptions.primaryColor !== undefined) primaryColor = primaryColorOrOptions.primaryColor;
      if (primaryColorOrOptions.secondaryColor !== undefined) secondaryColor = primaryColorOrOptions.secondaryColor;
      if (primaryColorOrOptions.avatarStyle !== undefined) this.avatarStyle = primaryColorOrOptions.avatarStyle;
    } else {
      primaryColor = primaryColorOrOptions;
    }
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
    // Build Tennis Racket
    this.buildTennisRacket();

    // Build Procedural Athletic Humanoid Mannequin
    this.buildHumanoidMesh();
    this.applyAvatarStyle();
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
    this.racketMesh = frame;
    this.racketGroup.add(frame);

    // High tension nano-mesh string bed
    const stringGeo = new THREE.CircleGeometry(0.16, 24);
    const stringMat = new THREE.MeshBasicMaterial({
      color: 0xe0f2fe,
      transparent: true,
      opacity: 0.6,
      wireframe: true
    });
    this.racketStringMat = stringMat;
    const strings = new THREE.Mesh(stringGeo, stringMat);
    strings.scale.set(0.88, 1.22, 1);
    strings.position.y = 0.83;
    this.racketGroup.add(strings);

    this.racketGroup.scale.set(1.0, 1.0, 1.0);
    this.racketGroup.visible = true;
    this.group.add(this.racketGroup);
  }

  private buildTableTennisPaddle(): void {
    this.paddleGroup = new THREE.Group();

    // 1. Blade Group — Positioned DOWNWARDS towards the table, red rubber facing table (+Z)
    const bladeGroup = new THREE.Group();
    bladeGroup.position.set(0, -0.10, 0.05);
    bladeGroup.rotation.x = -0.22; // Natural closed topspin pitch toward table surface

    // Multi-ply wood blade base (diameter 16.4cm, radius 0.082m)
    const bladeGeo = new THREE.CylinderGeometry(0.082, 0.082, 0.009, 36);
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.4 });
    const blade = new THREE.Mesh(bladeGeo, bladeMat);
    blade.rotation.x = Math.PI / 2;
    bladeGroup.add(blade);

    // High-contrast white edge tape perimeter with glow
    const edgeTapeGeo = new THREE.TorusGeometry(0.082, 0.005, 8, 36);
    const edgeTapeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.4,
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

    // White sweet-spot center badge
    const spotGeo = new THREE.CircleGeometry(0.018, 16);
    const spotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
    const spot = new THREE.Mesh(spotGeo, spotMat);
    spot.position.z = 0.0075;
    bladeGroup.add(spot);

    // Sleek Black Backhand Rubber — FACING THE PLAYER (-Z)
    const blackRubberMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.85 });
    const blackRubber = new THREE.Mesh(redRubberGeo, blackRubberMat);
    blackRubber.rotation.x = Math.PI / 2;
    blackRubber.position.z = -0.0055; // Facing player (-Z)
    bladeGroup.add(blackRubber);

    this.paddleGroup.add(bladeGroup);

    // 2. Flared ergonomic wooden handle held in hand at the wrist
    const handleGeo = new THREE.CylinderGeometry(0.013, 0.016, 0.11, 16);
    const handleMat = new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.45, metalness: 0.1 });
    const handle = new THREE.Mesh(handleGeo, handleMat);
    handle.position.set(0, 0.015, 0.01);
    handle.rotation.x = -0.22;
    this.paddleGroup.add(handle);

    this.paddleGroup.visible = false;
    this.group.add(this.paddleGroup);
  }

  public setAvatarStyle(style: 'humanoid' | 'cyber_skeleton'): void {
    this.avatarStyle = style;
    this.applyAvatarStyle();
  }

  protected applyAvatarStyle(): void {
    const isHumanoid = this.avatarStyle === 'humanoid';
    for (let i = 0; i < this.joints.length; i++) {
      this.joints[i].visible = !isHumanoid;
    }
    for (let i = 0; i < this.bones.length; i++) {
      this.bones[i].visible = !isHumanoid;
    }
    if (this.headMesh) {
      this.headMesh.visible = !isHumanoid;
    }
    if (this.humanoidGroup) {
      this.humanoidGroup.visible = isHumanoid;
    }
  }

  public getTennisRacketGroup(): THREE.Group | null {
    return this.tennisRacketGroup;
  }

  protected buildTennisRacket(): void {
    this.tennisRacketGroup = new THREE.Group();

    // 1. Ergonomic cushioned grip handle (~0.28m length)
    const gripGeo = new THREE.CylinderGeometry(0.018, 0.021, 0.28, 16);
    const gripMat = new THREE.MeshStandardMaterial({
      color: 0x18181b,
      roughness: 0.85,
      metalness: 0.15
    });
    const grip = new THREE.Mesh(gripGeo, gripMat);
    grip.position.y = 0.14;
    this.tennisRacketGroup.add(grip);

    // Butt cap with brand accent
    const buttCapGeo = new THREE.CylinderGeometry(0.023, 0.023, 0.02, 16);
    const buttCapMat = new THREE.MeshStandardMaterial({
      color: this.primaryColor,
      emissive: this.primaryColor,
      emissiveIntensity: 0.4
    });
    const buttCap = new THREE.Mesh(buttCapGeo, buttCapMat);
    buttCap.position.y = 0.01;
    this.tennisRacketGroup.add(buttCap);

    // Grip tape finishing collar accent
    const collarGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.018, 16);
    const collarMat = new THREE.MeshStandardMaterial({ color: this.secondaryColor, roughness: 0.3 });
    const collar = new THREE.Mesh(collarGeo, collarMat);
    collar.position.y = 0.27;
    this.tennisRacketGroup.add(collar);

    // 2. Open throat / aerodynamic V-bridge
    const throatMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.25,
      metalness: 0.85,
      emissive: this.primaryColor,
      emissiveIntensity: 0.2
    });
    const strutGeo = new THREE.CylinderGeometry(0.009, 0.011, 0.15, 12);

    const leftStrut = new THREE.Mesh(strutGeo, throatMat);
    leftStrut.position.set(0.028, 0.34, 0);
    leftStrut.rotation.z = -0.22;
    this.tennisRacketGroup.add(leftStrut);

    const rightStrut = new THREE.Mesh(strutGeo, throatMat);
    rightStrut.position.set(-0.028, 0.34, 0);
    rightStrut.rotation.z = 0.22;
    this.tennisRacketGroup.add(rightStrut);

    // Throat crossbar bridge
    const bridgeGeo = new THREE.BoxGeometry(0.065, 0.014, 0.016);
    const bridge = new THREE.Mesh(bridgeGeo, throatMat);
    bridge.position.set(0, 0.40, 0);
    this.tennisRacketGroup.add(bridge);

    // 3. Elliptical isometric racket head (~0.28m x 0.35m) with high-visibility neon frame
    const frameGeo = new THREE.TorusGeometry(0.18, 0.015, 14, 40);
    const frameMat = new THREE.MeshStandardMaterial({
      color: this.primaryColor,
      emissive: this.primaryColor,
      emissiveIntensity: 0.95,
      metalness: 0.65,
      roughness: 0.2
    });
    this.tennisRacketFrameMat = frameMat;
    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.scale.set(0.88, 1.18, 1.0);
    frame.position.y = 0.58;
    this.tennisRacketMesh = frame;
    this.tennisRacketGroup.add(frame);

    // Synthetic gut string bed with wireframe matrix
    const stringGeo = new THREE.CircleGeometry(0.17, 28);
    const stringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.55,
      wireframe: true
    });
    this.tennisRacketStringMat = stringMat;
    const strings = new THREE.Mesh(stringGeo, stringMat);
    strings.scale.set(0.88, 1.18, 1.0);
    strings.position.y = 0.58;
    this.tennisRacketGroup.add(strings);

    // Sweet spot center badge
    const stencilGeo = new THREE.RingGeometry(0.024, 0.040, 16);
    const stencilMat = new THREE.MeshBasicMaterial({
      color: this.secondaryColor,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide
    });
    const stencil = new THREE.Mesh(stencilGeo, stencilMat);
    stencil.position.set(0, 0.58, 0.002);
    this.tennisRacketGroup.add(stencil);

    // Hand glove wrapping handle
    const gloveMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.5, metalness: 0.3 });
    const palmGeo = new THREE.BoxGeometry(0.052, 0.088, 0.046);
    const palmMesh = new THREE.Mesh(palmGeo, gloveMat);
    palmMesh.position.set(-0.012, 0.14, 0);
    this.tennisRacketGroup.add(palmMesh);

    const fingerMat = new THREE.MeshStandardMaterial({
      color: this.primaryColor,
      emissive: this.primaryColor,
      emissiveIntensity: 0.35,
      roughness: 0.3
    });
    for (let f = 0; f < 4; f++) {
      const fingerGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.042, 8);
      const finger = new THREE.Mesh(fingerGeo, fingerMat);
      finger.rotation.z = Math.PI / 2;
      finger.position.set(0.014, 0.10 + f * 0.026, 0.016);
      this.tennisRacketGroup.add(finger);
    }
    const thumbGeo = new THREE.CylinderGeometry(0.009, 0.009, 0.034, 8);
    const thumb = new THREE.Mesh(thumbGeo, fingerMat);
    thumb.rotation.x = Math.PI / 3;
    thumb.position.set(-0.016, 0.16, -0.020);
    this.tennisRacketGroup.add(thumb);

    this.tennisRacketGroup.visible = false;
    this.group.add(this.tennisRacketGroup);
  }

  protected buildHumanoidMesh(): void {
    this.humanoidGroup = new THREE.Group();

    // High quality athletic materials
    this.humanoidBodyMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.38,
      metalness: 0.72
    });

    this.humanoidTrimMat = new THREE.MeshStandardMaterial({
      color: this.primaryColor,
      emissive: this.primaryColor,
      emissiveIntensity: 0.45,
      roughness: 0.25,
      metalness: 0.6
    });

    this.humanoidGlowMat = new THREE.MeshStandardMaterial({
      color: this.secondaryColor,
      emissive: this.secondaryColor,
      emissiveIntensity: 0.65,
      roughness: 0.2
    });

    this.humanoidShoeMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.5,
      metalness: 0.4
    });

    this.humanoidShoeSoleMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.8,
      metalness: 0.1
    });

    // 1. Torso: Chest / Thorax (contoured inverted trapezoid/box)
    const chestGroup = new THREE.Group();
    const thoraxGeo = new THREE.BoxGeometry(0.40, 0.32, 0.18);
    const thorax = new THREE.Mesh(thoraxGeo, this.humanoidBodyMat);
    thorax.castShadow = true;
    chestGroup.add(thorax);

    // Contoured pectoral armor plates
    const pecGeo = new THREE.BoxGeometry(0.16, 0.13, 0.025);
    const leftPec = new THREE.Mesh(pecGeo, this.humanoidTrimMat);
    leftPec.position.set(0.09, 0.05, 0.095);
    leftPec.rotation.y = 0.08;
    chestGroup.add(leftPec);

    const rightPec = new THREE.Mesh(pecGeo, this.humanoidTrimMat);
    rightPec.position.set(-0.09, 0.05, 0.095);
    rightPec.rotation.y = -0.08;
    chestGroup.add(rightPec);

    // Collarbone bridge trim
    const clavicleGeo = new THREE.BoxGeometry(0.38, 0.028, 0.06);
    const clavicle = new THREE.Mesh(clavicleGeo, this.humanoidGlowMat);
    clavicle.position.set(0, 0.14, 0.07);
    chestGroup.add(clavicle);

    this.chestMesh = thorax; // Reference root
    this.humanoidGroup.add(chestGroup);

    // 2. Torso: Core (flexible abdominal midsection)
    const coreGeo = new THREE.BoxGeometry(0.28, 0.14, 0.17);
    this.coreMesh = new THREE.Mesh(coreGeo, this.humanoidBodyMat);
    this.coreMesh.castShadow = true;
    const abGeo = new THREE.BoxGeometry(0.08, 0.10, 0.02);
    const ab = new THREE.Mesh(abGeo, this.humanoidTrimMat);
    ab.position.set(0, 0, 0.085);
    this.coreMesh.add(ab);
    this.humanoidGroup.add(this.coreMesh);

    // 3. Torso: Pelvis (hip box bridging spine to hips)
    const pelvisGeo = new THREE.BoxGeometry(0.34, 0.17, 0.19);
    this.pelvisMesh = new THREE.Mesh(pelvisGeo, this.humanoidBodyMat);
    this.pelvisMesh.castShadow = true;
    const beltGeo = new THREE.BoxGeometry(0.35, 0.035, 0.195);
    const belt = new THREE.Mesh(beltGeo, this.humanoidTrimMat);
    belt.position.set(0, 0.07, 0);
    this.pelvisMesh.add(belt);
    this.humanoidGroup.add(this.pelvisMesh);

    // 4. Neck Column
    const neckGeo = new THREE.CylinderGeometry(0.046, 0.052, 0.10, 14);
    this.neckMesh = new THREE.Mesh(neckGeo, this.humanoidBodyMat);
    this.humanoidGroup.add(this.neckMesh);

    // 5. Head: Athletic Mannequin Head with Jawline & Cyber-Visor
    this.humanoidHeadGroup = new THREE.Group();
    const craniumGeo = new THREE.SphereGeometry(0.105, 18, 18);
    this.humanoidHeadMesh = new THREE.Mesh(craniumGeo, this.humanoidBodyMat);
    this.humanoidHeadMesh.castShadow = true;
    this.humanoidHeadGroup.add(this.humanoidHeadMesh);

    const jawGeo = new THREE.BoxGeometry(0.085, 0.075, 0.095);
    const jaw = new THREE.Mesh(jawGeo, this.humanoidBodyMat);
    jaw.position.set(0, -0.04, 0.03);
    this.humanoidHeadGroup.add(jaw);

    const visorGeo = new THREE.BoxGeometry(0.17, 0.046, 0.07);
    this.humanoidVisorMesh = new THREE.Mesh(visorGeo, this.humanoidGlowMat);
    this.humanoidVisorMesh.position.set(0, 0.015, 0.078);
    this.humanoidHeadGroup.add(this.humanoidVisorMesh);
    this.humanoidGroup.add(this.humanoidHeadGroup);

    // 6. Shoulders & Upper Arms
    const deltoidGeo = new THREE.SphereGeometry(0.062, 14, 14);
    this.leftShoulderCap = new THREE.Mesh(deltoidGeo, this.humanoidTrimMat);
    this.rightShoulderCap = new THREE.Mesh(deltoidGeo, this.humanoidTrimMat);
    this.humanoidGroup.add(this.leftShoulderCap);
    this.humanoidGroup.add(this.rightShoulderCap);

    const upperArmGeo = new THREE.CylinderGeometry(0.038, 0.052, 1, 14);
    this.leftUpperArmMesh = new THREE.Mesh(upperArmGeo, this.humanoidBodyMat);
    this.leftUpperArmMesh.castShadow = true;
    this.rightUpperArmMesh = new THREE.Mesh(upperArmGeo, this.humanoidBodyMat);
    this.rightUpperArmMesh.castShadow = true;
    this.humanoidGroup.add(this.leftUpperArmMesh);
    this.humanoidGroup.add(this.rightUpperArmMesh);

    // 7. Elbow Cuffs & Forearms
    const elbowRingGeo = new THREE.TorusGeometry(0.040, 0.007, 8, 16);
    this.leftElbowRing = new THREE.Mesh(elbowRingGeo, this.humanoidGlowMat);
    this.rightElbowRing = new THREE.Mesh(elbowRingGeo, this.humanoidGlowMat);
    this.humanoidGroup.add(this.leftElbowRing);
    this.humanoidGroup.add(this.rightElbowRing);

    const forearmGeo = new THREE.CylinderGeometry(0.028, 0.040, 1, 14);
    this.leftForearmMesh = new THREE.Mesh(forearmGeo, this.humanoidBodyMat);
    this.leftForearmMesh.castShadow = true;
    this.rightForearmMesh = new THREE.Mesh(forearmGeo, this.humanoidBodyMat);
    this.rightForearmMesh.castShadow = true;
    this.humanoidGroup.add(this.leftForearmMesh);
    this.humanoidGroup.add(this.rightForearmMesh);

    // 8. Thighs & Knee Caps
    const thighGeo = new THREE.CylinderGeometry(0.046, 0.068, 1, 16);
    this.leftThighMesh = new THREE.Mesh(thighGeo, this.humanoidBodyMat);
    this.leftThighMesh.castShadow = true;
    this.rightThighMesh = new THREE.Mesh(thighGeo, this.humanoidBodyMat);
    this.rightThighMesh.castShadow = true;
    this.humanoidGroup.add(this.leftThighMesh);
    this.humanoidGroup.add(this.rightThighMesh);

    const kneeGeo = new THREE.BoxGeometry(0.08, 0.08, 0.04);
    this.leftKneeCap = new THREE.Mesh(kneeGeo, this.humanoidTrimMat);
    this.rightKneeCap = new THREE.Mesh(kneeGeo, this.humanoidTrimMat);
    this.humanoidGroup.add(this.leftKneeCap);
    this.humanoidGroup.add(this.rightKneeCap);

    // 9. Calves
    const calfGeo = new THREE.CylinderGeometry(0.034, 0.050, 1, 16);
    this.leftCalfMesh = new THREE.Mesh(calfGeo, this.humanoidBodyMat);
    this.leftCalfMesh.castShadow = true;
    this.rightCalfMesh = new THREE.Mesh(calfGeo, this.humanoidBodyMat);
    this.rightCalfMesh.castShadow = true;
    this.humanoidGroup.add(this.leftCalfMesh);
    this.humanoidGroup.add(this.rightCalfMesh);

    // 10. Athletic Tennis Running Shoes
    const createShoe = (): THREE.Group => {
      const shoeGroup = new THREE.Group();
      const soleGeo = new THREE.BoxGeometry(0.11, 0.045, 0.25);
      const sole = new THREE.Mesh(soleGeo, this.humanoidShoeSoleMat);
      sole.position.set(0, 0.022, 0.04);
      sole.castShadow = true;
      shoeGroup.add(sole);

      const upperGeo = new THREE.BoxGeometry(0.105, 0.060, 0.22);
      const upper = new THREE.Mesh(upperGeo, this.humanoidShoeMat);
      upper.position.set(0, 0.052, 0.03);
      upper.castShadow = true;
      shoeGroup.add(upper);

      const stripeGeo = new THREE.BoxGeometry(0.112, 0.018, 0.10);
      const stripe = new THREE.Mesh(stripeGeo, this.humanoidTrimMat);
      stripe.position.set(0, 0.048, 0.02);
      shoeGroup.add(stripe);

      const laceGeo = new THREE.BoxGeometry(0.045, 0.015, 0.06);
      const lace = new THREE.Mesh(laceGeo, this.humanoidGlowMat);
      lace.position.set(0, 0.082, 0.04);
      shoeGroup.add(lace);

      return shoeGroup;
    };

    this.leftShoeGroup = createShoe();
    this.rightShoeGroup = createShoe();
    this.humanoidGroup.add(this.leftShoeGroup);
    this.humanoidGroup.add(this.rightShoeGroup);

    this.group.add(this.humanoidGroup);
  }

  protected updateHumanoidMesh(): void {
    if (!this.humanoidGroup || !this.humanoidGroup.visible) return;

    const up = Avatar3D.scratchUpVector;

    const orientLimb = (mesh: THREE.Mesh, pA: THREE.Vector3, pB: THREE.Vector3): void => {
      const dist = pA.distanceTo(pB);
      mesh.position.copy(pA).add(pB).multiplyScalar(0.5);
      mesh.scale.set(1, Math.max(0.001, dist), 1);
      const dir = Avatar3D.scratchDir.subVectors(pB, pA).normalize();
      Avatar3D.scratchQuat.setFromUnitVectors(up, dir);
      mesh.setRotationFromQuaternion(Avatar3D.scratchQuat);
    };

    // 1. Torso articulation: Chest, Core, Pelvis
    const lSh = this.joints[PoseLandmark.LEFT_SHOULDER].position;
    const rSh = this.joints[PoseLandmark.RIGHT_SHOULDER].position;
    const lHip = this.joints[PoseLandmark.LEFT_HIP].position;
    const rHip = this.joints[PoseLandmark.RIGHT_HIP].position;

    const midShoulder = Avatar3D.scratchMid.copy(lSh).add(rSh).multiplyScalar(0.5);
    const midHip = Avatar3D.scratchSArmVector.copy(lHip).add(rHip).multiplyScalar(0.5);

    const spineVec = Avatar3D.scratchSpine.subVectors(midShoulder, midHip);
    const spineLen = Math.max(0.01, spineVec.length());
    const spineDir = spineVec.normalize();

    const lateralVec = Avatar3D.scratchLateral.subVectors(lSh, rSh).normalize();
    const normalVec = Avatar3D.scratchNormal.crossVectors(lateralVec, spineDir).normalize();
    if (normalVec.z < 0) normalVec.negate();
    const orthoLateral = Avatar3D.scratchLateral.crossVectors(spineDir, normalVec).normalize();

    Avatar3D.scratchBasisMat.makeBasis(orthoLateral, spineDir, normalVec);
    const torsoQuat = Avatar3D.scratchQuat.setFromRotationMatrix(Avatar3D.scratchBasisMat);

    if (this.chestMesh?.parent) {
      this.chestMesh.parent.position.copy(midHip).addScaledVector(spineDir, spineLen * 0.68);
      this.chestMesh.parent.setRotationFromQuaternion(torsoQuat);
    }

    if (this.coreMesh) {
      this.coreMesh.position.copy(midHip).addScaledVector(spineDir, spineLen * 0.36);
      this.coreMesh.setRotationFromQuaternion(torsoQuat);
    }

    if (this.pelvisMesh) {
      this.pelvisMesh.position.copy(midHip);
      this.pelvisMesh.setRotationFromQuaternion(torsoQuat);
    }

    if (this.neckMesh) {
      this.neckMesh.position.copy(midShoulder).addScaledVector(spineDir, 0.05);
      this.neckMesh.setRotationFromQuaternion(torsoQuat);
    }

    const headPos = this.joints[PoseLandmark.NOSE].position;
    if (this.humanoidHeadGroup) {
      this.humanoidHeadGroup.position.copy(headPos);
      this.humanoidHeadGroup.setRotationFromQuaternion(torsoQuat);
    }

    // 2. Arms (Upper arms, Deltoid caps, Elbow rings, Forearms)
    if (this.leftShoulderCap) this.leftShoulderCap.position.copy(lSh);
    if (this.rightShoulderCap) this.rightShoulderCap.position.copy(rSh);

    const lElbow = this.joints[PoseLandmark.LEFT_ELBOW].position;
    const rElbow = this.joints[PoseLandmark.RIGHT_ELBOW].position;
    const lWrist = this.joints[PoseLandmark.LEFT_WRIST].position;
    const rWrist = this.joints[PoseLandmark.RIGHT_WRIST].position;

    if (this.leftUpperArmMesh) orientLimb(this.leftUpperArmMesh, lSh, lElbow);
    if (this.rightUpperArmMesh) orientLimb(this.rightUpperArmMesh, rSh, rElbow);

    if (this.leftElbowRing) this.leftElbowRing.position.copy(lElbow);
    if (this.rightElbowRing) this.rightElbowRing.position.copy(rElbow);

    if (this.leftForearmMesh) orientLimb(this.leftForearmMesh, lElbow, lWrist);
    if (this.rightForearmMesh) orientLimb(this.rightForearmMesh, rElbow, rWrist);

    // 3. Legs (Thighs, Knees, Calves, Shoes)
    const lKnee = this.joints[PoseLandmark.LEFT_KNEE].position;
    const rKnee = this.joints[PoseLandmark.RIGHT_KNEE].position;
    const lAnkle = this.joints[PoseLandmark.LEFT_ANKLE].position;
    const rAnkle = this.joints[PoseLandmark.RIGHT_ANKLE].position;

    if (this.leftThighMesh) orientLimb(this.leftThighMesh, lHip, lKnee);
    if (this.rightThighMesh) orientLimb(this.rightThighMesh, rHip, rKnee);

    if (this.leftKneeCap) {
      this.leftKneeCap.position.copy(lKnee);
      this.leftKneeCap.position.z += 0.04;
    }
    if (this.rightKneeCap) {
      this.rightKneeCap.position.copy(rKnee);
      this.rightKneeCap.position.z += 0.04;
    }

    if (this.leftCalfMesh) orientLimb(this.leftCalfMesh, lKnee, lAnkle);
    if (this.rightCalfMesh) orientLimb(this.rightCalfMesh, rKnee, rAnkle);

    // 4. Shoes anchored to ground level Y = 0
    const lFootIdx = this.joints[PoseLandmark.LEFT_FOOT_INDEX].position;
    const rFootIdx = this.joints[PoseLandmark.RIGHT_FOOT_INDEX].position;

    if (this.leftShoeGroup) {
      this.leftShoeGroup.position.set(lAnkle.x, 0, lAnkle.z);
      const lFootDir = Avatar3D.scratchDir.subVectors(lFootIdx, lAnkle);
      const lFootAngle = Math.atan2(lFootDir.x, lFootDir.z);
      this.leftShoeGroup.rotation.set(0, lFootAngle, 0);
    }

    if (this.rightShoeGroup) {
      this.rightShoeGroup.position.set(rAnkle.x, 0, rAnkle.z);
      const rFootDir = Avatar3D.scratchDir.subVectors(rFootIdx, rAnkle);
      const rFootAngle = Math.atan2(rFootDir.x, rFootDir.z);
      this.rightShoeGroup.rotation.set(0, rFootAngle, 0);
    }
  }

  public setEquipment(type: 'badminton' | 'tabletennis' | 'tennis' | 'none'): void {
    this.currentEquipment = type;
    if (this.racketGroup) {
      this.racketGroup.visible = type === 'badminton';
      this.racketGroup.traverse((c) => { c.visible = type === 'badminton'; });
    }
    if (this.paddleGroup) {
      this.paddleGroup.visible = type === 'tabletennis';
      this.paddleGroup.traverse((c) => { c.visible = type === 'tabletennis'; });
    }
    if (this.tennisRacketGroup) {
      this.tennisRacketGroup.visible = type === 'tennis';
      this.tennisRacketGroup.traverse((c) => { c.visible = type === 'tennis'; });
    }
    this.applyDefaultPose(type === 'none' ? 'tabletennis' : type);
  }

  /**
   * Poses the avatar in a natural, athletic sports ready stance
   */
  public applyDefaultPose(sport: 'badminton' | 'tabletennis' | 'tennis' | 'sandbox' = 'tabletennis', isOpponent = false): void {
    const hipY = 0.95;
    const shoulderY = 1.45; // 1.45m upright athletic shoulder height (just below 1.55m net tape)
    const headY = 1.75; // 1.75m true full-height standing athlete (visibly taller than 1.55m net tape)

    // Set joints to athletic ready pose
    // Base skeleton in 3D world: Left is +X (screen-left), Right is -X (screen-right)
    this.joints[PoseLandmark.LEFT_HIP].position.set(0.16, hipY, 0);
    this.joints[PoseLandmark.RIGHT_HIP].position.set(-0.16, hipY, 0);

    this.joints[PoseLandmark.LEFT_SHOULDER].position.set(0.24, shoulderY, 0);
    this.joints[PoseLandmark.RIGHT_SHOULDER].position.set(-0.24, shoulderY, 0);

    this.headMesh.position.set(0, headY, 0.08);
    this.joints[PoseLandmark.NOSE].position.set(0, headY, 0.08);

    // Knees fixed in natural athletic ready bend at Y = 0.50m
    this.joints[PoseLandmark.LEFT_KNEE].position.set(0.19, 0.50, 0.06);
    this.joints[PoseLandmark.RIGHT_KNEE].position.set(-0.19, 0.50, 0.06);
    this.joints[PoseLandmark.LEFT_ANKLE].position.set(0.22, 0.08, -0.02);
    this.joints[PoseLandmark.RIGHT_ANKLE].position.set(-0.22, 0.08, -0.02);
    this.joints[PoseLandmark.LEFT_HEEL].position.set(0.22, 0.04, -0.06);
    this.joints[PoseLandmark.RIGHT_HEEL].position.set(-0.22, 0.04, -0.06);
    this.joints[PoseLandmark.LEFT_FOOT_INDEX].position.set(0.22, 0.00, 0.12);
    this.joints[PoseLandmark.RIGHT_FOOT_INDEX].position.set(-0.22, 0.00, 0.12);

    if (sport === 'tabletennis') {
      // Table Tennis stance
      if (this.dominantArm === 'right') {
        this.joints[PoseLandmark.LEFT_ELBOW].position.set(0.32, 1.1, 0.22);
        this.joints[PoseLandmark.LEFT_WRIST].position.set(0.22, 0.96, 0.36);

        this.joints[PoseLandmark.RIGHT_ELBOW].position.set(-0.32, 1.06, 0.22);
        this.joints[PoseLandmark.RIGHT_WRIST].position.set(-0.28, 0.96, 0.44);

        if (this.paddleGroup) {
          this.paddleGroup.position.set(-0.28, 0.96, 0.44);
          this.paddleGroup.rotation.set(0.35, 0, 0.2);
        }
      } else {
        this.joints[PoseLandmark.RIGHT_ELBOW].position.set(-0.32, 1.1, 0.22);
        this.joints[PoseLandmark.RIGHT_WRIST].position.set(-0.22, 0.96, 0.36);

        this.joints[PoseLandmark.LEFT_ELBOW].position.set(0.32, 1.06, 0.22);
        this.joints[PoseLandmark.LEFT_WRIST].position.set(0.28, 0.96, 0.44);

        if (this.paddleGroup) {
          this.paddleGroup.position.set(0.28, 0.96, 0.44);
          this.paddleGroup.rotation.set(0.35, 0, -0.2);
        }
      }
    } else if (sport === 'tennis') {
      // Tennis athletic ready stance (bent knees, ready to split-step, racket held in front)
      if (this.dominantArm === 'right') {
        this.joints[PoseLandmark.LEFT_ELBOW].position.set(0.24, 1.05, 0.28);
        this.joints[PoseLandmark.LEFT_WRIST].position.set(0.12, 1.08, 0.40);

        this.joints[PoseLandmark.RIGHT_ELBOW].position.set(-0.30, 1.08, 0.24);
        this.joints[PoseLandmark.RIGHT_WRIST].position.set(-0.16, 1.10, 0.42);

        if (this.tennisRacketGroup) {
          this.tennisRacketGroup.position.set(-0.16, 1.10, 0.42);
          this.tennisRacketGroup.rotation.set(0.42, -0.15, 0.1);
          this.tennisRacketGroup.scale.set(1.0, 1.0, 1.0);
          this.tennisRacketGroup.visible = true;
          this.tennisRacketGroup.traverse((c) => { c.visible = true; });
        }
        if (this.supportHandGroup) {
          this.supportHandGroup.position.set(0.12, 1.08, 0.40);
          this.supportHandGroup.rotation.set(-0.2, -0.3, 0);
        }
      } else {
        this.joints[PoseLandmark.RIGHT_ELBOW].position.set(-0.24, 1.05, 0.28);
        this.joints[PoseLandmark.RIGHT_WRIST].position.set(-0.12, 1.08, 0.40);

        this.joints[PoseLandmark.LEFT_ELBOW].position.set(0.30, 1.08, 0.24);
        this.joints[PoseLandmark.LEFT_WRIST].position.set(0.16, 1.10, 0.42);

        if (this.tennisRacketGroup) {
          this.tennisRacketGroup.position.set(0.16, 1.10, 0.42);
          this.tennisRacketGroup.rotation.set(0.42, 0.15, -0.1);
          this.tennisRacketGroup.scale.set(1.0, 1.0, 1.0);
          this.tennisRacketGroup.visible = true;
          this.tennisRacketGroup.traverse((c) => { c.visible = true; });
        }
        if (this.supportHandGroup) {
          this.supportHandGroup.position.set(-0.12, 1.08, 0.40);
          this.supportHandGroup.rotation.set(-0.2, 0.3, 0);
        }
      }
    } else {
      // Badminton ready pose
      if (this.dominantArm === 'right') {
        // Right-handed: Racket in right hand (-X, screen-right), support hand in left (+X, screen-left)
        this.joints[PoseLandmark.LEFT_ELBOW].position.set(0.32, 1.18, 0.15);
        this.joints[PoseLandmark.LEFT_WRIST].position.set(0.24, 1.25, 0.32);

        this.joints[PoseLandmark.RIGHT_ELBOW].position.set(-0.36, 1.30, 0.18);
        this.joints[PoseLandmark.RIGHT_WRIST].position.set(-0.32, 1.48, 0.28);

        if (this.racketGroup) {
          this.racketGroup.position.set(-0.32, 1.48, 0.28);
          this.racketGroup.rotation.set(0.2, 0, 0);
          this.racketGroup.scale.set(1.0, 1.0, 1.0);
          this.racketGroup.visible = true;
          this.racketGroup.traverse(c => { c.visible = true; });
        }
        if (this.supportHandGroup) {
          this.supportHandGroup.position.set(0.24, 1.25, 0.32);
          this.supportHandGroup.rotation.set(-0.2, -0.2, 0);
        }
      } else {
        // Left-handed: Racket in left hand (+X, screen-left), support hand in right (-X, screen-right)
        this.joints[PoseLandmark.RIGHT_ELBOW].position.set(-0.32, 1.18, 0.15);
        this.joints[PoseLandmark.RIGHT_WRIST].position.set(-0.24, 1.25, 0.32);

        this.joints[PoseLandmark.LEFT_ELBOW].position.set(0.36, 1.30, 0.18);
        this.joints[PoseLandmark.LEFT_WRIST].position.set(0.32, 1.48, 0.28);

        if (this.racketGroup) {
          this.racketGroup.position.set(0.32, 1.48, 0.28);
          this.racketGroup.rotation.set(0.2, 0, 0);
          this.racketGroup.scale.set(1.0, 1.0, 1.0);
          this.racketGroup.visible = true;
          this.racketGroup.traverse(c => { c.visible = true; });
        }
        if (this.supportHandGroup) {
          this.supportHandGroup.position.set(-0.24, 1.25, 0.32);
          this.supportHandGroup.rotation.set(-0.2, 0.2, 0);
        }
      }
    }


    this.updateBones();
  }

  public setDominantArm(arm: 'right' | 'left'): void {
    this.dominantArm = arm;
    const currentSport = this.currentEquipment === 'tennis'
      ? 'tennis'
      : (this.currentEquipment === 'tabletennis' ? 'tabletennis' : 'badminton');
    this.applyDefaultPose(currentSport);
  }

  public getDominantWristWorldPosition(): THREE.Vector3 {
    const wristIdx = this.dominantArm === 'right' ? PoseLandmark.RIGHT_WRIST : PoseLandmark.LEFT_WRIST;
    const wrist = this.joints[wristIdx];
    const pos = new THREE.Vector3();
    wrist.getWorldPosition(pos);
    return pos;
  }

  public getRacketGroup(): THREE.Group | null {
    return this.racketGroup;
  }

  public lockRacketToWrist(): void {
    const wristIdx = this.dominantArm === 'right' ? PoseLandmark.RIGHT_WRIST : PoseLandmark.LEFT_WRIST;
    const wrist = this.joints[wristIdx];
    if (!wrist) return;

    if (this.currentEquipment === 'tennis' && this.tennisRacketGroup) {
      this.tennisRacketGroup.position.copy(wrist.position);
      this.tennisRacketGroup.scale.set(1.0, 1.0, 1.0);
      this.tennisRacketGroup.visible = true;
      if (this.tennisRacketMesh) this.tennisRacketMesh.visible = true;
      this.tennisRacketGroup.traverse((child) => { child.visible = true; });
      return;
    }

    if (!this.racketGroup) return;
    this.racketGroup.position.copy(wrist.position);
    this.racketGroup.scale.set(1.0, 1.0, 1.0);
    this.racketGroup.visible = true;
    if (this.racketMesh) this.racketMesh.visible = true;
    this.racketGroup.traverse((child) => { child.visible = true; });
  }

  /**
   * Dynamically pose avatar arms towards world targets (for mouse/keyboard or procedural reach)
   */
  public poseArmsToTargets(
    dominantWorldTarget: THREE.Vector3,
    supportWorldTarget?: THREE.Vector3,
    dominantArm: 'right' | 'left' = this.dominantArm,
    racketVelocity: THREE.Vector3 = Avatar3D.defaultVelocity
  ): void {
    const upVector = Avatar3D.scratchUpVector;

    // 1. Dominant arm reaching towards racket target
    const dShoulderIdx = dominantArm === 'right' ? PoseLandmark.RIGHT_SHOULDER : PoseLandmark.LEFT_SHOULDER;
    const dElbowIdx = dominantArm === 'right' ? PoseLandmark.RIGHT_ELBOW : PoseLandmark.LEFT_ELBOW;
    const dWristIdx = dominantArm === 'right' ? PoseLandmark.RIGHT_WRIST : PoseLandmark.LEFT_WRIST;

    const sShoulderIdx = dominantArm === 'right' ? PoseLandmark.LEFT_SHOULDER : PoseLandmark.RIGHT_SHOULDER;
    const sElbowIdx = dominantArm === 'right' ? PoseLandmark.LEFT_ELBOW : PoseLandmark.RIGHT_ELBOW;
    const sWristIdx = dominantArm === 'right' ? PoseLandmark.LEFT_WRIST : PoseLandmark.RIGHT_WRIST;

    // Reset base shoulder & head lateral anchors before applying dynamic reach lean
    this.joints[PoseLandmark.RIGHT_SHOULDER].position.x = -0.24;
    this.joints[PoseLandmark.LEFT_SHOULDER].position.x = 0.24;
    this.joints[PoseLandmark.LEFT_SHOULDER].position.y = 1.45;
    this.joints[PoseLandmark.RIGHT_SHOULDER].position.y = 1.45;
    this.headMesh.position.x = 0;
    this.headMesh.position.y = 1.75;
    this.joints[PoseLandmark.NOSE].position.x = 0;
    this.joints[PoseLandmark.NOSE].position.y = 1.75;

    const shoulderPos = this.joints[dShoulderIdx].position;
    const localTarget = Avatar3D.scratchLocalTarget.copy(dominantWorldTarget);
    this.group.worldToLocal(localTarget);

    // Dynamic Torso Lean & Lateral Reach Expansion
    const reachOffset = localTarget.x;
    if (Math.abs(reachOffset) > 0.40) {
      const spineRoll = THREE.MathUtils.clamp(reachOffset / 1.1, -0.32, 0.32);
      const shoulderShift = THREE.MathUtils.clamp((reachOffset - Math.sign(reachOffset) * 0.40) * 0.5, -0.35, 0.35);
      shoulderPos.x += shoulderShift;
      this.joints[sShoulderIdx].position.x += (dominantArm === 'right' ? -shoulderShift * 0.6 : shoulderShift * 0.6);
      this.joints[sShoulderIdx].position.y += Math.sin(spineRoll) * 0.24;
      this.joints[dShoulderIdx].position.y -= Math.sin(spineRoll) * 0.24;
      this.headMesh.position.x += shoulderShift * 0.7;
      this.joints[PoseLandmark.NOSE].position.x += shoulderShift * 0.7;
    }

    const armVector = Avatar3D.scratchArmVector.subVectors(localTarget, shoulderPos);
    const armLength = Math.min(1.05, Math.max(0.28, armVector.length()));
    const armDir = armVector.normalize();

    const wristPos = Avatar3D.scratchWristPos.copy(shoulderPos).addScaledVector(armDir, armLength);
    wristPos.y = Math.min(wristPos.y, 1.78);
    this.joints[dWristIdx].position.copy(wristPos);

    const sideOffset = dominantArm === 'right' ? -0.09 : 0.09;
    this.joints[dElbowIdx].position.copy(shoulderPos).add(wristPos).multiplyScalar(0.5);
    this.joints[dElbowIdx].position.x += sideOffset;
    this.joints[dElbowIdx].position.y -= 0.04;

    const elbowPos = this.joints[dElbowIdx].position;
    const forearmDir = Avatar3D.scratchForearmDir.subVectors(wristPos, elbowPos).normalize();

    if (this.racketGroup) {
      if (this.currentEquipment === 'badminton') {
        this.racketGroup.position.copy(wristPos);
        this.racketGroup.visible = true;
        this.racketGroup.scale.set(1.0, 1.0, 1.0);
        this.racketGroup.traverse((child) => { child.visible = true; });
        this.updateRacketTransform(wristPos, elbowPos, shoulderPos, racketVelocity);
      } else {
        this.racketGroup.visible = false;
        this.racketGroup.traverse((child) => { child.visible = false; });
      }
    }
    if (this.tennisRacketGroup) {
      if (this.currentEquipment === 'tennis') {
        this.tennisRacketGroup.position.copy(wristPos);
        this.tennisRacketGroup.visible = true;
        this.tennisRacketGroup.scale.set(1.0, 1.0, 1.0);
        this.tennisRacketGroup.traverse((child) => { child.visible = true; });
        this.updateTennisRacketTransform(wristPos, elbowPos, shoulderPos, racketVelocity);
      } else {
        this.tennisRacketGroup.visible = false;
        this.tennisRacketGroup.traverse((child) => { child.visible = false; });
      }
    }
    if (this.paddleGroup && this.currentEquipment === 'tabletennis') {
      this.paddleGroup.position.copy(wristPos);
      this.paddleGroup.visible = true;
      this.paddleGroup.rotation.set(-0.22, dominantArm === 'left' ? 0.15 : -0.15, 0);
    } else if (this.paddleGroup) {
      this.paddleGroup.visible = false;
    }

    // 2. Support arm (cradling/holding shuttlecock or athletic balance)
    if (supportWorldTarget) {
      const sShoulderPos = this.joints[sShoulderIdx].position;
      const localSTarget = Avatar3D.scratchLocalSTarget.copy(supportWorldTarget);
      this.group.worldToLocal(localSTarget);
      const sArmVector = Avatar3D.scratchSArmVector.subVectors(localSTarget, sShoulderPos);

      const isCrossBody = dominantArm === 'right' ? localSTarget.x < 0 : localSTarget.x > 0;
      const maxReach = isCrossBody ? 0.95 : 0.78;
      const sArmLength = Math.min(maxReach, Math.max(0.20, sArmVector.length()));
      const sArmDir = sArmVector.normalize();

      const sWristPos = Avatar3D.scratchSWristPos.copy(sShoulderPos).addScaledVector(sArmDir, sArmLength);
      if (isCrossBody) {
        if (dominantArm === 'right' && sWristPos.x < Math.max(localSTarget.x, -0.50)) {
          sWristPos.x = Math.max(localSTarget.x, -0.50);
        } else if (dominantArm === 'left' && sWristPos.x > Math.min(localSTarget.x, 0.50)) {
          sWristPos.x = Math.min(localSTarget.x, 0.50);
        }
      }
      this.joints[sWristIdx].position.copy(sWristPos);

      const sSideOffset = isCrossBody
        ? (dominantArm === 'right' ? THREE.MathUtils.lerp(0.04, -0.08, Math.min(1, -localSTarget.x / 0.50)) : THREE.MathUtils.lerp(-0.04, 0.08, Math.min(1, localSTarget.x / 0.50)))
        : (dominantArm === 'right' ? 0.07 : -0.07);
      this.joints[sElbowIdx].position.copy(sShoulderPos).add(sWristPos).multiplyScalar(0.5);
      this.joints[sElbowIdx].position.x += sSideOffset;
      this.joints[sElbowIdx].position.y -= 0.04;

      const sForearmDir = Avatar3D.scratchSForearmDir.subVectors(sWristPos, this.joints[sElbowIdx].position).normalize();
      if (this.supportHandGroup) {
        this.supportHandGroup.position.copy(sWristPos);
        Avatar3D.scratchQuat.setFromUnitVectors(upVector, sForearmDir);
        this.supportHandGroup.setRotationFromQuaternion(Avatar3D.scratchQuat);
      }
    }

    this.updateBones();
  }

  /**
   * Computes an authentic badminton racket transform from active arm kinematics.
   * Guarantees the handle is held at the wrist, the shaft extends upward and forward (+Z)
   * into the court, the racket head is ALWAYS in front of the handle, and the string bed faces the net.
   */
  public updateRacketTransform(
    wristPos: THREE.Vector3,
    elbowPos: THREE.Vector3,
    shoulderPos: THREE.Vector3,
    velocityVector: THREE.Vector3 = new THREE.Vector3(0, 0, 0)
  ): void {
    if (!this.racketGroup || this.currentEquipment !== 'badminton') return;

    this.racketGroup.position.copy(wristPos);
    this.racketGroup.visible = true;
    this.racketGroup.scale.set(1.0, 1.0, 1.0);
    if (this.racketMesh) this.racketMesh.visible = true;
    this.racketGroup.traverse((child) => { child.visible = true; });

    const forearmVec = new THREE.Vector3().subVectors(wristPos, elbowPos);
    const forearmDir = forearmVec.length() > 0.01
      ? forearmVec.clone().normalize()
      : new THREE.Vector3(0, 0.45, 0.89);

    // Stable shaft direction aligned with forearm + natural forward court angle
    const shaftDir = forearmDir.clone().lerp(new THREE.Vector3(0, 0.4, 0.9), 0.25).normalize();

    // Orthonormal basis with zero roll/fan spin
    const forwardRef = new THREE.Vector3(0, 0, 1);
    let lateralX = new THREE.Vector3().crossVectors(shaftDir, forwardRef);
    if (lateralX.lengthSq() < 0.001) {
      lateralX.set(1, 0, 0);
    } else {
      lateralX.normalize();
      if (lateralX.x < 0) lateralX.negate();
    }
    const normalZ = new THREE.Vector3().crossVectors(lateralX, shaftDir).normalize();
    if (normalZ.z < 0) normalZ.negate();

    const targetQuat = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(lateralX, shaftDir, normalZ)
    );
    this.racketGroup.quaternion.slerp(targetQuat, 0.65);
  }

  /**
   * Computes an authentic tennis racket transform from active arm kinematics.
   */
  public updateTennisRacketTransform(
    wristPos: THREE.Vector3,
    elbowPos: THREE.Vector3,
    shoulderPos: THREE.Vector3,
    velocityVector: THREE.Vector3 = new THREE.Vector3(0, 0, 0)
  ): void {
    if (!this.tennisRacketGroup || this.currentEquipment !== 'tennis') return;

    this.tennisRacketGroup.position.copy(wristPos);
    this.tennisRacketGroup.visible = true;
    this.tennisRacketGroup.scale.set(1.0, 1.0, 1.0);
    if (this.tennisRacketMesh) this.tennisRacketMesh.visible = true;
    this.tennisRacketGroup.traverse((child) => { child.visible = true; });

    const forearmVec = new THREE.Vector3().subVectors(wristPos, elbowPos);
    const forearmDir = forearmVec.length() > 0.01
      ? forearmVec.clone().normalize()
      : new THREE.Vector3(0, 0.45, 0.89);

    const shaftDir = forearmDir.clone().lerp(new THREE.Vector3(0, 0.35, 0.92), 0.28).normalize();

    const forwardRef = new THREE.Vector3(0, 0, 1);
    let lateralX = new THREE.Vector3().crossVectors(shaftDir, forwardRef);
    if (lateralX.lengthSq() < 0.001) {
      lateralX.set(1, 0, 0);
    } else {
      lateralX.normalize();
      if (lateralX.x < 0) lateralX.negate();
    }
    const normalZ = new THREE.Vector3().crossVectors(lateralX, shaftDir).normalize();
    if (normalZ.z < 0) normalZ.negate();

    const targetQuat = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(lateralX, shaftDir, normalZ)
    );
    this.tennisRacketGroup.quaternion.slerp(targetQuat, 0.65);
  }

  // Temporal debounce state for isFullBodyStanding (15 consecutive frames ~250ms)
  private static standingDebounced = true;
  private static standingCandidate = true;
  private static standingCandidateFrames = 0;

  // Frustum-Aware ProximityMode Baseline Calibration State
  private static baselineTorsoScale = 0;
  private static baselineScaleSamples = 0;

  public static resetStandingCalibration(): void {
    Avatar3D.baselineTorsoScale = 0;
    Avatar3D.baselineScaleSamples = 0;
  }

  /**
   * Validates if full-body standing pose is confident enough for footwork court mapping.
   * Features Frustum-Aware Posture Guard with ProximityMode:
   * When user steps forward into camera FOV (torso width > 1.25x baseline calibration),
   * knee/ankle occlusion does NOT trigger seated warnings if upper spine is vertical.
   */
  public static isFullBodyStanding(landmarks: Landmark3D[]): boolean {
    if (!landmarks || landmarks.length < 33) {
      return Avatar3D.updateStandingDebounce(false);
    }
    const leftHip = landmarks[PoseLandmark.LEFT_HIP];
    const rightHip = landmarks[PoseLandmark.RIGHT_HIP];
    const leftAnkle = landmarks[PoseLandmark.LEFT_ANKLE];
    const rightAnkle = landmarks[PoseLandmark.RIGHT_ANKLE];
    const leftKnee = landmarks[PoseLandmark.LEFT_KNEE];
    const rightKnee = landmarks[PoseLandmark.RIGHT_KNEE];
    const leftShoulder = landmarks[PoseLandmark.LEFT_SHOULDER];
    const rightShoulder = landmarks[PoseLandmark.RIGHT_SHOULDER];
    const nose = landmarks[PoseLandmark.NOSE];

    // Visibility gates
    const hipVis = ((leftHip?.visibility ?? 0) + (rightHip?.visibility ?? 0)) * 0.5;
    const shoulderVis = ((leftShoulder?.visibility ?? 0) + (rightShoulder?.visibility ?? 0)) * 0.5;

    // Torso scale measurement (inter-clavicle distance)
    let currentTorsoScale = 0;
    if (leftShoulder && rightShoulder) {
      currentTorsoScale = Math.hypot(rightShoulder.x - leftShoulder.x, rightShoulder.y - leftShoulder.y);
    }

    // 1. ProximityMode Posture Guard:
    // When the player steps forward and torso width > 1.25x baseline calibration
    const inProximityMode =
      Avatar3D.baselineTorsoScale > 0 &&
      currentTorsoScale > Avatar3D.baselineTorsoScale * 1.25;

    if (inProximityMode && shoulderVis >= 0.25) {
      // In ProximityMode, do not require knee or ankle visibility!
      // Evaluate upper spine verticality (NOSE to MID_HIP or MID_SHOULDER to MID_HIP)
      const midHipX = (leftHip.x + rightHip.x) * 0.5;
      const midHipY = (leftHip.y + rightHip.y) * 0.5;
      const refTopX = nose && (nose.visibility ?? 0) > 0.30 ? nose.x : (leftShoulder.x + rightShoulder.x) * 0.5;
      const refTopY = nose && (nose.visibility ?? 0) > 0.30 ? nose.y : (leftShoulder.y + rightShoulder.y) * 0.5;

      const spineDx = refTopX - midHipX;
      const spineDy = refTopY - midHipY; // In camera space, nose is above hips => refTopY < midHipY
      const spineAbsDy = Math.abs(spineDy);
      const isUprightSpine = spineAbsDy >= 0.20 && (Math.abs(spineDx) / Math.max(0.01, spineAbsDy)) < 0.70;

      // Vertical hip height relative to frame (hip should not have dropped into lower 12% of screen)
      const isHipElevated = midHipY <= 0.88;

      // Shoulder roll angle (should be athletic upright posture, not lying down)
      const rollAngle = Math.abs(Math.atan2(rightShoulder.y - leftShoulder.y, rightShoulder.x - leftShoulder.x));
      const isLevelShoulders = rollAngle < 0.65; // < ~37 degrees

      if (isUprightSpine && isHipElevated && isLevelShoulders) {
        // Player is visibly upright and stepping forward to take a ball on the rise!
        return Avatar3D.updateStandingDebounce(true);
      }
    }

    if (hipVis < 0.25) return Avatar3D.updateStandingDebounce(false);

    // Leg & Knee visibility check
    const leftKneeVis = leftKnee?.visibility ?? 0;
    const rightKneeVis = rightKnee?.visibility ?? 0;
    const leftAnkleVis = leftAnkle?.visibility ?? 0;
    const rightAnkleVis = rightAnkle?.visibility ?? 0;

    const hasKneesVisible = leftKneeVis >= 0.30 || rightKneeVis >= 0.30;
    if (!hasKneesVisible) {
      // Framing check: user is standing close to camera, knees cut off!
      if (shoulderVis >= 0.25 && hipVis >= 0.25 && leftShoulder && rightShoulder) {
        const shoulderY = (leftShoulder.y + rightShoulder.y) * 0.5;
        const hipY = (leftHip.y + rightHip.y) * 0.5;
        const torsoHeight = Math.abs(hipY - shoulderY);
        const shoulderZ = ((leftShoulder.z ?? 0) + (rightShoulder.z ?? 0)) * 0.5;
        const hipZ = ((leftHip.z ?? 0) + (rightHip.z ?? 0)) * 0.5;
        const torsoDz = Math.abs(hipZ - shoulderZ);

        if (torsoHeight >= 0.28 && torsoDz < 0.38) {
          return Avatar3D.updateStandingDebounce(true);
        }
      }
      return Avatar3D.updateStandingDebounce(false);
    }

    // Vertical femur drop calculation:
    const leftDrop = Math.max(leftKnee.y - leftHip.y, leftHip.y - leftKnee.y, Math.abs(leftHip.y - leftKnee.y));
    const rightDrop = Math.max(rightKnee.y - rightHip.y, rightHip.y - rightKnee.y, Math.abs(rightHip.y - rightKnee.y));
    const verticalDrop = Math.max(leftDrop, rightDrop);

    const calcKneeAngle = (hip: Landmark3D, knee: Landmark3D, ankle: Landmark3D): number => {
      const ax = hip.x - knee.x;
      const ay = hip.y - knee.y;
      const az = (hip.z ?? 0) - (knee.z ?? 0);

      const bx = ankle.x - knee.x;
      const by = ankle.y - knee.y;
      const bz = (ankle.z ?? 0) - (knee.z ?? 0);

      const dot = ax * bx + ay * by + az * bz;
      const lenA = Math.hypot(ax, ay, az);
      const lenB = Math.hypot(bx, by, bz);
      if (lenA < 1e-4 || lenB < 1e-4) return 180;
      const cosAngle = Math.max(-1, Math.min(1, dot / (lenA * lenB)));
      return (Math.acos(cosAngle) * 180) / Math.PI;
    };

    // If verticalDrop >= 0.20m, the player is standing upright
    if (verticalDrop >= 0.20) {
      let rawStanding = true;
      if (leftShoulder && rightShoulder) {
        const shoulderSpan = Math.abs(rightShoulder.x - leftShoulder.x);
        if (shoulderSpan > 0.70) rawStanding = false;
      }

      // Update baseline standing torso scale calibration while standing in full view
      if (rawStanding && currentTorsoScale > 0.08) {
        if (Avatar3D.baselineScaleSamples < 30) {
          Avatar3D.baselineTorsoScale = Avatar3D.baselineScaleSamples === 0
            ? currentTorsoScale
            : Avatar3D.baselineTorsoScale * 0.9 + currentTorsoScale * 0.1;
          Avatar3D.baselineScaleSamples++;
        } else if (currentTorsoScale < Avatar3D.baselineTorsoScale * 1.15) {
          Avatar3D.baselineTorsoScale = Avatar3D.baselineTorsoScale * 0.995 + currentTorsoScale * 0.005;
        }
      }

      return Avatar3D.updateStandingDebounce(rawStanding);
    }

    // Only flag sitting if verticalDrop < 0.16m AND both knee angles are < 105°
    if (verticalDrop < 0.16) {
      if (leftKneeVis >= 0.30 && rightKneeVis >= 0.30 && leftAnkleVis >= 0.25 && rightAnkleVis >= 0.25) {
        const leftAngle = calcKneeAngle(leftHip, leftKnee, leftAnkle);
        const rightAngle = calcKneeAngle(rightHip, rightKnee, rightAnkle);
        if (leftAngle < 105 && rightAngle < 105) {
          return Avatar3D.updateStandingDebounce(false);
        }
      } else {
        return Avatar3D.updateStandingDebounce(false);
      }
    }

    return Avatar3D.updateStandingDebounce(true);
  }

  /**
   * Temporal debouncing: requires 15 consecutive frames (~250ms) of consistent state change
   * before flipping isStanding to prevent single-frame flickers.
   */
  private static updateStandingDebounce(rawStanding: boolean): boolean {
    if (rawStanding === Avatar3D.standingDebounced) {
      Avatar3D.standingCandidate = rawStanding;
      Avatar3D.standingCandidateFrames = 0;
    } else {
      if (rawStanding === Avatar3D.standingCandidate) {
        Avatar3D.standingCandidateFrames++;
        if (Avatar3D.standingCandidateFrames >= 15) {
          Avatar3D.standingDebounced = rawStanding;
          Avatar3D.standingCandidateFrames = 0;
        }
      } else {
        Avatar3D.standingCandidate = rawStanding;
        Avatar3D.standingCandidateFrames = 1;
      }
    }
    return Avatar3D.standingDebounced;
  }

  public static resetStandingDebounce(initialState = true): void {
    Avatar3D.standingDebounced = initialState;
    Avatar3D.standingCandidate = initialState;
    Avatar3D.standingCandidateFrames = 0;
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
      if (this.tennisRacketGroup) this.tennisRacketGroup.visible = true;
      this.supportHandGroup.visible = true;
    }

    if (this.humanoidGroup) {
      if (enabled) {
        if (this.chestMesh?.parent) this.chestMesh.parent.visible = false;
        if (this.coreMesh) this.coreMesh.visible = false;
        if (this.pelvisMesh) this.pelvisMesh.visible = false;
        if (this.neckMesh) this.neckMesh.visible = false;
        if (this.humanoidHeadGroup) this.humanoidHeadGroup.visible = false;
        if (this.leftThighMesh) this.leftThighMesh.visible = false;
        if (this.rightThighMesh) this.rightThighMesh.visible = false;
        if (this.leftKneeCap) this.leftKneeCap.visible = false;
        if (this.rightKneeCap) this.rightKneeCap.visible = false;
        if (this.leftCalfMesh) this.leftCalfMesh.visible = false;
        if (this.rightCalfMesh) this.rightCalfMesh.visible = false;
        if (this.leftShoeGroup) this.leftShoeGroup.visible = false;
        if (this.rightShoeGroup) this.rightShoeGroup.visible = false;
        if (this.leftUpperArmMesh) this.leftUpperArmMesh.visible = true;
        if (this.rightUpperArmMesh) this.rightUpperArmMesh.visible = true;
        if (this.leftForearmMesh) this.leftForearmMesh.visible = true;
        if (this.rightForearmMesh) this.rightForearmMesh.visible = true;
        if (this.leftShoulderCap) this.leftShoulderCap.visible = true;
        if (this.rightShoulderCap) this.rightShoulderCap.visible = true;
      } else {
        const isHumanoid = this.avatarStyle === 'humanoid';
        this.humanoidGroup.traverse((c) => { c.visible = isHumanoid; });
      }
    }
  }

  /**
   * Procedural IK swing animation for athletic strokes (smash, drive, clear)
   */
  /**
   * Poses arm into a clear, visually telegraphed backswing windup pose
   * Pulls the racket back by -0.35m to -0.42m behind the body
   */
  public playBackswingPose(
    progress: number, // 0 to 1
    dominantArm: 'right' | 'left' = 'right',
    isSmash = false
  ): void {
    const dShoulderIdx = dominantArm === 'right' ? PoseLandmark.RIGHT_SHOULDER : PoseLandmark.LEFT_SHOULDER;
    const shoulderPos = this.joints[dShoulderIdx].position.clone();
    this.group.localToWorld(shoulderPos);

    // Ready stance position (slightly in front of chest)
    const readyLocal = new THREE.Vector3(
      dominantArm === 'right' ? -0.22 : 0.22,
      0.15,
      0.10
    );
    const readyPos = shoulderPos.clone().add(readyLocal.applyQuaternion(this.group.quaternion));

    // Deep backswing windup: arm pulled back and high (avatar local -Z is behind avatar)
    const windupLocal = new THREE.Vector3(
      dominantArm === 'right' ? -0.36 : 0.36,
      isSmash ? 0.58 : 0.32,
      -0.42 // -0.42m behind avatar torso
    );
    const windupPos = shoulderPos.clone().add(windupLocal.applyQuaternion(this.group.quaternion));

    const easedT = THREE.MathUtils.smoothstep(progress, 0, 1);
    const currentTarget = new THREE.Vector3().lerpVectors(readyPos, windupPos, easedT);
    this.poseArmsToTargets(currentTarget, undefined, dominantArm);
  }

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
    if (progress < 0.30) {
      // Wind-up: pull arm back and up (avatar local -Z is behind avatar)
      const windupLocal = new THREE.Vector3(
        dominantArm === 'right' ? -0.32 : 0.32,
        isSmash ? 0.55 : 0.25,
        -0.38
      );
      const windupPos = shoulderPos.clone().add(windupLocal.applyQuaternion(this.group.quaternion));
      strikeTarget = windupPos;
    } else if (progress < 0.60) {
      // Strike phase: whip racket head forward into ball target
      const t = (progress - 0.30) / 0.30;
      const windupLocal = new THREE.Vector3(
        dominantArm === 'right' ? -0.32 : 0.32,
        isSmash ? 0.55 : 0.25,
        -0.38
      );
      const windupPos = shoulderPos.clone().add(windupLocal.applyQuaternion(this.group.quaternion));
      strikeTarget = new THREE.Vector3().lerpVectors(windupPos, targetWorld, t);
    } else {
      // Follow-through: sweep across body forward into court (avatar local +Z is forward)
      const t = (progress - 0.60) / 0.40;
      const followLocal = new THREE.Vector3(
        dominantArm === 'right' ? 0.28 : -0.28,
        -0.22,
        0.38
      );
      const followPos = shoulderPos.clone().add(followLocal.applyQuaternion(this.group.quaternion));
      strikeTarget = new THREE.Vector3().lerpVectors(targetWorld, followPos, t);
    }

    this.poseArmsToTargets(strikeTarget, undefined, dominantArm);
  }

  /**
   * Update bone cylinders to match current joint positions
   */
  protected updateBones(): void {
    if (this.avatarStyle === 'cyber_skeleton') {
      const upVector = Avatar3D.scratchUpVector;
      for (let b = 0; b < SKELETON_CONNECTIONS.length; b++) {
        const [i1, i2] = SKELETON_CONNECTIONS[b];
        const p1 = this.joints[i1].position;
        const p2 = this.joints[i2].position;

        const bone = this.bones[b];
        const dist = p1.distanceTo(p2);
        // Overlap cylinder ends slightly into joint sphere centers (R=0.045m) to eliminate air gaps
        bone.scale.set(1, Math.max(0.001, dist + 0.035), 1);

        // Position bone at midpoint
        bone.position.copy(p1).add(p2).multiplyScalar(0.5);

        // Rotate bone to look from p1 to p2
        const direction = Avatar3D.scratchDir.subVectors(p2, p1).normalize();
        const quaternion = Avatar3D.scratchQuat.setFromUnitVectors(upVector, direction);
        bone.setRotationFromQuaternion(quaternion);
      }
    }
    if (this.humanoidGroup && this.humanoidGroup.visible) {
      this.updateHumanoidMesh();
    }
  }

  /**
   * Update 3D avatar joint and bone positions from tracked world landmarks
   */
  public update(
    landmarks: Landmark3D[],
    dominantArm: 'right' | 'left' = this.dominantArm,
    frameDt = 1 / 60
  ): void {
    if (!landmarks || landmarks.length < 33) return;
    this.dominantArm = dominantArm;

    // Map MediaPipe world landmarks to Three.js coordinate system (Right is +X, Up is +Y, Forward is +Z)
    const toThree = (lm: Landmark3D): THREE.Vector3 => {
      return new THREE.Vector3(lm.x, -lm.y, lm.z);
    };

    // Keep equipment roles tied to landmark identity, never screen position.
    const trackJoint = (current: THREE.Vector3, target: THREE.Vector3): void => {
      if (current.distanceTo(target) > 0.60) {
        current.copy(target);
        return;
      }

      const alpha = Math.min(1.0, 1.0 - Math.exp(-36.0 * Math.min(frameDt, 0.1)));
      current.lerp(target, alpha);
    };

    // 1. Procedural Athletic Dynamic Base (Footwork, Split-Step & Lunge Weight Transfer)
    this.footworkTimer += frameDt;
    const isMoving = this.footworkVel.length() > 0.25;
    const isSplit = this.footworkIsSplitStep;
    const isLungeRight = this.footworkLungeDir === 'right' || this.footworkVel.x > 0.8;
    const isLungeLeft = this.footworkLungeDir === 'left' || this.footworkVel.x < -0.8;

    // Ready idle bounce (balls of feet, breathing ready posture)
    const idleBounceY = isMoving ? 0 : Math.sin(this.footworkTimer * 4.5) * 0.015;

    // Weight shift and knee drop calculations
    let hipShiftX = 0;
    let hipHeight = 0.95 + idleBounceY;
    let leftKneeY = 0.45 + idleBounceY;
    let rightKneeY = 0.45 + idleBounceY;
    let leftFootX = 0.22;
    let rightFootX = -0.22;
    let leftFootZ = -0.02;
    let rightFootZ = -0.02;
    let leftFootY = 0.08;
    let rightFootY = 0.08;

    if (isSplit) {
      // Split-step: wide athletic base, knees bent, hips lowered
      leftFootX = 0.32;
      rightFootX = -0.32;
      hipHeight = 0.88;
      leftKneeY = 0.38;
      rightKneeY = 0.38;
      leftFootZ = 0.04;
      rightFootZ = 0.04;
    } else if (isLungeRight) {
      // Right lateral reach / lunge: weight onto right leg (Avatar local -X is right)
      hipShiftX = -0.08;
      hipHeight = 0.89;
      rightFootX = -0.36;
      rightKneeY = 0.38;
      leftKneeY = 0.48;
      leftFootY = 0.10; // push-off heel raised
      rightFootZ = 0.08;
    } else if (isLungeLeft) {
      // Left lateral reach / lunge: weight onto left leg (Avatar local +X is left)
      hipShiftX = 0.08;
      hipHeight = 0.89;
      leftFootX = 0.36;
      leftKneeY = 0.38;
      rightKneeY = 0.48;
      rightFootY = 0.10; // push-off heel raised
      leftFootZ = 0.08;
    } else if (this.footworkVel.z > 0.4) {
      // Forward run / advance stride
      const strideCycle = Math.sin(this.footworkTimer * 8.0);
      leftFootZ = strideCycle * 0.14;
      rightFootZ = -strideCycle * 0.14;
      leftFootY = 0.08 + Math.max(0, strideCycle * 0.06);
      rightFootY = 0.08 + Math.max(0, -strideCycle * 0.06);
    } else if (this.footworkVel.z < -0.4) {
      // Backward back-pedal stride
      const strideCycle = Math.sin(this.footworkTimer * 8.0);
      leftFootZ = -strideCycle * 0.12;
      rightFootZ = strideCycle * 0.12;
      leftFootY = 0.08 + Math.max(0, -strideCycle * 0.05);
      rightFootY = 0.08 + Math.max(0, strideCycle * 0.05);
    }

    this.joints[PoseLandmark.LEFT_HIP].position.set(0.16 + hipShiftX, hipHeight, 0);
    this.joints[PoseLandmark.RIGHT_HIP].position.set(-0.16 + hipShiftX, hipHeight, 0);
    this.joints[PoseLandmark.LEFT_KNEE].position.set(leftFootX * 0.85 + hipShiftX * 0.5, leftKneeY, leftFootZ + 0.06);
    this.joints[PoseLandmark.RIGHT_KNEE].position.set(rightFootX * 0.85 + hipShiftX * 0.5, rightKneeY, rightFootZ + 0.06);
    this.joints[PoseLandmark.LEFT_ANKLE].position.set(leftFootX, leftFootY, leftFootZ);
    this.joints[PoseLandmark.RIGHT_ANKLE].position.set(rightFootX, rightFootY, rightFootZ);
    this.joints[PoseLandmark.LEFT_HEEL].position.set(leftFootX, leftFootY * 0.5, leftFootZ - 0.05);
    this.joints[PoseLandmark.RIGHT_HEEL].position.set(rightFootX, rightFootY * 0.5, rightFootZ - 0.05);
    this.joints[PoseLandmark.LEFT_FOOT_INDEX].position.set(leftFootX, 0.00, leftFootZ + 0.12);
    this.joints[PoseLandmark.RIGHT_FOOT_INDEX].position.set(rightFootX, 0.00, rightFootZ + 0.12);

    // 2. Drive Only Upper Body with Webcam:
    // (1) Lateral spine tilt / torso lean from shoulder angle
    const rawLeftSh = landmarks[PoseLandmark.LEFT_SHOULDER];
    const rawRightSh = landmarks[PoseLandmark.RIGHT_SHOULDER];
    let clampedRoll = 0;
    let spineLeanX = 0;

    if (rawLeftSh && rawRightSh) {
      const pL = toThree(rawLeftSh);
      const pR = toThree(rawRightSh);
      const rollAngle = Math.atan2(pL.y - pR.y, pL.x - pR.x);
      clampedRoll = THREE.MathUtils.clamp(rollAngle, -0.35, 0.35); // ±20 degrees torso roll
      spineLeanX = Math.sin(clampedRoll) * 0.20;
    }

    const baseShoulderY = 1.45;
    const leftShoulderTarget = new THREE.Vector3(
      0.24 * Math.cos(clampedRoll) + spineLeanX,
      baseShoulderY + 0.24 * Math.sin(clampedRoll),
      0
    );
    const rightShoulderTarget = new THREE.Vector3(
      -0.24 * Math.cos(clampedRoll) + spineLeanX,
      baseShoulderY - 0.24 * Math.sin(clampedRoll),
      0
    );
    trackJoint(this.joints[PoseLandmark.LEFT_SHOULDER].position, leftShoulderTarget);
    trackJoint(this.joints[PoseLandmark.RIGHT_SHOULDER].position, rightShoulderTarget);

    // Head / Nose positioned at Y = 1.75m
    const headTarget = new THREE.Vector3(spineLeanX * 1.25, 1.75, 0.08);
    trackJoint(this.joints[PoseLandmark.NOSE].position, headTarget);
    this.headMesh.position.copy(this.joints[PoseLandmark.NOSE].position);

    // Head/Face landmarks (1 to 10) relative to head
    for (let i = 1; i <= 10; i++) {
      if (landmarks[i] && landmarks[PoseLandmark.NOSE]) {
        const rel = toThree(landmarks[i]).sub(toThree(landmarks[PoseLandmark.NOSE]));
        this.joints[i].position.copy(this.joints[PoseLandmark.NOSE].position).add(rel);
      }
    }

    // (2) Arm IK: Shoulder -> Elbow -> Wrist -> Racket Head
    // Dominant Right Arm (screen-right / -X):
    const rawRElbow = landmarks[PoseLandmark.RIGHT_ELBOW];
    const rawRWrist = landmarks[PoseLandmark.RIGHT_WRIST];
    if (rawRElbow && rawRightSh) {
      const relUpper = toThree(rawRElbow).sub(toThree(rawRightSh));
      const upperLen = THREE.MathUtils.clamp(relUpper.length(), 0.18, 0.35);
      const upperDir = relUpper.length() > 0.01 ? relUpper.normalize() : new THREE.Vector3(-0.3, -0.9, 0.1).normalize();
      const targetElbow = this.joints[PoseLandmark.RIGHT_SHOULDER].position.clone().addScaledVector(upperDir, upperLen);
      trackJoint(this.joints[PoseLandmark.RIGHT_ELBOW].position, targetElbow);

      if (rawRWrist) {
        const relForearm = toThree(rawRWrist).sub(toThree(rawRElbow));
        const forearmLen = THREE.MathUtils.clamp(relForearm.length(), 0.18, 0.35);
        const forearmDir = relForearm.length() > 0.01 ? relForearm.normalize() : new THREE.Vector3(-0.2, 0.8, 0.5).normalize();
        const targetWrist = this.joints[PoseLandmark.RIGHT_ELBOW].position.clone().addScaledVector(forearmDir, forearmLen);

        trackJoint(this.joints[PoseLandmark.RIGHT_WRIST].position, targetWrist);
        this.lastRightWrist.copy(this.joints[PoseLandmark.RIGHT_WRIST].position);
        this.hasRightWrist = true;
      }
    }

    // Support Left Arm (screen-left / +X):
    const rawLElbow = landmarks[PoseLandmark.LEFT_ELBOW];
    const rawLWrist = landmarks[PoseLandmark.LEFT_WRIST];
    if (rawLElbow && rawLeftSh) {
      const relUpper = toThree(rawLElbow).sub(toThree(rawLeftSh));
      const upperLen = THREE.MathUtils.clamp(relUpper.length(), 0.18, 0.35);
      const upperDir = relUpper.length() > 0.01 ? relUpper.normalize() : new THREE.Vector3(0.3, -0.9, 0.1).normalize();
      const targetElbow = this.joints[PoseLandmark.LEFT_SHOULDER].position.clone().addScaledVector(upperDir, upperLen);
      trackJoint(this.joints[PoseLandmark.LEFT_ELBOW].position, targetElbow);

      if (rawLWrist) {
        const relForearm = toThree(rawLWrist).sub(toThree(rawLElbow));
        const forearmLen = THREE.MathUtils.clamp(relForearm.length(), 0.18, 0.35);
        const forearmDir = relForearm.length() > 0.01 ? relForearm.normalize() : new THREE.Vector3(0.2, 0.8, 0.5).normalize();
        const targetWrist = this.joints[PoseLandmark.LEFT_ELBOW].position.clone().addScaledVector(forearmDir, forearmLen);

        trackJoint(this.joints[PoseLandmark.LEFT_WRIST].position, targetWrist);
        this.lastLeftWrist.copy(this.joints[PoseLandmark.LEFT_WRIST].position);
        this.hasLeftWrist = true;
      }
    }

    // Fingers/hands relative to wrists
    for (const idx of [PoseLandmark.RIGHT_PINKY, PoseLandmark.RIGHT_INDEX, PoseLandmark.RIGHT_THUMB]) {
      if (landmarks[idx] && rawRWrist) {
        const rel = toThree(landmarks[idx]).sub(toThree(rawRWrist));
        this.joints[idx].position.copy(this.joints[PoseLandmark.RIGHT_WRIST].position).add(rel);
      }
    }
    for (const idx of [PoseLandmark.LEFT_PINKY, PoseLandmark.LEFT_INDEX, PoseLandmark.LEFT_THUMB]) {
      if (landmarks[idx] && rawLWrist) {
        const rel = toThree(landmarks[idx]).sub(toThree(rawLWrist));
        this.joints[idx].position.copy(this.joints[PoseLandmark.LEFT_WRIST].position).add(rel);
      }
    }

    // (3) Forward/backward footwork range from torso width scale
    if (rawLeftSh && rawRightSh) {
      const dShoulder = Math.hypot(rawLeftSh.x - rawRightSh.x, rawLeftSh.y - rawRightSh.y);
      const dBase = 0.18;
      if (dShoulder > dBase) {
        const forwardRatio = THREE.MathUtils.clamp((dShoulder - dBase) / 0.14, 0.0, 1.0);
        this.trackedForwardZ = forwardRatio * 1.8;
      } else {
        this.trackedForwardZ = 0;
      }
    }

    // Position and orient bones
    this.updateBones();

    // Position equipment on active wrist
    const wristIdx = dominantArm === 'right' ? PoseLandmark.RIGHT_WRIST : PoseLandmark.LEFT_WRIST;
    const elbowIdx = dominantArm === 'right' ? PoseLandmark.RIGHT_ELBOW : PoseLandmark.LEFT_ELBOW;
    const shoulderIdx = dominantArm === 'right' ? PoseLandmark.RIGHT_SHOULDER : PoseLandmark.LEFT_SHOULDER;

    const wristPos = this.joints[wristIdx].position;
    const elbowPos = this.joints[elbowIdx].position;
    const shoulderPos = this.joints[shoulderIdx].position;

    // Dynamic Torso Lean & Lateral Reach Expansion for webcam tracking
    if (Math.abs(wristPos.x) > 0.40) {
      const shoulderShift = THREE.MathUtils.clamp((wristPos.x - Math.sign(wristPos.x) * 0.40) * 0.45, -0.35, 0.35);
      shoulderPos.x += shoulderShift;
    }

    const forearmDir = new THREE.Vector3().subVectors(wristPos, elbowPos).normalize();
    const upVector = new THREE.Vector3(0, 1, 0);

    if (this.racketGroup) {
      if (this.currentEquipment === 'badminton') {
        this.racketGroup.position.copy(wristPos);
        this.racketGroup.visible = true;
        this.racketGroup.scale.set(1.0, 1.0, 1.0);
        this.racketGroup.traverse((child) => { child.visible = true; });
        this.updateRacketTransform(wristPos, elbowPos, shoulderPos, this.smoothedRacketVel);
      } else {
        this.racketGroup.visible = false;
        this.racketGroup.traverse((child) => { child.visible = false; });
      }
    }

    if (this.tennisRacketGroup) {
      if (this.currentEquipment === 'tennis') {
        this.tennisRacketGroup.position.copy(wristPos);
        this.tennisRacketGroup.visible = true;
        this.tennisRacketGroup.scale.set(1.0, 1.0, 1.0);
        this.tennisRacketGroup.traverse((child) => { child.visible = true; });
        this.updateTennisRacketTransform(wristPos, elbowPos, shoulderPos, this.smoothedRacketVel);
      } else {
        this.tennisRacketGroup.visible = false;
        this.tennisRacketGroup.traverse((child) => { child.visible = false; });
      }
    }

    if (this.paddleGroup) {
      if (this.currentEquipment === 'tabletennis') {
        this.paddleGroup.position.copy(wristPos);
        this.paddleGroup.visible = true;
        this.paddleGroup.rotation.set(-0.22, dominantArm === 'left' ? 0.15 : -0.15, 0);
      } else {
        this.paddleGroup.visible = false;
      }
    }

    // Position support / non-dominant hand
    const supportWristIdx = dominantArm === 'right' ? PoseLandmark.LEFT_WRIST : PoseLandmark.RIGHT_WRIST;
    const supportElbowIdx = dominantArm === 'right' ? PoseLandmark.LEFT_ELBOW : PoseLandmark.RIGHT_ELBOW;
    const sWristPos = this.joints[supportWristIdx].position;
    const sElbowPos = this.joints[supportElbowIdx].position;
    const sForearmDir = new THREE.Vector3().subVectors(sWristPos, sElbowPos).normalize();
    this.supportHandGroup.position.copy(sWristPos);
    this.supportHandGroup.setRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(upVector, sForearmDir));

    // Smoothly decay racket frame pulse
    if (this.racketFrameMat && this.racketFrameMat.emissiveIntensity > 0.7) {
      this.racketFrameMat.emissiveIntensity = THREE.MathUtils.lerp(this.racketFrameMat.emissiveIntensity, 0.7, 0.08);
    }
    if (this.tennisRacketFrameMat && this.tennisRacketFrameMat.emissiveIntensity > 0.7) {
      this.tennisRacketFrameMat.emissiveIntensity = THREE.MathUtils.lerp(this.tennisRacketFrameMat.emissiveIntensity, 0.7, 0.08);
    }

    // Exponential Moving Average (EMA) smoothing on wrist and racket velocities
    const currentDominantWristPos = this.joints[wristIdx].position.clone();
    const currentRacketWorldPos = this.getRacketWorldPosition();

    if (!this.isVelocitiesInitialized) {
      this.prevRightWristPos.copy(currentDominantWristPos);
      this.prevRacketWorldPos.copy(currentRacketWorldPos);
      this.isVelocitiesInitialized = true;
    } else {
      const safeDt = Math.max(0.008, frameDt);
      const rawWristVel = currentDominantWristPos.clone().sub(this.prevRightWristPos).divideScalar(safeDt);
      const rawRacketVel = currentRacketWorldPos.clone().sub(this.prevRacketWorldPos).divideScalar(safeDt);

      // Deadzone: only filter micro-movements when total velocity is below < 0.15 m/s (~0.54 km/h)
      if (rawWristVel.length() < 0.15) rawWristVel.set(0, 0, 0);
      if (rawRacketVel.length() < 0.15) rawRacketVel.set(0, 0, 0);

      // EMA smoothing alpha = 0.45 (responsive to natural strokes/flicks)
      this.smoothedRightWristVel.lerp(rawWristVel, 0.45);
      this.smoothedRacketVel.lerp(rawRacketVel, 0.45);

      this.prevRightWristPos.copy(currentDominantWristPos);
      this.prevRacketWorldPos.copy(currentRacketWorldPos);
    }
  }

  public getSmoothedRightWristVelocity(): THREE.Vector3 {
    return this.smoothedRightWristVel.clone();
  }

  public getSmoothedDominantWristVelocity(): THREE.Vector3 {
    return this.smoothedRightWristVel.clone();
  }

  public getSmoothedRacketVelocity(): THREE.Vector3 {
    return this.smoothedRacketVel.clone();
  }

  public resetVelocities(): void {
    this.smoothedRightWristVel.set(0, 0, 0);
    this.smoothedRacketVel.set(0, 0, 0);
    this.hasPrevRightWristPos = false;
    this.hasPrevRacketPos = false;
  }

  public getHandWorldPosition(hand: 'left' | 'right'): THREE.Vector3 {
    const index = hand === 'left' ? PoseLandmark.LEFT_WRIST : PoseLandmark.RIGHT_WRIST;
    return this.group.localToWorld(this.joints[index].position.clone());
  }

  public getShoulderWorldPosition(arm: 'left' | 'right' = this.dominantArm): THREE.Vector3 {
    const index = arm === 'left' ? PoseLandmark.LEFT_SHOULDER : PoseLandmark.RIGHT_SHOULDER;
    const pos = this.joints[index].position.clone();
    this.group.localToWorld(pos);
    return pos;
  }

  public getHipWorldPosition(side: 'left' | 'right' | 'center' = 'center'): THREE.Vector3 {
    if (side === 'center') {
      const left = this.joints[PoseLandmark.LEFT_HIP].position;
      const right = this.joints[PoseLandmark.RIGHT_HIP].position;
      const center = new THREE.Vector3().addVectors(left, right).multiplyScalar(0.5);
      this.group.localToWorld(center);
      return center;
    }
    const idx = side === 'left' ? PoseLandmark.LEFT_HIP : PoseLandmark.RIGHT_HIP;
    const pos = this.joints[idx].position.clone();
    this.group.localToWorld(pos);
    return pos;
  }

  public pulseImpact(type: 'smash' | 'hit' | 'serve' = 'hit'): void {
    const intensity = type === 'smash' ? 3.2 : (type === 'serve' ? 2.4 : 2.0);
    if (this.racketFrameMat) {
      this.racketFrameMat.emissiveIntensity = intensity;
    }
    if (this.tennisRacketFrameMat) {
      this.tennisRacketFrameMat.emissiveIntensity = intensity;
    }
  }

  public getNonDominantHandWorldPosition(dominantArm: 'right' | 'left' = this.dominantArm): THREE.Vector3 {
    const idx = dominantArm === 'right' ? PoseLandmark.LEFT_WRIST : PoseLandmark.RIGHT_WRIST;
    const pos = this.joints[idx].position.clone();
    this.group.localToWorld(pos);
    return pos;
  }

  public getSupportHandWorldPosition(): THREE.Vector3 {
    return this.getNonDominantHandWorldPosition(this.dominantArm);
  }

  public getPaddleWorldPosition(): THREE.Vector3 {
    if (this.paddleGroup && (this.paddleGroup.visible || this.currentEquipment === 'tabletennis')) {
      const pos = new THREE.Vector3();
      this.paddleGroup.getWorldPosition(pos);
      const bladeOffset = new THREE.Vector3(0, -0.10, 0.05);
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
    if (this.currentEquipment === 'tennis' && this.tennisRacketGroup) {
      this.tennisRacketGroup.visible = true;
      this.tennisRacketGroup.scale.set(1.0, 1.0, 1.0);
      const pos = new THREE.Vector3();
      this.tennisRacketGroup.getWorldPosition(pos);
      const headOffsetY = 0.58 * (this.tennisRacketGroup.scale.y || 1);
      const headOffset = new THREE.Vector3(0, headOffsetY, 0);
      const quat = new THREE.Quaternion();
      this.tennisRacketGroup.getWorldQuaternion(quat);
      headOffset.applyQuaternion(quat);
      pos.add(headOffset);
      return pos;
    }
    if (this.racketGroup) {
      this.racketGroup.visible = true;
      this.racketGroup.scale.set(1.0, 1.0, 1.0);
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

  public keepRacketInViewport(_camera: THREE.PerspectiveCamera, _maxNdcY = 0.85, _minNdcY = -0.85): void {
    if (!this.racketGroup && !this.tennisRacketGroup) return;
    this.lockRacketToWrist();
  }

  public getRacketStringNormal(): THREE.Vector3 {
    const activeGroup = (this.currentEquipment === 'tennis') ? this.tennisRacketGroup : this.racketGroup;
    if (activeGroup && activeGroup.visible) {
      const normal = new THREE.Vector3(0, 0, 1);
      const quat = new THREE.Quaternion();
      activeGroup.getWorldQuaternion(quat);
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
    const activeGroup = (this.currentEquipment === 'tennis') ? this.tennisRacketGroup : this.racketGroup;
    if (!activeGroup || !activeGroup.visible) {
      return { hit: false, impactPoint: ballPos.clone(), normal: new THREE.Vector3(0, 0, 1), distanceToCenter: 999 };
    }

    const headCenter = this.getRacketWorldPosition();
    const normal = this.getRacketStringNormal();
    const baseRadius = (this.currentEquipment === 'tennis') ? 0.18 : 0.22;
    const headRadius = baseRadius * (activeGroup.scale.x || 1.0);
    const halfThickness = (this.currentEquipment === 'tennis') ? 0.12 : 0.10;

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

  public getTrackedForwardZ(): number {
    return this.trackedForwardZ;
  }

  public flashStringBedWhite(durationSec = 0.06): void {
    if (this.currentEquipment === 'tennis' && this.tennisRacketStringMat) {
      this.tennisRacketStringMat.color.setHex(0xffffff);
      this.tennisRacketStringMat.opacity = 1.0;
      setTimeout(() => {
        if (this.tennisRacketStringMat) {
          this.tennisRacketStringMat.color.setHex(0xffffff);
          this.tennisRacketStringMat.opacity = 0.55;
        }
      }, durationSec * 1000);
      return;
    }
    if (!this.racketStringMat) return;
    this.racketStringMat.color.setHex(0xffffff);
    this.racketStringMat.opacity = 1.0;
    setTimeout(() => {
      if (this.racketStringMat) {
        this.racketStringMat.color.setHex(0xe0f2fe);
        this.racketStringMat.opacity = 0.6;
      }
    }, durationSec * 1000);
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
    distance = 2.05,
    sideOffset = 0.12,
    targetPlaneZ = -3.5
  ): THREE.Vector3 {
    let normX: number;
    let normY: number;

    if (isRawWebcam) {
      // 1:1 real-world mapping (screenX) for natural hand-eye coordination
      normX = (screenX - 0.5) * 2.0;
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

    // If camera is elevated/pulled back in broadcast mode (z < -6m), dynamically raycast to target player plane
    let effectiveDist = distance;
    if (camera.position.z < -6.0 && Math.abs(forward.z) > 0.1) {
      const distToBaselinePlane = (targetPlaneZ - camera.position.z) / forward.z;
      effectiveDist = Math.max(distance, distToBaselinePlane);
    }

    const dStrike = THREE.MathUtils.clamp(effectiveDist + screenZ * 0.25, 1.40, 9.50);
    const halfH = dStrike * Math.tan(fovRad * 0.5);
    const halfW = halfH * camera.aspect;

    return new THREE.Vector3()
      .copy(camera.position)
      .addScaledVector(forward, dStrike)
      .addScaledVector(right, normX * halfW * 1.25 + sideOffset)
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
    if (this.humanoidBodyMat) {
      this.humanoidBodyMat.transparent = isGhost;
      this.humanoidBodyMat.opacity = isGhost ? 0.25 : 1.0;
    }
    if (this.humanoidTrimMat) {
      this.humanoidTrimMat.transparent = isGhost;
      this.humanoidTrimMat.opacity = isGhost ? 0.35 : 1.0;
    }
  }

  public setJointColor(colorHex: number): void {
    this.jointMat.color.setHex(colorHex);
    this.jointMat.emissive.setHex(colorHex);
    if (this.humanoidTrimMat) {
      this.humanoidTrimMat.color.setHex(colorHex);
      this.humanoidTrimMat.emissive.setHex(colorHex);
    }
  }

  public getAvatarStyle(): AvatarStyle {
    return this.avatarStyle;
  }

  public destroy(): void {
    // Three.js cleanup
  }
}
