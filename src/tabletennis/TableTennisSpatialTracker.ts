import * as THREE from 'three';
import { Landmark3D, MotionFrame, PoseLandmark } from '../common/Types';

export type StrokeSide = 'FOREHAND' | 'BACKHAND';
export type MovementActionLabel =
  | 'READY STANCE'
  | 'STEP RIGHT ❯❯'
  | '❮❮ STEP LEFT'
  | 'HAND RIGHT (FOREHAND) ❯❯'
  | '❮❮ HAND LEFT (BACKHAND)'
  | 'FOREHAND DRIVE ⚡'
  | 'BACKHAND DRIVE ⚡'
  | 'SMASH 💥';

/**
 * Biomechanical Standing Stance, 1:1 Racket Orientation, Lateral Hand/Body Reach & Two-Handed Serve Tracker
 *
 * Translates 33 3D/2D MediaPipe Pose landmarks into:
 * - Jitter-free, deadzone-stabilized 3D paddle position across the full table width
 * - Smoothly filtered forearm-wrist paddle face orientation (pitch, yaw, roll, 3D normal)
 * - Hysteresis-stabilized Forehand vs. Backhand stance classification
 * - Real-time lateral body step & hand movement action detection (Left / Right)
 * - Non-dominant open-palm vertical serve toss detection (>= 16cm ITTF standard)
 */
export class TableTennisSpatialTracker {
  public strokeSide: StrokeSide = 'FOREHAND';
  public pitchDeg = -14;
  public yawDeg = 0;
  public paddleNormal = new THREE.Vector3(0, 0.24, 0.97).normalize();
  public playerFootworkZ = -1.45;
  public headParallaxOffset = new THREE.Vector2(0, 0);
  public activeMovementAction: MovementActionLabel = 'READY STANCE';
  public handLateralOffset = 0;
  public bodyLateralVelX = 0;
  public screenWristSpeed = 0;
  public screenWristVelY = 0;
  public serveDownwardDrop2D = 0;
  public isHandHangingIdle = false;
  public isHandRaisedForPlay = true;
  public activeHand: 'right' | 'left' = 'right';

  // Smoothed rotational state to eliminate 60Hz webcam micro-tremor / racket shaking
  private smoothedPitchRad = -0.22;
  private smoothedYawRad = 0;
  private smoothedRollRad = -0.12;
  private isRotationInitialized = false;

  // Smoothed 3D paddle target state with adaptive deadzone
  private smoothedPaddlePos = new THREE.Vector3(0.0, 0.92, -1.36);
  private smoothedPushZ = 0;
  private isPaddlePosInitialized = false;
  private prevTrackedPlayerX = 0;
  private prevWrist2DX = 0;
  private prevWrist2DY = 0;
  private servePeakWrist2DY = 1.0;
  private hasPrevWrist2D = false;
  private lastMotionTimestamp = -1;

  private prevNonDomWristY = 0;
  private nonDomRestBaselineY = 0;
  private hasPrevNonDom = false;
  private nonDomUpwardVel = 0;

  private readonly scratchEuler = new THREE.Euler();

  public reset(): void {
    this.hasPrevNonDom = false;
    this.nonDomUpwardVel = 0;
    this.pitchDeg = -14;
    this.yawDeg = 0;
    this.strokeSide = 'FOREHAND';
    this.activeMovementAction = 'READY STANCE';
    this.screenWristSpeed = 0;
    this.screenWristVelY = 0;
    this.serveDownwardDrop2D = 0;
    this.servePeakWrist2DY = 1.0;
    this.smoothedPushZ = 0;
    this.isHandHangingIdle = false;
    this.isHandRaisedForPlay = true;
    this.hasPrevWrist2D = false;
    this.lastMotionTimestamp = -1;
    this.paddleNormal.set(0, 0.24, 0.97).normalize();
    this.isRotationInitialized = false;
    this.isPaddlePosInitialized = false;
  }

  /**
   * Computes stabilized 1:1 3D paddle position directly from torso + wrist landmarks
   * without feedback oscillation from Avatar3D.poseArmsToTargets.
   */
  public computeStabilizedPaddleTarget(
    motionFrame: MotionFrame | null,
    dominantHand: 'right' | 'left',
    playerX: number,
    tableHeight: number,
    dt: number,
    isReadyServe = false
  ): THREE.Vector3 {
    const safeDt = Math.max(0.008, dt);
    const effectiveHand = motionFrame?.metrics?.dominantArm ?? dominantHand;
    this.activeHand = effectiveHand;
    const isLeft = effectiveHand === 'left';
    const wristIdx = isLeft ? PoseLandmark.LEFT_WRIST : PoseLandmark.RIGHT_WRIST;

    let rawX = playerX + (isLeft ? 0.06 : -0.06);
    let rawY = tableHeight + 0.16;
    let rawZ = -1.36;

    if (motionFrame && motionFrame.worldLandmarks && motionFrame.worldLandmarks.length > 20) {
      const worldLms = motionFrame.worldLandmarks;
      const rawLms = motionFrame.rawLandmarks;
      const wristWorld = worldLms[wristIdx];
      const lShWorld = worldLms[PoseLandmark.LEFT_SHOULDER];
      const rShWorld = worldLms[PoseLandmark.RIGHT_SHOULDER];
      const lHipWorld = worldLms[PoseLandmark.LEFT_HIP];
      const rHipWorld = worldLms[PoseLandmark.RIGHT_HIP];

      // 0. Measure true 2D planar wrist velocity only when a new camera frame arrives (avoids 60Hz render zeroing)
      const wrist2DSource = (rawLms && rawLms[wristIdx] && (rawLms[wristIdx].visibility ?? 1) > 0.25)
        ? rawLms[wristIdx]
        : wristWorld;
      const isNewCameraFrame =
        motionFrame.timestamp !== this.lastMotionTimestamp ||
        (wrist2DSource && (Math.abs(wrist2DSource.x - this.prevWrist2DX) > 1e-5 || Math.abs(wrist2DSource.y - this.prevWrist2DY) > 1e-5));

      if (wrist2DSource && isNewCameraFrame) {
        const frameDt = this.lastMotionTimestamp > 0 && motionFrame.timestamp > this.lastMotionTimestamp
          ? THREE.MathUtils.clamp((motionFrame.timestamp - this.lastMotionTimestamp) / 1000, 0.008, 0.12)
          : safeDt;
        if (this.hasPrevWrist2D) {
          const dx2D = wrist2DSource.x - this.prevWrist2DX;
          const dy2D = wrist2DSource.y - this.prevWrist2DY;
          const instScreenSpeed = Math.hypot(dx2D, dy2D) / frameDt;
          const instVelY = dy2D / frameDt; // Positive when bringing racket DOWN in 2D camera view (+Y is downward)
          if (instScreenSpeed < 0.12) {
            this.screenWristSpeed = THREE.MathUtils.lerp(this.screenWristSpeed, 0, 0.55);
            this.screenWristVelY = THREE.MathUtils.lerp(this.screenWristVelY, 0, 0.55);
            if (this.screenWristSpeed < 0.06) this.screenWristSpeed = 0;
            if (Math.abs(this.screenWristVelY) < 0.04) this.screenWristVelY = 0;
          } else {
            this.screenWristSpeed = THREE.MathUtils.lerp(this.screenWristSpeed, instScreenSpeed, 0.55);
            this.screenWristVelY = THREE.MathUtils.lerp(this.screenWristVelY, instVelY, 0.58);
          }

          if (isReadyServe) {
            // Track highest wrist apex (minimum 2D Y) during serve preparation / upward cocking
            if (dy2D < -0.002 || wrist2DSource.y < this.servePeakWrist2DY) {
              this.servePeakWrist2DY = Math.min(this.servePeakWrist2DY, wrist2DSource.y);
            }
            // Measure downward drop from the cocked/ready wrist apex when bringing the racket down
            if (dy2D > 0.002) {
              this.serveDownwardDrop2D = Math.max(0, wrist2DSource.y - this.servePeakWrist2DY);
            } else if (dy2D < -0.006) {
              this.serveDownwardDrop2D = 0;
            }
          } else {
            this.servePeakWrist2DY = wrist2DSource.y;
            this.serveDownwardDrop2D = 0;
          }
        } else {
          this.hasPrevWrist2D = true;
          this.screenWristSpeed = 0;
          this.screenWristVelY = 0;
          this.servePeakWrist2DY = wrist2DSource.y;
          this.serveDownwardDrop2D = 0;
        }
        this.prevWrist2DX = wrist2DSource.x;
        this.prevWrist2DY = wrist2DSource.y;
        this.lastMotionTimestamp = motionFrame.timestamp;
      }

      // Detect if player's active hand is in table-tennis play zone (waist/hip height or higher) vs. hanging down idle at mid-thigh
      if (wristWorld && lHipWorld && rHipWorld) {
        const refHipY = (lHipWorld.y + rHipWorld.y) * 0.5;
        this.isHandRaisedForPlay = wristWorld.y < refHipY + 0.12;
        this.isHandHangingIdle = (wristWorld.y >= refHipY + 0.10) && (this.screenWristSpeed < 0.16);
      } else {
        this.isHandRaisedForPlay = true;
        this.isHandHangingIdle = false;
      }

      // 1. Direct 1:1 lateral hand reach relative to torso centerline
      // Center of chest = center of table (X ≈ 0); Curtain/Right side = Right half (X < 0); Door/Left side = Left half (X > 0)
      const neutralWorldX = isLeft ? 0.04 : -0.04;
      let relHandX = isLeft ? 0.04 : -0.04;
      if (wristWorld && lShWorld && rShWorld) {
        const torsoWorldX = (lShWorld.x + rShWorld.x) * 0.5;
        const worldRelX = ((wristWorld.x - torsoWorldX) - neutralWorldX) * 1.70;
        relHandX = worldRelX;
      }

      if (rawLms && rawLms[wristIdx] && (rawLms[wristIdx].visibility ?? 1) > 0.3) {
        const wrist2D = rawLms[wristIdx];
        const lSh2D = rawLms[PoseLandmark.LEFT_SHOULDER];
        const rSh2D = rawLms[PoseLandmark.RIGHT_SHOULDER];
        if (lSh2D && rSh2D && (lSh2D.visibility ?? 1) > 0.3 && (rSh2D.visibility ?? 1) > 0.3) {
          const torso2DX = (lSh2D.x + rSh2D.x) * 0.5;
          const neutral2DX = isLeft ? 0.02 : -0.02;
          const screenRelX = ((wrist2D.x - torso2DX) - neutral2DX) * 2.25;
          relHandX = relHandX * 0.40 + screenRelX * 0.60;
        }
      }

      this.handLateralOffset = this.isHandHangingIdle
        ? 0
        : THREE.MathUtils.clamp(relHandX, -0.66, 0.66);
      // Clamp lateral paddle position to table width (±0.74m) so paddle stays over the table surface
      rawX = THREE.MathUtils.clamp(playerX + this.handLateralOffset, -0.74, 0.74);

      // 2. Vertical paddle height & forward depth (kept in natural table-tennis strike plane below net projection)
      if (wristWorld) {
        if (this.isHandHangingIdle && !isReadyServe) {
          // Hand is hanging down by player's thigh during rally: hold paddle at low baseline ready height
          this.smoothedPushZ = 0;
          rawY = tableHeight + 0.08;
          rawZ = -1.38;
        } else if (this.isHandHangingIdle && isReadyServe) {
          // Hand is hanging down before serve: hold docked paddle steady near center baseline
          this.smoothedPushZ = 0;
          rawX = THREE.MathUtils.clamp(playerX * 0.5, -0.22, 0.22);
          rawY = tableHeight + 0.14;
          rawZ = -1.36;
        } else {
          const refHipY = lHipWorld && rHipWorld ? (lHipWorld.y + rHipWorld.y) * 0.5 : 0;
          const heightAboveHip = Math.max(0, -(wristWorld.y - (refHipY + 0.06)));
          rawY = THREE.MathUtils.clamp(tableHeight + 0.10 + heightAboveHip * 0.34, tableHeight + 0.06, tableHeight + 0.25);

          // Smooth forward stroke push when hand is moving in 2D camera view
          if (this.isHandRaisedForPlay && this.screenWristSpeed >= 0.15) {
            const refTorsoZ = lShWorld && rShWorld ? (lShWorld.z + rShWorld.z) * 0.5 : 0;
            const forwardReachZ = Math.max(0, -(wristWorld.z - refTorsoZ));
            const targetPushZ = Math.min(
              0.28,
              forwardReachZ * 0.50 + heightAboveHip * 0.16 + this.screenWristSpeed * 0.22
            );
            this.smoothedPushZ = THREE.MathUtils.lerp(this.smoothedPushZ, targetPushZ, 0.48);
          } else {
            this.smoothedPushZ = THREE.MathUtils.lerp(this.smoothedPushZ, 0, 0.35);
            if (this.smoothedPushZ < 0.008) this.smoothedPushZ = 0;
          }
          rawZ = THREE.MathUtils.clamp(-1.36 + this.smoothedPushZ, -1.45, -1.06);
        }
      }
    }

    if (!this.isPaddlePosInitialized) {
      this.smoothedPaddlePos.set(rawX, rawY, rawZ);
      this.isPaddlePosInitialized = true;
      return this.smoothedPaddlePos;
    }

    // Adaptive deadzone & velocity-scaled EMA filter to stop resting racket shaking completely
    const dx = rawX - this.smoothedPaddlePos.x;
    const dy = rawY - this.smoothedPaddlePos.y;
    const dz = rawZ - this.smoothedPaddlePos.z;
    const deltaDist = Math.hypot(dx, dy, dz);

    // Deadzone: suppress sub-9mm camera sensor noise when player's hand is held steady
    if (deltaDist < 0.009) {
      return this.smoothedPaddlePos;
    }

    // Adaptive smoothing: gentle when moving slowly (0.24), fast 1:1 tracking when swinging (up to 0.78)
    const speedMps = deltaDist / safeDt;
    const alpha = THREE.MathUtils.clamp(0.22 + (speedMps / 4.5) * 0.56, 0.22, 0.78);
    this.smoothedPaddlePos.x = THREE.MathUtils.lerp(this.smoothedPaddlePos.x, rawX, alpha);
    this.smoothedPaddlePos.y = THREE.MathUtils.lerp(this.smoothedPaddlePos.y, rawY, alpha);
    this.smoothedPaddlePos.z = THREE.MathUtils.lerp(this.smoothedPaddlePos.z, rawZ, alpha);

    return this.smoothedPaddlePos;
  }

  /**
   * Computes stabilized 1:1 biomechanical paddle orientation, Forehand/Backhand stance,
   * left/right movement action label, head motion parallax, and non-dominant hand toss velocity.
   */
  public evaluateBiomechanics(
    motionFrame: MotionFrame | null,
    dominantHand: 'right' | 'left',
    targetPaddlePos: THREE.Vector3,
    paddleVel: THREE.Vector3,
    isReadyServe: boolean,
    dt: number,
    playerX = 0
  ): {
    pitchRad: number;
    yawRad: number;
    rollRad: number;
    pitchDeg: number;
    yawDeg: number;
    strokeSide: StrokeSide;
    paddleNormal: THREE.Vector3;
    headParallax: THREE.Vector2;
    footworkZ: number;
    isTossGesture: boolean;
    nonDomVelY: number;
    movementAction: MovementActionLabel;
  } {
    const safeDt = Math.max(0.008, dt);
    let forearmAngleX = 0;
    let forearmAngleY = 0;
    let isTossGesture = false;

    const rawBodyVelX = (playerX - this.prevTrackedPlayerX) / safeDt;
    this.bodyLateralVelX = THREE.MathUtils.lerp(this.bodyLateralVelX, rawBodyVelX, 0.35);
    this.prevTrackedPlayerX = playerX;

    const effectiveHand = motionFrame?.metrics?.dominantArm ?? dominantHand;
    this.activeHand = effectiveHand;
    if (motionFrame && motionFrame.worldLandmarks && motionFrame.worldLandmarks.length >= 25) {
      const lms: Landmark3D[] = motionFrame.worldLandmarks;
      const isLeft = effectiveHand === 'left';

      const wristIdx = isLeft ? PoseLandmark.LEFT_WRIST : PoseLandmark.RIGHT_WRIST;
      const elbowIdx = isLeft ? PoseLandmark.LEFT_ELBOW : PoseLandmark.RIGHT_ELBOW;
      const lSh = lms[PoseLandmark.LEFT_SHOULDER];
      const rSh = lms[PoseLandmark.RIGHT_SHOULDER];

      const wrist = lms[wristIdx];
      const elbow = lms[elbowIdx];

      // 1. Forehand vs. Backhand Stance Classification with Hysteresis (prevents center-line roll chattering)
      if (wrist && lSh && rSh) {
        const torsoCenterX = (lSh.x + rSh.x) * 0.5;
        // In Three.js / MediaPipe world coordinates: negative X is player's right side, positive X is player's left side
        const relWristX = wrist.x - torsoCenterX;
        const hysteresis = 0.045;
        if (!isLeft) {
          if (this.strokeSide === 'FOREHAND' && relWristX > hysteresis) {
            this.strokeSide = 'BACKHAND';
          } else if (this.strokeSide === 'BACKHAND' && relWristX < -hysteresis * 0.5) {
            this.strokeSide = 'FOREHAND';
          }
        } else {
          if (this.strokeSide === 'FOREHAND' && relWristX < -hysteresis) {
            this.strokeSide = 'BACKHAND';
          } else if (this.strokeSide === 'BACKHAND' && relWristX > hysteresis * 0.5) {
            this.strokeSide = 'FOREHAND';
          }
        }
      }

      // 2. Forearm Angles (using stable wrist-to-elbow vector; avoids noisy finger tips)
      if (wrist && elbow) {
        forearmAngleX = THREE.MathUtils.clamp((wrist.x - elbow.x) * 0.55, -0.35, 0.35);
        forearmAngleY = THREE.MathUtils.clamp((wrist.y - elbow.y) * 0.55, -0.32, 0.32);
      }

      // 3. Standing Depth Footwork (Stepping in toward table vs. backing up behind baseline)
      const lHip = lms[PoseLandmark.LEFT_HIP];
      const rHip = lms[PoseLandmark.RIGHT_HIP];
      if (lHip && rHip) {
        const hipZ = (lHip.z + rHip.z) * 0.5;
        const targetFootworkZ = THREE.MathUtils.clamp(-1.42 - hipZ * 0.9, -1.78, -0.95);
        this.playerFootworkZ = THREE.MathUtils.lerp(this.playerFootworkZ, targetFootworkZ, Math.min(1, safeDt * 8));
      }

      // 4. Head-Tracked Motion Parallax for 3D Depth Perception on 2D Screens
      const nose = lms[PoseLandmark.NOSE];
      if (nose && (nose.visibility ?? 1) > 0.4) {
        const targetPx = THREE.MathUtils.clamp(-nose.x * 0.12, -0.08, 0.08);
        const targetPy = THREE.MathUtils.clamp(-nose.y * 0.06, -0.05, 0.05);
        this.headParallaxOffset.x = THREE.MathUtils.lerp(this.headParallaxOffset.x, targetPx, Math.min(1, safeDt * 8));
        this.headParallaxOffset.y = THREE.MathUtils.lerp(this.headParallaxOffset.y, targetPy, Math.min(1, safeDt * 8));
      }

      // 5. Two-Handed Standing Serve Toss Detector (Non-Dominant Open Palm)
      const nonDomWristIdx = isLeft ? PoseLandmark.RIGHT_WRIST : PoseLandmark.LEFT_WRIST;
      const nonDomWrist = lms[nonDomWristIdx];
      if (nonDomWrist && (nonDomWrist.visibility ?? 1) > 0.35) {
        const nonDomY = (1.4 - nonDomWrist.y) * 1.6;
        if (this.hasPrevNonDom) {
          const rawVelY = (nonDomY - this.prevNonDomWristY) / safeDt;
          this.nonDomUpwardVel = THREE.MathUtils.lerp(this.nonDomUpwardVel, rawVelY, 0.5);
          if (Math.abs(this.nonDomUpwardVel) < 0.25) {
            this.nonDomRestBaselineY = THREE.MathUtils.lerp(this.nonDomRestBaselineY, nonDomY, 0.25);
          }
          const liftDisplacement = nonDomY - this.nonDomRestBaselineY;
          if (isReadyServe && liftDisplacement >= 0.12 && this.nonDomUpwardVel >= 0.85) {
            isTossGesture = true;
          }
        } else {
          this.hasPrevNonDom = true;
          this.nonDomRestBaselineY = nonDomY;
          this.nonDomUpwardVel = 0;
        }
        this.prevNonDomWristY = nonDomY;
      }
    }

    // 6. Classify Live Left / Right Body & Hand Movement Action
    // Note: In Three.js court space looking toward +Z, -X is Screen-Right (Forehand for right-hander) and +X is Screen-Left (Backhand for right-hander)
    const swingSpeed = paddleVel.length();
    if (!this.isHandHangingIdle && this.isHandRaisedForPlay && swingSpeed > 4.2 && paddleVel.z > 2.5) {
      this.activeMovementAction = 'SMASH 💥';
    } else if (!this.isHandHangingIdle && this.isHandRaisedForPlay && swingSpeed > 1.8 && Math.abs(paddleVel.x) > 0.45) {
      this.activeMovementAction = paddleVel.x < 0 ? 'FOREHAND DRIVE ⚡' : 'BACKHAND DRIVE ⚡';
    } else if (!this.isHandHangingIdle && this.isHandRaisedForPlay && (Math.abs(paddleVel.x) > 0.35 || Math.abs(this.handLateralOffset) > 0.16)) {
      const isHandRight = paddleVel.x < -0.35 || (Math.abs(paddleVel.x) <= 0.35 && this.handLateralOffset < -0.16);
      this.activeMovementAction = isHandRight ? 'HAND RIGHT (FOREHAND) ❯❯' : '❮❮ HAND LEFT (BACKHAND)';
    } else if (Math.abs(this.bodyLateralVelX) > 0.28 || Math.abs(playerX) > 0.22) {
      const isBodyRight = this.bodyLateralVelX < -0.28 || (Math.abs(this.bodyLateralVelX) <= 0.28 && playerX < -0.22);
      this.activeMovementAction = isBodyRight ? 'STEP RIGHT ❯❯' : '❮❮ STEP LEFT';
    } else {
      this.activeMovementAction = 'READY STANCE';
    }

    // 7. Compute Target Paddle Pitch, Yaw, Roll & Apply Exponential Smoothing + Deadzone
    const basePitch = isReadyServe ? -0.56 : -0.22;
    const rawPitchRad = basePitch + forearmAngleY * 0.65;
    const rawYawRad = THREE.MathUtils.clamp(
      -targetPaddlePos.x * 0.24 + forearmAngleX * 0.65,
      -0.46,
      0.46
    );
    const baseRoll = effectiveHand === 'left' ? 0.12 : -0.12;
    const rawRollRad = this.strokeSide === 'BACKHAND' ? -baseRoll * 1.25 : baseRoll;

    if (!this.isRotationInitialized) {
      this.smoothedPitchRad = rawPitchRad;
      this.smoothedYawRad = rawYawRad;
      this.smoothedRollRad = rawRollRad;
      this.isRotationInitialized = true;
    } else {
      const rotAlpha = swingSpeed > 1.5 ? 0.35 : 0.16;
      if (Math.abs(rawPitchRad - this.smoothedPitchRad) > 0.012) {
        this.smoothedPitchRad = THREE.MathUtils.lerp(this.smoothedPitchRad, rawPitchRad, rotAlpha);
      }
      if (Math.abs(rawYawRad - this.smoothedYawRad) > 0.012) {
        this.smoothedYawRad = THREE.MathUtils.lerp(this.smoothedYawRad, rawYawRad, rotAlpha);
      }
      if (Math.abs(rawRollRad - this.smoothedRollRad) > 0.012) {
        this.smoothedRollRad = THREE.MathUtils.lerp(this.smoothedRollRad, rawRollRad, 0.18);
      }
    }

    this.pitchDeg = THREE.MathUtils.radToDeg(this.smoothedPitchRad + 0.22);
    this.yawDeg = THREE.MathUtils.radToDeg(this.smoothedYawRad);

    // Derive 3D surface normal pointing toward opponent court (+Z)
    this.scratchEuler.set(this.smoothedPitchRad, this.smoothedYawRad, this.smoothedRollRad, 'XYZ');
    this.paddleNormal.set(0, 0, 1).applyEuler(this.scratchEuler).normalize();
    if (this.paddleNormal.z < 0.2) {
      this.paddleNormal.z = Math.abs(this.paddleNormal.z) + 0.3;
      this.paddleNormal.normalize();
    }

    return {
      pitchRad: this.smoothedPitchRad,
      yawRad: this.smoothedYawRad,
      rollRad: this.smoothedRollRad,
      pitchDeg: this.pitchDeg,
      yawDeg: this.yawDeg,
      strokeSide: this.strokeSide,
      paddleNormal: this.paddleNormal,
      headParallax: this.headParallaxOffset,
      footworkZ: this.playerFootworkZ,
      isTossGesture,
      nonDomVelY: this.nonDomUpwardVel,
      movementAction: this.activeMovementAction,
    };
  }
}
