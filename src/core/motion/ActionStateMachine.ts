import {
  ActionType,
  ActionEvent,
  BiomechanicalMetrics,
  Landmark3D,
  PoseLandmark,
  Vector3D
} from './Types';
import { Math3D, LocalBodyBasis } from './VectorNormalizer';

export interface ActionClassifierConfig {
  smashVelocityMps: number;       // Min wrist velocity for smash
  driveVelocityMps: number;       // Min wrist velocity for forehand/backhand
  liftVelocityMps: number;        // Min wrist velocity for underhand lift
  cooldownMs: number;             // Minimum time between repeated stroke triggers
}

export class ActionStateMachine {
  private config: ActionClassifierConfig = {
    smashVelocityMps: 4.2,   // ~15 km/h at wrist
    driveVelocityMps: 2.8,   // ~10 km/h at wrist
    liftVelocityMps: 2.0,    // ~7.2 km/h at wrist
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

    // Check lower-body lunges continuously
    if (metrics.isLungingLeft) {
      this.currentAction = 'LUNGE_LEFT';
    } else if (metrics.isLungingRight) {
      this.currentAction = 'LUNGE_RIGHT';
    } else if (!isCoolingDown) {
      this.currentAction = 'READY_STANCE';
    }

    if (isCoolingDown) {
      return { activeAction: this.currentAction, lastEvent: this.lastActionEvent };
    }

    // Determine primary swinging arm
    const arm = metrics.dominantArm;
    const wristIdx = arm === 'right' ? PoseLandmark.RIGHT_WRIST : PoseLandmark.LEFT_WRIST;
    const elbowIdx = arm === 'right' ? PoseLandmark.RIGHT_ELBOW : PoseLandmark.LEFT_ELBOW;
    const shoulderIdx = arm === 'right' ? PoseLandmark.RIGHT_SHOULDER : PoseLandmark.LEFT_SHOULDER;

    const wristVel = velocities[wristIdx] || { x: 0, y: 0, z: 0 };
    const wristSpeed = Math3D.length(wristVel);
    const wristSpeedKmh = wristSpeed * 3.6;

    // Local coordinates relative to torso/hip root
    const localWrist = normalizedLandmarks[wristIdx];
    const localShoulder = normalizedLandmarks[shoulderIdx];
    const elbowAngle = arm === 'right' ? metrics.rightElbowAngleDeg : metrics.leftElbowAngleDeg;

    // World height relative to shoulder
    const wristWorld = worldLandmarks[wristIdx];
    const shoulderWorld = worldLandmarks[shoulderIdx];
    const isWristAboveShoulder = localWrist.y > localShoulder.y + 0.15; // Raised high along spine axis

    // Downward velocity along torso vertical axis
    const downwardSpeed = -wristVel.y;
    const forwardSpeed = wristVel.z;

    // 1. OVERHEAD SMASH DETECTION
    // High hand + high velocity + forward/downward trajectory + extended arm
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
        // High hand with upward punch: OVERHEAD CLEAR
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
      // Analyze cross-body reach in local torso frame
      // For right hand: positive local X is right (forehand side), negative local X is left (backhand side)
      // For left hand: inverted
      const isForehandSide = arm === 'right' ? localWrist.x >= -0.05 : localWrist.x <= 0.05;
      const isMovingOutward = arm === 'right' ? wristVel.x > 0.8 : wristVel.x < -0.8;

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
        // Cross-torso or outward snap: Backhand
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
    const isWristLow = localWrist.y < 0.1; // Hand below mid-torso
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
