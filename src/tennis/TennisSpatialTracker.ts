import * as THREE from 'three';
import { Landmark3D, PoseLandmark } from '../common/Types';

export interface TennisFootworkState {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  lateralShift: number; // -1 (far left) to +1 (far right)
  depthRatio: number; // 0 (deep baseline) to 1 (at net)
  isLunging: boolean;
  lungeDirection: 'left' | 'right' | 'none';
  isSplitStepping: boolean;
  proximityRatio: number; // > 1.25 enters ProximityMode
  isProximityMode: boolean;
}

/**
 * Adaptive Living-Room Spatial Tracker
 * Maps a standard 2.0m x 2.0m room footprint to full singles half-court:
 * - Lateral X: [-4.115m, +4.115m] (ITF singles half-width)
 * - Depth Z: [-12.5m (deep defense), -11.5m (baseline), -6.0m (service line), -3.5m (volley zone)]
 */
export class TennisSpatialTracker {
  // Court Dimension Constraints
  public static readonly COURT_HALF_WIDTH = 4.115;
  public static readonly BASELINE_Z = -11.5;
  public static readonly DEEP_DEFENSE_Z = -12.5;
  public static readonly SERVICE_LINE_Z = -6.4;
  public static readonly VOLLEY_ZONE_Z = -3.5;
  public static readonly TACTICAL_CENTER_Z = -11.5;

  // Tracked State
  private currentPosition = new THREE.Vector3(0, 0, TennisSpatialTracker.BASELINE_Z);
  private targetPosition = new THREE.Vector3(0, 0, TennisSpatialTracker.BASELINE_Z);
  private currentVelocity = new THREE.Vector3(0, 0, 0);

  // Calibration State
  private baselineClavicleDistance = 0.18; // screen-space distance between shoulders
  private calibratedSamples = 0;
  private isCalibrated = false;
  private currentProximityRatio = 1.0;

  // Torso History & Velocity Tracking
  private prevTorsoRawX = 0.5;
  private prevTorsoRawY = 0.5;
  private smoothedTorsoVelocity = new THREE.Vector3();

  // Center Auto-Decay State
  private idleCenterTimer = 0;
  private static readonly IDLE_VELOCITY_THRESHOLD = 0.15; // m/s
  private static readonly IDLE_TRIGGER_TIME = 1.2; // seconds

  // Split-step and Footwork detection
  private splitStepTimer = 0;
  private isSplitStepping = false;
  private lungeState: 'left' | 'right' | 'none' = 'none';

  constructor() {
    this.reset();
  }

  public reset(initialZ = TennisSpatialTracker.BASELINE_Z): void {
    this.currentPosition.set(0, 0, initialZ);
    this.targetPosition.set(0, 0, initialZ);
    this.currentVelocity.set(0, 0, 0);
    this.smoothedTorsoVelocity.set(0, 0, 0);
    this.idleCenterTimer = 0;
    this.calibratedSamples = 0;
    this.isCalibrated = false;
    this.currentProximityRatio = 1.0;
    this.isSplitStepping = false;
    this.lungeState = 'none';
  }

  /**
   * Main tracking update called per frame with MediaPipe pose landmarks
   */
  public update(
    landmarks: Landmark3D[] | null | undefined,
    dt: number,
    isManualOverride = false
  ): TennisFootworkState {
    const safeDt = Math.max(0.001, Math.min(dt, 0.05));

    if (isManualOverride || !landmarks || landmarks.length < 25) {
      // Manual keyboard/mouse mode: gently update velocity
      this.currentVelocity.copy(this.targetPosition).sub(this.currentPosition).divideScalar(safeDt);
      this.currentPosition.copy(this.targetPosition);
      return this.buildFootworkState();
    }

    const leftShoulder = landmarks[PoseLandmark.LEFT_SHOULDER];
    const rightShoulder = landmarks[PoseLandmark.RIGHT_SHOULDER];
    const leftHip = landmarks[PoseLandmark.LEFT_HIP];
    const rightHip = landmarks[PoseLandmark.RIGHT_HIP];

    if (!leftShoulder || !rightShoulder) {
      return this.buildFootworkState();
    }

    // 1. Compute Mirrored Torso Center:
    // (PoseLandmark.LEFT_SHOULDER + PoseLandmark.RIGHT_SHOULDER + PoseLandmark.LEFT_HIP + PoseLandmark.RIGHT_HIP) / 4
    let torsoRawX: number;
    let torsoRawY: number;

    const hasHips = leftHip && rightHip && (leftHip.visibility ?? 1) > 0.25 && (rightHip.visibility ?? 1) > 0.25;
    if (hasHips) {
      torsoRawX = (leftShoulder.x + rightShoulder.x + leftHip.x + rightHip.x) * 0.25;
      torsoRawY = (leftShoulder.y + rightShoulder.y + leftHip.y + rightHip.y) * 0.25;
    } else {
      torsoRawX = (leftShoulder.x + rightShoulder.x) * 0.5;
      torsoRawY = (leftShoulder.y + rightShoulder.y) * 0.5;
    }

    // Mirrored screen-space offset from center:
    // In selfie camera feed, moving player's right is camera's right in mirrored coords (or x > 0.5)
    // To conform with CamArena's convention: (torsoRawX - 0.5) * 2.8 gives [-1.4, 1.4] normalized span
    const rawDx = (torsoRawX - 0.5);
    const instantaneousRawVx = (torsoRawX - this.prevTorsoRawX) / safeDt;
    this.prevTorsoRawX = torsoRawX;
    this.prevTorsoRawY = torsoRawY;

    // 2. Lateral X Mapping with Non-linear Velocity Curve:
    // Quick lateral split-steps and shuffles instantly amplify court movement across ±4.1m
    const rawSpeed = Math.abs(instantaneousRawVx);
    // Non-linear amplification: exponent boost for fast explosive movements
    const dynamicBoost = 1.0 + Math.pow(Math.min(3.5, rawSpeed * 4.2), 1.35) * 0.65;
    const mappedNormalizedX = (rawDx * 2.8) * dynamicBoost;

    // Map to half-court bounds: [-4.115m, +4.115m]
    const targetX = THREE.MathUtils.clamp(
      mappedNormalizedX * (TennisSpatialTracker.COURT_HALF_WIDTH / 1.15),
      -TennisSpatialTracker.COURT_HALF_WIDTH,
      TennisSpatialTracker.COURT_HALF_WIDTH
    );

    // 3. Depth Z Mapping: Inter-Clavicle Pixel Distance Tracking
    // Distance between left and right shoulder in camera space
    const clavicleDist = Math.hypot(
      rightShoulder.x - leftShoulder.x,
      rightShoulder.y - leftShoulder.y
    );

    // Auto-calibrate baseline clavicle distance during initial standing frames
    if (this.calibratedSamples < 30) {
      if (this.calibratedSamples === 0) {
        this.baselineClavicleDistance = clavicleDist;
      } else {
        this.baselineClavicleDistance = this.baselineClavicleDistance * 0.9 + clavicleDist * 0.1;
      }
      this.calibratedSamples++;
      if (this.calibratedSamples >= 30) {
        this.isCalibrated = true;
      }
    } else if (Math.abs(clavicleDist - this.baselineClavicleDistance) < 0.02) {
      // Slow micro-adaptation when standing quietly at baseline
      this.baselineClavicleDistance = this.baselineClavicleDistance * 0.995 + clavicleDist * 0.005;
    }

    const baseline = Math.max(0.08, this.baselineClavicleDistance);
    this.currentProximityRatio = clavicleDist / baseline;

    let targetZ = TennisSpatialTracker.BASELINE_Z;
    if (this.currentProximityRatio >= 1.0) {
      // Stepping forward toward camera (ratio 1.0 to 1.5):
      // 0.5m physical step corresponds to ~1.28x - 1.35x torso scale increase
      // Translates avatar smoothly from baseline (-11.5m) to service line (-6.0m) and net volley zone (-3.5m)
      const forwardT = THREE.MathUtils.clamp((this.currentProximityRatio - 1.0) / 0.45, 0.0, 1.0);
      // Smooth ergonomic S-curve
      const easedT = THREE.MathUtils.smoothstep(forwardT, 0.0, 1.0);
      targetZ = THREE.MathUtils.lerp(
        TennisSpatialTracker.BASELINE_Z,
        TennisSpatialTracker.VOLLEY_ZONE_Z,
        easedT
      );
    } else {
      // Stepping backward away from camera (ratio < 1.0):
      // Translates avatar backward to deep baseline defense (-12.5m)
      const backT = THREE.MathUtils.clamp((1.0 - this.currentProximityRatio) / 0.20, 0.0, 1.0);
      targetZ = THREE.MathUtils.lerp(
        TennisSpatialTracker.BASELINE_Z,
        TennisSpatialTracker.DEEP_DEFENSE_Z,
        backT
      );
    }

    // 4. Center Auto-Decay:
    // When torso velocity < 0.15 m/s for 1.2s, apply subtle drift correction back toward tactical center mark
    const instantaneousVel = new THREE.Vector3(
      (targetX - this.currentPosition.x) / safeDt,
      0,
      (targetZ - this.currentPosition.z) / safeDt
    );
    this.smoothedTorsoVelocity.lerp(instantaneousVel, Math.min(1.0, safeDt * 10));
    const planarSpeed = Math.hypot(this.smoothedTorsoVelocity.x, this.smoothedTorsoVelocity.z);

    if (planarSpeed < TennisSpatialTracker.IDLE_VELOCITY_THRESHOLD) {
      this.idleCenterTimer += safeDt;
      if (this.idleCenterTimer >= TennisSpatialTracker.IDLE_TRIGGER_TIME) {
        // Subtle drift correction back toward center without snapping avatar (speed ~0.35 m/s)
        const decayAlpha = Math.min(1.0, safeDt * 0.45);
        this.targetPosition.x = THREE.MathUtils.lerp(this.targetPosition.x, 0, decayAlpha);
        // Only decay depth if deep in court
        if (this.targetPosition.z > -8.0) {
          this.targetPosition.z = THREE.MathUtils.lerp(
            this.targetPosition.z,
            TennisSpatialTracker.TACTICAL_CENTER_Z,
            decayAlpha * 0.5
          );
        }
      }
    } else {
      this.idleCenterTimer = 0;
      this.targetPosition.set(targetX, 0, targetZ);
    }

    // 5. Responsive Spring Damping:
    // Fast response on explosive directional change, smoothly settled with zero jitter
    const lerpAlphaX = Math.min(1.0, 1.0 - Math.exp(-22.0 * safeDt));
    const lerpAlphaZ = Math.min(1.0, 1.0 - Math.exp(-14.0 * safeDt));

    const prevPos = this.currentPosition.clone();
    this.currentPosition.x = THREE.MathUtils.lerp(this.currentPosition.x, this.targetPosition.x, lerpAlphaX);
    this.currentPosition.z = THREE.MathUtils.lerp(this.currentPosition.z, this.targetPosition.z, lerpAlphaZ);

    this.currentVelocity.copy(this.currentPosition).sub(prevPos).divideScalar(safeDt);

    // 6. Split-step and Lunge evaluation for avatar animation
    if (planarSpeed > 2.2 && !this.isSplitStepping) {
      this.isSplitStepping = true;
      this.splitStepTimer = 0.25;
    }
    if (this.isSplitStepping) {
      this.splitStepTimer -= safeDt;
      if (this.splitStepTimer <= 0) {
        this.isSplitStepping = false;
      }
    }

    if (this.currentVelocity.x > 1.2) {
      this.lungeState = 'right';
    } else if (this.currentVelocity.x < -1.2) {
      this.lungeState = 'left';
    } else {
      this.lungeState = 'none';
    }

    return this.buildFootworkState();
  }

  public setManualPosition(x: number, z: number): void {
    this.targetPosition.set(
      THREE.MathUtils.clamp(x, -TennisSpatialTracker.COURT_HALF_WIDTH, TennisSpatialTracker.COURT_HALF_WIDTH),
      0,
      THREE.MathUtils.clamp(z, TennisSpatialTracker.DEEP_DEFENSE_Z, TennisSpatialTracker.VOLLEY_ZONE_Z)
    );
    this.currentPosition.copy(this.targetPosition);
  }

  public getPosition(): THREE.Vector3 {
    return this.currentPosition;
  }

  public getVelocity(): THREE.Vector3 {
    return this.currentVelocity;
  }

  public getProximityRatio(): number {
    return this.currentProximityRatio;
  }

  public isProximityMode(): boolean {
    return this.currentProximityRatio > 1.25;
  }

  private buildFootworkState(): TennisFootworkState {
    const latSpan = TennisSpatialTracker.COURT_HALF_WIDTH;
    const depthSpan = TennisSpatialTracker.VOLLEY_ZONE_Z - TennisSpatialTracker.BASELINE_Z;
    const normDepth = THREE.MathUtils.clamp(
      (this.currentPosition.z - TennisSpatialTracker.BASELINE_Z) / Math.max(0.1, depthSpan),
      0.0,
      1.0
    );

    return {
      position: this.currentPosition.clone(),
      velocity: this.currentVelocity.clone(),
      lateralShift: THREE.MathUtils.clamp(this.currentPosition.x / latSpan, -1.0, 1.0),
      depthRatio: normDepth,
      isLunging: this.lungeState !== 'none',
      lungeDirection: this.lungeState,
      isSplitStepping: this.isSplitStepping,
      proximityRatio: this.currentProximityRatio,
      isProximityMode: this.isProximityMode()
    };
  }
}
