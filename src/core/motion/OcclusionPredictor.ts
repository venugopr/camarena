import { Landmark3D, Vector3D, PoseLandmark } from './Types';
import { Math3D } from './VectorNormalizer';

interface TrackedJointState {
  lastValidPos: Vector3D;
  lastValidVel: Vector3D;
  occludedFrames: number;
  confidence: number;
}

/**
 * Occlusion Predictor & Kinematic Extrapolator:
 * Anticipates limb positions when arms or rackets cross in front of the torso
 * or go behind the head during explosive badminton smashes or table tennis backhands.
 */
export class OcclusionPredictor {
  private jointStates: Map<number, TrackedJointState> = new Map();
  private readonly minConfidenceThreshold = 0.45;
  private readonly maxPredictFrames = 12; // ~300-400ms at 30-60fps
  private readonly momentumDecay = 0.92;

  /**
   * Cleanses and reconstructs landmarks experiencing temporary occlusion
   */
  public processLandmarks(
    rawLandmarks: Landmark3D[],
    velocities: Vector3D[],
    dt: number
  ): Landmark3D[] {
    const refined: Landmark3D[] = [];

    for (let i = 0; i < rawLandmarks.length; i++) {
      const lm = rawLandmarks[i];
      const vel = velocities[i] || { x: 0, y: 0, z: 0 };
      const visibility = lm.visibility ?? 1.0;

      let state = this.jointStates.get(i);
      if (!state) {
        state = {
          lastValidPos: { x: lm.x, y: lm.y, z: lm.z },
          lastValidVel: { x: vel.x, y: vel.y, z: vel.z },
          occludedFrames: 0,
          confidence: visibility
        };
        this.jointStates.set(i, state);
      }

      if (visibility >= this.minConfidenceThreshold) {
        // High confidence landmark: update state
        if (state.occludedFrames > 0) {
          // Re-acquisition blend: smoothly blend from predicted to measured to avoid visual popping
          const blendFactor = Math.min(1.0, 0.4 + (1.0 / (state.occludedFrames + 1)));
          state.lastValidPos = {
            x: state.lastValidPos.x * (1 - blendFactor) + lm.x * blendFactor,
            y: state.lastValidPos.y * (1 - blendFactor) + lm.y * blendFactor,
            z: state.lastValidPos.z * (1 - blendFactor) + lm.z * blendFactor
          };
        } else {
          state.lastValidPos = { x: lm.x, y: lm.y, z: lm.z };
        }

        state.lastValidVel = { x: vel.x, y: vel.y, z: vel.z };
        state.occludedFrames = 0;
        state.confidence = visibility;

        refined.push({
          x: state.lastValidPos.x,
          y: state.lastValidPos.y,
          z: state.lastValidPos.z,
          visibility,
          presence: lm.presence
        });
      } else {
        // Low confidence / occluded landmark:
        state.occludedFrames++;

        if (state.occludedFrames <= this.maxPredictFrames) {
          // Ballistic momentum dead-reckoning extrapolation
          const decay = Math.pow(this.momentumDecay, state.occludedFrames);
          const predictedVel = Math3D.scale(state.lastValidVel, decay);
          const step = Math3D.scale(predictedVel, Math.min(dt, 0.05));
          let predictedPos = Math3D.add(state.lastValidPos, step);

          // Biomechanical arm length clamping
          predictedPos = this.enforceAnatomicalLimits(i, predictedPos, rawLandmarks);

          state.lastValidPos = predictedPos;
          state.confidence = Math.max(0.1, visibility);

          refined.push({
            x: predictedPos.x,
            y: predictedPos.y,
            z: predictedPos.z,
            visibility: state.confidence,
            presence: lm.presence
          });
        } else {
          // Prolonged occlusion: fallback to raw landmark
          refined.push(lm);
        }
      }
    }

    return refined;
  }

  /**
   * Constrains extrapolated joints from stretching unnaturally beyond human limb lengths
   */
  private enforceAnatomicalLimits(
    jointIndex: number,
    predicted: Vector3D,
    allLandmarks: Landmark3D[]
  ): Vector3D {
    // Right Wrist bounded by Right Elbow
    if (jointIndex === PoseLandmark.RIGHT_WRIST) {
      const elbow = allLandmarks[PoseLandmark.RIGHT_ELBOW];
      const maxForearmLen = 0.45; // ~45cm max forearm + hand
      const dist = Math3D.distance(predicted, elbow);
      if (dist > maxForearmLen && dist > 1e-4) {
        const dir = Math3D.normalize(Math3D.sub(predicted, elbow));
        return Math3D.add(elbow, Math3D.scale(dir, maxForearmLen));
      }
    }

    // Left Wrist bounded by Left Elbow
    if (jointIndex === PoseLandmark.LEFT_WRIST) {
      const elbow = allLandmarks[PoseLandmark.LEFT_ELBOW];
      const maxForearmLen = 0.45;
      const dist = Math3D.distance(predicted, elbow);
      if (dist > maxForearmLen && dist > 1e-4) {
        const dir = Math3D.normalize(Math3D.sub(predicted, elbow));
        return Math3D.add(elbow, Math3D.scale(dir, maxForearmLen));
      }
    }

    return predicted;
  }

  public reset(): void {
    this.jointStates.clear();
  }
}
