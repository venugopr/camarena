import { DifficultyLevel, Vector3D } from '../../common/Types';

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
  // Ultra-relaxed cooperative rally pacing — shuttle floats like a balloon
  // casual: 3.80s (~4.4m apex); normal: 3.20s (~4.0m); pro: 2.70s (~3.6m)
  casual: { modeName: 'casual', opponentSpeedZ: -1.2, opponentLiftY: 8.2, targetFlightTime: 3.80, hitTimeWindow: 950 },
  normal: { modeName: 'normal', opponentSpeedZ: -1.6, opponentLiftY: 7.8, targetFlightTime: 3.20, hitTimeWindow: 800 },
  pro:    { modeName: 'pro',    opponentSpeedZ: -2.0, opponentLiftY: 7.2, targetFlightTime: 2.70, hitTimeWindow: 650 }
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
  public pacingProfile!: GamePacingProfile;

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
    rallyCount = 0,
    playerIncomingSpeed?: number
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

    // Strike trigger: when shuttlecock travels visibly into opponent's court and approaches within reach
    const distToShuttle = Math.hypot(projectilePos.x - this.position.x, projectilePos.z - this.position.z);
    const inOpponentCourt = projectilePos.z >= 1.2;

    const shouldStartWindup =
      isIncoming &&
      this.swingState === 'IDLE' &&
      inOpponentCourt &&
      distToShuttle <= 2.5 &&
      projectilePos.y <= 3.6 &&
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

      // Strike triggers when windup finishes AND the shuttlecock is in realistic racket reach (~1.25m),
      // OR emergency save if shuttlecock is about to touch the floor before windup finishes
      const inRacketRange = distToShuttle <= 1.25 && inOpponentCourt;
      const emergencyFloorHit = projectilePos.y <= 0.60 && distToShuttle <= 1.6 && inOpponentCourt;
      const readyToStrike = (this.windupTimer <= 0 && inRacketRange) || emergencyFloorHit;

      if (readyToStrike) {
        this.swingState = 'STRIKING';
        this.isSwinging = true;
        this.swingProgress = 0;
        isPreparingSwing = false;

        const roll = Math.random();
        const canSmash = this.config.difficulty !== 'casual' && projectilePos.y > 2.1 && projectilePos.z < 4.2;
        isSmash = canSmash && roll < this.config.smashChance;
        const isDrop = !isSmash && (this.config.difficulty !== 'casual' && (roll < 0.15 || (rallyCount >= 4 && roll < 0.25)));

        // Casual focuses on cooperative rally clears that match player speed
        if (isSmash) {
          this.lastShotType = 'smash';
        } else if (isDrop) {
          this.lastShotType = 'drop';
        } else if (this.config.difficulty !== 'casual' && roll < 0.35) {
          this.lastShotType = 'drive';
        } else {
          this.lastShotType = 'clear';
        }

        const botTarget = getBotTarget(this.lastShotType, this.config.difficulty);
        hitVel = solveLaunchVelocity(
          projectilePos,
          botTarget,
          this.lastShotType,
          0.085,
          9.81,
          undefined,      // minimumNetHeight — auto
          this.pacingProfile, // Pillar B: thread Wii-Sports pacing into physics solver
          playerIncomingSpeed
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
  // Target strictly in front of player's body (player stands at z = -4.2)
  // Landing zone: z in [-3.5, -3.2] at chest/waist level, within easy reaching volume
  const targetX = (Math.random() - 0.5) * 1.0;
  let targetZ: number;
  switch (shotType) {
    case 'drop':
      // Short net drop: lands in front court (z in [-2.2, -1.8])
      targetZ = THREE_CLAMP(-2.0 - Math.random() * 0.3, -2.4, -1.8);
      break;
    case 'drive':
    case 'smash':
    case 'clear':
    default:
      // Cooperative rally return: arrives directly in front of player's racket (z in [-3.5, -3.2])
      targetZ = THREE_CLAMP(-3.35 - Math.random() * 0.25, -3.6, -3.2);
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
  minimumNetHeight?: number,
  pacingProfile?: GamePacingProfile,
  playerIncomingSpeed?: number
): Vector3D {
  // 1. Desired arrival height at the player's strike plane (waist/chest level):
  const targetY = 1.35;
  const safeTargetZ = THREE_CLAMP(target.z, -3.6, -2.0);
  const distZ = safeTargetZ - origin.z; // negative value
  const distX = target.x - origin.x;

  // 2. Flight time calculation:
  // If player incoming speed is known, scale flight time so return speed matches player's hit speed!
  let flightTime: number;
  if (playerIncomingSpeed && playerIncomingSpeed > 2.0) {
    // Player speed is e.g. 4.5 to 8.5 m/s. Return forward speed matches player's forward carry:
    const matchedForwardSpeed = THREE_CLAMP(playerIncomingSpeed * 0.58, 3.2, 5.0);
    flightTime = Math.abs(distZ) / matchedForwardSpeed;
  } else {
    // Default comfortable rally flight time from pacing profile (1.8s to 2.4s)
    const baseTime = pacingProfile?.targetFlightTime ?? 2.10;
    flightTime = shotType === 'drop' ? baseTime * 0.75 : baseTime;
  }
  // Clamp flight time to comfortable, trackable range
  flightTime = THREE_CLAMP(flightTime, 1.50, 2.60);

  // 3. Horizontal velocity with aerodynamic drag compensation
  // Drag deceleration over time reduces effective velocity, so launch speed needs ~1.12x boost
  const dragFactorZ = 1.0 + 0.5 * dragCoeff * Math.abs(distZ / flightTime) * flightTime * 0.35;
  let vz = (distZ / flightTime) * dragFactorZ;
  let vx = (distX / flightTime);

  // 4. Vertical velocity: analytically solved so the shuttle arrives at targetY at time flightTime
  // y(T) = origin.y + vy * T - 0.5 * g * T^2 = targetY
  // => vy = (targetY - origin.y + 0.5 * g * T^2) / T
  // With aerodynamic drag compensation:
  const halfGTT = 0.5 * gravity * flightTime * flightTime;
  const dragFactorY = 1.0 + 0.4 * dragCoeff * (halfGTT / flightTime) * 0.25;
  let vy = ((targetY - origin.y + halfGTT) / flightTime) * dragFactorY;

  // 5. Net Clearance Check at Z = 0:
  // Ensure the trajectory passes safely over the net tape (netHeight = 1.55m, target min = 1.85m)
  const distToNet = Math.abs(origin.z);
  const timeToNet = distToNet / Math.max(0.5, Math.abs(vz));
  const heightAtNet = origin.y + vy * timeToNet - 0.5 * gravity * timeToNet * timeToNet;
  const netMin = minimumNetHeight ?? 1.85;

  if (heightAtNet < netMin) {
    // If clearing the net requires more lift, solve required vy for net clearance
    const reqVyForNet = (netMin - origin.y + 0.5 * gravity * timeToNet * timeToNet) / timeToNet;
    vy = Math.max(vy, reqVyForNet + 0.15);
    // When vy increases, adjust vz so the shuttle still lands right at targetZ and never overshoots!
    const disc = vy * vy - 2 * gravity * (targetY - origin.y);
    if (disc > 0) {
      const correctedT = (vy + Math.sqrt(disc)) / gravity;
      if (correctedT > 0.5) {
        vz = (distZ / correctedT) * dragFactorZ;
      }
    }
  }

  // 6. Final safety bounds:
  // Forward speed vz clamped to [-5.2, -2.8] m/s (10 - 19 km/h) - perfectly matched to player gentle speed!
  vz = THREE_CLAMP(vz, -5.2, -2.8);
  vy = THREE_CLAMP(vy, 4.0, 7.5);
  vx = THREE_CLAMP(vx, -0.65, 0.65);

  return {
    x: vx,
    y: vy,
    z: vz
  };
}

function THREE_CLAMP(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

