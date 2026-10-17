import {
  MotionFrame,
  Landmark3D,
  Vector3D,
  PoseLandmark,
} from '../common/Types';
import { Math3D } from '../util/motion/VectorNormalizer';

export type PunchType =
  | 'JAB'
  | 'CROSS'
  | 'LEFT_HOOK'
  | 'RIGHT_HOOK'
  | 'LEFT_UPPERCUT'
  | 'RIGHT_UPPERCUT';

export type DefensiveStance =
  | 'IDLE'
  | 'HIGH_GUARD'
  | 'BODY_GUARD'
  | 'SLIP_LEFT'
  | 'SLIP_RIGHT'
  | 'DUCK';

export type TargetHurtbox = 'head' | 'chin' | 'jaw' | 'body' | 'liver' | 'guard';

export interface PunchEvent {
  type: PunchType;
  arm: 'left' | 'right';
  speedMps: number;
  speedKmh: number;
  damage: number;
  target: TargetHurtbox;
  timestamp: number;
  velocity: Vector3D;
  isCounter?: boolean;
}

export interface DefensiveState {
  stance: DefensiveStance;
  isHighGuard: boolean;
  isBodyGuard: boolean;
  isSlippingLeft: boolean;
  isSlippingRight: boolean;
  isDucking: boolean;
  slipRatio: number;   // -1.0 (far left) to +1.0 (far right)
  duckDepth: number;   // 0.0 (upright) to 1.0 (deep duck)
}

export class PunchClassifier {
  private dominantHand: 'right' | 'left' = 'right';

  // Debounce timing
  private lastPunchTimestamp = 0;
  private readonly PUNCH_DEBOUNCE_MS = 180; // 180ms debounce between punches

  // Standing calibration baselines
  private neutralHeadY: number | null = null;
  private neutralShoulderWidth = 0.40;

  // Recent state cache
  private currentDefense: DefensiveState = {
    stance: 'IDLE',
    isHighGuard: false,
    isBodyGuard: false,
    isSlippingLeft: false,
    isSlippingRight: false,
    isDucking: false,
    slipRatio: 0,
    duckDepth: 0,
  };

  // Synthetic testing queue
  private queuedSyntheticPunch: PunchEvent | null = null;
  private queuedSyntheticDefense: DefensiveStance | null = null;

  constructor(dominantHand: 'right' | 'left' = 'right') {
    this.dominantHand = dominantHand;
  }

  public setDominantHand(hand: 'right' | 'left'): void {
    this.dominantHand = hand;
  }

  /**
   * Primary frame evaluation: process 33 landmarks, velocities, and biomechanics.
   * Returns detected punch event (if any, respecting 120ms debounce) and current defensive state.
   */
  public update(
    frame: MotionFrame | null,
    nowMs = performance.now(),
    isRoundActive = true
  ): {
    punch: PunchEvent | null;
    defense: DefensiveState;
  } {
    if (!isRoundActive) {
      return { punch: null, defense: this.currentDefense };
    }

    // 1. Check synthetic queues first (for automated tests or keyboard shortcuts)
    if (this.queuedSyntheticPunch) {
      const punch = this.queuedSyntheticPunch;
      this.queuedSyntheticPunch = null;
      this.lastPunchTimestamp = nowMs;
      return { punch, defense: this.currentDefense };
    }

    if (this.queuedSyntheticDefense) {
      const stance = this.queuedSyntheticDefense;
      this.queuedSyntheticDefense = null;
      this.currentDefense = this.buildDefensiveStateFromStance(stance);
      return { punch: null, defense: this.currentDefense };
    }

    if (!frame || !frame.worldLandmarks || frame.worldLandmarks.length < 25) {
      return { punch: null, defense: this.currentDefense };
    }

    const { worldLandmarks, velocities, metrics } = frame;

    // 2. Evaluate Defensive Stances (Blocks, Slips, Ducks)
    this.currentDefense = this.classifyDefensiveStance(worldLandmarks, velocities);

    // 3. Evaluate Offensive Punches (respecting 120ms debounce)
    let punch: PunchEvent | null = null;
    if (nowMs - this.lastPunchTimestamp >= this.PUNCH_DEBOUNCE_MS) {
      punch = this.classifyPunches(worldLandmarks, velocities, metrics, nowMs);
      if (punch) {
        this.lastPunchTimestamp = nowMs;
      }
    }

    return { punch, defense: this.currentDefense };
  }

  /**
   * Classify High Guard, Body Guard, Slips, and Ducks.
   */
  private classifyDefensiveStance(
    lms: Landmark3D[],
    velocities: Vector3D[]
  ): DefensiveState {
    const lWrist = lms[PoseLandmark.LEFT_WRIST];
    const rWrist = lms[PoseLandmark.RIGHT_WRIST];
    const lShoulder = lms[PoseLandmark.LEFT_SHOULDER];
    const rShoulder = lms[PoseLandmark.RIGHT_SHOULDER];
    const nose = lms[PoseLandmark.NOSE];
    const lElbow = lms[PoseLandmark.LEFT_ELBOW];
    const rElbow = lms[PoseLandmark.RIGHT_ELBOW];

    if (!lWrist || !rWrist || !lShoulder || !rShoulder || !nose) {
      return this.currentDefense;
    }

    // Midpoints
    const shoulderCenter = {
      x: (lShoulder.x + rShoulder.x) * 0.5,
      y: (lShoulder.y + rShoulder.y) * 0.5,
      z: (lShoulder.z + rShoulder.z) * 0.5,
    };
    const shoulderSpan = Math.max(0.25, Math3D.distance(lShoulder, rShoulder));
    this.neutralShoulderWidth = this.neutralShoulderWidth * 0.98 + shoulderSpan * 0.02;

    // Calibrate neutral head height
    if (this.neutralHeadY === null) {
      this.neutralHeadY = nose.y;
    } else {
      // Slow auto-recalibration when standing upright
      if (Math.abs(nose.y - this.neutralHeadY) < 0.06) {
        this.neutralHeadY = this.neutralHeadY * 0.99 + nose.y * 0.01;
      }
    }

    // Wrist speeds
    const lWristVel = velocities[PoseLandmark.LEFT_WRIST] || { x: 0, y: 0, z: 0 };
    const rWristVel = velocities[PoseLandmark.RIGHT_WRIST] || { x: 0, y: 0, z: 0 };
    const lWristSpeed = Math3D.length(lWristVel);
    const rWristSpeed = Math3D.length(rWristVel);
    const avgWristSpeed = (lWristSpeed + rWristSpeed) * 0.5;

    // A. HIGH GUARD (BLOCK)
    // Both wrists raised in front of face (|wrist_L.x - wrist_R.x| < 0.28m, wrist.y > shoulder.y + 0.05m, velocity < 1.2 m/s)
    const wristDistX = Math.abs(lWrist.x - rWrist.x);
    const wristsAtOrAboveChin =
      (lWrist.y >= lShoulder.y + 0.05) && (rWrist.y >= rShoulder.y + 0.05);
    const isStationaryHands = avgWristSpeed < 1.20;

    const isHighGuard = wristDistX < 0.28 && wristsAtOrAboveChin && isStationaryHands;

    // B. BODY GUARD
    // Elbows tucked against ribs, wrists protecting upper abdomen
    const elbowDistX = Math3D.distance(lElbow, rElbow);
    const isBodyGuard =
      !isHighGuard &&
      elbowDistX < 0.38 &&
      lWrist.y < lShoulder.y &&
      rWrist.y < rShoulder.y &&
      isStationaryHands;

    // C. SLIP (LEFT / RIGHT)
    // Lateral shift > 0.18m relative to shoulder baseline
    const headLateralOffset = nose.x - shoulderCenter.x;
    const slipRatio = Math.max(-1, Math.min(1, headLateralOffset / 0.22));
    const isSlippingLeft = headLateralOffset < -0.16;
    const isSlippingRight = headLateralOffset > 0.16;

    // D. DUCK
    // Vertical drop > 0.15m relative to neutral head height
    const headVerticalDrop = this.neutralHeadY !== null ? (this.neutralHeadY - nose.y) : 0;
    // Note: If drop is positive (lowering down)
    const duckDepth = Math.max(0, Math.min(1, Math.abs(headVerticalDrop) / 0.25));
    const isDucking = (headVerticalDrop < -0.14 || headVerticalDrop > 0.14) && !isHighGuard;

    // Synthesize primary stance
    let stance: DefensiveStance = 'IDLE';
    if (isHighGuard) stance = 'HIGH_GUARD';
    else if (isBodyGuard) stance = 'BODY_GUARD';
    else if (isDucking) stance = 'DUCK';
    else if (isSlippingLeft) stance = 'SLIP_LEFT';
    else if (isSlippingRight) stance = 'SLIP_RIGHT';

    return {
      stance,
      isHighGuard,
      isBodyGuard,
      isSlippingLeft,
      isSlippingRight,
      isDucking,
      slipRatio,
      duckDepth,
    };
  }

  /**
   * Classify offensive punches:
   * - Jab / Straight Cross: |v_z| > 2.8 m/s or shoulder-to-wrist extension
   * - Hooks (Left/Right): |v_x| > 3.2 m/s with elbow flexion 65°-115°
   * - Uppercuts: v_y > 2.5 m/s starting below chest level
   */
  private classifyPunches(
    lms: Landmark3D[],
    velocities: Vector3D[],
    metrics: any,
    nowMs: number
  ): PunchEvent | null {
    const lWrist = lms[PoseLandmark.LEFT_WRIST];
    const rWrist = lms[PoseLandmark.RIGHT_WRIST];
    const lShoulder = lms[PoseLandmark.LEFT_SHOULDER];
    const rShoulder = lms[PoseLandmark.RIGHT_SHOULDER];

    const lWristVel = velocities[PoseLandmark.LEFT_WRIST] || { x: 0, y: 0, z: 0 };
    const rWristVel = velocities[PoseLandmark.RIGHT_WRIST] || { x: 0, y: 0, z: 0 };

    const lWristSpeed = Math3D.length(lWristVel);
    const rWristSpeed = Math3D.length(rWristVel);

    // Pick faster moving arm above threshold (min 1.35 m/s)
    const activeArm = rWristSpeed >= lWristSpeed ? 'right' : 'left';
    const activeSpeed = activeArm === 'right' ? rWristSpeed : lWristSpeed;
    const activeVel = activeArm === 'right' ? rWristVel : lWristVel;
    const activeWrist = activeArm === 'right' ? rWrist : lWrist;
    const activeShoulder = activeArm === 'right' ? rShoulder : lShoulder;

    if (activeSpeed < 1.35) {
      return null;
    }

    const speedKmh = activeSpeed * 3.6;
    const elbowAngle = activeArm === 'right'
      ? (metrics?.rightElbowAngleDeg ?? 90)
      : (metrics?.leftElbowAngleDeg ?? 90);

    // Extension from shoulder toward camera/screen
    const shoulderDist = Math3D.distance(activeWrist, activeShoulder);

    // High vs. Low Punch Target (High: Y > 1.4m => Head, Low: Y <= 1.35m => Body)
    const isBodyPunch = activeWrist.y < activeShoulder.y - 0.12;

    // 1. UPPERCUT: Upward burst (|v_y| > 1.4 m/s) starting below chest level
    const upwardSpeed = Math.abs(activeVel.y);
    const isBelowChest = activeWrist.y < activeShoulder.y - 0.05;
    if (upwardSpeed > 1.4 && isBelowChest && elbowAngle >= 45 && elbowAngle <= 135) {
      const type: PunchType = activeArm === 'left' ? 'LEFT_UPPERCUT' : 'RIGHT_UPPERCUT';
      const damage = Math.min(16, Math.max(12, Math.round(12 + (activeSpeed / 6.0) * 4)));
      return {
        type,
        arm: activeArm,
        speedMps: activeSpeed,
        speedKmh,
        damage,
        target: isBodyPunch ? 'body' : 'chin',
        timestamp: nowMs,
        velocity: activeVel,
      };
    }

    // 2. HOOK (LEFT / RIGHT): Lateral sweep (|v_x| > 1.5 m/s) with elbow flexion 50° to 130°
    const lateralSpeed = Math.abs(activeVel.x);
    if (lateralSpeed > 1.5 && elbowAngle >= 50 && elbowAngle <= 130) {
      const type: PunchType = activeArm === 'left' ? 'LEFT_HOOK' : 'RIGHT_HOOK';
      const damage = Math.min(16, Math.max(12, Math.round(12 + (activeSpeed / 5.5) * 4)));
      return {
        type,
        arm: activeArm,
        speedMps: activeSpeed,
        speedKmh,
        damage,
        target: isBodyPunch ? 'body' : (activeArm === 'left' ? 'jaw' : 'head'),
        timestamp: nowMs,
        velocity: activeVel,
      };
    }

    // 3. JAB / STRAIGHT CROSS: Forward acceleration (|v_z| > 1.25 m/s or forward extension)
    const forwardSpeed = Math.abs(activeVel.z);
    if (forwardSpeed > 1.25 || (activeSpeed > 1.35 && shoulderDist > 0.28)) {
      // Determine Jab vs Cross:
      // Lead hand is Jab (6–9 HP), rear hand is Cross (10–14 HP)
      const isLeadHand = this.dominantHand === 'right' ? activeArm === 'left' : activeArm === 'right';
      const type: PunchType = isLeadHand ? 'JAB' : 'CROSS';
      const damage = isBodyPunch
        ? Math.min(16, Math.max(12, Math.round(12 + (activeSpeed / 5.5) * 4)))
        : isLeadHand
          ? Math.min(9, Math.max(6, Math.round(6 + (activeSpeed / 6.0) * 3)))
          : Math.min(14, Math.max(10, Math.round(10 + (activeSpeed / 5.5) * 4)));

      return {
        type,
        arm: activeArm,
        speedMps: activeSpeed,
        speedKmh,
        damage,
        target: isBodyPunch ? 'body' : (isLeadHand ? 'head' : 'chin'),
        timestamp: nowMs,
        velocity: activeVel,
      };
    }

    // General punch fallback if speed is high (> 2.0 m/s)
    if (activeSpeed > 2.0) {
      const isLeadHand = this.dominantHand === 'right' ? activeArm === 'left' : activeArm === 'right';
      return {
        type: isLeadHand ? 'JAB' : 'CROSS',
        arm: activeArm,
        speedMps: activeSpeed,
        speedKmh,
        damage: isBodyPunch ? 14 : isLeadHand ? 8 : 12,
        target: isBodyPunch ? 'body' : 'head',
        timestamp: nowMs,
        velocity: activeVel,
      };
    }

    return null;
  }

  private buildDefensiveStateFromStance(stance: DefensiveStance): DefensiveState {
    return {
      stance,
      isHighGuard: stance === 'HIGH_GUARD',
      isBodyGuard: stance === 'BODY_GUARD',
      isSlippingLeft: stance === 'SLIP_LEFT',
      isSlippingRight: stance === 'SLIP_RIGHT',
      isDucking: stance === 'DUCK',
      slipRatio: stance === 'SLIP_LEFT' ? -1 : stance === 'SLIP_RIGHT' ? 1 : 0,
      duckDepth: stance === 'DUCK' ? 1 : 0,
    };
  }

  // ─── Synthetic Test API ──────────────────────────────────────────────────

  public triggerSyntheticPunch(
    type: PunchType,
    speedMps = 5.2,
    arm: 'left' | 'right' = 'right',
    target?: TargetHurtbox
  ): void {
    const damageMap: Record<PunchType, number> = {
      JAB: 8,
      CROSS: 12,
      LEFT_HOOK: 14,
      RIGHT_HOOK: 14,
      LEFT_UPPERCUT: 15,
      RIGHT_UPPERCUT: 15,
    };
    const targetMap: Record<PunchType, TargetHurtbox> = {
      JAB: 'head',
      CROSS: 'chin',
      LEFT_HOOK: 'jaw',
      RIGHT_HOOK: 'head',
      LEFT_UPPERCUT: 'chin',
      RIGHT_UPPERCUT: 'chin',
    };

    this.queuedSyntheticPunch = {
      type,
      arm,
      speedMps,
      speedKmh: speedMps * 3.6,
      damage: damageMap[type] || 10,
      target: target || targetMap[type] || 'head',
      timestamp: performance.now(),
      velocity: { x: 0, y: 0, z: -speedMps },
    };
  }

  public triggerSyntheticDefense(stance: DefensiveStance): void {
    this.queuedSyntheticDefense = stance;
  }

  public getCurrentDefense(): DefensiveState {
    return this.currentDefense;
  }
}
