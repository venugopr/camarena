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
  casual: { modeName: 'casual', opponentSpeedZ: -9.1, opponentLiftY: 8.0, targetFlightTime: 1.55, hitTimeWindow: 380 },
  normal: { modeName: 'normal', opponentSpeedZ: -10.5, opponentLiftY: 6.5, targetFlightTime: 1.07, hitTimeWindow: 240 },
  pro: { modeName: 'pro', opponentSpeedZ: -14.5, opponentLiftY: 5.0, targetFlightTime: 0.77, hitTimeWindow: 160 }
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
  private pacingProfile: GamePacingProfile;

  constructor(difficulty: DifficultyLevel = 'casual', homePos: Vector3D = { x: 0, y: 0.9, z: 5 }) {
    this.homePosition = { ...homePos };
    this.position = { ...homePos };
    this.targetPosition = { ...homePos };
    this.config = this.getDifficultyConfig(difficulty);
    this.pacingProfile = PACING_PROFILES[difficulty === 'legend' ? 'pro' : difficulty === 'pro' ? 'normal' : 'casual'];
  }

  public setDifficulty(diff: DifficultyLevel): void {
    this.config = this.getDifficultyConfig(diff);
    this.pacingProfile = PACING_PROFILES[diff === 'legend' ? 'pro' : diff === 'pro' ? 'normal' : 'casual'];
  }

  private getDifficultyConfig(diff: DifficultyLevel): OpponentConfig {
    switch (diff) {
      case 'casual':
        return {
          difficulty: diff,
          reactionTimeSec: 0.28,
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

  /**
   * Update AI positioning and anticipation based on incoming ball/shuttlecock
   */
  public update(
    dt: number,
    projectilePos: Vector3D,
    projectileVel: Vector3D,
    courtBounds: { minX: number; maxX: number; minZ: number; maxZ: number },
    rallyCount = 0
  ): { didHit: boolean; hitVelocity: Vector3D | null; isSmash: boolean; shotType?: 'smash' | 'drop' | 'clear' | 'drive' } {
    let didHit = false;
    let hitVel: Vector3D | null = null;
    let isSmash = false;

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
    }

    // Smooth physical movement towards target
    const dx = this.targetPosition.x - this.position.x;
    const dz = this.targetPosition.z - this.position.z;
    const dist = Math.hypot(dx, dz);

    if (dist > 0.04) {
      const step = Math.min(dist, this.config.speed * dt);
      this.position.x += (dx / dist) * step;
      this.position.z += (dz / dist) * step;
    }

    // Check hit trigger distance and forward strike plane window
    const distToBall = Math.hypot(
      projectilePos.x - this.position.x,
      projectilePos.y - this.position.y,
      projectilePos.z - this.position.z
    );

    const isInFront = projectilePos.z >= this.position.z - 1.15 && projectilePos.z <= this.position.z + 0.45;

    if (isIncoming && distToBall < 1.35 && isInFront) {
      // Trigger AI swing
      this.isSwinging = true;
      this.swingProgress = 0;
      this.swingTarget = { ...projectilePos };

      // Determine return shot quality based on origin height and court position
      const roll = Math.random();
      const canSmash = projectilePos.y > 1.95 && projectilePos.z < 4.6;
      isSmash = canSmash && roll < this.config.smashChance;
      // Disable front-court drop shots until a rally count of at least 6 is achieved
      const isDrop = !isSmash && rallyCount >= 6 && roll < 0.20;

      // 1. Target Depth: Set target landing deep near player's baseline:
      // z_target in [-4.7m, -4.3m] so the shuttlecock crosses player's strike plane (Z = -3.5m) at chest height
      const targetZ = this.config.difficulty === 'casual'
        ? -4.5 - (Math.random() - 0.5) * 0.4
        : -3.8 - Math.random() * 0.4;
      const rawTargetX = (Math.random() - 0.5) * 3.6 * this.config.accuracy; // [-1.8, 1.8]
      const targetX = Math.max(-1.8, Math.min(1.8, rawTargetX));

      let speedZ: number;
      let reqVy: number;

      if (this.config.difficulty === 'casual') {
        // Casual returns pass through player strike plane (Z = -3.5m) at chest height (Y = 1.3m - 1.7m)
        this.lastShotType = 'clear';
        speedZ = 9.1; // 8.8 m/s to 9.4 m/s
        reqVy = 8.0;  // 7.8 m/s to 8.2 m/s (apex y ≈ 3.8m)
      } else if (isSmash) {
        this.lastShotType = 'smash';
        speedZ = Math.abs(PACING_PROFILES.pro.opponentSpeedZ) + Math.random() * 1.0;
        reqVy = 4.8 + Math.random() * 0.6;
      } else if (isDrop) {
        this.lastShotType = 'drop';
        // Controlled front-court drop shot
        speedZ = 6.5 + Math.random() * 0.8;
        reqVy = 4.2 + Math.random() * 0.4;
      } else {
        // Normal/pro returns
        const isClear = roll < 0.70;
        this.lastShotType = isClear ? 'clear' : 'drive';
        if (isClear) {
          speedZ = Math.abs(this.pacingProfile.opponentSpeedZ) + (Math.random() - 0.5) * 0.4;
          reqVy = this.pacingProfile.opponentLiftY + (Math.random() - 0.5) * 0.4;
        } else {
          speedZ = Math.min(12.5, Math.abs(this.pacingProfile.opponentSpeedZ) * 1.25);
          reqVy = 5.2 + (Math.random() - 0.5) * 0.4;
        }
      }

      // Transit time to player strike plane (strictly 1.45s - 1.65s in casual, 1.20s - 1.40s otherwise)
      const estTransitTime = this.config.difficulty === 'casual'
        ? 1.45 + Math.random() * 0.20
        : 1.20 + Math.random() * 0.20;
      const vx = (targetX - projectilePos.x) / (estTransitTime * 0.75);

      hitVel = {
        x: Math.max(-3.5, Math.min(3.5, vx)),
        y: reqVy,
        z: -speedZ
      };

      didHit = true;
    }

    if (this.isSwinging) {
      this.swingProgress += dt * 4.5;
      if (this.swingProgress >= 1.0) {
        this.isSwinging = false;
        this.swingProgress = 0;
      }
    }

    return { didHit, hitVelocity: hitVel, isSmash, shotType: this.lastShotType };
  }

  public reset(): void {
    this.position = { ...this.homePosition };
    this.targetPosition = { ...this.homePosition };
    this.isSwinging = false;
    this.swingProgress = 0;
    this.reactionTimer = 0;
  }
}
