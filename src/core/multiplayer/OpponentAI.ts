import { DifficultyLevel, Vector3D } from '../motion/Types';

export interface OpponentConfig {
  difficulty: DifficultyLevel;
  reactionTimeSec: number;
  speed: number;
  accuracy: number;     // 0 - 1
  smashChance: number;  // 0 - 1
}

export interface GamePacingProfile {
  modeName: 'casual' | 'normal' | 'pro';
  opponentSpeedZ: number;
  opponentLiftY: number;
  targetFlightTime: number;
  hitTimeWindow: number;
}

export const PACING_PROFILES: Record<string, GamePacingProfile> = {
  // Slow, high-arc clears that hang long enough to read and land in front of the player.
  casual: { modeName: 'casual', opponentSpeedZ: -4.4, opponentLiftY: 6.8, targetFlightTime: 1.85, hitTimeWindow: 550 },
  normal: { modeName: 'normal', opponentSpeedZ: -5.2, opponentLiftY: 6.2, targetFlightTime: 1.55, hitTimeWindow: 420 },
  pro: { modeName: 'pro', opponentSpeedZ: -6.0, opponentLiftY: 5.6, targetFlightTime: 1.35, hitTimeWindow: 320 }
};

export class OpponentAI {
  private config: OpponentConfig;
  public position: Vector3D;
  public velocity: Vector3D = { x: 0, y: 0, z: 0 };
  public isSwinging = false;
  public swingProgress = 0;
  private homePosition: Vector3D;
  private reactionTimer = 0;
  private targetPosition: Vector3D;
  private pacingProfile!: GamePacingProfile;

  constructor(difficulty: DifficultyLevel = 'casual', homePos: Vector3D = { x: 0, y: 0.9, z: 5 }) {
    this.homePosition = { ...homePos };
    this.position = { ...homePos };
    this.targetPosition = { ...homePos };
    this.config = this.getDifficultyConfig(difficulty);
    this.applyPacing(difficulty);
  }

  public setDifficulty(diff: DifficultyLevel): void {
    this.config = this.getDifficultyConfig(diff);
    this.applyPacing(diff);
  }

  private applyPacing(diff: DifficultyLevel): void {
    this.pacingProfile = PACING_PROFILES[diff === 'legend' ? 'pro' : diff === 'pro' ? 'normal' : 'casual'];
    this.windupDuration = diff === 'legend' ? 0.18 : diff === 'pro' ? 0.26 : 0.28;
  }

  private getDifficultyConfig(diff: DifficultyLevel): OpponentConfig {
    switch (diff) {
      case 'casual':
        return {
          difficulty: diff,
          reactionTimeSec: 0.20,
          speed: 3.5,
          accuracy: 0.78,
          smashChance: 0.15
        };
      case 'pro':
        return {
          difficulty: diff,
          reactionTimeSec: 0.14,
          speed: 5.2,
          accuracy: 0.92,
          smashChance: 0.45
        };
      case 'legend':
        return {
          difficulty: diff,
          reactionTimeSec: 0.05,
          speed: 7.0,
          accuracy: 0.98,
          smashChance: 0.75
        };
    }
  }

  public swingTarget: Vector3D = { x: 0, y: 1.5, z: 4.0 };
  public lastShotType: 'smash' | 'drop' | 'clear' | 'drive' = 'drive';
  public swingState: 'IDLE' | 'WINDUP' | 'STRIKING' = 'IDLE';
  public windupTimer = 0;
  public windupDuration = 0.45;

  /**
   * Update AI positioning and anticipation based on incoming ball/shuttlecock
   */
  public update(
    dt: number,
    projectilePos: Vector3D,
    projectileVel: Vector3D,
    courtBounds: { minX: number; maxX: number; minZ: number; maxZ: number },
    rallyCount = 0
  ): {
    didHit: boolean;
    hitVelocity: Vector3D | null;
    target?: { x: number; z: number };
    isSmash: boolean;
    shotType?: 'smash' | 'drop' | 'clear' | 'drive';
    isPreparingSwing: boolean;
    windupProgress: number;
  } {
    let didHit = false;
    let hitVel: Vector3D | null = null;
    let hitTarget: { x: number; z: number } | undefined = undefined;
    let isSmash = false;
    let isPreparingSwing = false;
    let windupProgress = 0;

    // Is projectile heading towards AI court (positive Z)?
    const isIncoming = projectileVel.z > 0.4;

    if (isIncoming) {
      this.reactionTimer += dt;
      if (this.reactionTimer >= this.config.reactionTimeSec) {
        // 3D Ballistic Trajectory Intercept Prediction
        // Estimate time when shuttlecock reaches comfortable strike height (y ≈ 1.35m)
        const g = 9.8;
        const currentY = projectilePos.y;
        const vy = projectileVel.y;
        const targetY = 1.35;
        
        // Quadratic equation for Y: y(t) = y0 + vy*t - 0.5*g*t^2 = targetY
        // 0.5*g*t^2 - vy*t + (targetY - y0) = 0
        const a = 0.5 * g;
        const b = -vy;
        const c = targetY - currentY;
        const disc = b * b - 4 * a * c;
        
        let timeToReach = 0.6;
        if (disc >= 0) {
          const t1 = (-b + Math.sqrt(disc)) / (2 * a);
          const t2 = (-b - Math.sqrt(disc)) / (2 * a);
          const posT = [t1, t2].filter(t => t > 0.05);
          if (posT.length > 0) {
            timeToReach = Math.min(...posT);
          }
        } else {
          // Shuttle is descending steeply below standard chest height (dig attempt at floor y ≈ 0.35m)
          const cFloor = 0.35 - currentY;
          const discFloor = b * b - 4 * a * cFloor;
          if (discFloor >= 0) {
            const t1 = (-b + Math.sqrt(discFloor)) / (2 * a);
            const t2 = (-b - Math.sqrt(discFloor)) / (2 * a);
            const posT = [t1, t2].filter(t => t > 0.05);
            if (posT.length > 0) {
              timeToReach = Math.min(...posT);
            }
          }
        }

        // Account for forward drag deceleration estimate (factor ~0.82)
        const predictedZ = projectilePos.z + projectileVel.z * timeToReach * 0.82;
        const predictedX = projectilePos.x + projectileVel.x * timeToReach * 0.85;

        // Clamp inside opponent court zone
        this.targetPosition.x = Math.max(courtBounds.minX, Math.min(courtBounds.maxX, predictedX));
        // Offset slightly behind anticipated landing point to strike cleanly forward
        this.targetPosition.z = Math.max(courtBounds.minZ + 0.2, Math.min(courtBounds.maxZ - 0.2, predictedZ + 0.35));
      }
    } else {
      // Return towards center home position
      this.reactionTimer = 0;
      this.targetPosition.x = this.homePosition.x;
      this.targetPosition.z = this.homePosition.z;
      if (this.swingState === 'WINDUP') {
        this.swingState = 'IDLE';
        this.windupTimer = 0;
      }
    }

    const dx = this.targetPosition.x - this.position.x;
    const dz = this.targetPosition.z - this.position.z;
    const moveDist = Math.hypot(dx, dz);

    if (moveDist > 0.05) {
      const step = Math.min(this.config.speed * dt, moveDist);
      this.position.x += (dx / moveDist) * step;
      this.position.z += (dz / moveDist) * step;
    }

    // Interception Proximity Check
    const distToProjectile = Math.hypot(
      projectilePos.x - this.position.x,
      projectilePos.z - this.position.z
    );

    const isInStrikeZone =
      projectilePos.z >= 1.6 &&
      projectilePos.z <= 6.2 &&
      distToProjectile <= 2.10 &&
      projectilePos.y >= 0.45 &&
      projectilePos.y <= 3.20;

    if (isInStrikeZone && isIncoming && this.swingState === 'IDLE') {
      this.reactionTimer += dt;
      if (this.reactionTimer >= this.config.reactionTimeSec) {
        this.swingState = 'WINDUP';
        this.windupTimer = this.windupDuration;
        this.reactionTimer = 0;
      }
    } else if (!isInStrikeZone) {
      this.reactionTimer = Math.max(0, this.reactionTimer - dt * 2);
    }

    if (this.swingState === 'WINDUP') {
      this.windupTimer -= dt;
      isPreparingSwing = true;
      windupProgress = THREE_CLAMP(1.0 - (this.windupTimer / this.windupDuration), 0, 1);
      this.swingTarget = { ...projectilePos };

      if (this.windupTimer <= 0) {
        // Exact contact frame: transition to STRIKING and trigger hit
        this.swingState = 'STRIKING';
        this.isSwinging = true;
        this.swingProgress = 0;
        isPreparingSwing = false;

        // Determine return shot quality based on origin height and court position
        const roll = Math.random();
        const canSmash = projectilePos.y > 1.95 && projectilePos.z < 4.6;
        isSmash = canSmash && roll < this.config.smashChance;
        const isDrop = !isSmash && (roll < 0.25 || (rallyCount >= 4 && roll < 0.40));

        if (this.config.difficulty === 'casual') {
          this.lastShotType = 'clear';
        } else if (isSmash) {
          this.lastShotType = 'smash';
        } else if (isDrop) {
          this.lastShotType = 'drop';
        } else {
          this.lastShotType = roll < 0.60 ? 'clear' : 'drive';
        }

        const botTarget = getBotTarget(this.lastShotType, this.config.difficulty);
        hitVel = solveLaunchVelocity(
          projectilePos,
          botTarget,
          this.lastShotType,
          undefined,
          undefined,
          this.pacingProfile.targetFlightTime
        );
        hitTarget = botTarget;
        didHit = true;
      }
    }

    if (this.isSwinging) {
      this.swingProgress += dt * 4.5;
      if (this.swingProgress >= 1.0) {
        this.isSwinging = false;
        this.swingProgress = 0;
        this.swingState = 'IDLE';
      }
    }

    return {
      didHit,
      hitVelocity: hitVel,
      target: hitTarget,
      isSmash,
      shotType: this.lastShotType,
      isPreparingSwing,
      windupProgress
    };
  }

  public reset(): void {
    this.position = { ...this.homePosition };
    this.targetPosition = { ...this.homePosition };
    this.isSwinging = false;
    this.swingProgress = 0;
    this.reactionTimer = 0;
    this.swingState = 'IDLE';
    this.windupTimer = 0;
  }
}

// ─── Safe Singles Court Boundaries & Aerodynamic Trajectory Solver ───────────

export const SAFE_HALF_WIDTH = 0.80; // Constrain bot to aim strictly within [-0.8m, +0.8m] (dead center of court)
export const TARGET_MIN_Z = -3.5;   // Mid-court
export const TARGET_MAX_Z = -5.0;   // Well in front of -6.7m baseline

/**
 * Generates a safe in-bounds landing target dead-center on the player's side of the singles court
 */
export function getBotTarget(
  shotType: 'drop' | 'clear' | 'drive' | 'smash',
  _difficulty: DifficultyLevel = 'casual'
): { x: number; z: number } {
  // Land in front of the player (avatar ~ z = -3.5), well inside singles.
  const targetX = (Math.random() - 0.5) * 1.4; // [-0.7m, +0.7m] (dead center of court)
  let targetZ: number;
  switch (shotType) {
    case 'drop':
      targetZ = -2.2 - Math.random() * 0.4; // [-2.2m, -2.6m]
      break;
    case 'smash':
    case 'drive':
      targetZ = -2.8 - Math.random() * 0.6; // [-2.8m, -3.4m]
      break;
    case 'clear':
    default:
      targetZ = -3.2 - Math.random() * 0.6; // [-3.2m, -3.8m] (safely inside court, far in front of -6.7m baseline)
      break;
  }

  return { x: targetX, z: targetZ };
}

/**
 * Solves the initial launch velocity required to send a shuttlecock from `origin`
 * to land at `target` under quadratic aerodynamic drag and gravity, ensuring net clearance.
 */
export function solveLaunchVelocity(
  origin: Vector3D,
  target: { x: number; z: number },
  shotType: 'drop' | 'clear' | 'drive' | 'smash',
  dragCoeff = 0.085,
  gravity = 9.81,
  targetFlightTime = 1.75
): Vector3D {
  let initVy: number;
  switch (shotType) {
    case 'clear':
      initVy = 7.5 + Math.random() * 0.3; // High arc upward
      break;
    case 'drop':
      initVy = 3.5 + Math.random() * 0.2; // Gentle float over net
      break;
    case 'smash':
      initVy = 3.2 + Math.random() * 0.2;
      break;
    case 'drive':
    default:
      initVy = 5.0 + Math.random() * 0.2;
      break;
  }

  const flightT = Math.max(1.3, targetFlightTime);
  const distZ = target.z - origin.z;
  let vz = distZ / flightT;
  let vx = (target.x - origin.x) / flightT;
  let vy = initVy;

  const simDt = 1 / 60;
  const targetFloorY = 0.08;

  for (let iter = 0; iter < 8; iter++) {
    let simX = origin.x;
    let simY = origin.y;
    let simZ = origin.z;
    let simVx = vx;
    let simVy = vy;
    let simVz = vz;
    let netCrossingY = origin.y;
    let crossedNet = false;
    let totalTime = 0;

    while (simY > targetFloorY && totalTime < 3.2) {
      const spd = Math.sqrt(simVx * simVx + simVy * simVy + simVz * simVz);
      const dMag = dragCoeff * spd;
      simVx -= dMag * simVx * simDt;
      simVy -= (dMag * simVy + gravity) * simDt;
      simVz -= dMag * simVz * simDt;

      const prevZ = simZ;
      simX += simVx * simDt;
      simY += simVy * simDt;
      simZ += simVz * simDt;
      totalTime += simDt;

      if (!crossedNet && prevZ > 0 && simZ <= 0) {
        netCrossingY = simY;
        crossedNet = true;
      }
    }

    if (netCrossingY < 2.05 && origin.z > 0.2) {
      vy += (2.05 - netCrossingY) * 0.7;
    }

    const errZ = simZ - target.z;
    const errX = simX - target.x;
    if (Math.abs(errZ) < 0.08 && Math.abs(errX) < 0.08) {
      break;
    }

    const timeRatio = Math.max(0.6, totalTime);
    vz -= (errZ / timeRatio) * 0.7;
    vx -= (errX / timeRatio) * 0.7;
  }

  // Apply direct dampening factor to the solved return velocity
  vx *= 0.85;
  vz *= 0.68; // Significantly reduce forward push so it doesn't overshoot baseline

  // Hard clamp magnitudes based on shot type (Badminton casual/playable pace):
  if (shotType === 'clear') {
    // High clears must go UP and parachute down, not laser-beam past baseline
    vy = Math.max(7.2, Math.min(8.2, vy));
    vz = Math.max(-3.5, Math.min(-2.2, vz)); // Prevents overshooting -6.70m
  } else if (shotType === 'drop') {
    vy = Math.max(3.5, Math.min(4.5, vy));
    vz = Math.max(-3.8, Math.min(-2.4, vz));
  } else {
    // Drives and smashes
    vy = Math.max(4.5, Math.min(5.8, vy));
    vz = Math.max(-4.8, Math.min(-3.0, vz));
  }
  vx = Math.max(-1.1, Math.min(1.1, vx));

  return { x: vx, y: vy, z: vz };
}

function THREE_CLAMP(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}
