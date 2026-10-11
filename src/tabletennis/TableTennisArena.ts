import * as THREE from 'three';

/**
 * Tournament Arena Environment for Table Tennis.
 * Features tiered spectator bleachers, stylized crowd silhouettes with rally bobbing animations,
 * overhead metal lighting truss, arena sports floor, and scrolling LED ribbon barrier boards.
 */
export class TableTennisArena {
  public group: THREE.Group;

  private spectators: THREE.Group[] = [];
  private spectatorBaseY: number[] = [];
  private spectatorPhases: number[] = [];

  private ledCanvas!: HTMLCanvasElement;
  private ledCtx!: CanvasRenderingContext2D;
  private ledTexture!: THREE.CanvasTexture;
  private ledScrollOffset = 0;

  constructor() {
    this.group = new THREE.Group();

    this.buildSportsFloor();
    this.buildLightingTruss();
    this.buildStadiumBleachersAndSpectators();
    this.buildLEDRibbonBoards();
  }

  /**
   * Builds high-visibility tournament sports floor with court markings.
   */
  private buildSportsFloor(): void {
    // Tournament Vinyl Mat Floor (26m x 32m)
    const floorGeo = new THREE.PlaneGeometry(26, 32);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x0c1322, // Deep navy arena floor
      roughness: 0.35,
      metalness: 0.15,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.receiveShadow = true;
    this.group.add(floor);

    // Warm Tournament Court Mat Inset (8m x 14m under table)
    const matGeo = new THREE.PlaneGeometry(8, 14);
    const matMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.3,
      metalness: 0.1,
    });
    const courtMat = new THREE.Mesh(matGeo, matMat);
    courtMat.rotation.x = -Math.PI / 2;
    courtMat.position.set(0, 0.002, 0);
    courtMat.receiveShadow = true;
    this.group.add(courtMat);

    // Cyan Court Boundary Lines
    const lineGeo = new THREE.PlaneGeometry(7.6, 13.6);
    const lineEdges = new THREE.EdgesGeometry(lineGeo);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x00f2fe, linewidth: 2 });
    const lines = new THREE.LineSegments(lineEdges, lineMat);
    lines.rotation.x = -Math.PI / 2;
    lines.position.set(0, 0.004, 0);
    this.group.add(lines);
  }

  /**
   * Builds overhead metal truss structure with arena spotlights.
   */
  private buildLightingTruss(): void {
    const trussGroup = new THREE.Group();
    const trussMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.85, roughness: 0.2 });

    // Main Gantry Beams (Overhead rectangular frame at Y = 5.2m)
    const beamLongGeo = new THREE.BoxGeometry(0.12, 0.12, 16);
    const beamWideGeo = new THREE.BoxGeometry(10, 0.12, 0.12);

    const beamLeft = new THREE.Mesh(beamLongGeo, trussMat);
    beamLeft.position.set(-4.5, 5.2, 0);
    trussGroup.add(beamLeft);

    const beamRight = new THREE.Mesh(beamLongGeo, trussMat);
    beamRight.position.set(4.5, 5.2, 0);
    trussGroup.add(beamRight);

    const beamFar = new THREE.Mesh(beamWideGeo, trussMat);
    beamFar.position.set(0, 5.2, 7.5);
    trussGroup.add(beamFar);

    const beamNear = new THREE.Mesh(beamWideGeo, trussMat);
    beamNear.position.set(0, 5.2, -7.5);
    trussGroup.add(beamNear);

    // Spotlight Fixtures & Downward Light Cones
    const spotGeo = new THREE.CylinderGeometry(0.14, 0.22, 0.35, 16);
    const spotMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.9, roughness: 0.1 });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xe0f2fe, transparent: true, opacity: 0.85 });

    const coneGeo = new THREE.CylinderGeometry(0.18, 1.8, 4.8, 16, 1, true);
    const coneMat = new THREE.MeshBasicMaterial({
      color: 0x00f2fe,
      transparent: true,
      opacity: 0.08,
      side: THREE.DoubleSide
    });

    const spotPositions = [
      new THREE.Vector3(-4.2, 5.0, -4.5),
      new THREE.Vector3(4.2, 5.0, -4.5),
      new THREE.Vector3(-4.2, 5.0, 4.5),
      new THREE.Vector3(4.2, 5.0, 4.5),
    ];

    spotPositions.forEach((pos) => {
      const fixture = new THREE.Mesh(spotGeo, spotMat);
      fixture.position.copy(pos);
      fixture.rotation.x = Math.PI / 6 * (pos.z > 0 ? -1 : 1);
      trussGroup.add(fixture);

      const lensGlow = new THREE.Mesh(new THREE.CircleGeometry(0.14, 16), glowMat);
      lensGlow.position.set(pos.x, pos.y - 0.18, pos.z);
      lensGlow.rotation.x = Math.PI / 2;
      trussGroup.add(lensGlow);

      const lightCone = new THREE.Mesh(coneGeo, coneMat);
      lightCone.position.set(pos.x * 0.5, pos.y * 0.5, pos.z * 0.5);
      lightCone.rotation.x = Math.PI / 6 * (pos.z > 0 ? -1 : 1);
      trussGroup.add(lightCone);
    });

    this.group.add(trussGroup);
  }

  /**
   * Builds 3-tiered stadium bleachers populated with stylized spectator silhouettes.
   */
  private buildStadiumBleachersAndSpectators(): void {
    const standMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5 });
    const shirtColors = [0x00f2fe, 0xff0055, 0xfacc15, 0x38bdf8, 0xa855f7, 0x39ff14, 0xf97316];

    // Shared spectator geometry
    const headGeo = new THREE.SphereGeometry(0.12, 10, 10);
    const bodyGeo = new THREE.CapsuleGeometry(0.14, 0.32, 6, 10);

    interface StandSide {
      axis: 'far' | 'near' | 'left' | 'right';
      x?: number;
      z?: number;
      rotY: number;
    }

    const sides: StandSide[] = [
      { axis: 'far', z: 7.2, rotY: Math.PI },
      { axis: 'near', z: -7.2, rotY: 0 },
      { axis: 'left', x: 7.5, rotY: -Math.PI / 2 },
      { axis: 'right', x: -7.5, rotY: Math.PI / 2 }
    ];

    sides.forEach((side) => {
      const standGroup = new THREE.Group();
      const sz = side.z ?? 0;
      const sx = side.x ?? 0;

      // 3 Stepped Bleacher Tiers
      for (let tier = 0; tier < 3; tier++) {
        const tierY = 0.5 + tier * 0.55;
        const tierDepth = 0.75 + tier * 0.70;

        const benchGeo = side.axis === 'far' || side.axis === 'near'
          ? new THREE.BoxGeometry(14, 0.4, 0.65)
          : new THREE.BoxGeometry(12, 0.4, 0.65);

        const bench = new THREE.Mesh(benchGeo, standMat);

        if (side.axis === 'far') bench.position.set(0, tierY, sz + tierDepth);
        else if (side.axis === 'near') bench.position.set(0, tierY, sz - tierDepth);
        else if (side.axis === 'left') bench.position.set(sx + tierDepth, tierY, 0);
        else if (side.axis === 'right') bench.position.set(sx - tierDepth, tierY, 0);

        standGroup.add(bench);

        // Populate tier with stylized spectators
        const count = side.axis === 'far' || side.axis === 'near' ? 14 : 10;
        const spacing = side.axis === 'far' || side.axis === 'near' ? 0.95 : 1.1;

        for (let i = 0; i < count; i++) {
          const specGroup = new THREE.Group();
          const color = shirtColors[(tier + i) % shirtColors.length];

          const shirtMat = new THREE.MeshStandardMaterial({
            color,
            roughness: 0.4,
            metalness: 0.1
          });
          const headMat = new THREE.MeshStandardMaterial({
            color: 0x334155,
            roughness: 0.6
          });

          const body = new THREE.Mesh(bodyGeo, shirtMat);
          body.position.y = 0.22;
          specGroup.add(body);

          const head = new THREE.Mesh(headGeo, headMat);
          head.position.y = 0.48;
          specGroup.add(head);

          let px = 0;
          let pz = 0;
          const py = tierY + 0.30;

          if (side.axis === 'far') {
            px = -6.2 + i * spacing;
            pz = sz + tierDepth;
          } else if (side.axis === 'near') {
            px = -6.2 + i * spacing;
            pz = sz - tierDepth;
          } else if (side.axis === 'left') {
            px = sx + tierDepth;
            pz = -5.0 + i * spacing;
          } else if (side.axis === 'right') {
            px = sx - tierDepth;
            pz = -5.0 + i * spacing;
          }

          specGroup.position.set(px, py, pz);
          specGroup.rotation.y = side.rotY;

          this.spectators.push(specGroup);
          this.spectatorBaseY.push(py);
          this.spectatorPhases.push(Math.random() * Math.PI * 2);

          standGroup.add(specGroup);
        }
      }

      this.group.add(standGroup);
    });
  }

  /**
   * Constructs court perimeter LED barrier ribbon boards with dynamic scrolling text.
   */
  private buildLEDRibbonBoards(): void {
    // 512x64 Canvas for scrolling LED Text
    this.ledCanvas = document.createElement('canvas');
    this.ledCanvas.width = 512;
    this.ledCanvas.height = 64;
    this.ledCtx = this.ledCanvas.getContext('2d')!;

    this.ledTexture = new THREE.CanvasTexture(this.ledCanvas);
    this.ledTexture.wrapS = THREE.RepeatWrapping;
    this.ledTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.ledTexture.repeat.set(2, 1);

    this.renderLEDCanvas();

    const boardMat = new THREE.MeshStandardMaterial({
      color: 0x090d16,
      map: this.ledTexture,
      emissiveMap: this.ledTexture,
      emissive: 0x090d16,
      emissiveIntensity: 0.15,
      roughness: 0.7,
      metalness: 0.1
    });

    const boardGeoLong = new THREE.BoxGeometry(10, 0.45, 0.08);
    const boardGeoSide = new THREE.BoxGeometry(0.08, 0.45, 12);

    // Far Barrier Board (+Z)
    const farBoard = new THREE.Mesh(boardGeoLong, boardMat);
    farBoard.position.set(0, 0.225, 4.8);
    this.group.add(farBoard);

    // Near Barrier Board (-Z)
    const nearBoard = new THREE.Mesh(boardGeoLong, boardMat);
    nearBoard.position.set(0, 0.225, -4.8);
    this.group.add(nearBoard);

    // Left Barrier Board (+X)
    const leftBoard = new THREE.Mesh(boardGeoSide, boardMat);
    leftBoard.position.set(4.8, 0.225, 0);
    this.group.add(leftBoard);

    // Right Barrier Board (-X)
    const rightBoard = new THREE.Mesh(boardGeoSide, boardMat);
    rightBoard.position.set(-4.8, 0.225, 0);
    this.group.add(rightBoard);
  }

  /**
   * Renders high-contrast, subdued LED banner text on 2D canvas.
   */
  private renderLEDCanvas(): void {
    const ctx = this.ledCtx;
    const w = this.ledCanvas.width;
    const h = this.ledCanvas.height;

    // Matte dark navy/charcoal background
    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, w, h);

    // Subdued border line
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, w - 4, h - 4);

    // Subdued warm amber text (non-clashing, zero ball camouflage)
    ctx.fillStyle = '#d97706';
    ctx.font = '800 20px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('CAMARENA TABLE TENNIS  ★  WORLD CHAMPIONSHIP  ★  SERVE FOR GLORY  ★  ', 12, h / 2);

    this.ledTexture.needsUpdate = true;
  }

  /**
   * Updates scrolling LED boards and spectator rally animation.
   */
  public updateArena(dt: number, rallyCount: number): void {
    // 1. Scroll LED Ribbon Boards
    this.ledScrollOffset += dt * 0.12;
    this.ledTexture.offset.x = this.ledScrollOffset;

    // 2. Spectator Bobbing Animation (Scales intensity with rally count!)
    const bounceAmp = rallyCount >= 12 ? 0.08 : (rallyCount >= 6 ? 0.04 : 0.015);
    const bounceFreq = rallyCount >= 6 ? 9 : 4;

    const time = performance.now() * 0.001;

    for (let i = 0; i < this.spectators.length; i++) {
      const spec = this.spectators[i];
      const baseY = this.spectatorBaseY[i];
      const phase = this.spectatorPhases[i];

      spec.position.y = baseY + Math.sin(time * bounceFreq + phase) * bounceAmp;
    }
  }
}
