import * as THREE from 'three';
import { DifficultyLevel } from '../common/Types';
import { TableTennisPhysics } from './TableTennisPhysics';

export type AIShotArchetype =
  | 'GENTLE_FEED'
  | 'PUSH_CHOP'
  | 'COUNTER_DRIVE'
  | 'TOPSPIN_LOOP'
  | 'SMASH_KILL';

export interface AIReturnDecision {
  shotType: AIShotArchetype;
  targetX: number;
  targetZ: number;
  pacingSpeed: number;
  maxSpeedOverride?: number;
  exitSpin: THREE.Vector3;
}

/**
 * Spin-Aware Tactical Table Tennis AI Opponent
 *
 * Scales tactical intelligence, court movement speed, spin variety, and shot power
 * across Low (learner), Medium (casual), and High (pro / legend) difficulty tiers.
 */
export class TableTennisAI {
  public willIntercept = true;
  public hasInterceptDecision = false;
  public lastShotType: AIShotArchetype = 'COUNTER_DRIVE';

  /**
   * Determines whether the AI will successfully intercept the player's shot
   */
  public decideInterception(
    difficulty: DifficultyLevel,
    ballVel: THREE.Vector3,
    ballPos: THREE.Vector3
  ): boolean {
    const speedKmh = ballVel.length() * 3.6;
    if (difficulty === 'learner') {
      this.willIntercept = Math.random() < 0.80;
    } else if (difficulty === 'casual') {
      const isAngledFastShot = speedKmh > 22 && Math.abs(ballPos.x) > 0.30;
      this.willIntercept = isAngledFastShot ? Math.random() < 0.42 : Math.random() < 0.68;
    } else if (difficulty === 'pro' || difficulty === 'legend') {
      const isDeepCornerSmash = speedKmh > 46 && Math.abs(ballPos.x) > 0.44;
      const baseRate = difficulty === 'legend' ? 0.98 : 0.95;
      this.willIntercept = isDeepCornerSmash ? Math.random() < 0.48 : Math.random() < baseRate;
    } else {
      this.willIntercept = Math.random() < 0.92;
    }
    this.hasInterceptDecision = true;
    return this.willIntercept;
  }

  /**
   * Computes AI avatar lateral & depth movement speed
   */
  public getFootworkSpeed(difficulty: DifficultyLevel): number {
    if (difficulty === 'legend') return 14.5;
    if (difficulty === 'pro') return 11.0;
    if (difficulty === 'casual') return 8.5;
    return 7.5;
  }

  /**
   * Computes AI return shot selection, target placement, speed, and spin
   */
  public computeReturnShot(
    difficulty: DifficultyLevel,
    ballPos: THREE.Vector3,
    ballVel: THREE.Vector3,
    ballSpin: THREE.Vector3,
    playerX: number
  ): AIReturnDecision {
    // 1. Low Mode (Learner): 100% gentle centered feeds with zero spin
    if (difficulty === 'learner') {
      this.lastShotType = 'GENTLE_FEED';
      return {
        shotType: 'GENTLE_FEED',
        targetX: THREE.MathUtils.clamp((Math.random() - 0.5) * 0.28, -0.20, 0.20),
        targetZ: -0.86,
        pacingSpeed: 3.6,
        maxSpeedOverride: 4.4,
        exitSpin: new THREE.Vector3(0, 0, 0),
      };
    }

    // 2. Medium Mode (Casual): Balanced drives and occasional backspin pushes
    if (difficulty === 'casual') {
      const isShortOrBackspin = ballPos.z < 0.65 || ballSpin.x < -8;
      this.lastShotType = isShortOrBackspin ? 'PUSH_CHOP' : 'COUNTER_DRIVE';
      const targetX = THREE.MathUtils.clamp((Math.random() - 0.5) * 0.48, -0.30, 0.30);
      const targetZ = -0.92 - Math.random() * 0.16;
      const spinX = isShortOrBackspin ? -6 : 8;
      return {
        shotType: this.lastShotType,
        targetX,
        targetZ,
        pacingSpeed: 3.7,
        maxSpeedOverride: 4.5,
        exitSpin: new THREE.Vector3(spinX, (Math.random() - 0.5) * 4, 0),
      };
    }

    // 3. High Mode (Pro / Legend): Spin-aware tactical selection (Loops, Chops, Corner Smashes)
    const heightAboveTable = ballPos.y - TableTennisPhysics.TABLE_HEIGHT;
    const awayFromPlayerX = playerX >= 0 ? -0.40 - Math.random() * 0.14 : 0.40 + Math.random() * 0.14;

    if (heightAboveTable > 0.26) {
      // High loose ball -> AI executes aggressive corner smash/loop!
      this.lastShotType = 'SMASH_KILL';
      return {
        shotType: 'SMASH_KILL',
        targetX: THREE.MathUtils.clamp(awayFromPlayerX, -0.52, 0.52),
        targetZ: -0.94 - Math.random() * 0.18,
        pacingSpeed: 5.4,
        maxSpeedOverride: 6.8,
        exitSpin: new THREE.Vector3(24, (Math.random() - 0.5) * 14, 0),
      };
    }

    if (ballSpin.x < -10 || ballPos.z < 0.62) {
      // Player hit chop/short ball -> AI responds with heavy backspin push or topspin loop lift
      const doLoop = Math.random() < 0.55;
      this.lastShotType = doLoop ? 'TOPSPIN_LOOP' : 'PUSH_CHOP';
      return {
        shotType: this.lastShotType,
        targetX: THREE.MathUtils.clamp((Math.random() - 0.5) * 0.80, -0.44, 0.44),
        targetZ: doLoop ? -0.92 - Math.random() * 0.18 : -0.72 - Math.random() * 0.16,
        pacingSpeed: doLoop ? 4.6 : 3.8,
        maxSpeedOverride: 5.6,
        exitSpin: new THREE.Vector3(doLoop ? 26 : -18, (Math.random() - 0.5) * 12, 0),
      };
    }

    // Standard deep tactical drive
    this.lastShotType = 'COUNTER_DRIVE';
    return {
      shotType: 'COUNTER_DRIVE',
      targetX: THREE.MathUtils.clamp((Math.random() - 0.5) * 0.80, -0.44, 0.44),
      targetZ: -0.85 - Math.random() * 0.22,
      pacingSpeed: 4.3,
      maxSpeedOverride: 5.4,
      exitSpin: new THREE.Vector3(16, (Math.random() - 0.5) * 10, 0),
    };
  }
}
