import * as THREE from 'three';
import { Avatar3D } from '../badminton/Avatar3D';
import { DifficultyLevel } from '../common/Types';
import { TennisPhysics, TennisHitResult, TennisShotType } from './TennisPhysics';

export class TennisAI {
  public avatar: Avatar3D;
  public position = new THREE.Vector3(0, 0, 11.5);
  public velocity = new THREE.Vector3(0, 0, 0);

  private difficulty: DifficultyLevel = 'casual';
  private targetPosition = new THREE.Vector3(0, 0, 11.5);

  private isWindingUp = false;
  private windupProgress = 0;
  private isStriking = false;
  private strikeProgress = 0;
  private strikeTarget = new THREE.Vector3();
  private isSmash = false;

  private hitCooldown = 0;
  private hasHitCurrentBall = false;
  public hasBouncedOnMySide = false;
  private bounceStrikeTimer = -1;

  // Rally Pacing Engine (6 to 12 sustained rally hits before aggressive winner)
  private rallyHitCounter = 0;
  private targetRallyLength = 8;
  private lastTactic: 'cross_court' | 'down_the_line' = 'cross_court';

  constructor() {
    this.avatar = new Avatar3D({
      primaryColor: 0xff0055,
      secondaryColor: 0xffaa00,
      avatarStyle: 'humanoid'
    });
    this.avatar.setEquipment('tennis');
    this.avatar.group.rotation.y = Math.PI; // Face towards the net and player
    this.avatar.group.position.copy(this.position);
    this.avatar.applyDefaultPose('tennis', true);
    this.resetRallyTarget();
  }

  public setDifficulty(level: DifficultyLevel): void {
    this.difficulty = level;
  }

  private resetRallyTarget(): void {
    // Sustain active rallies of 6–12 hits before aiming for aggressive winners
    this.rallyHitCounter = 0;
    this.targetRallyLength = 6 + Math.floor(Math.random() * 7); // 6 to 12 hits
  }

  public resetPosition(isServing = false, courtSide: 'deuce' | 'ad' = 'deuce'): void {
    const serveX = courtSide === 'deuce' ? -1.8 : 1.8; // In AI frame facing net
    this.position.set(isServing ? serveX : 0, 0, 11.5);
    this.targetPosition.copy(this.position);
    this.velocity.set(0, 0, 0);
    this.avatar.group.position.copy(this.position);
    this.isWindingUp = false;
    this.isStriking = false;
    this.hasHitCurrentBall = false;
    this.hasBouncedOnMySide = false;
    this.bounceStrikeTimer = -1;
    this.hitCooldown = 0;
    this.resetRallyTarget();
    this.avatar.applyDefaultPose('tennis', true);
  }

  /**
   * Called when the ball makes ground contact on the court
   */
  public onBallBounce(x: number, z: number): void {
    if (z > 0 && !this.hasHitCurrentBall) {
      this.hasBouncedOnMySide = true;
      this.isWindingUp = true;
      this.windupProgress = 0;
      // 160-220ms reaction delay after ground bounce before striking groundstroke
      this.bounceStrikeTimer = this.difficulty === 'legend' ? 0.16 : (this.difficulty === 'pro' ? 0.18 : 0.22);
    }
  }

  public update(dt: number, physics: TennisPhysics, playerPosX = 0, playerPosZ = -11.5): TennisHitResult | null {
    this.hitCooldown = Math.max(0, this.hitCooldown - dt);

    const ballPos = physics.ballPos;
    const ballVel = physics.ballVel;
    const isBallApproaching = physics.inPlay && ballVel.z > 0.5; // Moving towards AI half (+Z)

    // Speed limits tuned per difficulty
    const speedLimit = this.difficulty === 'legend' ? 6.5 : (this.difficulty === 'pro' ? 5.2 : 4.0);

    if (isBallApproaching && !this.hasHitCurrentBall) {
      // 1. Run laterally to intercept incoming ball
      const targetX = THREE.MathUtils.clamp(ballPos.x, -3.8, 3.8);
      const targetZ = Math.min(12.0, Math.max(9.5, ballPos.z + 0.8));
      this.targetPosition.set(targetX, 0, targetZ);

      // 2. 1-Bounce Waiting & Timed Groundstroke Return
      if (this.hasBouncedOnMySide && this.bounceStrikeTimer > 0) {
        this.bounceStrikeTimer -= dt;
        this.windupProgress = Math.min(1.0, this.windupProgress + dt / 0.18);
        this.avatar.playBackswingPose(this.windupProgress, this.avatar.dominantArm, false);

        if (this.bounceStrikeTimer <= 0) {
          // AI strikes the ball back across the net
          this.hasHitCurrentBall = true;
          this.hasBouncedOnMySide = false;
          this.bounceStrikeTimer = -1;
          this.isWindingUp = false;
          this.isStriking = true;
          this.strikeProgress = 0.3;
          this.strikeTarget.copy(ballPos);

          this.rallyHitCounter++;
          const isWinnerAttempt = this.rallyHitCounter >= this.targetRallyLength;

          // In-rally AI solver: Target cross-court and down-the-line zones based on player avatar court position
          let targetX = 0;
          let targetZ = -10.2;
          let shotType: TennisShotType = 'DRIVE';
          let launchSpeed = 24.0;
          let topspin = 45;

          if (isWinnerAttempt) {
            // Aggressive Winner Attempt: Aim for lines away from player's current position
            if (playerPosX >= 0.5) {
              // Player covering right: drive aggressively to far left corner
              targetX = -3.4;
            } else if (playerPosX <= -0.5) {
              // Player covering left: drive aggressively to far right corner
              targetX = 3.4;
            } else {
              // Player in center: sharp cross-court angle
              targetX = ballPos.x > 0 ? -3.2 : 3.2;
            }

            // If player stepped up to net volley zone (Z > -8.0m), fire deep passing drive
            if (playerPosZ > -8.0) {
              targetZ = -11.2;
              launchSpeed = 31.0;
              shotType = 'DRIVE';
              topspin = 70;
            } else {
              targetZ = -10.8;
              launchSpeed = 29.0;
              shotType = 'TOPSPIN';
              topspin = 120;
            }
            // Reset rally target after winner attempt to cycle dynamic rallies
            this.resetRallyTarget();
          } else {
            // Sustain active rallies of 6–12 hits: Alternate cross-court and down-the-line with safe margins
            if (this.lastTactic === 'cross_court') {
              // Down-the-line placement
              targetX = ballPos.x > 0 ? 2.2 : -2.2;
              this.lastTactic = 'down_the_line';
            } else {
              // Cross-court placement
              targetX = ballPos.x > 0 ? -2.2 : 2.2;
              this.lastTactic = 'cross_court';
            }

            // Safe baseline depth ~1.8m inside baseline
            targetZ = -9.8;
            launchSpeed = this.difficulty === 'legend' ? 26.0 : (this.difficulty === 'pro' ? 24.0 : 21.5);
            shotType = 'DRIVE';
            topspin = 40;
          }

          // Flight time estimation with drag compensation
          const distZ = Math.abs(targetZ - ballPos.z);
          const flightTime = THREE.MathUtils.clamp(distZ / launchSpeed, 0.65, 0.95);

          const returnVx = ((targetX - ballPos.x) / flightTime) * 1.12;
          const returnVz = -launchSpeed * 0.92; // Forward negative Z towards player
          let returnVy = 3.0;

          const returnVel = new THREE.Vector3(returnVx, returnVy, returnVz);
          // Kinematically guarantee clean clearance over 0.914m net by at least +0.28m (1.20m)
          physics.enforceNetClearance(ballPos, returnVel, 1.20);

          physics.ballVel.copy(returnVel);
          physics.ballSpin.set(topspin, 0, 0);
          physics.lastHitter = 2;
          physics.prevBallPos.copy(ballPos);

          this.avatar.pulseImpact('hit');
          this.avatar.flashStringBedWhite(0.08);

          const speedKmh = returnVel.length() * 3.6;
          return {
            hit: true,
            impactPos: ballPos.clone(),
            impactPoint: ballPos.clone(),
            shotType,
            speedKmh,
            spin: physics.ballSpin.clone(),
            isSweetSpot: true
          };
        }
      }
    } else {
      // Ball flying towards player or out of play -> return to center baseline
      this.targetPosition.set(0, 0, 11.5);
      this.isWindingUp = false;
      this.hasBouncedOnMySide = false;
      this.bounceStrikeTimer = -1;
      if (physics.ballVel.z < -0.5) {
        this.hasHitCurrentBall = false;
      }
    }

    // Smooth movement towards targetPosition
    const diff = new THREE.Vector3().subVectors(this.targetPosition, this.position);
    diff.y = 0;
    const dist = diff.length();

    if (dist > 0.05) {
      const moveDir = diff.normalize();
      const currentSpeed = Math.min(speedLimit, dist * 6.5);
      this.velocity.copy(moveDir).multiplyScalar(currentSpeed);
      this.position.addScaledVector(this.velocity, dt);
    } else {
      this.velocity.set(0, 0, 0);
    }

    this.avatar.group.position.copy(this.position);

    // Follow-through stroke animation
    if (this.isStriking) {
      this.strikeProgress = Math.min(1.0, this.strikeProgress + dt / 0.22);
      this.avatar.playSwingAnimation(this.strikeTarget, this.strikeProgress, this.isSmash, this.avatar.dominantArm);

      if (this.strikeProgress >= 1.0) {
        this.isStriking = false;
        this.avatar.applyDefaultPose('tennis', true);
      }
    }

    return null;
  }

  /**
   * Deterministic Service Court Targeting Solver
   * Targets the legal diagonal service box (Z: 0.5m to 6.4m; X: ±0.5m to ±4.0m)
   * with 92% consistency on Casual, 97% on Pro, and 99% on Legend.
   */
  public executeAIServe(physics: TennisPhysics, courtSide: 'deuce' | 'ad'): void {
    const serveX = courtSide === 'deuce' ? -1.8 : 1.8;
    this.resetPosition(true, courtSide);

    // Position ball visibly at AI server contact point (dockX, 1.85m contact height, dockZ)
    const dockX = serveX + 0.20;
    const dockY = 1.85;
    const dockZ = 11.5 - 0.35;
    physics.prepareServe(2, dockX, dockZ, dockY);
    physics.ballMesh.visible = true;

    // Consistency rate based on difficulty: Casual 92%, Pro 97%, Legend 99%
    const successRate = this.difficulty === 'legend' ? 0.99 : (this.difficulty === 'pro' ? 0.97 : 0.92);
    const isCleanServe = Math.random() < successRate;

    // Legal Service Box Targeting:
    // In receiver's near half (Z in [-6.40m, 0.0m]):
    // Deuce serve (courtSide === 'deuce') lands in receiver's deuce box: X in [+0.5m, +4.0m], Z in [-6.0m, -1.0m]
    // Ad serve (courtSide === 'ad') lands in receiver's ad box: X in [-4.0m, -0.5m], Z in [-6.0m, -1.0m]
    let targetX: number;
    let targetZ: number;

    if (isCleanServe) {
      // Deterministic legal landing placement with safe margin inside service lines
      if (courtSide === 'deuce') {
        // X safely between 1.0m and 3.2m
        targetX = THREE.MathUtils.lerp(1.2, 3.2, 0.2 + Math.random() * 0.6);
      } else {
        // X safely between -3.2m and -1.0m
        targetX = THREE.MathUtils.lerp(-3.2, -1.2, 0.2 + Math.random() * 0.6);
      }
      // Z safely between -4.8m and -2.4m (well clear of service line -6.4m and net 0.0m)
      targetZ = THREE.MathUtils.lerp(-4.8, -2.4, 0.2 + Math.random() * 0.6);
    } else {
      // Controlled rare fault: slight miss long past service line (-6.7m) or wide
      if (courtSide === 'deuce') {
        targetX = Math.random() < 0.5 ? 4.3 : 2.5;
        targetZ = -6.7;
      } else {
        targetX = Math.random() < 0.5 ? -4.3 : -2.5;
        targetZ = -6.7;
      }
    }

    // Ballistic trajectory calculation
    const baseSpeed = this.difficulty === 'legend' ? 29.0 : (this.difficulty === 'pro' ? 26.0 : 22.5);
    const deltaZ = targetZ - dockZ; // Negative value (~ -15m)
    const flightTime = Math.abs(deltaZ) / baseSpeed;

    // Drag and forward vector solve:
    // vx and vz calculated so the ball arrives at (targetX, targetZ) at t = flightTime
    const vz = (deltaZ / flightTime) * 1.10; // Drag compensation factor
    const vx = ((targetX - dockX) / flightTime) * 1.10;

    // Net clearance at Z = 0:
    // Ball crosses net at tNet = (0 - dockZ) / vz
    const tNet = (0 - dockZ) / vz;
    const targetNetY = 1.25; // 0.33m clearance above 0.914m net
    // y(tNet) = dockY + vy * tNet - 0.5 * gEff * tNet^2 >= targetNetY
    const gEff = TennisPhysics.GRAVITY + 1.2;
    const requiredVy = (targetNetY - dockY + 0.5 * gEff * tNet * tNet) / tNet;

    const serveVelocity = new THREE.Vector3(vx, Math.max(1.5, requiredVy), vz);
    physics.enforceNetClearance(physics.ballPos, serveVelocity, 1.25);
    physics.prevBallPos.copy(physics.ballPos);

    // Launch serve into play with authentic slice/topspin
    const spinX = this.difficulty === 'casual' ? 60 : 90;
    const spinY = courtSide === 'deuce' ? -25 : 25;
    physics.launchServe(2, serveVelocity, new THREE.Vector3(spinX, spinY, 0));

    this.avatar.playSwingAnimation(new THREE.Vector3(serveX, 1.85, 11.0), 0.5, true, this.avatar.dominantArm);
    this.avatar.pulseImpact('serve');
    this.avatar.flashStringBedWhite(0.08);
  }
}
