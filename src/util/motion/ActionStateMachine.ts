import {
  ActionType,
  ActionEvent,
  BiomechanicalMetrics,
  Landmark3D,
  PoseLandmark,
  Vector3D
} from '../../common/Types';
import { Math3D, LocalBodyBasis } from './VectorNormalizer';

export interface ActionClassifierConfig {
  smashVelocityMps: number;       // Min wrist velocity for smash
  driveVelocityMps: number;       // Min wrist velocity for forehand/backhand
  liftVelocityMps: number;        // Min wrist velocity for underhand lift
  cooldownMs: number;             // Minimum time between repeated stroke triggers
}

export class ActionStateMachine {
  private config: ActionClassifierConfig = {
    smashVelocityMps: 4.8,   // ~17.3 km/h at wrist (requires intentional fast swing)
    driveVelocityMps: 2.2,   // ~7.9 km/h at wrist (fluid arm stroke or lateral sweep)
    liftVelocityMps: 2.0,    // ~7.2 km/h at wrist (natural gentle underhand serve/lift)
    cooldownMs: 320          // 320ms refractory period
  };

  private lastActionTime = 0;
  private currentAction: ActionType = 'READY_STANCE';
  private lastActionEvent: ActionEvent | null = null;
  private actionListeners: ((event: ActionEvent) => void)[] = [];

  constructor(customConfig?: Partial<ActionClassifierConfig>) {
    if (customConfig) {
      this.config = { ...this.config, ...customConfig };
    }
  }

  public onAction(callback: (event: ActionEvent) => void): () => void {
    this.actionListeners.push(callback);
    return () => {
      this.actionListeners = this.actionListeners.filter(cb => cb !== callback);
    };
  }

  private emitAction(event: ActionEvent): void {
    this.currentAction = event.type;
    this.lastActionEvent = event;
    for (const listener of this.actionListeners) {
      listener(event);
    }
  }

  /**
   * Main per-frame state classification step
   */
  public update(
    normalizedLandmarks: Landmark3D[],
    worldLandmarks: Landmark3D[],
    velocities: Vector3D[],
    metrics: BiomechanicalMetrics,
    basis: LocalBodyBasis,
    timestamp: number
  ): { activeAction: ActionType; lastEvent: ActionEvent | null } {
    const isCoolingDown = timestamp - this.lastActionTime < this.config.cooldownMs;

    // Determine primary swinging arm
    const arm = metrics.dominantArm;
    const wristIdx = arm === 'right' ? PoseLandmark.RIGHT_WRIST : PoseLandmark.LEFT_WRIST;
    const shoulderIdx = arm === 'right' ? PoseLandmark.RIGHT_SHOULDER : PoseLandmark.LEFT_SHOULDER;

    const wristVel = velocities[wristIdx] || { x: 0, y: 0, z: 0 };
    const wristSpeed = Math3D.length(wristVel);
    const wristSpeedKmh = wristSpeed * 3.6;

    const localWrist = normalizedLandmarks[wristIdx];
    const localShoulder = normalizedLandmarks[shoulderIdx];
    const localWristVelX = Math3D.dot(wristVel, basis.right);

    // Check lower-body lunges & active lateral hand movements (allow waist-level table tennis strokes above mid-thigh)
    const isHandRaisedAboveHip = Boolean(localWrist && localWrist.y > -0.10);
    if (metrics.isLungingLeft) {
      this.currentAction = 'LUNGE_LEFT';
    } else if (metrics.isLungingRight) {
      this.currentAction = 'LUNGE_RIGHT';
    } else if (isHandRaisedAboveHip && wristSpeed >= 0.55 && (Math.abs(localWristVelX) > 0.35 || Math.abs(localWrist.x) > 0.14)) {
      const isForehandSide = arm === 'right'
        ? localWrist.x >= -0.02 || localWristVelX > 0.35
        : localWrist.x <= 0.02 || localWristVelX < -0.35;
      this.currentAction = isForehandSide ? 'FOREHAND_DRIVE' : 'BACKHAND_DRIVE';
    } else if (wristSpeed < 0.55 || !isCoolingDown) {
      this.currentAction = 'READY_STANCE';
    }

    if (isCoolingDown) {
      return { activeAction: this.currentAction, lastEvent: this.lastActionEvent };
    }

    // Never emit stroke events when the hand is hanging down below mid-thigh or moving below 1.6 m/s
    if (!isHandRaisedAboveHip || wristSpeed < 1.6) {
      return { activeAction: this.currentAction, lastEvent: this.lastActionEvent };
    }

    const elbowAngle = arm === 'right' ? metrics.rightElbowAngleDeg : metrics.leftElbowAngleDeg;

    // World height relative to shoulder
    const wristWorld = worldLandmarks[wristIdx];
    const isWristAboveShoulder = localWrist.y > localShoulder.y + 0.15;

    // Downward velocity along torso vertical axis
    const downwardSpeed = -wristVel.y;
    const forwardSpeed = wristVel.z;

    // 1. OVERHEAD SMASH DETECTION
    if (isWristAboveShoulder && wristSpeed >= this.config.smashVelocityMps) {
      if (downwardSpeed > 1.2 || forwardSpeed > 1.5 || wristSpeed > 5.5) {
        const power = Math.min(100, Math.round((wristSpeed / 7.5) * 100));
        const event: ActionEvent = {
          type: 'OVERHEAD_SMASH',
          timestamp,
          speedMps: wristSpeed,
          speedKmh: wristSpeedKmh,
          power,
          arm,
          wristVelocity: wristVel,
          elbowAngleDeg: elbowAngle,
          shoulderAngleDeg: 120,
          apexHeightMeters: Math.abs(wristWorld.y),
          lungeDepthMeters: metrics.lungeDepth,
          direction: Math3D.normalize(wristVel),
          description: `Overhead Smash (${wristSpeedKmh.toFixed(0)} km/h, Power ${power}%)`
        };

        this.lastActionTime = timestamp;
        this.emitAction(event);
        return { activeAction: event.type, lastEvent: event };
      } else if (wristVel.y > 0.5) {
        const power = Math.min(100, Math.round((wristSpeed / 6.0) * 100));
        const event: ActionEvent = {
          type: 'OVERHEAD_CLEAR',
          timestamp,
          speedMps: wristSpeed,
          speedKmh: wristSpeedKmh,
          power,
          arm,
          wristVelocity: wristVel,
          elbowAngleDeg: elbowAngle,
          shoulderAngleDeg: 110,
          apexHeightMeters: Math.abs(wristWorld.y),
          lungeDepthMeters: metrics.lungeDepth,
          direction: Math3D.normalize(wristVel),
          description: `High Clear (${wristSpeedKmh.toFixed(0)} km/h)`
        };

        this.lastActionTime = timestamp;
        this.emitAction(event);
        return { activeAction: event.type, lastEvent: event };
      }
    }

    // 2. FOREHAND VS BACKHAND DRIVES
    if (wristSpeed >= this.config.driveVelocityMps) {
      // Combine wrist position relative to torso and vertical/lateral swing velocity
      // Note: localWrist.x > 0 is the anatomical right side; upward/forward swings on or from the forehand side are FOREHAND_DRIVE
      const upwardSpeed = Math3D.dot(wristVel, basis.up);
      const isForehandSide = arm === 'right'
        ? localWrist.x >= -0.02 || upwardSpeed > 0.85 || localWristVelX > 0.55
        : localWrist.x <= 0.02 || upwardSpeed > 0.85 || localWristVelX < -0.55;

      if (isForehandSide) {
        const power = Math.min(100, Math.round((wristSpeed / 5.5) * 100));
        const event: ActionEvent = {
          type: 'FOREHAND_DRIVE',
          timestamp,
          speedMps: wristSpeed,
          speedKmh: wristSpeedKmh,
          power,
          arm,
          wristVelocity: wristVel,
          elbowAngleDeg: elbowAngle,
          shoulderAngleDeg: 60,
          apexHeightMeters: Math.abs(wristWorld.y),
          lungeDepthMeters: metrics.lungeDepth,
          direction: Math3D.normalize(wristVel),
          description: `Forehand Drive (${wristSpeedKmh.toFixed(0)} km/h)`
        };

        this.lastActionTime = timestamp;
        this.emitAction(event);
        return { activeAction: event.type, lastEvent: event };
      } else {
        const power = Math.min(100, Math.round((wristSpeed / 5.0) * 100));
        const event: ActionEvent = {
          type: 'BACKHAND_DRIVE',
          timestamp,
          speedMps: wristSpeed,
          speedKmh: wristSpeedKmh,
          power,
          arm,
          wristVelocity: wristVel,
          elbowAngleDeg: elbowAngle,
          shoulderAngleDeg: 55,
          apexHeightMeters: Math.abs(wristWorld.y),
          lungeDepthMeters: metrics.lungeDepth,
          direction: Math3D.normalize(wristVel),
          description: `Backhand Drive (${wristSpeedKmh.toFixed(0)} km/h)`
        };

        this.lastActionTime = timestamp;
        this.emitAction(event);
        return { activeAction: event.type, lastEvent: event };
      }
    }

    // 3. UNDERHAND LIFT / DROP
    const isWristLow = localWrist.y < 0.1;
    if (isWristLow && wristSpeed >= this.config.liftVelocityMps && wristVel.y > 0.8) {
      const power = Math.min(100, Math.round((wristSpeed / 4.0) * 100));
      const isDrop = wristSpeed < 2.5;
      const type: ActionType = isDrop ? 'DROP_SHOT' : 'UNDERHAND_LIFT';

      const event: ActionEvent = {
        type,
        timestamp,
        speedMps: wristSpeed,
        speedKmh: wristSpeedKmh,
        power,
        arm,
        wristVelocity: wristVel,
        elbowAngleDeg: elbowAngle,
        shoulderAngleDeg: 40,
        apexHeightMeters: Math.abs(wristWorld.y),
        lungeDepthMeters: metrics.lungeDepth,
        direction: Math3D.normalize(wristVel),
        description: `${type === 'DROP_SHOT' ? 'Net Drop' : 'Underhand Lift'} (${wristSpeedKmh.toFixed(0)} km/h)`
      };

      this.lastActionTime = timestamp;
      this.emitAction(event);
      return { activeAction: event.type, lastEvent: event };
    }

    return { activeAction: this.currentAction, lastEvent: this.lastActionEvent };
  }

  public reset(): void {
    this.currentAction = 'READY_STANCE';
    this.lastActionEvent = null;
    this.lastActionTime = 0;
  }
}
