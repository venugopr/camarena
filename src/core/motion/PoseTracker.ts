import {
  MotionFrame,
  Landmark3D,
  PoseLandmark,
  Vector3D,
  ActionEvent
} from './Types';
import { PoseFilterBank } from './OneEuroFilter';
import { VectorNormalizer } from './VectorNormalizer';
import { OcclusionPredictor } from './OcclusionPredictor';
import { ActionStateMachine } from './ActionStateMachine';

export type TrackingMode = 'webcam' | 'synthetic';

export class PoseTracker {
  private videoElement: HTMLVideoElement | null = null;
  private poseInstance: any = null;
  private cameraUtilsInstance: any = null;

  private filterBank = new PoseFilterBank(33);
  private normalizer = new VectorNormalizer();
  private occlusionPredictor = new OcclusionPredictor();
  private actionStateMachine = new ActionStateMachine();

  private isRunning = false;
  private isProcessingFrame = false;
  private processingCanvas: HTMLCanvasElement | null = null;
  private processingCtx: CanvasRenderingContext2D | null = null;
  private trackingMode: TrackingMode = 'synthetic';
  private dominantHand: 'right' | 'left' = 'right';
  private syntheticAnimTime = 0;
  private syntheticAction: 'idle' | 'forehand' | 'smash' | 'backhand' | 'lunge' = 'idle';

  private lastFrameTimestamp = performance.now();
  private fps = 0;
  private frameCount = 0;
  private fpsTimer = performance.now();

  private frameListeners: ((frame: MotionFrame) => void)[] = [];
  private actionListeners: ((event: ActionEvent) => void)[] = [];
  private statusListeners: ((status: string, isError?: boolean) => void)[] = [];
  private gesturePauseListeners: (() => void)[] = [];
  private handRaiseDuration = 0;
  private lastGesturePauseTime = 0;

  constructor() {
    this.actionStateMachine.onAction((evt) => {
      for (const listener of this.actionListeners) {
        listener(evt);
      }
    });
  }

  public setDominantHand(hand: 'right' | 'left'): void {
    this.dominantHand = hand;
    this.normalizer.setDominantHand(hand);
  }

  public getDominantHand(): 'right' | 'left' {
    return this.dominantHand;
  }

  public onGesturePause(cb: () => void): () => void {
    this.gesturePauseListeners.push(cb);
    return () => {
      this.gesturePauseListeners = this.gesturePauseListeners.filter(l => l !== cb);
    };
  }

  public triggerGesturePause(): void {
    for (const listener of this.gesturePauseListeners) {
      listener();
    }
  }


  public onFrame(cb: (frame: MotionFrame) => void): () => void {
    this.frameListeners.push(cb);
    return () => {
      this.frameListeners = this.frameListeners.filter(l => l !== cb);
    };
  }

  public onAction(cb: (event: ActionEvent) => void): () => void {
    this.actionListeners.push(cb);
    return () => {
      this.actionListeners = this.actionListeners.filter(l => l !== cb);
    };
  }

  public onStatus(cb: (status: string, isError?: boolean) => void): () => void {
    this.statusListeners.push(cb);
    return () => {
      this.statusListeners = this.statusListeners.filter(l => l !== cb);
    };
  }

  private notifyStatus(msg: string, isError = false): void {
    for (const listener of this.statusListeners) {
      listener(msg, isError);
    }
  }

  public getTrackingMode(): TrackingMode {
    return this.trackingMode;
  }

  public setTrackingMode(mode: TrackingMode): void {
    this.trackingMode = mode;
    this.notifyStatus(`Tracking mode set to: ${mode.toUpperCase()}`);
    if (!this.isRunning) {
      this.isRunning = true;
      this.startLoop();
    }
    if (mode === 'webcam') {
      this.startWebcam();
    }
  }

  public triggerSyntheticStroke(type: 'forehand' | 'smash' | 'backhand' | 'lunge'): void {
    if (this.trackingMode !== 'synthetic') {
      this.setTrackingMode('synthetic');
    }
    this.filterBank.reset();
    this.syntheticAction = type;
    this.syntheticAnimTime = 0;

    // The 1-Euro filter heavily damps a single 0.4s pose burst, so also dispatch
    // the contact-frame stroke that a real classified swing would produce.
    const strokeType =
      type === 'smash' ? 'OVERHEAD_SMASH' :
      type === 'backhand' ? 'BACKHAND_DRIVE' :
      type === 'lunge' ? 'LUNGE_RIGHT' :
      'FOREHAND_DRIVE';

    if (strokeType === 'LUNGE_RIGHT') return;

    window.setTimeout(() => {
      const event: ActionEvent = {
        type: strokeType,
        timestamp: performance.now(),
        speedMps: 5.6,
        speedKmh: 20,
        power: 72,
        arm: this.dominantHand,
        wristVelocity: { x: 0.4, y: 1.2, z: 5.2 },
        elbowAngleDeg: 95,
        shoulderAngleDeg: 70,
        apexHeightMeters: 1.6,
        lungeDepthMeters: 0,
        direction: { x: 0, y: 0.2, z: 1 },
        description: `Synthetic ${strokeType}`
      };
      for (const listener of this.actionListeners) {
        listener(event);
      }
    }, 120);
  }

  /**
   * Initializes MediaPipe Pose and starts tracking loop
   */
  public async init(videoElement: HTMLVideoElement): Promise<void> {
    this.videoElement = videoElement;
    this.isRunning = true;

    // Start synthetic animation loop immediately so games are playable right away
    this.startLoop();

    try {
      this.notifyStatus('Initializing MediaPipe Pose Engine...');
      await this.initMediaPipe();
    } catch (err: any) {
      console.warn('MediaPipe initialization warning (falling back to synthetic mode):', err);
      this.notifyStatus('Webcam tracking fallback ready. Running high-precision motion simulator.');
    }
  }

  private async initMediaPipe(): Promise<void> {
    // Dynamically load MediaPipe Pose if available in window or npm
    let PoseClass = (window as any).Pose;

    if (!PoseClass) {
      // Load script from CDN if not already bundled (with 3.5s network timeout safeguard)
      await Promise.race([
        new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/pose.js';
          script.crossOrigin = 'anonymous';
          script.onload = () => resolve();
          script.onerror = (e) => reject(e);
          document.head.appendChild(script);
        }),
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error('MediaPipe CDN load timed out')), 3500))
      ]);
      PoseClass = (window as any).Pose;
    }

    if (!PoseClass) {
      throw new Error('Could not load MediaPipe Pose library');
    }

    this.poseInstance = new PoseClass({
      locateFile: (file: string) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/${file}`;
      }
    });

    this.poseInstance.setOptions({
      modelComplexity: 0,
      smoothLandmarks: true,
      enableSegmentation: false,
      smoothSegmentation: false,
      minDetectionConfidence: 0.3,
      minTrackingConfidence: 0.3
    });

    this.poseInstance.onResults((results: any) => this.handlePoseResults(results));
    this.notifyStatus('MediaPipe Pose Model loaded successfully (Lite complexity 0).');
  }

  public async startWebcam(): Promise<boolean> {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.notifyStatus('Webcam not supported in this browser environment', true);
      return false;
    }

    try {
      this.notifyStatus('Requesting webcam access...');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640, max: 640 },
          height: { ideal: 480, max: 480 },
          facingMode: 'user'
        },
        audio: false
      });

      if (this.videoElement) {
        this.videoElement.srcObject = stream;
        await this.videoElement.play();
      }

      // Initialize dedicated 640x480 processing canvas to guarantee standard resolution for MediaPipe
      if (!this.processingCanvas) {
        this.processingCanvas = document.createElement('canvas');
        this.processingCanvas.width = 640;
        this.processingCanvas.height = 480;
        this.processingCtx = this.processingCanvas.getContext('2d', { willReadFrequently: true });
      }

      this.trackingMode = 'webcam';
      this.notifyStatus('Webcam connected! Full-body 3D tracking active.');

      // Setup processing cadence using requestVideoFrameCallback or requestAnimationFrame
      const processVideo = async () => {
        if (!this.isRunning || this.trackingMode !== 'webcam') return;

        // Prevent inference queue buildup: drop or skip incoming frames if the previous send({ image }) call has not resolved
        if (!this.isProcessingFrame && this.videoElement && this.videoElement.readyState >= 2 && this.poseInstance) {
          this.isProcessingFrame = true;
          try {
            if (this.processingCanvas && this.processingCtx && this.videoElement.videoWidth > 0) {
              this.processingCtx.drawImage(
                this.videoElement,
                0, 0,
                this.processingCanvas.width,
                this.processingCanvas.height
              );
              await this.poseInstance.send({ image: this.processingCanvas });
            } else {
              await this.poseInstance.send({ image: this.videoElement });
            }
          } catch (e) {
            // Ignore temporary frame send errors
          } finally {
            this.isProcessingFrame = false;
          }
        }

        if ('requestVideoFrameCallback' in (this.videoElement as any)) {
          (this.videoElement as any).requestVideoFrameCallback(processVideo);
        } else {
          requestAnimationFrame(processVideo);
        }
      };

      processVideo();
      return true;
    } catch (err: any) {
      console.warn('Webcam permission denied or unavailable:', err);
      this.notifyStatus('Webcam unavailable. Continuing in Synthetic Motion Simulator mode.', false);
      this.trackingMode = 'synthetic';
      return false;
    }
  }

  /**
   * Process results received from MediaPipe
   */
  private handlePoseResults(results: any): void {
    if (!results.poseLandmarks || !results.poseWorldLandmarks) return;

    const timestamp = performance.now();
    const dt = Math.max((timestamp - this.lastFrameTimestamp) / 1000, 0.001);
    this.lastFrameTimestamp = timestamp;

    this.processRawLandmarks(results.poseLandmarks, results.poseWorldLandmarks, timestamp, dt);
  }

  private prevWorldLandmarks: Landmark3D[] | null = null;
  private lowConfidenceHoldCount: number[] = new Array(33).fill(0);

  /**
   * Main motion pipeline: Filter -> Occlusion Repair -> Normalization -> Action Classification
   */
  private processRawLandmarks(
    raw2D: Landmark3D[],
    rawWorld3D: Landmark3D[],
    timestamp: number,
    dt: number
  ): void {
    if (!rawWorld3D || rawWorld3D.length < 33 || !raw2D || raw2D.length < 33) return;

    // 0. Confidence Thresholding & Teleport Clamping:
    // Only hold previous pose if visibility < 0.30, and cap to at most 2 consecutive frames
    const sanitizedWorld3D: Landmark3D[] = [];
    for (let i = 0; i < rawWorld3D.length; i++) {
      let lm = { ...rawWorld3D[i] };

      const visibility = raw2D[i]?.visibility ?? lm.visibility ?? 1.0;
      if (visibility < 0.30 && this.prevWorldLandmarks && this.prevWorldLandmarks[i]) {
        if (this.lowConfidenceHoldCount[i] < 2) {
          // Hold previous valid landmark for max 2 frames
          lm = { ...this.prevWorldLandmarks[i] };
          this.lowConfidenceHoldCount[i]++;
        } else {
          // Accept raw position after 2 frames to avoid freezing
          this.lowConfidenceHoldCount[i] = 0;
        }
      } else {
        this.lowConfidenceHoldCount[i] = 0;
      }

      // Teleport rejection only for extreme sensor artifacts (> 1.2m per frame)
      if (this.prevWorldLandmarks && this.prevWorldLandmarks[i]) {
        const prev = this.prevWorldLandmarks[i];
        const disp = Math.hypot(lm.x - prev.x, lm.y - prev.y, lm.z - prev.z);
        if (disp > 1.20) {
          const ratio = 1.20 / disp;
          lm.x = prev.x + (lm.x - prev.x) * ratio;
          lm.y = prev.y + (lm.y - prev.y) * ratio;
          lm.z = prev.z + (lm.z - prev.z) * ratio;
        }
      }
      sanitizedWorld3D.push(lm);
    }
    this.prevWorldLandmarks = sanitizedWorld3D.map(l => ({ ...l }));

    // 1. One-Euro Adaptive Velocity & Jitter Filtering on 3D World Landmarks
    const filtered = this.filterBank.filterLandmarks(sanitizedWorld3D, timestamp);
    const filteredPositions = filtered.positions as Landmark3D[];
    const velocities = filtered.velocities;

    // Attach visibility tags
    for (let i = 0; i < filteredPositions.length; i++) {
      filteredPositions[i].visibility = sanitizedWorld3D[i]?.visibility ?? 1.0;
    }

    // 2. Predictive Occlusion & Kinematic Dead-Reckoning
    const occlRepaired = this.occlusionPredictor.processLandmarks(filteredPositions, velocities, dt);

    // 3. Biomechanical Vector Normalization: Anchor to Torso/Hip Root Frame
    const localBasis = this.normalizer.computeLocalBasis(occlRepaired);
    const normalizedLandmarks = this.normalizer.normalizeToRoot(occlRepaired, localBasis);

    // 4. Biomechanical Kinematic Metrics
    const metrics = this.normalizer.computeMetrics(occlRepaired, velocities, localBasis);

    // 5. Action State Machine (Forehand, Backhand, Smash, Lunge detection)
    const { activeAction, lastEvent } = this.actionStateMachine.update(
      normalizedLandmarks,
      occlRepaired,
      velocities,
      metrics,
      localBasis,
      timestamp
    );

    // Update FPS
    this.frameCount++;
    if (timestamp - this.fpsTimer > 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.fpsTimer = timestamp;
    }

    // Check for the "Raise Both Hands to Pause" gesture:
    // Require both wrists above head level so normal play gestures do not pause the game.
    const nose2D = raw2D[PoseLandmark.NOSE];
    const rWrist2D = raw2D[PoseLandmark.RIGHT_WRIST];
    const lWrist2D = raw2D[PoseLandmark.LEFT_WRIST];

    const isHandRaised = Boolean(
      rWrist2D && lWrist2D && nose2D &&
      (rWrist2D.visibility ?? 1) > 0.4 &&
      (lWrist2D.visibility ?? 1) > 0.4 &&
      rWrist2D.y < nose2D.y - 0.12 &&
      lWrist2D.y < nose2D.y - 0.12
    );

    if (isHandRaised) {
      this.handRaiseDuration += dt;
      if (this.handRaiseDuration >= 0.6 && timestamp - this.lastGesturePauseTime > 2500) {
        this.lastGesturePauseTime = timestamp;
        this.handRaiseDuration = 0;
        this.triggerGesturePause();
      }
    } else {
      this.handRaiseDuration = Math.max(0, this.handRaiseDuration - dt * 2.0);
    }

    const frame: MotionFrame = {
      timestamp,
      deltaTime: dt,
      confidence: occlRepaired[PoseLandmark.LEFT_HIP]?.visibility ?? 0.9,
      rawLandmarks: raw2D,
      worldLandmarks: occlRepaired,
      normalizedLandmarks,
      velocities,
      metrics,
      activeAction,
      lastActionEvent: lastEvent
    };


    for (const listener of this.frameListeners) {
      listener(frame);
    }
  }

  /**
   * Synthetic Motion Generator: Produces authentic human athletic biomechanics
   * for instant testing, automation, and non-webcam environments.
   */
  private generateSyntheticPose(t: number, dt: number): { raw2D: Landmark3D[]; world3D: Landmark3D[] } {
    this.syntheticAnimTime += dt;
    const animT = this.syntheticAnimTime;

    // Base athletic ready stance
    let hipY = 0.95 + Math.sin(t * 4) * 0.02; // Gentle ready bounce
    let hipX = Math.sin(t * 1.5) * 0.1;       // Natural weight transfer
    let hipZ = 0;

    let rightArmX = 0.35;
    let rightArmY = 0.8;
    let rightArmZ = 0.25;

    let leftArmX = 0.35;
    let leftArmY = 0.8;
    let leftArmZ = 0.2;

    let leftAnkleX = 0.35;
    let rightAnkleX = 0.35;
    let leftAnkleY = 0.05;
    let rightAnkleY = 0.05;

    // Handle interactive strokes
    if (this.syntheticAction === 'forehand') {
      const progress = Math.min(1.0, animT / 0.38);
      if (progress < 0.28) {
        const p = progress / 0.28;
        rightArmX = 0.35 + p * 0.40;
        rightArmY = 0.75 - p * 0.12;
        rightArmZ = 0.25 - p * 0.50;
        hipX = 0.15;
      } else if (progress < 0.55) {
        const p = (progress - 0.28) / 0.27;
        rightArmX = 0.75 - p * 1.05;
        rightArmY = 0.63 + p * 0.45;
        rightArmZ = -0.25 + p * 1.05;
        hipX = -0.18;
      } else {
        const p = (progress - 0.55) / 0.45;
        rightArmX = -0.30 + p * 0.65;
        rightArmY = 1.08 - p * 0.28;
        rightArmZ = 0.80 - p * 0.55;
      }
      if (progress >= 1.0) this.syntheticAction = 'idle';
    } else if (this.syntheticAction === 'smash') {
      const progress = Math.min(1.0, animT / 0.55);
      if (progress < 0.3) {
        // Apex leap and cock racket
        const p = progress / 0.3;
        hipY = 0.95 - p * 0.2; // Jump up (world y inverted)
        rightArmX = 0.25 + p * 0.1;
        rightArmY = 0.8 + p * 0.75; // Hand high above head
        rightArmZ = 0.25 - p * 0.3;
      } else if (progress < 0.65) {
        // Explosive downward smash strike
        const p = (progress - 0.3) / 0.35;
        hipY = 0.75 + p * 0.2;
        rightArmX = 0.35 - p * 0.15;
        rightArmY = 1.55 - p * 1.1; // Steep down stroke
        rightArmZ = -0.05 + p * 0.85;
      } else {
        // Landing and recovery
        const p = (progress - 0.65) / 0.35;
        rightArmX = 0.2 + p * 0.15;
        rightArmY = 0.45 + p * 0.35;
        rightArmZ = 0.8 - p * 0.55;
      }
      if (progress >= 1.0) this.syntheticAction = 'idle';
    } else if (this.syntheticAction === 'backhand') {
      const progress = Math.min(1.0, animT / 0.5);
      if (progress < 0.35) {
        // Cross torso load
        const p = progress / 0.35;
        rightArmX = 0.35 - p * 0.55;
        rightArmY = 0.8 - p * 0.1;
        rightArmZ = 0.25 - p * 0.2;
        hipX = -0.15;
      } else if (progress < 0.7) {
        // Outward backhand sweep
        const p = (progress - 0.35) / 0.35;
        rightArmX = -0.2 + p * 0.75;
        rightArmY = 0.7 + p * 0.25;
        rightArmZ = 0.05 + p * 0.6;
        hipX = 0.1;
      } else {
        const p = (progress - 0.7) / 0.3;
        rightArmX = 0.55 - p * 0.2;
        rightArmY = 0.95 - p * 0.15;
        rightArmZ = 0.65 - p * 0.4;
      }
      if (progress >= 1.0) this.syntheticAction = 'idle';
    } else if (this.syntheticAction === 'lunge') {
      const progress = Math.min(1.0, animT / 0.7);
      if (progress < 0.45) {
        const p = progress / 0.45;
        hipY = 0.95 + p * 0.3;  // Drop hips
        hipX = p * 0.45;        // Shift right
        rightAnkleX = 0.35 + p * 0.5; // Step deep right
      } else {
        const p = (progress - 0.45) / 0.55;
        hipY = 1.25 - p * 0.3;
        hipX = 0.45 - p * 0.45;
        rightAnkleX = 0.85 - p * 0.5;
      }
      if (progress >= 1.0) this.syntheticAction = 'idle';
    }

    // Mirror kinematics if left-handed
    if (this.dominantHand === 'left') {
      const strokeX = rightArmX;
      const strokeY = rightArmY;
      const strokeZ = rightArmZ;

      rightArmX = 0.35;
      rightArmY = 0.8;
      rightArmZ = 0.2;

      leftArmX = strokeX;
      leftArmY = strokeY;
      leftArmZ = strokeZ;

      hipX = -hipX;
    }

    // Build 33 standard landmarks
    const world3D: Landmark3D[] = new Array(33);
    const raw2D: Landmark3D[] = new Array(33);

    const setLM = (idx: number, x: number, y: number, z: number) => {
      world3D[idx] = { x, y: -y, z, visibility: 0.98, presence: 0.98 };
      // Map to 2D viewport [0, 1]
      raw2D[idx] = {
        x: 0.5 + x * 0.4,
        y: 0.5 - (y - 0.9) * 0.4,
        z: z * 0.4,
        visibility: 0.98
      };
    };

    // Hips: Right is -X, Left is +X
    setLM(PoseLandmark.LEFT_HIP, hipX + 0.16, hipY, hipZ);
    setLM(PoseLandmark.RIGHT_HIP, hipX - 0.16, hipY, hipZ);

    // Spine and Shoulders
    const shoulderY = hipY + 0.48;
    setLM(PoseLandmark.LEFT_SHOULDER, hipX + 0.24, shoulderY, hipZ);
    setLM(PoseLandmark.RIGHT_SHOULDER, hipX - 0.24, shoulderY, hipZ);

    // Head
    const headY = shoulderY + 0.22;
    setLM(PoseLandmark.NOSE, hipX, headY, hipZ + 0.08);
    setLM(PoseLandmark.LEFT_EYE, hipX + 0.04, headY + 0.03, hipZ + 0.08);
    setLM(PoseLandmark.RIGHT_EYE, hipX - 0.04, headY + 0.03, hipZ + 0.08);
    setLM(PoseLandmark.LEFT_EAR, hipX + 0.1, headY + 0.02, hipZ);
    setLM(PoseLandmark.RIGHT_EAR, hipX - 0.1, headY + 0.02, hipZ);
    setLM(PoseLandmark.MOUTH_LEFT, hipX + 0.03, headY - 0.04, hipZ + 0.07);
    setLM(PoseLandmark.MOUTH_RIGHT, hipX - 0.03, headY - 0.04, hipZ + 0.07);

    // Left Arm (Neutral support at screen-left +X in MediaPipe coordinates)
    const leftElbowX = hipX + 0.24 + leftArmX * 0.45;
    const leftElbowY = shoulderY - 0.25;
    const leftElbowZ = hipZ + leftArmZ * 0.5;
    setLM(PoseLandmark.LEFT_ELBOW, leftElbowX, leftElbowY, leftElbowZ);
    setLM(PoseLandmark.LEFT_WRIST, hipX + 0.24 + leftArmX * 0.65, shoulderY - 0.45 + (leftArmY - 0.8), hipZ + leftArmZ);
    setLM(PoseLandmark.LEFT_PINKY, hipX + 0.24 + leftArmX * 0.65 + 0.03, shoulderY - 0.5, hipZ + leftArmZ);
    setLM(PoseLandmark.LEFT_INDEX, hipX + 0.24 + leftArmX * 0.65 - 0.02, shoulderY - 0.5, hipZ + leftArmZ);
    setLM(PoseLandmark.LEFT_THUMB, hipX + 0.24 + leftArmX * 0.65, shoulderY - 0.48, hipZ + leftArmZ + 0.03);

    // Right Arm (Dynamic swinging arm at screen-right -X in MediaPipe coordinates)
    const rightElbowX = hipX - (0.24 + rightArmX * 0.45);
    const rightElbowY = shoulderY - 0.15 + (rightArmY - 0.8) * 0.5;
    const rightElbowZ = hipZ + rightArmZ * 0.4;
    setLM(PoseLandmark.RIGHT_ELBOW, rightElbowX, rightElbowY, rightElbowZ);
    setLM(PoseLandmark.RIGHT_WRIST, hipX - (0.24 + rightArmX * 0.65), shoulderY - 0.35 + (rightArmY - 0.8), hipZ + rightArmZ);
    setLM(PoseLandmark.RIGHT_PINKY, hipX - (0.24 + rightArmX * 0.65) - 0.03, shoulderY - 0.4, hipZ + rightArmZ);
    setLM(PoseLandmark.RIGHT_INDEX, hipX - (0.24 + rightArmX * 0.65) + 0.02, shoulderY - 0.4, hipZ + rightArmZ);
    setLM(PoseLandmark.RIGHT_THUMB, hipX - (0.24 + rightArmX * 0.65), shoulderY - 0.38, hipZ + rightArmZ + 0.03);

    // Legs
    const kneeY = hipY * 0.52;
    setLM(PoseLandmark.LEFT_KNEE, leftAnkleX * 0.8, kneeY, hipZ + 0.05);
    setLM(PoseLandmark.RIGHT_KNEE, -rightAnkleX * 0.8, kneeY, hipZ + 0.05);

    setLM(PoseLandmark.LEFT_ANKLE, leftAnkleX, leftAnkleY, hipZ);
    setLM(PoseLandmark.RIGHT_ANKLE, -rightAnkleX, rightAnkleY, hipZ);

    setLM(PoseLandmark.LEFT_HEEL, leftAnkleX, leftAnkleY, hipZ - 0.08);
    setLM(PoseLandmark.RIGHT_HEEL, -rightAnkleX, rightAnkleY, hipZ - 0.08);

    setLM(PoseLandmark.LEFT_FOOT_INDEX, leftAnkleX, 0.02, hipZ + 0.12);
    setLM(PoseLandmark.RIGHT_FOOT_INDEX, -rightAnkleX, 0.02, hipZ + 0.12);

    return { raw2D, world3D };
  }

  private isLoopRunning = false;

  private startLoop(): void {
    if (this.isLoopRunning) return;
    this.isLoopRunning = true;
    let lastTime = performance.now();

    const loop = (currentTime: number) => {
      if (!this.isRunning) {
        this.isLoopRunning = false;
        return;
      }

      const dt = Math.max((currentTime - lastTime) / 1000, 0.001);
      lastTime = currentTime;

      if (this.trackingMode === 'synthetic') {
        const { raw2D, world3D } = this.generateSyntheticPose(currentTime / 1000, dt);
        this.processRawLandmarks(raw2D, world3D, currentTime, dt);
      }

      requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
  }

  public getFps(): number {
    return this.fps;
  }

  public destroy(): void {
    this.isRunning = false;
    this.frameListeners = [];
    this.actionListeners = [];
    this.statusListeners = [];

    if (this.videoElement && this.videoElement.srcObject) {
      const stream = this.videoElement.srcObject as MediaStream;
      for (const track of stream.getTracks()) {
        track.stop();
      }
      this.videoElement.srcObject = null;
    }
  }
}
