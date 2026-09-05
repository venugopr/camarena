import { DifficultyLevel, Vector3D } from '../motion/Types';

export interface OpponentConfig {
  difficulty: DifficultyLevel;
  reactionTimeSec: number;
  speed: number;
  accuracy: number;     // 0 - 1
  smashChance: number;  // 0 - 1
}

export class OpponentAI {
  private config: OpponentConfig;
  public position: Vector3D;
  public velocity: Vector3D = { x: 0, y: 0, z: 0 };
  public isSwinging = false;
  public swingProgress = 0;
  private homePosition: Vector3D;
  private reactionTimer = 0;
  private targetPosition: Vector3D;

  constructor(difficulty: DifficultyLevel = 'casual', homePos: Vector3D = { x: 0, y: 0.9, z: 5 }) {
    this.homePosition = { ...homePos };
    this.position = { ...homePos };
    this.targetPosition = { ...homePos };
    this.config = this.getDifficultyConfig(difficulty);
  }

  public setDifficulty(diff: DifficultyLevel): void {
    this.config = this.getDifficultyConfig(diff);
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

  /**
   * Update AI positioning and anticipation based on incoming ball/shuttlecock
   */
  public update(
    dt: number,
    projectilePos: Vector3D,
    projectileVel: Vector3D,
    courtBounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  ): { didHit: boolean; hitVelocity: Vector3D | null; isSmash: boolean } {
    let didHit = false;
    let hitVel: Vector3D | null = null;
    let isSmash = false;

    // Is projectile heading towards AI court (positive Z)?
    const isIncoming = projectileVel.z > 0;

    if (isIncoming) {
      this.reactionTimer += dt;
      if (this.reactionTimer >= this.config.reactionTimeSec) {
        // Anticipate intercept point
        const timeToReach = Math.max(0.1, (this.position.z - projectilePos.z) / Math.max(0.1, projectileVel.z));
        const predictedX = projectilePos.x + projectileVel.x * timeToReach;
        const clampedX = Math.max(courtBounds.minX, Math.min(courtBounds.maxX, predictedX));

        this.targetPosition.x = clampedX;
        this.targetPosition.z = Math.max(courtBounds.minZ, Math.min(courtBounds.maxZ, this.homePosition.z));
      }
    } else {
      // Return towards center home position
      this.reactionTimer = 0;
      this.targetPosition = { ...this.homePosition };
    }

    // Smooth movement towards target
    const dx = this.targetPosition.x - this.position.x;
    const dz = this.targetPosition.z - this.position.z;
    const dist = Math.hypot(dx, dz);

    if (dist > 0.05) {
      const step = Math.min(dist, this.config.speed * dt);
      this.position.x += (dx / dist) * step;
      this.position.z += (dz / dist) * step;
    }

    // Check hit trigger distance
    const distToBall = Math.hypot(
      projectilePos.x - this.position.x,
      projectilePos.y - this.position.y,
      projectilePos.z - this.position.z
    );

    if (isIncoming && distToBall < 1.2 && projectilePos.z > this.position.z - 0.8) {
      // Trigger AI swing
      this.isSwinging = true;
      this.swingProgress = 0;

      // Determine return shot quality
      const roll = Math.random();
      isSmash = projectilePos.y > 1.8 && roll < this.config.smashChance;

      // Calculate return velocity towards player's court (negative Z)
      const targetX = (Math.random() - 0.5) * (courtBounds.maxX - courtBounds.minX) * this.config.accuracy;
      const speed = isSmash ? 16.0 : (10.0 + Math.random() * 3.0);

      hitVel = {
        x: (targetX - projectilePos.x) * 0.8,
        y: isSmash ? -2.5 : 4.2 + (Math.random() * 1.5),
        z: -speed
      };

      didHit = true;
    }

    if (this.isSwinging) {
      this.swingProgress += dt * 5;
      if (this.swingProgress >= 1.0) {
        this.isSwinging = false;
        this.swingProgress = 0;
      }
    }

    return { didHit, hitVelocity: hitVel, isSmash };
  }

  public reset(): void {
    this.position = { ...this.homePosition };
    this.targetPosition = { ...this.homePosition };
    this.isSwinging = false;
    this.swingProgress = 0;
    this.reactionTimer = 0;
  }
}
