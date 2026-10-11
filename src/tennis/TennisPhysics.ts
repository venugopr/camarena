import * as THREE from 'three';

export type TennisShotType = 'FLAT SERVE' | 'KICK SERVE' | 'TOPSPIN FOREHAND' | 'TOPSPIN BACKHAND' | 'SLICE' | 'VOLLEY' | 'SMASH' | 'LOB' | 'DRIVE' | 'TOPSPIN';

export interface TennisHitResult {
  hit: boolean;
  shotType: TennisShotType;
  speedKmh: number;
  impactPos: THREE.Vector3;
  impactPoint?: THREE.Vector3;
  spin?: THREE.Vector3;
  isSweetSpot?: boolean;
}

export interface TennisBounceEvent {
  x: number;
  z: number;
  side: 'near' | 'far'; // near = player 1, far = player 2 (AI)
  bounceCount: number;
  speedKmh: number;
}

export class TennisPhysics {
  public ballMesh: THREE.Group;
  public ballPos = new THREE.Vector3(0, 1.2, -11.5);
  public prevBallPos = new THREE.Vector3(0, 1.2, -11.5);
  public ballVel = new THREE.Vector3(0, 0, 0);
  public ballSpin = new THREE.Vector3(0, 0, 0); // (omega_x: topspin/backspin, omega_y: sidespin, omega_z: roll)

  // Authentic Tennis Physical & Aerodynamic Properties
  public static readonly BALL_MASS = 0.058; // kg (ITF specification ~56.0-59.4g)
  public static readonly BALL_RADIUS = 0.033; // m (ITF regulation diameter ~6.54-6.86cm)
  public static readonly VISUAL_RADIUS = 0.065; // High-visibility optic scale for camera view
  public static readonly GRAVITY = 9.81;
  public static readonly AIR_DENSITY = 1.21; // kg/m^3 (sea level air density)
  public static readonly DRAG_COEFF = 0.55; // Fuzzy tennis ball Cd ~ 0.50-0.60
  public static readonly MAGNUS_COEFF = 0.32; // Lift coefficient Cl
  public static readonly GROUND_RESTITUTION = 0.72; // Hardcourt regulation restitution ey = 0.72
  public static readonly GROUND_FRICTION = 0.38; // Hardcourt dynamic friction mu = 0.38
  public static readonly FIXED_SUB_DT = 1 / 120; // 120 Hz tick (~0.00833s)

  public inPlay = false;
  public lastHitter: 1 | 2 = 1;
  public bounceCountNear = 0;
  public bounceCountFar = 0;
  public hasClearedNet = false;
  public hitNetTape = false;
  public netFaultOccurred = false;

  private shadowMesh: THREE.Mesh;
  private trailLine: THREE.Line;
  private trailPositions: THREE.Vector3[] = [];
  private static readonly MAX_TRAIL_POINTS = 18;

  public onBounce?: (e: TennisBounceEvent) => void;
  public onNetFault?: (ballPos: THREE.Vector3) => void;
  public onNetTapeLet?: (ballPos: THREE.Vector3) => void;

  constructor() {
    this.ballMesh = new THREE.Group();
    this.buildBallGeometry();
    this.shadowMesh = this.buildShadow();
    this.trailLine = this.buildTrail();
  }

  private buildBallGeometry(): void {
    // 1. High-visibility optic-yellow felt core
    const sphereGeo = new THREE.SphereGeometry(TennisPhysics.VISUAL_RADIUS, 32, 32);
    const sphereMat = new THREE.MeshStandardMaterial({
      color: 0xccff00,
      roughness: 0.35,
      metalness: 0.05,
      emissive: 0x88cc00,
      emissiveIntensity: 0.45
    });
    const core = new THREE.Mesh(sphereGeo, sphereMat);
    core.castShadow = true;
    this.ballMesh.add(core);

    // 2. White curved rubber seams (TorusGeometry)
    const seamGeo = new THREE.TorusGeometry(TennisPhysics.VISUAL_RADIUS * 0.97, 0.0035, 12, 36);
    const seamMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const seam1 = new THREE.Mesh(seamGeo, seamMat);
    seam1.rotation.x = Math.PI / 4;
    seam1.rotation.y = Math.PI / 4;
    this.ballMesh.add(seam1);

    const seam2 = new THREE.Mesh(seamGeo, seamMat);
    seam2.rotation.x = -Math.PI / 4;
    seam2.rotation.y = -Math.PI / 4;
    this.ballMesh.add(seam2);
  }

  private buildShadow(): THREE.Mesh {
    const shadowGeo = new THREE.CircleGeometry(0.18, 24);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x020813,
      transparent: true,
      opacity: 0.65,
      depthWrite: false
    });
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.005;
    return shadow;
  }

  private buildTrail(): THREE.Line {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(TennisPhysics.MAX_TRAIL_POINTS * 3);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({
      color: 0xeaff00,
      transparent: true,
      opacity: 0.6,
      linewidth: 2
    });
    return new THREE.Line(geometry, material);
  }

  public getTrailMesh(): THREE.Line {
    return this.trailLine;
  }

  public getShadowMesh(): THREE.Mesh {
    return this.shadowMesh;
  }

  /**
   * Resets ball state for a new serve
   */
  public prepareServe(server: 1 | 2, serverX: number, serverZ: number, serverY = 1.25): void {
    this.inPlay = false;
    this.lastHitter = server;
    this.bounceCountNear = 0;
    this.bounceCountFar = 0;
    this.hasClearedNet = false;
    this.hitNetTape = false;
    this.netFaultOccurred = false;
    this.ballVel.set(0, 0, 0);
    this.ballSpin.set(0, 0, 0);

    this.ballPos.set(serverX, serverY, serverZ);
    this.prevBallPos.copy(this.ballPos);
    this.ballMesh.position.copy(this.ballPos);
    this.ballMesh.visible = true;
    this.shadowMesh.position.set(this.ballPos.x, 0.005, this.ballPos.z);
    this.shadowMesh.scale.set(1, 1, 1);
    (this.shadowMesh.material as THREE.MeshBasicMaterial).opacity = 0.65;
    this.trailPositions = [];
  }

  /**
   * Kinematic Net Clearance Solver
   * Solves required vertical launch velocity so the ball cleanly clears the 0.914m net with safety margin.
   */
  public enforceNetClearance(origin: THREE.Vector3, velocity: THREE.Vector3, targetClearance = 1.35): THREE.Vector3 {
    const vzAbs = Math.abs(velocity.z);
    if (vzAbs < 0.5) return velocity;

    const distToNet = Math.abs(origin.z);
    // Aerodynamic drag slows forward velocity vz by ~15-20% over 12m flight
    const tNet = (distToNet / vzAbs) * 1.18;

    if (tNet <= 0 || tNet > 4.0) return velocity;

    // Effective gravity accounting for topspin Magnus downward acceleration
    const gEff = TennisPhysics.GRAVITY + 1.2;
    const yNet = origin.y + velocity.y * tNet - 0.5 * gEff * tNet * tNet;

    if (yNet < targetClearance) {
      const requiredVy = (targetClearance - origin.y + 0.5 * gEff * tNet * tNet) / tNet + 0.35;
      velocity.y = Math.max(velocity.y, requiredVy);
    }

    return velocity;
  }

  /**
   * Launches the serve into play
   */
  public launchServe(server: 1 | 2, velocity: THREE.Vector3, spin: THREE.Vector3): void {
    this.inPlay = true;
    this.lastHitter = server;
    this.bounceCountNear = 0;
    this.bounceCountFar = 0;
    this.hasClearedNet = false;
    this.hitNetTape = false;
    this.netFaultOccurred = false;
    this.enforceNetClearance(this.ballPos, velocity, 1.35);
    this.ballVel.copy(velocity);
    this.ballSpin.copy(spin);
    this.prevBallPos.copy(this.ballPos);
  }

  /**
   * Main Physics Integrator (Sub-stepped RK4/Verlet approximation)
   */
  /**
   * Main Physics Integrator (120 Hz Sub-stepped Verlet/RK approximation)
   */
  public update(dt: number): void {
    if (!this.inPlay) {
      this.ballVel.set(0, 0, 0);
      this.ballMesh.position.copy(this.ballPos);
      this.shadowMesh.position.set(this.ballPos.x, 0.005, this.ballPos.z);
      this.shadowMesh.scale.set(1, 1, 1);
      (this.shadowMesh.material as THREE.MeshBasicMaterial).opacity = 0.65;
      return;
    }

    // Fixed 120 Hz sub-stepping tick (FIXED_SUB_DT ~ 0.00833s) to eliminate collision tunneling
    const maxSubSteps = 10;
    const stepDt = TennisPhysics.FIXED_SUB_DT;
    let remainingDt = dt;
    let steps = 0;

    while (remainingDt > 1e-4 && steps < maxSubSteps) {
      const currentSubDt = Math.min(stepDt, remainingDt);
      this.integrateStep(currentSubDt);
      remainingDt -= currentSubDt;
      steps++;
    }

    // Update Three.js visual mesh position
    this.ballMesh.position.copy(this.ballPos);

    // Ball visual spin roll
    const spinSpeed = this.ballSpin.length();
    if (spinSpeed > 0.1) {
      const axis = this.ballSpin.clone().normalize();
      this.ballMesh.rotateOnAxis(axis, spinSpeed * dt);
    }

    // Ground Shadow update (scales with altitude, locked to court floor Y = 0.005)
    const altitude = Math.max(0, this.ballPos.y - TennisPhysics.BALL_RADIUS);
    this.shadowMesh.position.set(this.ballPos.x, 0.005, this.ballPos.z);
    const shadowScale = Math.max(0.4, 1.0 + altitude * 0.25);
    this.shadowMesh.scale.set(shadowScale, shadowScale, 1);
    const shadowOpacity = Math.max(0.15, 0.65 - altitude * 0.15);
    (this.shadowMesh.material as THREE.MeshBasicMaterial).opacity = shadowOpacity;

    // Trajectory Trail update
    this.updateTrail();
  }

  private integrateStep(dt: number): void {
    this.prevBallPos.copy(this.ballPos);

    const speed = this.ballVel.length();
    const area = Math.PI * TennisPhysics.BALL_RADIUS * TennisPhysics.BALL_RADIUS;

    // 1. Aerodynamic Drag: F_d = -0.5 * rho * C_d * A * |v| * v => a_d = F_d / m
    const dragScalar = (0.5 * TennisPhysics.AIR_DENSITY * TennisPhysics.DRAG_COEFF * area * speed) / TennisPhysics.BALL_MASS;
    const dragAcc = this.ballVel.clone().multiplyScalar(-dragScalar);

    // 2. Magnus Effect: F_m = 0.5 * rho * C_l * A * r * (omega x v) => a_m = F_m / m
    // Topspin (omega_x > 0, forward v_z > 0): cross product generates strong downward acceleration (loop & dip)
    // Slice (omega_x < 0, forward v_z > 0): cross product generates upward aerodynamic lift (float)
    const magnusScalar = (0.5 * TennisPhysics.AIR_DENSITY * TennisPhysics.MAGNUS_COEFF * area * TennisPhysics.BALL_RADIUS) / TennisPhysics.BALL_MASS;
    const magnusAcc = new THREE.Vector3()
      .crossVectors(this.ballSpin, this.ballVel)
      .multiplyScalar(magnusScalar * 1.85);

    // 3. Gravity: F_g = m * g => a_g = (0, -g, 0)
    const gravityAcc = new THREE.Vector3(0, -TennisPhysics.GRAVITY, 0);

    // Sum accelerations and integrate velocity
    const totalAcc = new THREE.Vector3().add(dragAcc).add(magnusAcc).add(gravityAcc);
    this.ballVel.addScaledVector(totalAcc, dt);

    // Integrate position
    this.ballPos.addScaledVector(this.ballVel, dt);

    // 4. Net Collision Detection (Net at Z = 0, |X| <= 6.40m, center height 0.914m, posts 1.07m)
    this.checkNetCollision();

    // 5. Court Ground Bounce (Y <= BALL_RADIUS)
    if (this.ballPos.y <= TennisPhysics.BALL_RADIUS) {
      this.handleGroundBounce();
    }
  }

  private checkNetCollision(): void {
    if (this.netFaultOccurred || !this.inPlay) return;

    const prevZ = this.prevBallPos.z;
    const currZ = this.ballPos.z;

    // Only trigger a net plane crossing if the ball genuinely traveled across the net plane Z = 0
    const crossedNet = (this.prevBallPos.z < 0.0 && this.ballPos.z >= 0.0) ||
                       (this.prevBallPos.z > 0.0 && this.ballPos.z <= 0.0);

    if (crossedNet) {
      const denom = currZ - prevZ;
      const t = Math.abs(denom) > 1e-6 ? (0 - prevZ) / denom : 0.5;
      const intersectX = this.prevBallPos.x + t * (this.ballPos.x - this.prevBallPos.x);
      const intersectY = this.prevBallPos.y + t * (this.ballPos.y - this.prevBallPos.y);

      const courtHalfWidth = 6.40; // doubles net post span

      // Only declare a Net Fault if intersectY <= 0.95m AND |intersectX| <= courtHalfWidth
      if (intersectY <= 0.95 && Math.abs(intersectX) <= courtHalfWidth) {
        // Check if hitting top tape (within top 5cm of net ~ 0.90m - 0.95m)
        if (intersectY >= 0.90) {
          // Lucky Net Tape Let / Cord Deflection!
          this.hitNetTape = true;
          this.ballVel.z *= 0.65; // damp forward speed
          this.ballVel.y = Math.max(0.6, this.ballVel.y * 0.4 + 0.5); // bounce up slightly
          this.ballPos.z = currZ > 0 ? 0.05 : -0.05; // nudge past net
          if (this.onNetTapeLet) this.onNetTapeLet(this.ballPos);
        } else {
          // Net Fault! Solid collision with net mesh
          this.netFaultOccurred = true;
          this.ballVel.z = -this.ballVel.z * 0.15; // damp and rebound backwards
          this.ballVel.x *= 0.3;
          this.ballVel.y = Math.min(0.2, this.ballVel.y * 0.2);
          this.ballPos.z = prevZ;
          if (this.onNetFault) this.onNetFault(this.ballPos);
        }
        return;
      }

      // If intersectY > 0.95m, cleanly cleared the net!
      this.hasClearedNet = true;
    }
  }

  private handleGroundBounce(): void {
    this.ballPos.y = TennisPhysics.BALL_RADIUS;

    // Hardcourt Restitution: e_y = 0.72. Slice cut skids with reduced vertical rebound.
    let restitutionY = TennisPhysics.GROUND_RESTITUTION;
    if (this.ballSpin.x < -30) {
      restitutionY = 0.58; // Slice skid reduction
    }

    if (Math.abs(this.ballVel.y) > 0.35) {
      this.ballVel.y = -this.ballVel.y * restitutionY;
    } else {
      this.ballVel.y = 0; // come to rest
    }

    // Dynamic Friction (mu = 0.38) & Spin modifies horizontal exit velocity post-bounce:
    const forwardSign = Math.sign(this.ballVel.z) || 1;
    // Topspin (omega_x > 0): imparts forward kick, ball accelerates forward off bounce
    const topspinKick = (this.ballSpin.x * TennisPhysics.BALL_RADIUS * TennisPhysics.GROUND_FRICTION) * 0.9;
    this.ballVel.z += forwardSign * topspinKick;
    this.ballVel.z *= (1.0 - TennisPhysics.GROUND_FRICTION * 0.35);

    // Sidespin modification
    const sideSpinKick = (this.ballSpin.y * TennisPhysics.BALL_RADIUS * TennisPhysics.GROUND_FRICTION) * 0.75;
    this.ballVel.x += sideSpinKick;
    this.ballVel.x *= (1.0 - TennisPhysics.GROUND_FRICTION * 0.45);

    // Spin decays on ground impact
    this.ballSpin.x *= 0.52;
    this.ballSpin.y *= 0.48;
    this.ballSpin.z *= 0.60;

    // Track bounce count on court side
    const isNearSide = this.ballPos.z < 0;
    if (isNearSide) {
      this.bounceCountNear++;
    } else {
      this.bounceCountFar++;
    }

    const currentCount = isNearSide ? this.bounceCountNear : this.bounceCountFar;
    const speedKmh = this.ballVel.length() * 3.6;

    if (this.onBounce) {
      this.onBounce({
        x: this.ballPos.x,
        z: this.ballPos.z,
        side: isNearSide ? 'near' : 'far',
        bounceCount: currentCount,
        speedKmh
      });
    }
  }

  private updateTrail(): void {
    this.trailPositions.unshift(this.ballPos.clone());
    if (this.trailPositions.length > TennisPhysics.MAX_TRAIL_POINTS) {
      this.trailPositions.pop();
    }

    const posAttr = this.trailLine.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < TennisPhysics.MAX_TRAIL_POINTS; i++) {
      const p = this.trailPositions[i] || this.ballPos;
      posAttr.setXYZ(i, p.x, p.y, p.z);
    }
    posAttr.needsUpdate = true;
  }

  /**
   * Swept oriented disc collision against player or AI racket
   */
  public checkRacketStrike(
    racketCenter: THREE.Vector3,
    racketNormal: THREE.Vector3,
    racketRadius = 0.20,
    racketVel: THREE.Vector3 = new THREE.Vector3(),
    isPlayer = true
  ): TennisHitResult {
    if (!this.inPlay && !isPlayer) {
      return { hit: false, shotType: 'FLAT SERVE', speedKmh: 0, impactPos: this.ballPos.clone() };
    }

    // Don't double-hit own shot immediately (cooldown 180ms or requires crossing net)
    const hitterId: 1 | 2 = isPlayer ? 1 : 2;
    if (this.lastHitter === hitterId && this.inPlay && Math.abs(this.ballVel.z) > 4.0) {
      // Allow only if ball is returning towards the hitter
      const movingTowardsHitter = isPlayer ? this.ballVel.z < 0 : this.ballVel.z > 0;
      if (!movingTowardsHitter) {
        return { hit: false, shotType: 'FLAT SERVE', speedKmh: 0, impactPos: this.ballPos.clone() };
      }
    }

    const normal = racketNormal.clone().normalize();
    const halfThickness = 0.14;

    // 1. Swept test against racket disc plane
    const toBall = new THREE.Vector3().subVectors(this.ballPos, racketCenter);
    const distPerp = toBall.dot(normal);
    const inPlaneVec = new THREE.Vector3().copy(toBall).addScaledVector(normal, -distPerp);
    const distParallel = inPlaneVec.length();

    let hit = false;
    let impactPoint = this.ballPos.clone();

    // Check instantaneous proximity
    if (Math.abs(distPerp) <= halfThickness + TennisPhysics.BALL_RADIUS && distParallel <= racketRadius + TennisPhysics.BALL_RADIUS) {
      hit = true;
      impactPoint.copy(racketCenter).add(inPlaneVec);
    } else {
      // Swept trajectory segment test
      const toPrev = new THREE.Vector3().subVectors(this.prevBallPos, racketCenter);
      const distPrevPerp = toPrev.dot(normal);
      if ((distPrevPerp > 0 && distPerp <= 0) || (distPrevPerp < 0 && distPerp >= 0)) {
        const denom = distPrevPerp - distPerp;
        const t = Math.abs(denom) > 1e-5 ? Math.max(0, Math.min(1, distPrevPerp / denom)) : 0.5;
        const crossPoint = new THREE.Vector3().lerpVectors(this.prevBallPos, this.ballPos, t);
        const crossInPlane = new THREE.Vector3().subVectors(crossPoint, racketCenter);
        crossInPlane.addScaledVector(normal, -crossInPlane.dot(normal));
        if (crossInPlane.length() <= racketRadius + TennisPhysics.BALL_RADIUS) {
          hit = true;
          impactPoint = crossPoint;
        }
      }
    }

    if (!hit) {
      return { hit: false, shotType: 'FLAT SERVE', speedKmh: 0, impactPos: this.ballPos.clone() };
    }

    // 2. Physics Calculation of Outgoing Ball Trajectory & Shot Type
    this.inPlay = true;
    this.lastHitter = hitterId;
    this.hasClearedNet = false;
    this.hitNetTape = false;
    this.netFaultOccurred = false;

    // Reset bounce counters for new inbound flight
    if (isPlayer) {
      this.bounceCountFar = 0;
    } else {
      this.bounceCountNear = 0;
    }

    // Forward direction into opponent's half
    const forwardDirZ = isPlayer ? 1 : -1;

    // Calculate stroke mechanics via Racket Swept Volume & Vector Analysis
    const swingSpeed = racketVel.length();
    const swingVy = racketVel.y;
    const racketPitch = normal.y; // pitch angle indicator: positive is open face, negative is closed face
    const ballAltitude = this.ballPos.y;
    const isVolley = (isPlayer ? this.bounceCountNear === 0 : this.bounceCountFar === 0) &&
                     Math.abs(this.ballPos.z) < 7.0;

    let shotType: TennisShotType = 'DRIVE';
    let launchSpeed = 28.0; // base arcade velocity (>100 km/h)
    let launchAngleY = 0.12;
    let topspinRad = 45;

    if (ballAltitude > 2.2 && (swingSpeed > 3.5 || swingVy < -1.2)) {
      // 1. Overhead Smash & Serve Pronation: High contact (y > 2.2m) with downward snap (> 3.5 m/s)
      shotType = 'SMASH';
      launchSpeed = 34.0 + Math.min(10.0, swingSpeed * 1.25); // 122 - 158 km/h!
      launchAngleY = -0.05; // downward blistering drive
      topspinRad = 80;
    } else if (isVolley) {
      // 2. Volley Punch: Short, crisp blocking motion inside Z > -7.0m with instant forward deflection
      shotType = 'VOLLEY';
      launchSpeed = 25.0 + Math.min(8.0, swingSpeed * 0.9);
      launchAngleY = 0.08;
      topspinRad = 35;
    } else if (swingVy > 0.4 && racketPitch <= 0.22) {
      // 3. Topspin Brush: vy_racket > 0.4 m/s, pitch closed (racket face closed)
      // Impart +180 rad/s forward spin: ball dips sharply inside baseline and accelerates forward off bounce
      shotType = isPlayer ? 'TOPSPIN FOREHAND' : 'TOPSPIN';
      launchSpeed = 27.5 + Math.min(11.0, swingSpeed * 1.15); // ~100-138 km/h
      launchAngleY = 0.22; // higher arc that dips aggressively from Magnus force
      topspinRad = 180; // +180 rad/s topspin
    } else if (swingVy < -0.3 && racketPitch > 0.25) {
      // 4. Slice Cut: vy_racket < -0.3 m/s, pitch open > 15 deg (~0.25 rad)
      // Impart -120 rad/s backspin: ball floats low across the net and skids with reduced vertical rebound
      shotType = 'SLICE';
      launchSpeed = 23.0 + Math.min(7.0, swingSpeed * 0.85); // 83 - 108 km/h
      launchAngleY = 0.10; // flat skimming arc with backspin lift
      topspinRad = -120; // -120 rad/s backspin float
    } else {
      // 5. Flat Drive: Direct horizontal strike (> 100 km/h arcade velocity)
      shotType = 'DRIVE';
      launchSpeed = 29.0 + Math.min(9.0, swingSpeed * 1.1); // ~105 - 137 km/h
      launchAngleY = 0.13;
      topspinRad = 50;
    }

    // Directional control from racket position & swing lateral offset
    const lateralTargetX = THREE.MathUtils.clamp((racketCenter.x * 0.8) + (racketVel.x * 0.2), -3.2, 3.2);
    const targetZ = isPlayer ? 10.5 : -10.5;
    const toTarget = new THREE.Vector3(lateralTargetX - this.ballPos.x, 0, targetZ - this.ballPos.z).normalize();

    this.ballVel.set(
      toTarget.x * launchSpeed * 0.45,
      launchSpeed * launchAngleY,
      forwardDirZ * launchSpeed * Math.abs(toTarget.z || 1.0)
    );

    // Kinematically guarantee clean net crossing clearance
    this.enforceNetClearance(this.ballPos, this.ballVel, 1.18);
    this.prevBallPos.copy(this.ballPos);

    this.ballSpin.set(topspinRad, 0, 0);

    const speedKmh = launchSpeed * 3.6;
    return { hit: true, shotType, speedKmh, impactPos: impactPoint };
  }

  /**
   * Predicts projected first bounce location and time-to-bounce.
   * Used for court-floor landing decal and contracting timing ring.
   */
  public predictBounceLanding(): { x: number; z: number; timeToBounce: number } | null {
    if (!this.inPlay || Math.abs(this.ballVel.z) < 0.5) return null;

    const simPos = this.ballPos.clone();
    const simVel = this.ballVel.clone();
    const simSpin = this.ballSpin.clone();
    const simDt = 0.016;
    let t = 0;
    const maxTime = 2.5;

    const area = Math.PI * TennisPhysics.BALL_RADIUS * TennisPhysics.BALL_RADIUS;
    const dragScalar = (0.5 * TennisPhysics.AIR_DENSITY * TennisPhysics.DRAG_COEFF * area) / TennisPhysics.BALL_MASS;
    const magnusScalar = (0.5 * TennisPhysics.AIR_DENSITY * TennisPhysics.MAGNUS_COEFF * area * TennisPhysics.BALL_RADIUS * 1.85) / TennisPhysics.BALL_MASS;

    while (t < maxTime) {
      const spd = simVel.length();
      const dragAcc = simVel.clone().multiplyScalar(-dragScalar * spd);
      const magnusAcc = new THREE.Vector3().crossVectors(simSpin, simVel).multiplyScalar(magnusScalar);
      const gravityAcc = new THREE.Vector3(0, -TennisPhysics.GRAVITY, 0);

      simVel.addScaledVector(dragAcc.add(magnusAcc).add(gravityAcc), simDt);
      simPos.addScaledVector(simVel, simDt);
      t += simDt;

      if (simPos.y <= TennisPhysics.BALL_RADIUS) {
        return {
          x: simPos.x,
          z: simPos.z,
          timeToBounce: t
        };
      }
    }
    return null;
  }
}
