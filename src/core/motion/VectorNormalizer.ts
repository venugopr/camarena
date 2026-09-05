import {
  Landmark3D,
  Vector3D,
  PoseLandmark,
  BiomechanicalMetrics
} from './Types';

/**
 * 3D Vector Math Utilities
 */
export class Math3D {
  static add(a: Vector3D, b: Vector3D): Vector3D {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
  }

  static sub(a: Vector3D, b: Vector3D): Vector3D {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  }

  static scale(v: Vector3D, s: number): Vector3D {
    return { x: v.x * s, y: v.y * s, z: v.z * s };
  }

  static dot(a: Vector3D, b: Vector3D): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  }

  static cross(a: Vector3D, b: Vector3D): Vector3D {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x
    };
  }

  static length(v: Vector3D): number {
    return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  }

  static normalize(v: Vector3D): Vector3D {
    const len = Math3D.length(v);
    if (len < 1e-6) return { x: 0, y: 1, z: 0 };
    return { x: v.x / len, y: v.y / len, z: v.z / len };
  }

  static distance(a: Vector3D, b: Vector3D): number {
    return Math3D.length(Math3D.sub(a, b));
  }

  static angleBetween(a: Vector3D, b: Vector3D): number {
    const la = Math3D.length(a);
    const lb = Math3D.length(b);
    if (la < 1e-6 || lb < 1e-6) return 0;
    const cosAngle = Math.max(-1, Math.min(1, Math3D.dot(a, b) / (la * lb)));
    return (Math.acos(cosAngle) * 180) / Math.PI;
  }
}

/**
 * Biomechanical Torso/Hip Coordinate Basis
 */
export interface LocalBodyBasis {
  origin: Vector3D;      // Hip root midpoint
  right: Vector3D;       // Local X: Left hip -> Right hip
  up: Vector3D;          // Local Y: Hip midpoint -> Shoulder midpoint (orthogonalized)
  forward: Vector3D;     // Local Z: Right x Up (facing forward)
  torsoYawDeg: number;
  torsoPitchDeg: number;
  torsoRollDeg: number;
}

/**
 * Vector Normalizer:
 * Anchors joint vectors relative to the torso/hip root frame.
 * Ensures consistent athletic tracking during lateral lunges, side reaches, and torso rotations.
 */
export class VectorNormalizer {
  private neutralHipHeight: number | null = null;
  private neutralAnkleWidth: number | null = null;

  /**
   * Constructs the local coordinate basis for the player's torso
   */
  public computeLocalBasis(landmarks: Landmark3D[]): LocalBodyBasis {
    const leftHip = landmarks[PoseLandmark.LEFT_HIP];
    const rightHip = landmarks[PoseLandmark.RIGHT_HIP];
    const leftShoulder = landmarks[PoseLandmark.LEFT_SHOULDER];
    const rightShoulder = landmarks[PoseLandmark.RIGHT_SHOULDER];

    // Root origin at mid-hip
    const origin: Vector3D = {
      x: (leftHip.x + rightHip.x) * 0.5,
      y: (leftHip.y + rightHip.y) * 0.5,
      z: (leftHip.z + rightHip.z) * 0.5
    };

    // Shoulder midpoint
    const midShoulder: Vector3D = {
      x: (leftShoulder.x + rightShoulder.x) * 0.5,
      y: (leftShoulder.y + rightShoulder.y) * 0.5,
      z: (leftShoulder.z + rightShoulder.z) * 0.5
    };

    // Local Right vector (from left hip towards right hip)
    let right = Math3D.normalize(Math3D.sub(rightHip, leftHip));

    // Spine vector (from hip midpoint towards shoulder midpoint)
    const spine = Math3D.sub(midShoulder, origin);

    // Gram-Schmidt orthogonalization: ensure Up is perpendicular to Right
    const rightProj = Math3D.scale(right, Math3D.dot(spine, right));
    let up = Math3D.normalize(Math3D.sub(spine, rightProj));

    // Forward vector (perpendicular to coronal plane: Right cross Up)
    let forward = Math3D.normalize(Math3D.cross(right, up));

    // Calculate torso angles in degrees
    const torsoYawDeg = (Math.atan2(forward.x, forward.z) * 180) / Math.PI;
    const torsoPitchDeg = (Math.asin(Math.max(-1, Math.min(1, -forward.y))) * 180) / Math.PI;
    const torsoRollDeg = (Math.atan2(right.y, right.x) * 180) / Math.PI;

    return {
      origin,
      right,
      up,
      forward,
      torsoYawDeg,
      torsoPitchDeg,
      torsoRollDeg
    };
  }

  /**
   * Projects landmarks into local body-root coordinate space
   */
  public normalizeToRoot(
    landmarks: Landmark3D[],
    basis: LocalBodyBasis
  ): Landmark3D[] {
    const normalized: Landmark3D[] = [];

    for (let i = 0; i < landmarks.length; i++) {
      const lm = landmarks[i];
      const rel = Math3D.sub(lm, basis.origin);

      // Project onto local basis axes
      const localX = Math3D.dot(rel, basis.right);
      const localY = Math3D.dot(rel, basis.up);
      const localZ = Math3D.dot(rel, basis.forward);

      normalized.push({
        x: localX,
        y: localY,
        z: localZ,
        visibility: lm.visibility,
        presence: lm.presence
      });
    }

    return normalized;
  }

  /**
   * Computes comprehensive biomechanical athletic metrics
   */
  public computeMetrics(
    worldLandmarks: Landmark3D[],
    velocities: Vector3D[],
    basis: LocalBodyBasis
  ): BiomechanicalMetrics {
    const leftHip = worldLandmarks[PoseLandmark.LEFT_HIP];
    const rightHip = worldLandmarks[PoseLandmark.RIGHT_HIP];
    const leftKnee = worldLandmarks[PoseLandmark.LEFT_KNEE];
    const rightKnee = worldLandmarks[PoseLandmark.RIGHT_KNEE];
    const leftAnkle = worldLandmarks[PoseLandmark.LEFT_ANKLE];
    const rightAnkle = worldLandmarks[PoseLandmark.RIGHT_ANKLE];

    const leftShoulder = worldLandmarks[PoseLandmark.LEFT_SHOULDER];
    const rightShoulder = worldLandmarks[PoseLandmark.RIGHT_SHOULDER];
    const leftElbow = worldLandmarks[PoseLandmark.LEFT_ELBOW];
    const rightElbow = worldLandmarks[PoseLandmark.RIGHT_ELBOW];
    const leftWrist = worldLandmarks[PoseLandmark.LEFT_WRIST];
    const rightWrist = worldLandmarks[PoseLandmark.RIGHT_WRIST];

    // Elbow flexion angles (180 deg = fully straight arm)
    const rightElbowAngleDeg = Math3D.angleBetween(
      Math3D.sub(rightElbow, rightShoulder),
      Math3D.sub(rightWrist, rightElbow)
    );
    const leftElbowAngleDeg = Math3D.angleBetween(
      Math3D.sub(leftElbow, leftShoulder),
      Math3D.sub(leftWrist, leftElbow)
    );

    // Instantaneous wrist velocities (m/s) & speed (km/h)
    const rightWristVel = velocities[PoseLandmark.RIGHT_WRIST] || { x: 0, y: 0, z: 0 };
    const leftWristVel = velocities[PoseLandmark.LEFT_WRIST] || { x: 0, y: 0, z: 0 };

    const rightSpeedMps = Math3D.length(rightWristVel);
    const leftSpeedMps = Math3D.length(leftWristVel);

    const rightWristSpeedKmh = rightSpeedMps * 3.6;
    const leftWristSpeedKmh = leftSpeedMps * 3.6;

    // Dominant arm determination (highest current dynamic energy)
    const dominantArm = rightSpeedMps >= leftSpeedMps ? 'right' : 'left';

    // Lower body kinematics: lunge and weight shift
    const currentHipHeight = basis.origin.y;
    const currentAnkleWidth = Math3D.distance(leftAnkle, rightAnkle);

    if (this.neutralHipHeight === null) {
      this.neutralHipHeight = currentHipHeight;
    } else {
      // Slow auto-calibration of neutral standing baseline
      if (Math.abs(currentHipHeight - this.neutralHipHeight) < 0.05) {
        this.neutralHipHeight = this.neutralHipHeight * 0.99 + currentHipHeight * 0.01;
      }
    }

    if (this.neutralAnkleWidth === null) {
      this.neutralAnkleWidth = Math.max(currentAnkleWidth, 0.3);
    }

    // Lunge depth: hip center dropping lower than baseline (in meters)
    // Note: in world coords, -y is up or down depending on camera, here we measure relative offset
    const lungeDepth = Math.max(0, currentHipHeight - this.neutralHipHeight);

    // Lateral weight distribution: projection of hip center relative to ankle midpoint
    const midAnkleX = (leftAnkle.x + rightAnkle.x) * 0.5;
    const footSpan = Math.max(0.2, Math.abs(rightAnkle.x - leftAnkle.x));
    const lateralShiftRatio = Math.max(-1, Math.min(1, (basis.origin.x - midAnkleX) / (footSpan * 0.5)));

    // Knee flexion angles
    const rightKneeAngle = Math3D.angleBetween(
      Math3D.sub(rightKnee, rightHip),
      Math3D.sub(rightAnkle, rightKnee)
    );
    const leftKneeAngle = Math3D.angleBetween(
      Math3D.sub(leftKnee, leftHip),
      Math3D.sub(leftAnkle, leftKnee)
    );

    // Lunge detection criteria: widened stance + deep knee bend + hip drop
    const isStanceWidened = currentAnkleWidth > (this.neutralAnkleWidth * 1.3);
    const isLungingRight = isStanceWidened && (rightKneeAngle < 135 || lateralShiftRatio > 0.35);
    const isLungingLeft = isStanceWidened && (leftKneeAngle < 135 || lateralShiftRatio < -0.35);

    // Jump detection: both ankles elevated significantly
    const isInAir = (currentHipHeight < this.neutralHipHeight - 0.15);

    return {
      torsoYawDeg: basis.torsoYawDeg,
      torsoPitchDeg: basis.torsoPitchDeg,
      torsoRollDeg: basis.torsoRollDeg,
      dominantArm,
      rightWristVelocity: rightWristVel,
      leftWristVelocity: leftWristVel,
      rightWristSpeedKmh,
      leftWristSpeedKmh,
      rightElbowAngleDeg,
      leftElbowAngleDeg,
      hipCenterWorld: basis.origin,
      lungeDepth,
      lateralWeightShift: lateralShiftRatio,
      isLungingLeft,
      isLungingRight,
      isInAir
    };
  }
}
