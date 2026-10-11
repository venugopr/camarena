import * as THREE from 'three';
import { DifficultyLevel } from '../common/Types';
import { SoundSynthesizer } from '../util/audio/SoundSynthesizer';
import { DefensiveState, PunchEvent } from './PunchClassifier';

export type AIBoxerState =
  | 'IDLE_STANCE'
  | 'WINDUP_TELEGRAPH'
  | 'STRIKE'
  | 'RECOVERY'
  | 'GUARDING'
  | 'STAGGERED'
  | 'VULNERABLE'
  | 'KNOCKED_DOWN'
  | 'KNOCKED_OUT';

export interface OpponentAttack {
  type: 'STRAIGHT' | 'HOOK' | 'UPPERCUT' | 'BODY_BLOW';
  arm: 'left' | 'right';
  damage: number;
  speedKmh: number;
  durationMs: number;
  counterRequired: 'BLOCK' | 'SLIP' | 'DUCK';
}

export class OpponentBoxerAI {
  public readonly group: THREE.Group;
  private audio: SoundSynthesizer;
  private difficulty: DifficultyLevel = 'casual';

  // Combat State
  private state: AIBoxerState = 'IDLE_STANCE';
  private stateTimer = 0;
  private attackCooldown = 1.8; // seconds between attacks

  // Health & Knockdown
  private maxHealth = 100;
  private health = 100;
  private knockdownCount = 0;
  private isKnockedDown = false;
  private refereeCount = 0;
  private refereeTimer = 0;

  // Active Attack & Telegraphing
  private currentAttack: OpponentAttack | null = null;
  private telegraphDuration = 0.50; // Casual: 500ms, Pro: 420ms, Champion: 350ms
  private strikeProgress = 0;
  private strikeDuration = 0.22;
  private recoveryDuration = 0.35;
  private vulnerableTimer = 0; // 1.2s counter window

  // Procedural Model Parts
  private rootGroup: THREE.Group;
  private headGroup: THREE.Group;
  private jawMesh: THREE.Mesh;
  private torsoGroup: THREE.Group;
  private chestMesh: THREE.Mesh;
  private absMesh: THREE.Mesh;

  private leftArmGroup: THREE.Group;
  private leftForearmGroup: THREE.Group;
  private leftGloveMesh: THREE.Mesh;
  private leftTelegraphGlow: THREE.Mesh;

  private rightArmGroup: THREE.Group;
  private rightForearmGroup: THREE.Group;
  private rightGloveMesh: THREE.Mesh;
  private rightTelegraphGlow: THREE.Mesh;

  private leftLegGroup: THREE.Group;
  private rightLegGroup: THREE.Group;

  // Hit Reactions & Procedural Motion
  private basePosition = new THREE.Vector3(0, 0, -1.8);
  private targetOffset = new THREE.Vector3(0, 0, 0);
  private currentOffset = new THREE.Vector3(0, 0, 0);
  private headSnapRot = new THREE.Euler(0, 0, 0);
  private torsoTwistRot = new THREE.Euler(0, 0, 0);
  private idleTime = 0;
  private staggerVelocity = 0;

  // Hurtboxes (world coordinates)
  public readonly hurtboxes = {
    head: new THREE.Sphere(new THREE.Vector3(0, 1.68, -1.8), 0.18),
    chin: new THREE.Sphere(new THREE.Vector3(0, 1.50, -1.75), 0.13),
    body: new THREE.Sphere(new THREE.Vector3(0, 1.25, -1.8), 0.22),
    liver: new THREE.Sphere(new THREE.Vector3(-0.16, 1.18, -1.78), 0.16),
  };

  // Callbacks
  private onAttackHitCallback?: (damage: number, attackName: string, isBlocked: boolean) => void;
  private onAttackEvadedCallback?: (evadeType: string) => void;
  private onStateChangeCallback?: (state: AIBoxerState) => void;
  private onKnockdownCallback?: (count: number) => void;
  private onKnockoutCallback?: () => void;
  private onRiseFromKnockdownCallback?: () => void;

  constructor(audio: SoundSynthesizer, difficulty: DifficultyLevel = 'casual') {
    this.audio = audio;
    this.difficulty = difficulty;
    this.group = new THREE.Group();
    this.rootGroup = new THREE.Group();
    this.group.add(this.rootGroup);

    // Build Rig
    this.headGroup = new THREE.Group();
    this.jawMesh = new THREE.Mesh();
    this.torsoGroup = new THREE.Group();
    this.chestMesh = new THREE.Mesh();
    this.absMesh = new THREE.Mesh();

    this.leftArmGroup = new THREE.Group();
    this.leftForearmGroup = new THREE.Group();
    this.leftGloveMesh = new THREE.Mesh();
    this.leftTelegraphGlow = new THREE.Mesh();

    this.rightArmGroup = new THREE.Group();
    this.rightForearmGroup = new THREE.Group();
    this.rightGloveMesh = new THREE.Mesh();
    this.rightTelegraphGlow = new THREE.Mesh();

    this.leftLegGroup = new THREE.Group();
    this.rightLegGroup = new THREE.Group();

    this.buildBoxerModel();
    this.setDifficulty(difficulty);
    this.reset();
  }

  public setDifficulty(diff: DifficultyLevel): void {
    this.difficulty = diff;
    if (diff === 'learner' || diff === 'casual') {
      this.telegraphDuration = 0.50; // 500ms warning window
      this.attackCooldown = 2.0;
      this.maxHealth = 85;
    } else if (diff === 'pro') {
      this.telegraphDuration = 0.42; // 420ms warning window
      this.attackCooldown = 1.5;
      this.maxHealth = 100;
    } else {
      // legend / champion
      this.telegraphDuration = 0.35; // 350ms warning window
      this.attackCooldown = 1.15;
      this.maxHealth = 120;
    }
  }

  public setOnAttackHit(cb: (damage: number, attackName: string, isBlocked: boolean) => void): void {
    this.onAttackHitCallback = cb;
  }
  public setOnAttackEvaded(cb: (evadeType: string) => void): void {
    this.onAttackEvadedCallback = cb;
  }
  public setOnStateChange(cb: (state: AIBoxerState) => void): void {
    this.onStateChangeCallback = cb;
  }
  public setOnKnockdown(cb: (count: number) => void): void {
    this.onKnockdownCallback = cb;
  }
  public setOnKnockout(cb: () => void): void {
    this.onKnockoutCallback = cb;
  }
  public setOnRiseFromKnockdown(cb: () => void): void {
    this.onRiseFromKnockdownCallback = cb;
  }

  public getState(): AIBoxerState { return this.state; }
  public getHealth(): number { return this.health; }
  public getMaxHealth(): number { return this.maxHealth; }
  public isVulnerable(): boolean { return this.state === 'VULNERABLE'; }

  public reset(): void {
    this.health = this.maxHealth;
    this.isKnockedDown = false;
    this.refereeCount = 0;
    this.refereeTimer = 0;
    this.vulnerableTimer = 0;
    this.staggerVelocity = 0;
    this.currentOffset.set(0, 0, 0);
    this.targetOffset.set(0, 0, 0);
    this.headSnapRot.set(0, 0, 0);
    this.torsoTwistRot.set(0, 0, 0);
    this.setState('IDLE_STANCE');
    this.updateHurtboxes();
  }

  private setState(newState: AIBoxerState): void {
    this.state = newState;
    this.stateTimer = 0;

    // Toggle Telegraph Glow
    const showGlow = newState === 'WINDUP_TELEGRAPH';
    if (this.currentAttack?.arm === 'left') {
      this.leftTelegraphGlow.visible = showGlow;
      this.rightTelegraphGlow.visible = false;
    } else if (this.currentAttack?.arm === 'right') {
      this.rightTelegraphGlow.visible = showGlow;
      this.leftTelegraphGlow.visible = false;
    } else {
      this.leftTelegraphGlow.visible = false;
      this.rightTelegraphGlow.visible = false;
    }

    if (this.onStateChangeCallback) {
      this.onStateChangeCallback(newState);
    }
  }

  /**
   * Primary AI Update Loop (60+ FPS)
   */
  public update(dt: number, playerDefense: DefensiveState): void {
    this.idleTime += dt;
    this.stateTimer += dt;

    // Lerp Hit Reaction recovery
    this.headSnapRot.x = THREE.MathUtils.lerp(this.headSnapRot.x, 0, dt * 8);
    this.headSnapRot.y = THREE.MathUtils.lerp(this.headSnapRot.y, 0, dt * 8);
    this.headSnapRot.z = THREE.MathUtils.lerp(this.headSnapRot.z, 0, dt * 8);

    this.torsoTwistRot.x = THREE.MathUtils.lerp(this.torsoTwistRot.x, 0, dt * 6);
    this.torsoTwistRot.y = THREE.MathUtils.lerp(this.torsoTwistRot.y, 0, dt * 6);

    this.currentOffset.lerp(this.targetOffset, dt * 7);

    // Apply rotations
    this.headGroup.rotation.copy(this.headSnapRot);
    this.torsoGroup.rotation.copy(this.torsoTwistRot);

    // State Machine
    switch (this.state) {
      case 'IDLE_STANCE':
        this.updateIdleStance(dt);
        break;

      case 'WINDUP_TELEGRAPH':
        this.updateWindupTelegraph(dt);
        break;

      case 'STRIKE':
        this.updateStrike(dt, playerDefense);
        break;

      case 'RECOVERY':
        this.updateRecovery(dt);
        break;

      case 'GUARDING':
        this.updateGuarding(dt);
        break;

      case 'STAGGERED':
        this.updateStaggered(dt);
        break;

      case 'VULNERABLE':
        this.updateVulnerable(dt);
        break;

      case 'KNOCKED_DOWN':
        this.updateKnockedDown(dt);
        break;

      case 'KNOCKED_OUT':
        // Lay flat on canvas
        this.rootGroup.position.set(0, -0.65, -1.8);
        this.rootGroup.rotation.x = -Math.PI / 2;
        break;
    }

    this.updateHurtboxes();
  }

  // ─── State Logic ─────────────────────────────────────────────────────────

  private updateIdleStance(dt: number): void {
    // Bob and weave animation
    const bobY = Math.sin(this.idleTime * 4.5) * 0.04;
    const weaveX = Math.cos(this.idleTime * 2.8) * 0.08;
    this.rootGroup.position.set(
      this.basePosition.x + this.currentOffset.x + weaveX,
      this.basePosition.y + this.currentOffset.y + bobY,
      this.basePosition.z + this.currentOffset.z
    );

    // Default Guard position for hands
    this.leftArmGroup.rotation.set(0.8, -0.3, 0.4);
    this.leftForearmGroup.rotation.set(1.4, 0.2, -0.4);
    this.rightArmGroup.rotation.set(0.9, 0.3, -0.4);
    this.rightForearmGroup.rotation.set(1.45, -0.2, 0.4);

    // Ready to attack?
    if (this.stateTimer >= this.attackCooldown) {
      this.planNextAttack();
    }
  }

  private planNextAttack(): void {
    // Choose attack based on difficulty
    const roll = Math.random();
    let type: OpponentAttack['type'] = 'STRAIGHT';
    let arm: 'left' | 'right' = Math.random() > 0.5 ? 'right' : 'left';
    let counterReq: OpponentAttack['counterRequired'] = 'BLOCK';
    let damage = 18;
    let speed = 40;

    if (roll < 0.45) {
      type = 'STRAIGHT'; // Cross or Jab
      arm = 'right';
      counterReq = Math.random() > 0.5 ? 'SLIP' : 'BLOCK';
      damage = 18;
      speed = 46;
    } else if (roll < 0.75) {
      type = 'HOOK'; // Wild Hook
      arm = Math.random() > 0.5 ? 'left' : 'right';
      counterReq = 'DUCK';
      damage = 26;
      speed = 52;
    } else if (roll < 0.90) {
      type = 'UPPERCUT'; // Uppercut
      arm = 'right';
      counterReq = 'SLIP';
      damage = 30;
      speed = 48;
    } else {
      type = 'BODY_BLOW'; // Liver punch
      arm = 'left';
      counterReq = 'BLOCK';
      damage = 22;
      speed = 42;
    }

    this.currentAttack = {
      type,
      arm,
      damage,
      speedKmh: speed,
      durationMs: this.strikeDuration * 1000,
      counterRequired: counterReq,
    };

    this.setState('WINDUP_TELEGRAPH');
  }

  private updateWindupTelegraph(dt: number): void {
    if (!this.currentAttack) return;

    // Windup posture (drawing attacking arm back, cocking shoulder)
    const progress = Math.min(1.0, this.stateTimer / this.telegraphDuration);
    const arm = this.currentAttack.arm;

    // Pulse telegraph glow
    const glowScale = 1.0 + Math.sin(this.stateTimer * 20) * 0.25;
    if (arm === 'left') {
      this.leftTelegraphGlow.scale.set(glowScale, glowScale, glowScale);
      this.leftArmGroup.rotation.set(0.3, -0.6 * progress, 0.3);
      this.leftForearmGroup.rotation.set(1.6, 0.4, -0.2);
    } else {
      this.rightTelegraphGlow.scale.set(glowScale, glowScale, glowScale);
      this.rightArmGroup.rotation.set(0.3, 0.6 * progress, -0.3);
      this.rightForearmGroup.rotation.set(1.6, -0.4, 0.2);
    }

    // Telegraph window expired -> Launch Strike!
    if (this.stateTimer >= this.telegraphDuration) {
      this.strikeProgress = 0;
      this.setState('STRIKE');
      this.audio.boxingWhoosh(this.currentAttack.speedKmh / 10);
    }
  }

  private updateStrike(dt: number, playerDefense: DefensiveState): void {
    if (!this.currentAttack) {
      this.setState('RECOVERY');
      return;
    }

    this.strikeProgress += dt / this.strikeDuration;
    const t = Math.min(1.0, this.strikeProgress);
    const arm = this.currentAttack.arm;
    const type = this.currentAttack.type;

    // Rapid extension toward player camera
    const extensionZ = THREE.MathUtils.lerp(0, 1.1, Math.sin(t * Math.PI));

    if (arm === 'left') {
      if (type === 'HOOK') {
        this.leftArmGroup.rotation.set(1.2, 0.8 * t, 0.3);
        this.leftForearmGroup.rotation.set(1.2, 1.4 * t, -0.2);
      } else if (type === 'UPPERCUT') {
        this.leftArmGroup.rotation.set(1.5 * t, -0.2, 0.2);
        this.leftForearmGroup.rotation.set(1.8 * t, 0.1, -0.1);
      } else {
        // Straight
        this.leftArmGroup.rotation.set(1.4 * t, 0.1, 0.1);
        this.leftForearmGroup.rotation.set(0.2, 0, 0);
      }
      this.leftGloveMesh.position.z = extensionZ;
    } else {
      if (type === 'HOOK') {
        this.rightArmGroup.rotation.set(1.2, -0.8 * t, -0.3);
        this.rightForearmGroup.rotation.set(1.2, -1.4 * t, 0.2);
      } else if (type === 'UPPERCUT') {
        this.rightArmGroup.rotation.set(1.5 * t, 0.2, -0.2);
        this.rightForearmGroup.rotation.set(1.8 * t, -0.1, 0.1);
      } else {
        // Straight
        this.rightArmGroup.rotation.set(1.4 * t, -0.1, -0.1);
        this.rightForearmGroup.rotation.set(0.2, 0, 0);
      }
      this.rightGloveMesh.position.z = extensionZ;
    }

    // Apex impact check at t ~ 0.55
    if (this.strikeProgress >= 0.55 && this.strikeProgress - (dt / this.strikeDuration) < 0.55) {
      this.resolveStrikeHit(playerDefense);
    }

    if (this.strikeProgress >= 1.0) {
      this.leftGloveMesh.position.z = 0;
      this.rightGloveMesh.position.z = 0;
      this.setState('RECOVERY');
    }
  }

  private resolveStrikeHit(defense: DefensiveState): void {
    if (!this.currentAttack) return;

    const attack = this.currentAttack;
    let isBlocked = false;
    let isEvaded = false;
    let evadeType = '';

    // Check Duck evade
    if (defense.isDucking && (attack.type === 'HOOK' || attack.type === 'STRAIGHT')) {
      isEvaded = true;
      evadeType = 'DUCK COUNTER';
    }

    // Check Slip evade
    if (attack.type === 'STRAIGHT' || attack.type === 'UPPERCUT') {
      if (attack.arm === 'right' && defense.isSlippingLeft) {
        isEvaded = true;
        evadeType = 'PERFECT SLIP (LEFT)';
      } else if (attack.arm === 'left' && defense.isSlippingRight) {
        isEvaded = true;
        evadeType = 'PERFECT SLIP (RIGHT)';
      }
    }

    // Check High Guard (Block absorbs 85% damage)
    if (!isEvaded && defense.isHighGuard) {
      isBlocked = true;
    }

    // Check Body Guard for body blows
    if (!isEvaded && attack.type === 'BODY_BLOW' && defense.isBodyGuard) {
      isBlocked = true;
    }

    if (isEvaded) {
      // Whiff sound
      this.audio.boxingWhoosh(5.0);
      if (this.onAttackEvadedCallback) {
        this.onAttackEvadedCallback(evadeType);
      }
      // Enter VULNERABLE counter window!
      this.triggerVulnerable(1.2);
    } else if (isBlocked) {
      // Leather block sound
      this.audio.boxingGloveBlock();
      const absorbedDmg = Math.max(2, Math.round(attack.damage * 0.15)); // absorbs 85%
      if (this.onAttackHitCallback) {
        this.onAttackHitCallback(absorbedDmg, `${attack.type} BLOCKED`, true);
      }
      // Successful block also grants brief 0.8s counter window
      this.triggerVulnerable(0.8);
    } else {
      // Clean impact on player!
      this.audio.boxingPunchImpact(1.3, attack.type === 'HOOK' || attack.type === 'UPPERCUT', false);
      if (this.onAttackHitCallback) {
        this.onAttackHitCallback(attack.damage, `${attack.type} HIT`, false);
      }
    }
  }

  private updateRecovery(dt: number): void {
    if (this.stateTimer >= this.recoveryDuration) {
      // Return to guard or idle
      this.leftGloveMesh.position.z = 0;
      this.rightGloveMesh.position.z = 0;
      this.currentAttack = null;
      this.setState('IDLE_STANCE');
    }
  }

  private updateGuarding(dt: number): void {
    // Tight high guard covering face
    this.leftArmGroup.rotation.set(1.2, -0.15, 0.3);
    this.leftForearmGroup.rotation.set(1.6, 0.1, -0.2);
    this.rightArmGroup.rotation.set(1.2, 0.15, -0.3);
    this.rightForearmGroup.rotation.set(1.6, -0.1, 0.2);

    if (this.stateTimer >= 1.0) {
      this.setState('IDLE_STANCE');
    }
  }

  private updateStaggered(dt: number): void {
    // Reeling backward motion
    this.targetOffset.z = -0.35;
    if (this.stateTimer >= 0.85) {
      this.targetOffset.z = 0;
      this.setState('IDLE_STANCE');
    }
  }

  private updateVulnerable(dt: number): void {
    this.vulnerableTimer -= dt;
    // Off-balance, exposed posture
    this.leftArmGroup.rotation.set(0.4, -0.5, 0.2);
    this.rightArmGroup.rotation.set(0.4, 0.5, -0.2);
    this.headGroup.rotation.z = Math.sin(this.stateTimer * 8) * 0.12;

    if (this.vulnerableTimer <= 0) {
      this.setState('IDLE_STANCE');
    }
  }

  private updateKnockedDown(dt: number): void {
    this.refereeTimer += dt;
    // Laying collapsed on canvas
    this.rootGroup.position.set(0, -0.65, -1.8);
    this.rootGroup.rotation.x = THREE.MathUtils.lerp(this.rootGroup.rotation.x, -Math.PI / 2, dt * 6);

    // 1-second cadence referee count
    if (this.refereeTimer >= 1.0) {
      this.refereeTimer = 0;
      this.refereeCount++;
      this.audio.boxingRefCountdown(this.refereeCount);

      if (this.onKnockdownCallback) {
        this.onKnockdownCallback(this.refereeCount);
      }

      // Can AI get back up?
      // On Round 1 or 2, AI rises at count 7 if knockdownCount <= 2
      const canRise = this.knockdownCount < 3 && this.refereeCount >= 7;
      if (canRise) {
        this.riseFromKnockdown();
        return;
      }

      // 10 count reached = K.O.
      if (this.refereeCount >= 10) {
        this.setState('KNOCKED_OUT');
        this.audio.boxingBellRing(3);
        this.audio.boxingCrowdRoar(1.5);
        if (this.onKnockoutCallback) {
          this.onKnockoutCallback();
        }
      }
    }
  }

  private riseFromKnockdown(): void {
    this.isKnockedDown = false;
    this.health = Math.round(this.maxHealth * 0.45); // Restores 45% HP on recovery
    this.rootGroup.position.set(0, 0, -1.8);
    this.rootGroup.rotation.set(0, 0, 0);
    this.audio.boxingCrowdRoar(0.8);
    this.setState('IDLE_STANCE');
    if (this.onRiseFromKnockdownCallback) {
      this.onRiseFromKnockdownCallback();
    }
  }

  // ─── Player Damage & Hit Reactions ────────────────────────────────────────

  public takePlayerHit(punch: PunchEvent, isCounter: boolean): {
    damageDealt: number;
    isKnockedDown: boolean;
  } {
    if (this.state === 'KNOCKED_DOWN' || this.state === 'KNOCKED_OUT') {
      return { damageDealt: 0, isKnockedDown: false };
    }

    // Critical Counter multiplier (2x damage if vulnerable or clean counter!)
    const multiplier = (this.isVulnerable() || isCounter) ? 2.0 : 1.0;
    const finalDamage = Math.round(punch.damage * multiplier);
    this.health = Math.max(0, this.health - finalDamage);

    // Hit reaction animation based on punch target & arm
    if (punch.type === 'LEFT_HOOK') {
      // Hit on right side of opponent jaw
      this.headSnapRot.y = -0.45;
      this.headSnapRot.z = 0.25;
      this.torsoTwistRot.y = -0.35;
      this.targetOffset.x = -0.25;
    } else if (punch.type === 'RIGHT_HOOK') {
      // Hit on left side of opponent jaw
      this.headSnapRot.y = 0.45;
      this.headSnapRot.z = -0.25;
      this.torsoTwistRot.y = 0.35;
      this.targetOffset.x = 0.25;
    } else if (punch.type === 'LEFT_UPPERCUT' || punch.type === 'RIGHT_UPPERCUT') {
      // Lift opponent chin straight upward
      this.headSnapRot.x = -0.65;
      this.targetOffset.y = 0.15;
      this.targetOffset.z = -0.3;
    } else {
      // Straight Cross / Jab
      this.headSnapRot.x = -0.35;
      this.targetOffset.z = -0.35;
    }

    // Audio Impact
    this.audio.boxingPunchImpact(
      finalDamage / 20.0,
      punch.type === 'RIGHT_HOOK' || punch.type === 'RIGHT_UPPERCUT',
      isCounter || this.isVulnerable()
    );

    // Knockdown check
    if (this.health <= 0) {
      this.knockdownCount++;
      this.isKnockedDown = true;
      this.refereeCount = 0;
      this.refereeTimer = 0;
      this.setState('KNOCKED_DOWN');
      this.audio.boxingCrowdRoar(1.2);
      return { damageDealt: finalDamage, isKnockedDown: true };
    }

    // Stagger reaction on heavy hit (> 28 dmg)
    if (finalDamage >= 28 && this.state !== 'VULNERABLE') {
      this.setState('STAGGERED');
    }

    return { damageDealt: finalDamage, isKnockedDown: false };
  }

  public triggerVulnerable(duration = 1.2): void {
    this.vulnerableTimer = duration;
    this.setState('VULNERABLE');
  }

  private updateHurtboxes(): void {
    const pos = this.rootGroup.position;
    this.hurtboxes.head.center.set(pos.x, pos.y + 1.68, pos.z + 0.05);
    this.hurtboxes.chin.center.set(pos.x, pos.y + 1.50, pos.z + 0.12);
    this.hurtboxes.body.center.set(pos.x, pos.y + 1.25, pos.z + 0.05);
    this.hurtboxes.liver.center.set(pos.x - 0.16, pos.y + 1.18, pos.z + 0.08);
  }

  // ─── Procedural 3D Athletic Boxer Model ──────────────────────────────────

  private buildBoxerModel(): void {
    // Materials
    const skinMat = new THREE.MeshStandardMaterial({
      color: 0xc88258,
      roughness: 0.65,
      metalness: 0.1,
    });
    const headguardMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a1a,
      roughness: 0.4,
      metalness: 0.3,
    });
    const shortsMat = new THREE.MeshStandardMaterial({
      color: 0xaa1122,
      roughness: 0.5,
      metalness: 0.2,
    });
    const waistbandMat = new THREE.MeshStandardMaterial({
      color: 0xddaa22,
      roughness: 0.3,
      metalness: 0.6,
    });
    const gloveMat = new THREE.MeshStandardMaterial({
      color: 0xd91428,
      roughness: 0.25,
      metalness: 0.15,
    });
    const lacesMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.6,
    });
    const bootMat = new THREE.MeshStandardMaterial({
      color: 0x111111,
      roughness: 0.4,
    });

    // 1. Torso Group
    this.torsoGroup = new THREE.Group();
    this.torsoGroup.position.set(0, 1.2, 0);

    // Chest & Upper Torso
    const chestGeo = new THREE.CylinderGeometry(0.24, 0.20, 0.35, 12);
    this.chestMesh = new THREE.Mesh(chestGeo, skinMat);
    this.chestMesh.position.y = 0.12;
    this.torsoGroup.add(this.chestMesh);

    // Abs & Lower Torso
    const absGeo = new THREE.CylinderGeometry(0.20, 0.18, 0.30, 12);
    this.absMesh = new THREE.Mesh(absGeo, skinMat);
    this.absMesh.position.y = -0.16;
    this.torsoGroup.add(this.absMesh);

    // Pectorals sculpt
    const pecGeo = new THREE.BoxGeometry(0.18, 0.12, 0.08);
    const lPec = new THREE.Mesh(pecGeo, skinMat);
    lPec.position.set(-0.10, 0.16, 0.14);
    const rPec = new THREE.Mesh(pecGeo, skinMat);
    rPec.position.set(0.10, 0.16, 0.14);
    this.torsoGroup.add(lPec, rPec);

    // 2. Head & Neck
    const neckGeo = new THREE.CylinderGeometry(0.09, 0.10, 0.12, 10);
    const neck = new THREE.Mesh(neckGeo, skinMat);
    neck.position.set(0, 0.34, 0);
    this.torsoGroup.add(neck);

    this.headGroup = new THREE.Group();
    this.headGroup.position.set(0, 0.46, 0);

    // Head base
    const headGeo = new THREE.SphereGeometry(0.14, 16, 16);
    headGeo.scale(1.0, 1.15, 1.05);
    const headMesh = new THREE.Mesh(headGeo, skinMat);
    this.headGroup.add(headMesh);

    // Headguard
    const guardGeo = new THREE.SphereGeometry(0.145, 16, 16);
    guardGeo.scale(1.02, 1.18, 1.08);
    const guardMesh = new THREE.Mesh(guardGeo, headguardMat);
    guardMesh.position.set(0, 0.02, -0.01);
    this.headGroup.add(guardMesh);

    // Chin / Jaw
    const jawGeo = new THREE.BoxGeometry(0.12, 0.08, 0.12);
    this.jawMesh = new THREE.Mesh(jawGeo, skinMat);
    this.jawMesh.position.set(0, -0.10, 0.06);
    this.headGroup.add(this.jawMesh);

    // Mouthguard inside jaw
    const mouthGeo = new THREE.BoxGeometry(0.08, 0.03, 0.04);
    const mouthMesh = new THREE.Mesh(mouthGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
    mouthMesh.position.set(0, -0.08, 0.13);
    this.headGroup.add(mouthMesh);

    this.torsoGroup.add(this.headGroup);
    this.rootGroup.add(this.torsoGroup);

    // 3. Arms & Boxing Gloves
    // Left Arm
    this.leftArmGroup = new THREE.Group();
    this.leftArmGroup.position.set(-0.28, 1.45, 0);

    const bicepGeo = new THREE.CylinderGeometry(0.07, 0.065, 0.28, 10);
    const lBicep = new THREE.Mesh(bicepGeo, skinMat);
    lBicep.position.y = -0.14;
    this.leftArmGroup.add(lBicep);

    this.leftForearmGroup = new THREE.Group();
    this.leftForearmGroup.position.set(0, -0.28, 0);

    const forearmGeo = new THREE.CylinderGeometry(0.065, 0.06, 0.26, 10);
    const lForearm = new THREE.Mesh(forearmGeo, skinMat);
    lForearm.position.y = -0.13;
    this.leftForearmGroup.add(lForearm);

    // Left Laced Glove
    this.leftGloveMesh = this.createBoxingGlove(gloveMat, lacesMat);
    this.leftGloveMesh.position.set(0, -0.32, 0.05);
    this.leftForearmGroup.add(this.leftGloveMesh);

    // Telegraph Glow (Left)
    this.leftTelegraphGlow = this.createTelegraphGlow();
    this.leftTelegraphGlow.position.copy(this.leftGloveMesh.position);
    this.leftForearmGroup.add(this.leftTelegraphGlow);

    this.leftArmGroup.add(this.leftForearmGroup);
    this.rootGroup.add(this.leftArmGroup);

    // Right Arm
    this.rightArmGroup = new THREE.Group();
    this.rightArmGroup.position.set(0.28, 1.45, 0);

    const rBicep = new THREE.Mesh(bicepGeo, skinMat);
    rBicep.position.y = -0.14;
    this.rightArmGroup.add(rBicep);

    this.rightForearmGroup = new THREE.Group();
    this.rightForearmGroup.position.set(0, -0.28, 0);

    const rForearm = new THREE.Mesh(forearmGeo, skinMat);
    rForearm.position.y = -0.13;
    this.rightForearmGroup.add(rForearm);

    // Right Laced Glove
    this.rightGloveMesh = this.createBoxingGlove(gloveMat, lacesMat);
    this.rightGloveMesh.position.set(0, -0.32, 0.05);
    this.rightForearmGroup.add(this.rightGloveMesh);

    // Telegraph Glow (Right)
    this.rightTelegraphGlow = this.createTelegraphGlow();
    this.rightTelegraphGlow.position.copy(this.rightGloveMesh.position);
    this.rightForearmGroup.add(this.rightTelegraphGlow);

    this.rightArmGroup.add(this.rightForearmGroup);
    this.rootGroup.add(this.rightArmGroup);

    // 4. Waist & Satin Boxing Shorts
    const waistGeo = new THREE.CylinderGeometry(0.20, 0.22, 0.12, 12);
    const waistband = new THREE.Mesh(waistGeo, waistbandMat);
    waistband.position.set(0, 0.96, 0);
    this.rootGroup.add(waistband);

    const shortsGeo = new THREE.CylinderGeometry(0.23, 0.27, 0.35, 12);
    const shorts = new THREE.Mesh(shortsGeo, shortsMat);
    shorts.position.set(0, 0.76, 0);
    this.rootGroup.add(shorts);

    // 5. Legs & Boots
    const legGeo = new THREE.CylinderGeometry(0.08, 0.065, 0.42, 10);
    const bootGeo = new THREE.BoxGeometry(0.12, 0.14, 0.22);

    // Left leg
    this.leftLegGroup = new THREE.Group();
    this.leftLegGroup.position.set(-0.14, 0.55, 0);
    const lLeg = new THREE.Mesh(legGeo, skinMat);
    lLeg.position.y = -0.20;
    const lBoot = new THREE.Mesh(bootGeo, bootMat);
    lBoot.position.set(0, -0.45, 0.04);
    this.leftLegGroup.add(lLeg, lBoot);
    this.rootGroup.add(this.leftLegGroup);

    // Right leg
    this.rightLegGroup = new THREE.Group();
    this.rightLegGroup.position.set(0.14, 0.55, 0);
    const rLeg = new THREE.Mesh(legGeo, skinMat);
    rLeg.position.y = -0.20;
    const rBoot = new THREE.Mesh(bootGeo, bootMat);
    rBoot.position.set(0, -0.45, 0.04);
    this.rightLegGroup.add(rLeg, rBoot);
    this.rootGroup.add(this.rightLegGroup);

    this.rootGroup.position.copy(this.basePosition);
  }

  private createBoxingGlove(gloveMat: THREE.Material, lacesMat: THREE.Material): THREE.Mesh {
    const group = new THREE.Group();

    // Main padded fist
    const fistGeo = new THREE.SphereGeometry(0.11, 14, 14);
    fistGeo.scale(1.0, 1.25, 0.95);
    const fist = new THREE.Mesh(fistGeo, gloveMat);
    group.add(fist);

    // Thumb lock
    const thumbGeo = new THREE.SphereGeometry(0.05, 10, 10);
    thumbGeo.scale(1.0, 1.4, 0.8);
    const thumb = new THREE.Mesh(thumbGeo, gloveMat);
    thumb.position.set(0.07, -0.02, 0.04);
    group.add(thumb);

    // Wrist cuff
    const cuffGeo = new THREE.CylinderGeometry(0.08, 0.085, 0.10, 12);
    const cuff = new THREE.Mesh(cuffGeo, gloveMat);
    cuff.position.y = 0.11;
    group.add(cuff);

    // Laces detailing
    const laceGeo = new THREE.BoxGeometry(0.06, 0.07, 0.015);
    const laces = new THREE.Mesh(laceGeo, lacesMat);
    laces.position.set(0, 0.10, -0.08);
    group.add(laces);

    // Package into dummy root mesh
    const dummyMesh = new THREE.Mesh();
    dummyMesh.add(group);
    return dummyMesh;
  }

  private createTelegraphGlow(): THREE.Mesh {
    const geo = new THREE.SphereGeometry(0.24, 12, 12);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff2200,
      transparent: true,
      opacity: 0.55,
      wireframe: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    return mesh;
  }
}
