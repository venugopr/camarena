import { Vector3D } from './Types';

/**
 * Low-pass filter component for 1-Euro Filter
 */
class LowPassFilter {
  private y: number | null = null;
  private s: number | null = null;

  filter(value: number, alpha: number): number {
    if (this.y === null) {
      this.s = value;
      this.y = value;
      return value;
    }
    this.y = alpha * value + (1 - alpha) * this.s!;
    this.s = this.y;
    return this.y;
  }

  lastValue(): number | null {
    return this.y;
  }

  reset(): void {
    this.y = null;
    this.s = null;
  }
}

/**
 * 1-Euro Filter for 1D scalar tracking (Casiez et al.)
 * Adapts cutoff frequency based on movement speed:
 * - Low speed: low cutoff (e.g. 1 Hz) eliminates micro-jitter while stationary
 * - High speed: high cutoff dynamically eliminates lag during high-velocity swings
 */
export class OneEuroFilter1D {
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;
  private xFilter = new LowPassFilter();
  private dxFilter = new LowPassFilter();
  private lastTime: number | null = null;

  constructor(minCutoff = 1.0, beta = 0.04, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  private alpha(rate: number, cutoff: number): number {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    const te = 1.0 / rate;
    return 1.0 / (1.0 + tau / te);
  }

  filter(val: number, timestamp: number): { value: number; derivative: number } {
    if (this.lastTime === null || timestamp <= this.lastTime) {
      this.lastTime = timestamp;
      const filteredVal = this.xFilter.filter(val, 1.0);
      return { value: filteredVal, derivative: 0 };
    }

    const dt = Math.max((timestamp - this.lastTime) / 1000.0, 0.001);
    this.lastTime = timestamp;
    const rate = 1.0 / dt;

    // Estimate raw derivative
    const prevVal = this.xFilter.lastValue() ?? val;
    const rawDx = (val - prevVal) / dt;

    // Filter derivative
    const edx = this.dxFilter.filter(rawDx, this.alpha(rate, this.dCutoff));

    // Dynamic cutoff frequency based on filtered speed
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);

    // Filter value
    const filteredVal = this.xFilter.filter(val, this.alpha(rate, cutoff));

    return { value: filteredVal, derivative: edx };
  }

  reset(): void {
    this.xFilter.reset();
    this.dxFilter.reset();
    this.lastTime = null;
  }
}

/**
 * 3D Vector 1-Euro Filter with direct velocity vector derivation
 */
export class OneEuroFilter3D {
  private fx: OneEuroFilter1D;
  private fy: OneEuroFilter1D;
  private fz: OneEuroFilter1D;

  constructor(minCutoff = 1.2, beta = 0.05, dCutoff = 1.2) {
    this.fx = new OneEuroFilter1D(minCutoff, beta, dCutoff);
    this.fy = new OneEuroFilter1D(minCutoff, beta, dCutoff);
    this.fz = new OneEuroFilter1D(minCutoff, beta, dCutoff);
  }

  filter(vec: Vector3D, timestamp: number): { position: Vector3D; velocity: Vector3D } {
    const rx = this.fx.filter(vec.x, timestamp);
    const ry = this.fy.filter(vec.y, timestamp);
    const rz = this.fz.filter(vec.z, timestamp);

    return {
      position: { x: rx.value, y: ry.value, z: rz.value },
      velocity: { x: rx.derivative, y: ry.derivative, z: rz.derivative }
    };
  }

  reset(): void {
    this.fx.reset();
    this.fy.reset();
    this.fz.reset();
  }
}

/**
 * Full Body 33-Landmark Pose Filter Bank
 */
export class PoseFilterBank {
  private filters: OneEuroFilter3D[] = [];

  constructor(landmarkCount = 33) {
    for (let i = 0; i < landmarkCount; i++) {
      // Arms and wrists move much faster than core, so apply higher beta for extremities
      const isWristOrHand = (i >= 15 && i <= 22);
      const isAnkleOrFoot = (i >= 27 && i <= 32);
      const minCutoff = (isWristOrHand || isAnkleOrFoot) ? 1.5 : 1.0;
      const beta = isWristOrHand ? 0.08 : (isAnkleOrFoot ? 0.05 : 0.03);

      this.filters.push(new OneEuroFilter3D(minCutoff, beta, 1.2));
    }
  }

  filterLandmarks(
    landmarks: Vector3D[],
    timestamp: number
  ): { positions: Vector3D[]; velocities: Vector3D[] } {
    const positions: Vector3D[] = [];
    const velocities: Vector3D[] = [];

    for (let i = 0; i < landmarks.length; i++) {
      if (!this.filters[i]) {
        this.filters[i] = new OneEuroFilter3D();
      }
      const lm = landmarks[i] || { x: 0, y: 0, z: 0 };
      const result = this.filters[i].filter(lm, timestamp);
      positions.push(result.position);
      velocities.push(result.velocity);
    }

    return { positions, velocities };
  }

  reset(): void {
    for (const f of this.filters) {
      f.reset();
    }
  }
}
