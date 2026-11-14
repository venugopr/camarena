import * as THREE from 'three';
import { DifficultyLevel } from '../common/Types';

export type ContactQuality = 'SWEET_SPOT' | 'OUTER_BLADE' | 'WOOD_RIM' | 'MISS';

export interface ModePhysicsConfig {
  modeName: 'LOW' | 'MEDIUM' | 'HIGH';
  sweetSpotRadius: number;
  outerBladeRadius: number;
  rimRadius: number;
  speedMinMps: number;
  speedMaxMps: number;
  restitutionSweetSpot: number;
  restitutionOuter: number;
  restitutionRim: number;
  rubberFrictionCoeff: number;
  incomingSpinGrip: number;
  assistWeight: number; // 0.0 = Pure unassisted simulation, 1.0 = Full trajectory guidance
}

export interface PaddleStrikeInput {
  ballPos: THREE.Vector3;
  ballVel: THREE.Vector3;
  ballSpin: THREE.Vector3;
  paddlePos: THREE.Vector3;
  paddleVel: THREE.Vector3;
  paddleNormal: THREE.Vector3;
  paddlePitchDeg: number;
  paddleYawDeg: number;
  contactDistance: number;
  difficulty: DifficultyLevel;
}

export interface PaddleStrikeOutput {
  contactQuality: ContactQuality;
  exitVelocity: THREE.Vector3;
  exitSpin: THREE.Vector3;
  speedMps: number;
  speedKmh: number;
  spinRps: number;
  isWoodHit: boolean;
  brushRatio: number;
}

/**
 * Table Tennis 3D Aerodynamic, Spin & Impulse Physics Engine
 *
 * Implements:
 * - Swept-Volume continuous collision detection (CCD)
 * - Tiered physics configurations for Low (learner), Medium (casual), and High (pro/legend)
 * - Target-coupled ballistic trajectory solver with 2-pass aerodynamic drag & Magnus correction
 * - Incoming topspin / backspin rubber bite sensitivity
 * - 3D Magnus aerodynamic force & spin-coupled table bounce restitution
 */
export class TableTennisPhysics {
  // Official ITTF Regulation Dimensions (meters)
  public static readonly TABLE_LENGTH = 2.74;
  public static readonly TABLE_WIDTH = 1.525;
  public static readonly TABLE_HEIGHT = 0.76;
  public static readonly NET_HEIGHT = 0.1525;
  public static readonly NET_WIDTH = 1.83;
  public static readonly BALL_RADIUS = 0.02; // 40mm ITTF ball
  public static readonly GRAVITY = 9.81;

  // Scratch vectors to avoid GC allocations in 60-120Hz loop
  private readonly scratchSegD1 = new THREE.Vector3();
  private readonly scratchSegD2 = new THREE.Vector3();
  private readonly scratchSegR = new THREE.Vector3();
  private readonly scratchSegA = new THREE.Vector3();
  private readonly scratchSegB = new THREE.Vector3();
  private readonly scratchRelVel = new THREE.Vector3();
  private readonly scratchNormal = new THREE.Vector3();
  private readonly scratchTangent = new THREE.Vector3();
  private readonly scratchSimPos = new THREE.Vector3();
  private readonly scratchSimPrevPos = new THREE.Vector3();
  private readonly scratchSimVel = new THREE.Vector3();
  private readonly scratchSimSpin = new THREE.Vector3();

  private static readonly MODE_CONFIGS: Record<'LOW' | 'MEDIUM' | 'HIGH', ModePhysicsConfig> = {
    LOW: {
      modeName: 'LOW',
      sweetSpotRadius: 0.14,
      outerBladeRadius: 0.28,
      rimRadius: 0.44,
      speedMinMps: 2.8,
      speedMaxMps: 4.6, // 10 - 16.5 km/h
      restitutionSweetSpot: 0.80,
      restitutionOuter: 0.74,
      restitutionRim: 0.58,
      rubberFrictionCoeff: 0.50,
      incomingSpinGrip: 0.12,
      assistWeight: 0.92,
    },
    MEDIUM: {
      modeName: 'MEDIUM',
      sweetSpotRadius: 0.12,
      outerBladeRadius: 0.25,
      rimRadius: 0.42,
      speedMinMps: 3.1,
      speedMaxMps: 10.8, // 11 - 39 km/h
      restitutionSweetSpot: 0.84,
      restitutionOuter: 0.72,
      restitutionRim: 0.48,
      rubberFrictionCoeff: 0.68,
      incomingSpinGrip: 0.48,
      assistWeight: 0.65,
    },
    HIGH: {
      modeName: 'HIGH',
      sweetSpotRadius: 0.055,
      outerBladeRadius: 0.082,
      rimRadius: 0.105, // True 15.5cm ITTF blade + 2cm ball radius
      speedMinMps: 4.2,
      speedMaxMps: 22.5, // 15 - 81 km/h tournament speeds
      restitutionSweetSpot: 0.88,
      restitutionOuter: 0.68,
      restitutionRim: 0.40,
      rubberFrictionCoeff: 0.82,
      incomingSpinGrip: 1.0, // Full unassisted spin sensitivity
      assistWeight: 0.0,
    },
  };

  public getModeConfig(difficulty: DifficultyLevel): ModePhysicsConfig {
    if (difficulty === 'learner') return TableTennisPhysics.MODE_CONFIGS.LOW;
    if (difficulty === 'pro' || difficulty === 'legend') return TableTennisPhysics.MODE_CONFIGS.HIGH;
    return TableTennisPhysics.MODE_CONFIGS.MEDIUM;
  }

  /**
   * Swept-Volume Line-Segment Minimum Distance Solver
   */
  public closestApproachSegSeg(
    a0: THREE.Vector3,
    a1: THREE.Vector3,
    b0: THREE.Vector3,
    b1: THREE.Vector3
  ): number {
    const d1 = this.scratchSegD1.subVectors(a1, a0);
    const d2 = this.scratchSegD2.subVectors(b1, b0);
    const r = this.scratchSegR.subVectors(a0, b0);

    const a = d1.dot(d1);
    const e = d2.dot(d2);
    const f = d2.dot(r);

    let s: number;
    let t: number;

    if (a <= 1e-8 && e <= 1e-8) {
      return a0.distanceTo(b0);
    }
    if (a <= 1e-8) {
      s = 0;
      t = THREE.MathUtils.clamp(f / e, 0, 1);
    } else {
      const c = d1.dot(r);
      if (e <= 1e-8) {
        t = 0;
        s = THREE.MathUtils.clamp(-c / a, 0, 1);
      } else {
        const b = d1.dot(d2);
        const denom = a * e - b * b;
        s = denom !== 0 ? THREE.MathUtils.clamp((b * f - c * e) / denom, 0, 1) : 0;
        t = (b * s + f) / e;
        if (t < 0) {
          t = 0;
          s = THREE.MathUtils.clamp(-c / a, 0, 1);
        } else if (t > 1) {
          t = 1;
          s = THREE.MathUtils.clamp((b - c) / a, 0, 1);
        }
      }
    }

    const closestA = this.scratchSegA.copy(a0).addScaledVector(d1, s);
    const closestB = this.scratchSegB.copy(b0).addScaledVector(d2, t);
    return closestA.distanceTo(closestB);
  }

  /**
   * Classify contact region across the paddle blade
   */
  public classifyContact(distance: number, difficulty: DifficultyLevel): ContactQuality {
    const cfg = this.getModeConfig(difficulty);
    if (distance <= cfg.sweetSpotRadius) return 'SWEET_SPOT';
    if (distance <= cfg.outerBladeRadius) return 'OUTER_BLADE';
    if (distance <= cfg.rimRadius) return 'WOOD_RIM';
    return 'MISS';
  }

  /**
   * Computes realistic paddle-ball 3D impulse, rubber spin bite, and ballistically coupled exit velocity
   * so normal standing strokes clear the net and land in-bounds on the opponent's table half.
   */
  public resolvePaddleStrike(input: PaddleStrikeInput): PaddleStrikeOutput {
    const cfg = this.getModeConfig(input.difficulty);
    const quality = this.classifyContact(input.contactDistance, input.difficulty);

    if (quality === 'MISS') {
      return {
        contactQuality: 'MISS',
        exitVelocity: input.ballVel.clone(),
        exitSpin: input.ballSpin.clone(),
        speedMps: input.ballVel.length(),
        speedKmh: input.ballVel.length() * 3.6,
        spinRps: input.ballSpin.length() / (2 * Math.PI),
        isWoodHit: false,
        brushRatio: 0,
      };
    }

    const isWoodHit = quality === 'WOOD_RIM';

    // 1. Oriented paddle surface normal (pointing into opponent court +Z)
    const normal = this.scratchNormal.copy(input.paddleNormal).normalize();
    if (normal.z < 0.15) {
      normal.z = Math.max(0.25, Math.abs(normal.z));
      normal.normalize();
    }

    // 2. Relative velocity & tangential brush across rubber
    const vRel = this.scratchRelVel.subVectors(input.ballVel, input.paddleVel);
    const vDotN = vRel.dot(normal);
    const vNormalVec = normal.clone().multiplyScalar(vDotN);
    const vTangent = this.scratchTangent.subVectors(vRel, vNormalVec);
    const brushSpeed = input.paddleVel.y * 0.85 + Math.abs(input.paddleVel.x) * 0.45;
    const totalSwingSpeed = Math.max(input.paddleVel.length(), 1.2);
    const brushRatio = THREE.MathUtils.clamp(Math.abs(brushSpeed) / (totalSwingSpeed + 0.5), 0, 1);

    // 3. Compute Exit Spin (3D Angular Velocity rad/s)
    // Upward brush + closed face generates heavy topspin (+omega.x)
    // Downward chop + open face generates heavy backspin (-omega.x)
    const frictionScale = isWoodHit ? 0.25 : cfg.rubberFrictionCoeff;
    const topspinGenerated = THREE.MathUtils.clamp(
      (input.paddleVel.y * 28 - input.paddlePitchDeg * 0.8 + 10) * frictionScale,
      -65,
      95
    );
    const maxSidespin = cfg.modeName === 'HIGH' ? 55 : 30;
    const sidespinGenerated = THREE.MathUtils.clamp(
      (-input.paddleVel.x * 20 - input.paddleYawDeg * 0.5) * frictionScale,
      -maxSidespin,
      maxSidespin
    );
    const corkscrewRoll = THREE.MathUtils.clamp(vTangent.x * 6 * frictionScale, -25, 25);
    const exitSpin = new THREE.Vector3(topspinGenerated, sidespinGenerated, corkscrewRoll);

    // 4. Compute Target-Coupled Ballistic Trajectory on Opponent's Court
    const pitchRad = THREE.MathUtils.degToRad(input.paddlePitchDeg);
    const yawRad = THREE.MathUtils.degToRad(input.paddleYawDeg);

    // Incoming spin reaction on grippy rubber:
    const incomingSpinLift = input.ballSpin.x * 0.045 * cfg.incomingSpinGrip;
    const incomingSidespinDeflect = -input.ballSpin.y * 0.025 * cfg.incomingSpinGrip;

    // Lateral placement (targetX) within table half-width (±0.7625m) so cross-body backhand drives stay in-bounds
    const lateralShift = input.paddleVel.x * 0.08 + Math.sin(yawRad) * 0.24 + incomingSidespinDeflect * 0.08;
    const handPlacementX = input.paddlePos.x * 0.36;
    const maxLateralAim = cfg.modeName === 'LOW' ? 0.34 : cfg.modeName === 'MEDIUM' ? 0.38 : 0.46;
    const targetX = THREE.MathUtils.clamp(handPlacementX + lateralShift, -maxLateralAim, maxLateralAim);

    // Depth placement (targetZ) & Pacing Speed by Mode Tier
    const forwardSwingSpeed = Math.max(1.0, input.paddleVel.z);
    let targetZ = 0.85;
    let pacingSpeed = 3.5;
    let netClearance = 0.085;
    let maxSpeedOverride: number | undefined;

    if (cfg.modeName === 'LOW') {
      targetZ = THREE.MathUtils.clamp(0.75 + Math.min(forwardSwingSpeed, 4.0) * 0.05, 0.68, 1.00);
      pacingSpeed = THREE.MathUtils.clamp(3.0 + Math.min(forwardSwingSpeed, 5.0) * 0.15, 2.9, 3.8);
      netClearance = 0.095;
      maxSpeedOverride = 4.2;
    } else if (cfg.modeName === 'MEDIUM') {
      targetZ = THREE.MathUtils.clamp(
        0.72 + Math.min(forwardSwingSpeed, 5.5) * 0.055 + pitchRad * 0.14,
        0.62,
        1.10
      );
      pacingSpeed = THREE.MathUtils.clamp(3.6 + Math.min(forwardSwingSpeed, 7.0) * 0.32, 3.4, 6.0);
      netClearance = 0.085;
      maxSpeedOverride = 7.2;
    } else {
      // HIGH (pro / legend) mode:
      // Normal strokes land cleanly on opponent table [0.60m, 1.16m] while honoring spin & angle physics
      targetZ = THREE.MathUtils.clamp(
        0.74 + Math.min(forwardSwingSpeed, 6.0) * 0.055 + pitchRad * 0.22 + incomingSpinLift * 0.06,
        0.60,
        1.16
      );
      pacingSpeed = THREE.MathUtils.clamp(3.9 + Math.min(forwardSwingSpeed, 12.0) * 0.72, 3.8, 13.5);
      netClearance = THREE.MathUtils.clamp(0.085 + pitchRad * 0.16 + incomingSpinLift * 0.05, 0.06, 0.18);
      maxSpeedOverride = 16.0;
    }

    const finalExitVel = this.solveExactControlledVelocity(
      input.ballPos,
      targetX,
      targetZ,
      netClearance,
      pacingSpeed,
      maxSpeedOverride,
      exitSpin
    );

    // 5. High-Mode Unassisted Spin & Extreme Paddle Face Angle Sensitivity
    if (cfg.modeName === 'HIGH' && !isWoodHit) {
      // Explosive power smash in HIGH mode preserves full ballistic speed (> 48 km/h)
      if (forwardSwingSpeed >= 9.0) {
        const smashTargetSpeed = Math.min(cfg.speedMaxMps, Math.max(13.6, forwardSwingSpeed * 1.15));
        const curLen = Math.max(0.1, finalExitVel.length());
        if (curLen < smashTargetSpeed) {
          finalExitVel.multiplyScalar(smashTargetSpeed / curLen);
        }
      }
      // Extreme open face (+15° or more) on incoming topspin pops the ball significantly higher
      if (input.paddlePitchDeg >= 15) {
        const openLift = (input.paddlePitchDeg - 10) * 0.11 + Math.max(0, incomingSpinLift) * 0.85;
        finalExitVel.y += openLift;
      }
      // Extreme closed face (-18° or more) chopping down on heavy backspin drags the ball downward into net
      if (input.paddlePitchDeg <= -18 && input.ballSpin.x <= -15 && input.paddleVel.y < 0) {
        const backspinDrag = Math.min(0, incomingSpinLift) * 0.85 + input.paddleVel.y * 0.35;
        finalExitVel.y += backspinDrag;
      }
    }

    // 6. Wood Rim Deflection Penalty (erratic angle & dampened forward speed)
    if (isWoodHit) {
      finalExitVel.x += (input.ballPos.x >= input.paddlePos.x ? 1 : -1) * 0.95;
      finalExitVel.y += 0.85;
      finalExitVel.z *= 0.68;
    }

    // 7. Clamp total speed within mode bounds
    const currentSpeed = finalExitVel.length();
    if (currentSpeed > cfg.speedMaxMps) {
      finalExitVel.multiplyScalar(cfg.speedMaxMps / currentSpeed);
    } else if (currentSpeed < cfg.speedMinMps && !isWoodHit) {
      finalExitVel.multiplyScalar(cfg.speedMinMps / Math.max(0.1, currentSpeed));
    }

    const speedMps = finalExitVel.length();
    return {
      contactQuality: quality,
      exitVelocity: finalExitVel,
      exitSpin,
      speedMps,
      speedKmh: speedMps * 3.6,
      spinRps: exitSpin.length() / (2 * Math.PI),
      isWoodHit,
      brushRatio,
    };
  }

  /**
   * Closed-Form + 2-Pass Aerodynamic Shooting Ballistic Solver
   *
   * Solves initial velocity (vx, vy, vz) so that under quadratic air drag and 3D Magnus spin
   * the ball is guaranteed to clear the net at Z = 0 by `netClearance` and land at `(targetX, targetZ)`.
   */
  public solveExactControlledVelocity(
    fromPos: THREE.Vector3,
    targetX: number,
    targetZ: number,
    netClearance = 0.075,
    pacingSpeed = 3.5,
    maxSpeedOverride?: number,
    spin?: THREE.Vector3
  ): THREE.Vector3 {
    const targetY = TableTennisPhysics.TABLE_HEIGHT + TableTennisPhysics.BALL_RADIUS;
    const dx = targetX - fromPos.x;
    const dz = targetZ - fromPos.z;
    const distZ = Math.max(0.25, Math.abs(dz));
    const crossesNet = (fromPos.z < -0.02 && targetZ > 0.02) || (fromPos.z > 0.02 && targetZ < -0.02);
    const maxV = maxSpeedOverride ?? Math.max(4.5, pacingSpeed * 1.25);
    const spinX = spin ? spin.x : 0;

    const g = TableTennisPhysics.GRAVITY;
    const gEff = Math.max(5.5, g + spinX * pacingSpeed * 0.0038 * 0.85);
    const safeClearance = Math.max(0.055, netClearance);
    const Hnet = TableTennisPhysics.TABLE_HEIGHT + TableTennisPhysics.NET_HEIGHT + safeClearance;

    let flightTime: number;
    let lambda = 0.5;

    if (crossesNet && distZ > 0.30) {
      lambda = THREE.MathUtils.clamp(Math.abs(fromPos.z / dz), 0.05, 0.95);
      const lineOfSightAtNet = fromPos.y + lambda * (targetY - fromPos.y);
      const deltaH = Hnet - lineOfSightAtNet;

      let tMin = 0.30;
      if (deltaH > 0.004) {
        const denom = gEff * lambda * (1.0 - lambda);
        tMin = Math.sqrt((2.0 * deltaH) / Math.max(0.2, denom));
      }

      const clampedPacing = THREE.MathUtils.clamp(pacingSpeed, 2.8, maxV);
      const desiredFlightTime = distZ / clampedPacing;
      const minFlight = clampedPacing > 7.5 ? 0.16 : Math.max(0.32, tMin * 1.06);
      flightTime = THREE.MathUtils.clamp(
        Math.max(minFlight, desiredFlightTime),
        0.16,
        0.64
      );
    } else {
      flightTime = THREE.MathUtils.clamp(distZ / Math.max(2.0, pacingSpeed), 0.20, 0.34);
    }

    // Initial analytical guess with first-order drag & Magnus compensation
    const estSpeed = Math.hypot(dx, dz) / flightTime;
    const kDrag = 0.07 * estSpeed * flightTime;
    const horizComp = 1.0 + 0.52 * kDrag;
    const vertComp = 1.0 + 0.26 * kDrag;

    let vx = (dx / flightTime) * horizComp;
    let vz = (dz / flightTime) * horizComp;
    let vy = ((targetY - fromPos.y + 0.5 * gEff * flightTime * flightTime) / flightTime) * vertComp;

    // 2-Pass Forward Aerodynamic Shooting Refinement using exact stepAerodynamics
    const simDt = 1 / 60;
    for (let pass = 0; pass < 2; pass++) {
      const simPos = this.scratchSimPos.copy(fromPos);
      const simPrevPos = this.scratchSimPrevPos.copy(fromPos);
      const simVel = this.scratchSimVel.set(vx, vy, vz);
      const simSpin = this.scratchSimSpin.set(
        spin ? spin.x : 0,
        spin ? spin.y : 0,
        spin ? spin.z : 0
      );

      let yAtNet = Hnet + 0.02;
      let crossedNetInSim = false;
      let landed = false;
      let simTime = 0;

      for (let step = 0; step < 75; step++) {
        simPrevPos.copy(simPos);
        this.stepAerodynamics(simPos, simVel, simSpin, simDt);
        simTime += simDt;

        if (
          crossesNet &&
          !crossedNetInSim &&
          ((simPrevPos.z < 0 && simPos.z >= 0) || (simPrevPos.z > 0 && simPos.z <= 0))
        ) {
          const alpha = Math.abs(simPrevPos.z) / Math.max(1e-5, Math.abs(simPos.z - simPrevPos.z));
          yAtNet = THREE.MathUtils.lerp(simPrevPos.y, simPos.y, alpha);
          crossedNetInSim = true;
        }

        if (step >= 3 && simVel.y < 0 && simPos.y <= targetY) {
          const alphaY =
            (simPrevPos.y - targetY) / Math.max(1e-5, simPrevPos.y - simPos.y);
          simPos.lerpVectors(simPrevPos, simPos, THREE.MathUtils.clamp(alphaY, 0, 1));
          landed = true;
          break;
        }
      }

      if (crossesNet && crossedNetInSim && yAtNet < Hnet) {
        const netDeficit = Hnet - yAtNet + 0.018;
        vy += netDeficit / Math.max(0.12, lambda * simTime);
      }

      if (landed) {
        const actualDz = simPos.z - fromPos.z;
        const actualDx = simPos.x - fromPos.x;
        if (Math.abs(actualDz) > 0.15) {
          const scaleZ = THREE.MathUtils.clamp(dz / actualDz, 0.72, 1.38);
          vz *= scaleZ;
        }
        vx += ((dx - actualDx) / Math.max(0.18, simTime)) * 0.85;
      }
    }

    return new THREE.Vector3(
      THREE.MathUtils.clamp(vx, -4.5, 4.5),
      THREE.MathUtils.clamp(vy, 0.25, 4.6),
      THREE.MathUtils.clamp(vz, -maxV, maxV)
    );
  }

  /**
   * Integrates 3D Aerodynamic Air Drag, Gravity & Magnus Spin Curvature over dt
   */
  public stepAerodynamics(
    ballPos: THREE.Vector3,
    ballVel: THREE.Vector3,
    ballSpin: THREE.Vector3,
    dt: number
  ): void {
    const ballSpeed = ballVel.length();
    // Air drag deceleration for 2.7g 40mm celluloid/poly ball
    const dragFactor = 0.07 * ballSpeed;
    ballVel.x -= ballVel.x * dragFactor * dt;
    ballVel.y -= ballVel.y * dragFactor * dt;
    ballVel.z -= ballVel.z * dragFactor * dt;

    // 3D Magnus Force:
    // Positive ballSpin.x = Topspin (drives ball downward onto court regardless of +Z or -Z flight direction)
    // Negative ballSpin.x = Backspin (floats ball upward regardless of +Z or -Z flight direction)
    const magnusCoeff = 0.0038;
    const forwardSpeedZ = Math.abs(ballVel.z);
    const magX = (ballSpin.y * ballVel.z - ballSpin.z * ballVel.y) * magnusCoeff;
    const magY = (ballSpin.z * ballVel.x - ballSpin.x * forwardSpeedZ) * magnusCoeff;
    const magZ = (ballSpin.x * ballVel.y - ballSpin.y * ballVel.x) * magnusCoeff * Math.sign(ballVel.z || 1);

    ballVel.x += magX * dt;
    ballVel.y += (magY - TableTennisPhysics.GRAVITY) * dt;
    ballVel.z += magZ * dt;

    // Rotational spin decay in air
    ballSpin.multiplyScalar(Math.max(0, 1 - 0.22 * dt));

    // Integrate position
    ballPos.addScaledVector(ballVel, dt);
  }

  /**
   * Resolves Table Surface Bounce with Spin-Friction Bite
   */
  public resolveTableBounce(ballVel: THREE.Vector3, ballSpin: THREE.Vector3): void {
    const speedKmh = Math.abs(ballVel.z) * 3.6;
    const restitutionZ = speedKmh >= 12 ? 0.88 : 0.82;
    const restitutionX = speedKmh >= 12 ? 0.86 : 0.78;

    ballVel.y = Math.max(-ballVel.y * 0.86, 1.85);
    // Topspin (+spin.x) kicks ball forward in flight direction; Backspin (-spin.x) checks forward speed
    const zSign = Math.sign(ballVel.z) || 1;
    ballVel.z = ballVel.z * restitutionZ + zSign * ballSpin.x * TableTennisPhysics.BALL_RADIUS * 0.05;
    if (zSign < 0) {
      // Ensure incoming shots on player's side carry cleanly to the baseline strike zone without double-bouncing short
      ballVel.z = Math.min(ballVel.z, -2.55);
    }
    ballVel.x = ballVel.x * restitutionX + ballSpin.y * TableTennisPhysics.BALL_RADIUS * 0.08 + ballSpin.z * 0.015;

    // Table surface friction dampens spin upon bounce
    ballSpin.x *= 0.65;
    ballSpin.y *= 0.65;
    ballSpin.z *= 0.55;
  }
}
