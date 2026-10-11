import * as THREE from 'three';

export interface ChalkDecal {
  mesh: THREE.Mesh;
  opacity: number;
  life: number;
  maxLife: number;
}

export class TennisCourt {
  public group: THREE.Group;
  private chalkDecals: ChalkDecal[] = [];
  private chalkDecalPool: THREE.Mesh[] = [];

  // In-Flight Bounce Landing Target Decal & Contracting Timing Ring
  private landingTargetGroup!: THREE.Group;
  private landingTargetCore!: THREE.Mesh;
  private landingTimingRing!: THREE.Mesh;
  private isLandingTargetActive = false;
  private landingTimeRemaining = 0;
  private landingTotalTime = 1.0;

  // ITF Regulation Dimensions (meters)
  public static readonly COURT_LENGTH = 23.77;
  public static readonly HALF_LENGTH = 11.885;
  public static readonly DOUBLES_WIDTH = 10.97;
  public static readonly HALF_DOUBLES_WIDTH = 5.485;
  public static readonly SINGLES_WIDTH = 8.23;
  public static readonly HALF_SINGLES_WIDTH = 4.115;
  public static readonly SERVICE_LINE_DIST = 6.40;
  public static readonly NET_HEIGHT_CENTER = 0.914;
  public static readonly NET_HEIGHT_POST = 1.07;
  public static readonly NET_POST_X = 6.40;

  constructor() {
    this.group = new THREE.Group();
    this.buildCourtFloor();
    this.buildCourtLines();
    this.buildNet();
    this.buildStadiumSurround();
    this.buildUmpireAndBenches();
    this.buildLandingTargetDecal();
  }

  private buildCourtFloor(): void {
    // 1. Outer Arena Apron Floor (Australian / US Open deep navy surround)
    const apronGeo = new THREE.PlaneGeometry(24.0, 44.0);
    const apronMat = new THREE.MeshStandardMaterial({
      color: 0x0c1e36,
      roughness: 0.85,
      metalness: 0.1
    });
    const apronMesh = new THREE.Mesh(apronGeo, apronMat);
    apronMesh.rotation.x = -Math.PI / 2;
    apronMesh.position.y = -0.002;
    apronMesh.receiveShadow = true;
    this.group.add(apronMesh);

    // 2. Inner Hardcourt Playing Area (Vibrant tournament Pacific Blue)
    const innerGeo = new THREE.PlaneGeometry(TennisCourt.DOUBLES_WIDTH + 0.2, TennisCourt.COURT_LENGTH + 0.2);
    const innerMat = new THREE.MeshStandardMaterial({
      color: 0x1d4ed8,
      roughness: 0.72,
      metalness: 0.15
    });
    const innerMesh = new THREE.Mesh(innerGeo, innerMat);
    innerMesh.rotation.x = -Math.PI / 2;
    innerMesh.position.y = -0.001;
    innerMesh.receiveShadow = true;
    this.group.add(innerMesh);
  }

  private buildCourtLines(): void {
    const lineMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide
    });

    const addLine = (width: number, length: number, x: number, z: number, rotY = 0): void => {
      const lineGeo = new THREE.PlaneGeometry(width, length);
      const line = new THREE.Mesh(lineGeo, lineMat);
      line.rotation.x = -Math.PI / 2;
      line.rotation.z = rotY;
      line.position.set(x, 0.001, z);
      line.receiveShadow = true;
      this.group.add(line);
    };

    const lineWidth = 0.05; // 5 cm regulation
    const baselineWidth = 0.08; // 8 cm wide baseline

    // Baselines (Z = ±11.885)
    addLine(TennisCourt.DOUBLES_WIDTH, baselineWidth, 0, -TennisCourt.HALF_LENGTH);
    addLine(TennisCourt.DOUBLES_WIDTH, baselineWidth, 0, TennisCourt.HALF_LENGTH);

    // Doubles Sidelines (X = ±5.485)
    addLine(lineWidth, TennisCourt.COURT_LENGTH, -TennisCourt.HALF_DOUBLES_WIDTH, 0);
    addLine(lineWidth, TennisCourt.COURT_LENGTH, TennisCourt.HALF_DOUBLES_WIDTH, 0);

    // Singles Sidelines (X = ±4.115)
    addLine(lineWidth, TennisCourt.COURT_LENGTH, -TennisCourt.HALF_SINGLES_WIDTH, 0);
    addLine(lineWidth, TennisCourt.COURT_LENGTH, TennisCourt.HALF_SINGLES_WIDTH, 0);

    // Service Lines (Z = ±6.40, across singles width)
    addLine(TennisCourt.SINGLES_WIDTH, lineWidth, 0, -TennisCourt.SERVICE_LINE_DIST);
    addLine(TennisCourt.SINGLES_WIDTH, lineWidth, 0, TennisCourt.SERVICE_LINE_DIST);

    // Center Service Line (X = 0, between service lines Z = -6.40 to +6.40)
    addLine(lineWidth, TennisCourt.SERVICE_LINE_DIST * 2, 0, 0);

    // Center Marks at Baselines (0.15m long into court)
    addLine(lineWidth, 0.15, 0, -TennisCourt.HALF_LENGTH + 0.075);
    addLine(lineWidth, 0.15, 0, TennisCourt.HALF_LENGTH - 0.075);
  }

  private buildNet(): void {
    const netGroup = new THREE.Group();

    // 1. Net Posts (Cylinders at X = ±6.40m, height 1.07m)
    const postGeo = new THREE.CylinderGeometry(0.04, 0.04, TennisCourt.NET_HEIGHT_POST, 16);
    const postMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.8,
      roughness: 0.2
    });

    const leftPost = new THREE.Mesh(postGeo, postMat);
    leftPost.position.set(-TennisCourt.NET_POST_X, TennisCourt.NET_HEIGHT_POST / 2, 0);
    leftPost.castShadow = true;
    netGroup.add(leftPost);

    const rightPost = new THREE.Mesh(postGeo, postMat);
    rightPost.position.set(TennisCourt.NET_POST_X, TennisCourt.NET_HEIGHT_POST / 2, 0);
    rightPost.castShadow = true;
    netGroup.add(rightPost);

    // 2. Net Mesh Geometry (Catenary curve / trapezoid approximation)
    // Left side: from (-6.4, 1.07) to (0, 0.914)
    // Right side: from (0, 0.914) to (6.4, 1.07)
    const netMeshMat = new THREE.MeshBasicMaterial({
      color: 0x0f172a,
      transparent: true,
      opacity: 0.65,
      wireframe: true,
      side: THREE.DoubleSide
    });

    // We can build the net surface using a 2D grid of vertices
    const netWidth = TennisCourt.NET_POST_X * 2;
    const segmentsX = 24;
    const netGeo = new THREE.PlaneGeometry(netWidth, 1.0, segmentsX, 10);
    const posAttr = netGeo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const normalizedX = Math.abs(x) / TennisCourt.NET_POST_X; // 0 at center, 1 at post
      const topY = THREE.MathUtils.lerp(TennisCourt.NET_HEIGHT_CENTER, TennisCourt.NET_HEIGHT_POST, normalizedX * normalizedX);
      const originalY = posAttr.getY(i) + 0.5; // [0, 1]
      posAttr.setY(i, originalY * topY);
    }
    netGeo.computeVertexNormals();

    const netMesh = new THREE.Mesh(netGeo, netMeshMat);
    netMesh.position.set(0, 0, 0);
    netMesh.castShadow = true;
    netGroup.add(netMesh);

    // 3. Top White Net Tape (5cm thick band along top curve)
    const tapeSegments = 24;
    const tapeCurvePoints: THREE.Vector3[] = [];
    for (let s = 0; s <= tapeSegments; s++) {
      const frac = s / tapeSegments;
      const x = -TennisCourt.NET_POST_X + frac * (TennisCourt.NET_POST_X * 2);
      const normalizedX = Math.abs(x) / TennisCourt.NET_POST_X;
      const y = THREE.MathUtils.lerp(TennisCourt.NET_HEIGHT_CENTER, TennisCourt.NET_HEIGHT_POST, normalizedX * normalizedX);
      tapeCurvePoints.push(new THREE.Vector3(x, y, 0));
    }
    const tapeCurve = new THREE.CatmullRomCurve3(tapeCurvePoints);
    const tapeGeo = new THREE.TubeGeometry(tapeCurve, 24, 0.026, 8, false);
    const tapeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.3,
      metalness: 0.1
    });
    const tapeMesh = new THREE.Mesh(tapeGeo, tapeMat);
    tapeMesh.castShadow = true;
    netGroup.add(tapeMesh);

    // 4. Center Strap (White band holding center down to 0.914m)
    const strapGeo = new THREE.BoxGeometry(0.05, TennisCourt.NET_HEIGHT_CENTER, 0.015);
    const strapMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
    const strapMesh = new THREE.Mesh(strapGeo, strapMat);
    strapMesh.position.set(0, TennisCourt.NET_HEIGHT_CENTER / 2, 0);
    netGroup.add(strapMesh);

    this.group.add(netGroup);
  }

  private buildStadiumSurround(): void {
    // Stadium Perimeter Walls & Digital LED Advertising Boards
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x050d1a,
      roughness: 0.6,
      metalness: 0.5
    });

    const ledMat = new THREE.MeshStandardMaterial({
      color: 0x00f2fe,
      emissive: 0x00f2fe,
      emissiveIntensity: 0.45,
      roughness: 0.2
    });

    const backWallZ = 21.0;
    const sideWallX = 11.5;

    // Back boards (behind players)
    const createBoard = (w: number, h: number, x: number, y: number, z: number, rotY = 0): void => {
      const boardGroup = new THREE.Group();
      const baseMesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.2), wallMat);
      baseMesh.castShadow = true;
      baseMesh.receiveShadow = true;
      boardGroup.add(baseMesh);

      // Neon brand strip
      const stripMesh = new THREE.Mesh(new THREE.BoxGeometry(w * 0.96, 0.08, 0.22), ledMat);
      stripMesh.position.y = h * 0.35;
      boardGroup.add(stripMesh);

      boardGroup.position.set(x, y + h / 2, z);
      boardGroup.rotation.y = rotY;
      this.group.add(boardGroup);
    };

    createBoard(23.0, 1.2, 0, 0, -backWallZ);
    createBoard(23.0, 1.2, 0, 0, backWallZ, Math.PI);
    createBoard(42.0, 1.2, -sideWallX, 0, 0, Math.PI / 2);
    createBoard(42.0, 1.2, sideWallX, 0, 0, -Math.PI / 2);
  }

  private buildUmpireAndBenches(): void {
    // 1. Umpire Tower at sideline X = -7.5m, Z = 0
    const umpireGroup = new THREE.Group();
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.7, roughness: 0.3 });
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.5 });

    // 4 legs
    const legGeo = new THREE.CylinderGeometry(0.03, 0.03, 2.4, 8);
    for (const [dx, dz] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) {
      const leg = new THREE.Mesh(legGeo, frameMat);
      leg.position.set(dx, 1.2, dz);
      leg.rotation.z = dx * 0.15;
      leg.castShadow = true;
      umpireGroup.add(leg);
    }

    // Seat platform
    const platform = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.08, 1.0), frameMat);
    platform.position.y = 2.0;
    umpireGroup.add(platform);

    // Chair
    const chair = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), seatMat);
    chair.position.set(0, 2.4, 0);
    chair.rotation.y = Math.PI / 2; // Facing the court
    umpireGroup.add(chair);

    // Sun umbrella canopy
    const canopyGeo = new THREE.ConeGeometry(0.8, 0.35, 16);
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0x38ef7d, roughness: 0.6 });
    const canopy = new THREE.Mesh(canopyGeo, canopyMat);
    canopy.position.set(0, 3.2, 0);
    umpireGroup.add(canopy);

    umpireGroup.position.set(-7.5, 0, 0);
    this.group.add(umpireGroup);

    // 2. Player benches on the opposite side (X = +7.5m)
    const createBench = (z: number): void => {
      const benchGroup = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 1.6), seatMat);
      seat.position.y = 0.45;
      seat.castShadow = true;
      benchGroup.add(seat);

      const leg1 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, 0.1), frameMat);
      leg1.position.set(0, 0.225, -0.6);
      benchGroup.add(leg1);

      const leg2 = leg1.clone();
      leg2.position.set(0, 0.225, 0.6);
      benchGroup.add(leg2);

      benchGroup.position.set(7.5, 0, z);
      this.group.add(benchGroup);
    };

    createBench(-4.0);
    createBench(4.0);
  }

  /**
   * Spawns a white chalk impact decal on the court floor at the bounce location
   */
  public spawnChalkImpact(x: number, z: number, isGoodIn = true): void {
    let decalMesh = this.chalkDecalPool.pop();
    if (!decalMesh) {
      const geo = new THREE.RingGeometry(0.015, 0.075, 20);
      const mat = new THREE.MeshBasicMaterial({
        color: isGoodIn ? 0xffffff : 0xff3b30,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide
      });
      decalMesh = new THREE.Mesh(geo, mat);
      decalMesh.rotation.x = -Math.PI / 2;
    } else {
      (decalMesh.material as THREE.MeshBasicMaterial).color.setHex(isGoodIn ? 0xffffff : 0xff3b30);
      (decalMesh.material as THREE.MeshBasicMaterial).opacity = 0.85;
      decalMesh.visible = true;
    }

    decalMesh.position.set(x, 0.003, z);
    decalMesh.scale.set(1, 1, 1);
    this.group.add(decalMesh);

    this.chalkDecals.push({
      mesh: decalMesh,
      opacity: 0.85,
      life: 0,
      maxLife: 2.5
    });
  }

  private buildLandingTargetDecal(): void {
    this.landingTargetGroup = new THREE.Group();
    this.landingTargetGroup.position.set(0, 0.003, 0);
    this.landingTargetGroup.visible = false;

    // 1. Inner Bullseye Landing Target
    const coreGeo = new THREE.RingGeometry(0.04, 0.22, 32);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0x00f2fe,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide
    });
    this.landingTargetCore = new THREE.Mesh(coreGeo, coreMat);
    this.landingTargetCore.rotation.x = -Math.PI / 2;
    this.landingTargetGroup.add(this.landingTargetCore);

    // 2. Outer Contracting Timing Ring
    const ringGeo = new THREE.RingGeometry(0.25, 0.32, 48);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x39ff14,
      transparent: true,
      opacity: 0.90,
      side: THREE.DoubleSide
    });
    this.landingTimingRing = new THREE.Mesh(ringGeo, ringMat);
    this.landingTimingRing.rotation.x = -Math.PI / 2;
    this.landingTargetGroup.add(this.landingTimingRing);

    this.group.add(this.landingTargetGroup);
  }

  public showLandingTarget(x: number, z: number, timeToBounce: number, isNearSide = true): void {
    this.landingTargetGroup.position.set(x, 0.003, z);
    this.landingTargetGroup.visible = true;
    this.isLandingTargetActive = true;
    this.landingTimeRemaining = timeToBounce;
    this.landingTotalTime = Math.max(0.12, timeToBounce);

    const coreColor = isNearSide ? 0x00f2fe : 0xfacc15;
    const ringColor = isNearSide ? 0x39ff14 : 0xff0055;
    (this.landingTargetCore.material as THREE.MeshBasicMaterial).color.setHex(coreColor);
    (this.landingTimingRing.material as THREE.MeshBasicMaterial).color.setHex(ringColor);
  }

  public hideLandingTarget(): void {
    if (this.landingTargetGroup) {
      this.landingTargetGroup.visible = false;
      this.isLandingTargetActive = false;
    }
  }

  public update(dt: number): void {
    // 1. Update In-Flight Landing Decal & Timing Ring
    if (this.isLandingTargetActive) {
      this.landingTimeRemaining = Math.max(0, this.landingTimeRemaining - dt);
      const ratio = Math.max(0, this.landingTimeRemaining / this.landingTotalTime);

      // Contracting scale: starts at ~4.0x and smoothly contracts down to 1.0x at impact
      const contractScale = 1.0 + ratio * 3.2;
      this.landingTimingRing.scale.set(contractScale, contractScale, 1);
      this.landingTimingRing.rotation.z += dt * 3.5;
      this.landingTargetCore.rotation.z -= dt * 1.5;

      const ringOpacity = THREE.MathUtils.lerp(0.95, 0.45, ratio);
      (this.landingTimingRing.material as THREE.MeshBasicMaterial).opacity = ringOpacity;

      if (this.landingTimeRemaining <= 0) {
        this.hideLandingTarget();
      }
    }

    // 2. Update Chalk Impact Decals
    for (let i = this.chalkDecals.length - 1; i >= 0; i--) {
      const d = this.chalkDecals[i];
      d.life += dt;
      const progress = d.life / d.maxLife;
      d.opacity = THREE.MathUtils.lerp(0.85, 0, progress);
      (d.mesh.material as THREE.MeshBasicMaterial).opacity = d.opacity;
      const scale = 1.0 + progress * 0.4;
      d.mesh.scale.set(scale, scale, 1);

      if (d.life >= d.maxLife) {
        this.group.remove(d.mesh);
        d.mesh.visible = false;
        this.chalkDecalPool.push(d.mesh);
        this.chalkDecals.splice(i, 1);
      }
    }
  }

  public destroy(): void {
    for (const d of this.chalkDecals) {
      this.group.remove(d.mesh);
    }
    this.chalkDecals = [];
    this.chalkDecalPool = [];
    if (this.landingTargetGroup) {
      this.group.remove(this.landingTargetGroup);
    }
  }
}
