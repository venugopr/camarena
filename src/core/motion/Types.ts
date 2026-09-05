/**
 * CamArena Core Motion Data Contracts & Types
 */

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export interface Landmark3D extends Vector3D {
  visibility?: number;
  presence?: number;
}

// MediaPipe 33 Pose Landmark Indices
export enum PoseLandmark {
  NOSE = 0,
  LEFT_EYE_INNER = 1,
  LEFT_EYE = 2,
  LEFT_EYE_OUTER = 3,
  RIGHT_EYE_INNER = 4,
  RIGHT_EYE = 5,
  RIGHT_EYE_OUTER = 6,
  LEFT_EAR = 7,
  RIGHT_EAR = 8,
  MOUTH_LEFT = 9,
  MOUTH_RIGHT = 10,
  LEFT_SHOULDER = 11,
  RIGHT_SHOULDER = 12,
  LEFT_ELBOW = 13,
  RIGHT_ELBOW = 14,
  LEFT_WRIST = 15,
  RIGHT_WRIST = 16,
  LEFT_PINKY = 17,
  RIGHT_PINKY = 18,
  LEFT_INDEX = 19,
  RIGHT_INDEX = 20,
  LEFT_THUMB = 21,
  RIGHT_THUMB = 22,
  LEFT_HIP = 23,
  RIGHT_HIP = 24,
  LEFT_KNEE = 25,
  RIGHT_KNEE = 26,
  LEFT_ANKLE = 27,
  RIGHT_ANKLE = 28,
  LEFT_HEEL = 29,
  RIGHT_HEEL = 30,
  LEFT_FOOT_INDEX = 31,
  RIGHT_FOOT_INDEX = 32,
}

export type ActionType =
  | 'READY_STANCE'
  | 'FOREHAND_DRIVE'
  | 'BACKHAND_DRIVE'
  | 'OVERHEAD_SMASH'
  | 'OVERHEAD_CLEAR'
  | 'DROP_SHOT'
  | 'UNDERHAND_LIFT'
  | 'LUNGE_LEFT'
  | 'LUNGE_RIGHT'
  | 'RECOVER';

export interface ActionEvent {
  type: ActionType;
  timestamp: number;
  speedMps: number;
  speedKmh: number;
  power: number; // 0 - 100
  arm: 'right' | 'left';
  wristVelocity: Vector3D;
  elbowAngleDeg: number;
  shoulderAngleDeg: number;
  apexHeightMeters: number;
  lungeDepthMeters: number;
  direction: Vector3D;
  description: string;
}

export interface BiomechanicalMetrics {
  torsoYawDeg: number;       // Shoulder / hip horizontal turn
  torsoPitchDeg: number;     // Forward / backward lean
  torsoRollDeg: number;      // Lateral lean
  dominantArm: 'right' | 'left';
  rightWristVelocity: Vector3D;
  leftWristVelocity: Vector3D;
  rightWristSpeedKmh: number;
  leftWristSpeedKmh: number;
  rightElbowAngleDeg: number;
  leftElbowAngleDeg: number;
  hipCenterWorld: Vector3D;
  lungeDepth: number;        // Metric displacement of hips relative to neutral
  lateralWeightShift: number;// -1 (full left) to +1 (full right)
  isLungingLeft: boolean;
  isLungingRight: boolean;
  isInAir: boolean;          // Jump detection
}

export interface MotionFrame {
  timestamp: number;
  deltaTime: number;
  confidence: number;
  rawLandmarks: Landmark3D[];             // 2D screen normalized [0, 1]
  worldLandmarks: Landmark3D[];           // 3D world coordinates in meters
  normalizedLandmarks: Landmark3D[];      // Anchored to hip root coordinate basis
  velocities: Vector3D[];                 // 1-Euro filtered instantaneous velocity (m/s)
  metrics: BiomechanicalMetrics;
  activeAction: ActionType;
  lastActionEvent: ActionEvent | null;
}

export type GameModeId = 'badminton' | 'tabletennis' | 'sandbox';
export type OpponentMode = 'system' | 'pvp' | 'practice';
export type DifficultyLevel = 'casual' | 'pro' | 'legend';
