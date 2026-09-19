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

    const isIncoming = projectileVel.z > 0.15;

    if (isIncoming) {
      this.moveReactionTimer += dt;
      if (this.moveReactionTimer >= this.config.reactionTimeSec) {
        const g = 9.81;
        const currentY = Math.max(0.1, projectilePos.y);
        const vy = projectileVel.y;
        const targetFloorY = 0.80;

        // Quadratic solve for time until shuttle descends into strike zone
        const underRadical = Math.max(0.01, vy * vy + 2 * g * (currentY - targetFloorY));
        const timeToDescend = Math.max(0.15, Math.min(2.5, (vy + Math.sqrt(underRadical)) / g));

        // Predict future position where the shuttle will be within reach
        const predictedZ = projectilePos.z + projectileVel.z * timeToDescend * 0.82;
        const predictedX = projectilePos.x + projectileVel.x * timeToDescend * 0.85;

        // If the shuttle is already in the opponent court (z >= 0.5), actively position right behind it
        if (projectilePos.z >= 0.5) {
          this.targetPosition.x = THREE_CLAMP(projectilePos.x, courtBounds.minX, courtBounds.maxX);
          this.targetPosition.z = THREE_CLAMP(Math.max(projectilePos.z + 0.25, predictedZ), courtBounds.minZ, courtBounds.maxZ);
        } else {
          this.targetPosition.x = THREE_CLAMP(predictedX, courtBounds.minX, courtBounds.maxX);
          this.targetPosition.z = THREE_CLAMP(predictedZ + 0.25, courtBounds.minZ, courtBounds.maxZ);
        }
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
    const inOpponentCourt = projectilePos.z >= 0.4;

    const shouldStartWindup =
      isIncoming &&
      this.swingState === 'IDLE' &&
      inOpponentCourt &&
      distToShuttle <= 2.8 &&
      projectilePos.y <= 3.4 &&
      projectilePos.y >= 0.15;

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

      // Strike triggers when windup finishes OR when the shuttlecock gets into hitting reach
      const inStrikePocket = distToShuttle <= 2.0 && inOpponentCourt;
      const emergencyFloorHit = projectilePos.y <= 0.70 && distToShuttle <= 2.4 && inOpponentCourt;
      if (this.windupTimer <= 0 || inStrikePocket || emergencyFloorHit) {
        this.swingState = 'STRIKING';
        this.isSwinging = true;
        this.swingProgress = 0;
        isPreparingSwing = false;

        const roll = Math.random();
        const canSmash = projectilePos.y > 1.95 && projectilePos.z < 4.8;
        isSmash = canSmash && roll < this.config.smashChance;
        const isDrop = !isSmash && (roll < 0.22 || (rallyCount >= 4 && roll < 0.35));

        // True shot variety across Casual, Pro, and Legend
        if (isSmash) {
          this.lastShotType = 'smash';
        } else if (isDrop) {
          this.lastShotType = 'drop';
        } else if (roll < 0.45) {
          this.lastShotType = 'drive';
        } else {
          this.lastShotType = 'clear';
        }

        const botTarget = getBotTarget(this.lastShotType, this.config.difficulty);
        hitVel = solveLaunchVelocity(
          projectilePos,
          botTarget,
          this.lastShotType
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
  const targetX = (Math.random() - 0.5) * 0.50; // Narrow corridor right down center
  let targetZ: number;
  switch (shotType) {
    case 'clear':
    default:
      targetZ = -3.3 - Math.random() * 0.30; // Drops right in front of player
      break;
    case 'smash':
    case 'drive':
      targetZ = -2.8 - Math.random() * 0.30;
      break;
    case 'drop':
      targetZ = -1.9 - Math.random() * 0.30;
      break;
  }
  return { x: targetX, z: targetZ };
}

export function solveLaunchVelocity(
  origin: Vector3D,
  target: { x: number; z: number },
  shotType: 'drop' | 'clear' | 'drive' | 'smash',
  dragCoeff = 0.085,
  gravity = 9.81
): Vector3D {
  // Randomized speed variation per shot type so no two shots have identical velocity
  const speedVariation = 0.88 + Math.random() * 0.24; // ±12% speed variance

  let targetFlightTime = 1.85 * speedVariation;
  let baseVy = 5.4;

  switch (shotType) {
    case 'smash':
      targetFlightTime = 0.70 * speedVariation;
      baseVy = 2.9;
      break;
    case 'drive':
      targetFlightTime = 1.15 * speedVariation;
      baseVy = 4.0;
      break;
    case 'drop':
      targetFlightTime = 1.50 * speedVariation;
      baseVy = 4.2;
      break;
    case 'clear':
    default:
      targetFlightTime = 1.95 * speedVariation;
      baseVy = 6.0;
      break;
  }

  // Ensure target.z stays strictly inside player court [-5.2m to -2.3m] (never past -6.75m baseline)
  const clampedTargetZ = THREE_CLAMP(target.z, -5.2, -2.3);
  const distZ = clampedTargetZ - origin.z;
  const distX = target.x - origin.x;

  let vz = distZ / targetFlightTime;
  let vx = distX / targetFlightTime;
  let vy = baseVy;

  // Net clearance check at Z = 0
  const distToNet = Math.abs(origin.z);
  const tNet = distToNet / Math.max(0.5, Math.abs(vz));
  const netY = origin.y + vy * tNet - 0.5 * gravity * tNet * tNet;
  if (netY < 1.70) {
    vy += (1.70 - netY) * 1.15;
  }

  // Safe velocity bounds guaranteed to land inside player singles court
  if (shotType === 'smash') {
    vz = THREE_CLAMP(vz, -7.8, -6.2); // Prevents out-of-bounds baseline overshoots
    vy = THREE_CLAMP(vy, 2.0, 3.4);
  } else if (shotType === 'drive') {
    vz = THREE_CLAMP(vz, -5.8, -4.2);
    vy = THREE_CLAMP(vy, 3.2, 4.4);
  } else if (shotType === 'drop') {
    vz = THREE_CLAMP(vz, -2.8, -1.8);
    vy = THREE_CLAMP(vy, 3.6, 4.6);
  } else {
    // Clear
    vz = THREE_CLAMP(vz, -4.2, -2.6);
    vy = THREE_CLAMP(vy, 5.0, 6.8);
  }

  return {
    x: THREE_CLAMP(vx, -0.45, 0.45),
    y: vy,
    z: vz
  };
}

function THREE_CLAMP(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

