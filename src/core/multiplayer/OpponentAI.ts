import { DifficultyLevel, Vector3D } from '../motion/Types';

export interface OpponentConfig {
  difficulty: DifficultyLevel;
  reactionTimeSec: number;
  speed: number;
  accuracy: number;
  smashChance: number;
}

export interface GamePacingProfile {
  modeName: 'casual' | 'normal' | 'pro';
  opponentSpeedZ: number;
  opponentLiftY: number;
  targetFlightTime: number;
  hitTimeWindow: number;
}

export const PACING_PROFILES: Record<string, GamePacingProfile> = {
  casual: { modeName: 'casual', opponentSpeedZ: -2.4, opponentLiftY: 6.8, targetFlightTime: 2.30, hitTimeWindow: 650 },
  normal: { modeName: 'normal', opponentSpeedZ: -2.6, opponentLiftY: 6.5, targetFlightTime: 2.05, hitTimeWindow: 520 },
  pro: { modeName: 'pro', opponentSpeedZ: -2.9, opponentLiftY: 6.0, targetFlightTime: 1.80, hitTimeWindow: 420 }
};

export class OpponentAI {
  private config: OpponentConfig;
  public position: Vector3D;
  public velocity: Vector3D = { x: 0, y: 0, z: 0 };
  public isSwinging = false;
  public swingProgress = 0;
  private homePosition: Vector3D;
  private moveReactionTimer = 0;
  private targetPosition: Vector3D;
  private pacingProfile!: GamePacingProfile;

  public swingTarget: Vector3D = { x: 0, y: 1.5, z: 4.0 };
  public lastShotType: 'smash' | 'drop' | 'clear' | 'drive' = 'drive';
  public swingState: 'IDLE' | 'WINDUP' | 'STRIKING' = 'IDLE';
  public windupTimer = 0;
  public windupDuration = 0.22;

  constructor(difficulty: DifficultyLevel = 'casual', homePos: Vector3D = { x: 0, y: 0.9, z: 4.0 }) {
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
    this.windupDuration = diff === 'legend' ? 0.16 : diff === 'pro' ? 0.20 : 0.22;
  }

  private getDifficultyConfig(diff: DifficultyLevel): OpponentConfig {
    switch (diff) {
      case 'casual':
        return {
          difficulty: diff,
          reactionTimeSec: 0.10,
          speed: 4.5,
          accuracy: 0.85,
          smashChance: 0.0
        };
      case 'pro':
        return {
          difficulty: diff,
          reactionTimeSec: 0.06,
          speed: 5.5,
          accuracy: 0.94,
          smashChance: 0.15
        };
      case 'legend':
        return {
          difficulty: diff,
          reactionTimeSec: 0.02,
          speed: 6.8,
          accuracy: 0.98,
          smashChance: 0.30
        };
    }
  }

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

    const isIncoming = projectileVel.z > 0.3;

    if (isIncoming) {
      this.moveReactionTimer += dt;
      if (this.moveReactionTimer >= this.config.reactionTimeSec) {
        const g = 9.81;
        const currentY = projectilePos.y;
        const vy = projectileVel.y;
        const targetY = 1.35;

        // Solve for descending intercept time when shuttle reaches targetY
        const underRadical = Math.max(0.01, vy * vy + 2 * g * (currentY - targetY));
        const timeToReach = Math.max(0.25, Math.min(2.2, (vy + Math.sqrt(underRadical)) / g));

        const predictedZ = projectilePos.z + projectileVel.z * timeToReach * 0.84;
        const predictedX = projectilePos.x + projectileVel.x * timeToReach * 0.86;

        this.targetPosition.x = THREE_CLAMP(predictedX, courtBounds.minX, courtBounds.maxX);
        // Position slightly behind anticipated contact point to strike forward into the court
        this.targetPosition.z = THREE_CLAMP(predictedZ + 0.30, courtBounds.minZ, courtBounds.maxZ);
      }
    } else {
      this.moveReactionTimer = 0;
      this.targetPosition.x = this.homePosition.x;
      this.targetPosition.z = this.homePosition.z;
      if (this.swingState === 'WINDUP') {
        this.swingState = 'IDLE';
        this.windupTimer = 0;
      }
    }

    // Smooth movement towards intercept location
    const dx = this.targetPosition.x - this.position.x;
    const dz = this.targetPosition.z - this.position.z;
    const moveDist = Math.hypot(dx, dz);

    if (moveDist > 0.04) {
      const step = Math.min(this.config.speed * dt, moveDist);
      this.position.x += (dx / moveDist) * step;
      this.position.z += (dz / moveDist) * step;
    }

    // Strike trigger: when shuttlecock enters opponent's court and approaches within reach
    const distToShuttle = Math.hypot(projectilePos.x - this.position.x, projectilePos.z - this.position.z);
    const distZ = this.position.z - projectilePos.z;

    const shouldStartWindup =
      isIncoming &&
      this.swingState === 'IDLE' &&
      projectilePos.z >= 0.6 &&
      distZ <= 2.4 &&
      distZ >= -0.5 &&
      distToShuttle <= 2.6 &&
      projectilePos.y <= 3.2 &&
      projectilePos.y >= 0.3;

    if (shouldStartWindup) {
      this.swingState = 'WINDUP';
      this.windupTimer = this.windupDuration;
      this.swingTarget = { ...projectilePos };
    }

    if (this.swingState === 'WINDUP') {
      this.windupTimer -= dt;
      isPreparingSwing = true;
      windupProgress = THREE_CLAMP(1.0 - (this.windupTimer / this.windupDuration), 0, 1);
      this.swingTarget = { ...projectilePos };

      // Strike triggers when windup finishes OR when the shuttlecock gets dangerously close to the floor
      const emergencyFloorHit = projectilePos.y <= 0.45 && distToShuttle <= 1.8;
      if (this.windupTimer <= 0 || emergencyFloorHit) {
        this.swingState = 'STRIKING';
        this.isSwinging = true;
        this.swingProgress = 0;
        isPreparingSwing = false;

        const roll = Math.random();
        const canSmash = projectilePos.y > 1.95 && projectilePos.z < 4.8;
        isSmash = canSmash && roll < this.config.smashChance;
        const isDrop = !isSmash && (roll < 0.22 || (rallyCount >= 4 && roll < 0.35));

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
      this.swingProgress += dt * 5.0;
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
    this.moveReactionTimer = 0;
    this.swingState = 'IDLE';
    this.windupTimer = 0;
  }
}

export function getBotTarget(
  shotType: 'drop' | 'clear' | 'drive' | 'smash',
  _difficulty: DifficultyLevel = 'casual'
): { x: number; z: number } {
  // Aim strictly down the center corridor (|x| <= 0.35m) so bot never misses the sidelines
  const targetX = (Math.random() - 0.5) * 0.70;
  let targetZ: number;
  switch (shotType) {
    case 'clear':
    default:
      // Lands cleanly in front of player's midcourt stance (avatar at z = -4.2)
      targetZ = -3.2 - Math.random() * 0.4;
      break;
    case 'smash':
    case 'drive':
      targetZ = -2.8 - Math.random() * 0.4;
      break;
    case 'drop':
      targetZ = -2.0 - Math.random() * 0.3;
      break;
  }
  return { x: targetX, z: targetZ };
}

export function solveLaunchVelocity(
  origin: Vector3D,
  target: { x: number; z: number },
  shotType: 'drop' | 'clear' | 'drive' | 'smash',
  dragCoeff = 0.085,
  gravity = 9.81,
  targetFlightTime = 2.20
): Vector3D {
  let initVy: number;
  switch (shotType) {
    case 'clear':
      initVy = 6.6 + Math.random() * 0.3;
      break;
    case 'drop':
      initVy = 4.0 + Math.random() * 0.2;
      break;
    case 'smash':
      initVy = 4.2 + Math.random() * 0.2;
      break;
    case 'drive':
    default:
      initVy = 5.4 + Math.random() * 0.2;
      break;
  }

  const flightT = Math.max(1.6, targetFlightTime);
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

    while (simY > targetFloorY && totalTime < 3.5) {
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

    if (netCrossingY < 1.95 && origin.z > 0.2) {
      vy += (1.95 - netCrossingY) * 0.7;
    }

    const errZ = simZ - target.z;
    const errX = simX - target.x;
    if (Math.abs(errZ) < 0.08 && Math.abs(errX) < 0.08) break;

    const timeRatio = Math.max(0.8, totalTime);
    vz -= (errZ / timeRatio) * 0.7;
    vx -= (errX / timeRatio) * 0.7;
  }

  // Gentle, slow, highly readable returns that land in bounds and give 2+ seconds to hit back
  if (shotType === 'clear') {
    vy = THREE_CLAMP(vy, 6.0, 7.2);
    vz = THREE_CLAMP(vz, -2.8, -1.8);
  } else if (shotType === 'drop') {
    vy = THREE_CLAMP(vy, 3.8, 4.8);
    vz = THREE_CLAMP(vz, -2.2, -1.4);
  } else {
    vy = THREE_CLAMP(vy, 5.0, 6.2);
    vz = THREE_CLAMP(vz, -2.8, -1.8);
  }
  vx = THREE_CLAMP(vx, -0.40, 0.40);

  return { x: vx, y: vy, z: vz };
}

function THREE_CLAMP(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}
