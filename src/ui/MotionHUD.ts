import { MotionFrame, ActionEvent, PoseLandmark, GameModeId } from '../core/motion/Types';
import { PoseTracker } from '../core/motion/PoseTracker';
import { SKELETON_CONNECTIONS } from '../scenes/components/Avatar3D';
import { GameSceneManager } from '../core/scene/GameSceneManager';

export class MotionHUD {
  private container: HTMLElement;
  private tracker: PoseTracker;
  private sceneManager?: GameSceneManager;
  private currentGameMode: GameModeId = 'badminton';

  // DOM elements
  private pipContainer!: HTMLElement;
  private videoEl!: HTMLVideoElement;
  private canvasEl!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private statusDot!: HTMLElement;
  private statusText!: HTMLElement;
  private postureBadge!: HTMLElement;
  private equipmentBadge!: HTMLElement;

  private actionCard!: HTMLElement;
  private actionTitle!: HTMLElement;
  private actionSpeed!: HTMLElement;
  private meterFill!: HTMLElement;
  private telemetryYaw!: HTMLElement;
  private telemetryLunge!: HTMLElement;
  private telemetryFps!: HTMLElement;

  private pipImpactTimer = 0;
  private pipImpactX = 0;
  private pipImpactY = 0;
  private pipImpactIsSmash = false;
  private isHoldingShuttle = true;

  public triggerImpactEffect(isSmash = false): void {
    this.pipImpactTimer = 0.36;
    this.pipImpactIsSmash = isSmash;
  }

  public setHoldingShuttle(holding: boolean): void {
    this.isHoldingShuttle = holding;
    if (this.equipmentBadge && this.currentGameMode === 'badminton') {
      if (holding) {
        this.equipmentBadge.textContent = '🏸 SHUTTLE IN HAND — READY TO SERVE';
        this.equipmentBadge.style.color = '#fbbf24';
      } else {
        this.equipmentBadge.textContent = '🏸 VIRTUAL RACKET ON HAND';
        this.equipmentBadge.style.color = '#00f2fe';
      }
    }
  }

  constructor(container: HTMLElement, tracker: PoseTracker, sceneManager?: GameSceneManager) {
    this.container = container;
    this.tracker = tracker;
    this.sceneManager = sceneManager;
    if (sceneManager) {
      this.currentGameMode = sceneManager.getActiveSceneId() || 'badminton';
      sceneManager.onSceneChange((id) => {
        this.currentGameMode = id;
        this.updateEquipmentBadge();
      });
    }
    this.buildDOM();
    this.bindEvents();
    this.updateEquipmentBadge();
  }

  public setGameMode(mode: GameModeId): void {
    this.currentGameMode = mode;
    this.updateEquipmentBadge();
  }

  private updateEquipmentBadge(): void {
    if (!this.equipmentBadge) return;
    if (this.currentGameMode === 'badminton') {
      this.equipmentBadge.textContent = '🏸 VIRTUAL RACKET ON HAND';
      this.equipmentBadge.style.color = '#00f2fe';
    } else if (this.currentGameMode === 'tabletennis') {
      this.equipmentBadge.textContent = '🏓 VIRTUAL PADDLE ON HAND';
      this.equipmentBadge.style.color = '#ff4d4d';
    } else {
      this.equipmentBadge.textContent = '🪞 MOTION MIRROR';
      this.equipmentBadge.style.color = '#a855f7';
    }
  }

  public getVideoElement(): HTMLVideoElement {
    return this.videoEl;
  }

  private buildDOM(): void {
    // 1. Right Bottom PIP Camera Panel
    const pipHud = document.createElement('div');
    pipHud.className = 'motion-hud';

    this.pipContainer = document.createElement('div');
    this.pipContainer.className = 'camera-pip glass-panel';

    this.videoEl = document.createElement('video');
    this.videoEl.className = 'camera-video';
    this.videoEl.autoplay = true;
    this.videoEl.playsInline = true;
    this.videoEl.muted = true;

    this.canvasEl = document.createElement('canvas');
    this.canvasEl.className = 'camera-canvas';
    this.ctx = this.canvasEl.getContext('2d')!;

    // Header controls row for PIP
    const pipHeader = document.createElement('div');
    pipHeader.className = 'pip-header-bar';

    const statusBadge = document.createElement('div');
    statusBadge.className = 'pip-status-badge';
    this.statusDot = document.createElement('span');
    this.statusDot.className = 'status-dot';
    this.statusText = document.createElement('span');
    this.statusText.textContent = 'LIVE FEED 60FPS';
    statusBadge.appendChild(this.statusDot);
    statusBadge.appendChild(this.statusText);

    // Mirror mode expand button
    const mirrorBtn = document.createElement('button');
    mirrorBtn.className = 'pip-mirror-btn';
    mirrorBtn.id = 'btn-pip-mirror-toggle';
    mirrorBtn.innerHTML = '<span>🪞</span><span>Mirror View</span>';
    mirrorBtn.title = 'Toggle between compact PiP and large high-visibility mirror';
    mirrorBtn.onclick = () => {
      this.toggleMirrorMode();
    };

    pipHeader.appendChild(statusBadge);
    pipHeader.appendChild(mirrorBtn);

    // Equipment & Posture & Depth badges on PIP
    this.equipmentBadge = document.createElement('div');
    this.equipmentBadge.className = 'pip-equipment-badge';
    this.equipmentBadge.textContent = '🏸 VIRTUAL RACKET ACTIVE';

    this.postureBadge = document.createElement('div');
    this.postureBadge.className = 'pip-posture-badge';
    this.postureBadge.textContent = 'READY STANCE';

    const depthBadge = document.createElement('div');
    depthBadge.className = 'pip-depth-badge';
    depthBadge.id = 'pip-depth-indicator';
    depthBadge.textContent = '✅ OPTIMAL DEPTH';

    const gestureHint = document.createElement('div');
    gestureHint.className = 'pip-gesture-hint';
    gestureHint.innerHTML = '<span>🙌 Raise both hands or Esc to Pause</span>';

    this.pipContainer.appendChild(this.videoEl);
    this.pipContainer.appendChild(this.canvasEl);
    this.pipContainer.appendChild(pipHeader);
    this.pipContainer.appendChild(this.equipmentBadge);
    this.pipContainer.appendChild(this.postureBadge);
    this.pipContainer.appendChild(depthBadge);
    this.pipContainer.appendChild(gestureHint);

    pipHud.appendChild(this.pipContainer);
    this.container.appendChild(pipHud);


    // 2. Left Bottom Athletic Action & Telemetry Banner
    const actionBanner = document.createElement('div');
    actionBanner.className = 'action-banner';

    this.actionCard = document.createElement('div');
    this.actionCard.className = 'stroke-card glass-panel';

    const titleRow = document.createElement('div');
    titleRow.className = 'stroke-title';
    this.actionTitle = document.createElement('span');
    this.actionTitle.textContent = 'READY STANCE';
    this.actionSpeed = document.createElement('span');
    this.actionSpeed.className = 'stroke-speed';
    this.actionSpeed.textContent = '0 KM/H';
    titleRow.appendChild(this.actionTitle);
    titleRow.appendChild(this.actionSpeed);

    const meterContainer = document.createElement('div');
    meterContainer.className = 'meter-container';
    this.meterFill = document.createElement('div');
    this.meterFill.className = 'meter-fill';
    meterContainer.appendChild(this.meterFill);

    const telemetryRow = document.createElement('div');
    telemetryRow.className = 'telemetry-row';
    this.telemetryYaw = document.createElement('span');
    this.telemetryYaw.textContent = 'YAW: 0°';
    this.telemetryLunge = document.createElement('span');
    this.telemetryLunge.textContent = 'LUNGE: NEUTRAL';
    this.telemetryFps = document.createElement('span');
    this.telemetryFps.textContent = 'FPS: 60';
    telemetryRow.appendChild(this.telemetryYaw);
    telemetryRow.appendChild(this.telemetryLunge);
    telemetryRow.appendChild(this.telemetryFps);

    // Quick Action Test Bar (instant testing for user convenience)
    const testBar = document.createElement('div');
    testBar.className = 'test-actions-bar';
    const actions = [
      { id: 'forehand', label: 'Forehand ⚡' },
      { id: 'smash', label: 'Overhead Smash 💥' },
      { id: 'backhand', label: 'Backhand 🔄' },
      { id: 'lunge', label: 'Side Lunge 🏃' }
    ] as const;

    for (const a of actions) {
      const btn = document.createElement('button');
      btn.className = 'test-action-btn';
      btn.textContent = a.label;
      btn.onclick = () => {
        this.tracker.triggerSyntheticStroke(a.id);
      };
      testBar.appendChild(btn);
    }

    this.actionCard.appendChild(titleRow);
    this.actionCard.appendChild(meterContainer);
    this.actionCard.appendChild(telemetryRow);
    actionBanner.appendChild(this.actionCard);
    actionBanner.appendChild(testBar);

    this.container.appendChild(actionBanner);
  }

  private bindEvents(): void {
    this.tracker.onStatus((status, isError) => {
      this.statusText.textContent = status.substring(0, 26);
      if (isError) {
        this.statusDot.style.background = '#ff0055';
        this.statusDot.style.boxShadow = '0 0 6px #ff0055';
      } else {
        this.statusDot.style.background = '#39ff14';
        this.statusDot.style.boxShadow = '0 0 6px #39ff14';
      }
    });

    this.tracker.onAction((event: ActionEvent) => {
      this.handleAction(event);
    });

    window.addEventListener('camarena-impact', (e: Event) => {
      const customEvt = e as CustomEvent<{ isSmash?: boolean }>;
      this.triggerImpactEffect(Boolean(customEvt.detail?.isSmash));
    });

    window.addEventListener('camarena-holding-shuttle', (e: Event) => {
      const customEvt = e as CustomEvent<{ isHolding?: boolean }>;
      this.setHoldingShuttle(Boolean(customEvt.detail?.isHolding));
    });
  }

  private isMirrorExpanded: boolean = false;

  public toggleMirrorMode(): void {
    this.isMirrorExpanded = !this.isMirrorExpanded;
    const btn = this.pipContainer.querySelector('#btn-pip-mirror-toggle');
    if (this.isMirrorExpanded) {
      this.pipContainer.classList.add('mirror-expanded');
      if (btn) btn.innerHTML = '<span>↗</span><span>Compact PiP</span>';
    } else {
      this.pipContainer.classList.remove('mirror-expanded');
      if (btn) btn.innerHTML = '<span>🪞</span><span>Mirror View</span>';
    }
  }

  public update(frame: MotionFrame | null): void {
    if (!frame) return;

    // Update Telemetry
    const speedKmh = Math.max(frame.metrics.rightWristSpeedKmh, frame.metrics.leftWristSpeedKmh);
    this.actionSpeed.textContent = `${speedKmh.toFixed(0)} KM/H`;

    const powerRatio = Math.min(100, (speedKmh / 50) * 100);
    this.meterFill.style.width = `${powerRatio}%`;

    this.telemetryYaw.textContent = `YAW: ${frame.metrics.torsoYawDeg.toFixed(0)}°`;
    if (frame.metrics.isLungingRight) {
      this.telemetryLunge.textContent = 'LUNGE: RIGHT ❯❯';
      this.telemetryLunge.style.color = '#39ff14';
    } else if (frame.metrics.isLungingLeft) {
      this.telemetryLunge.textContent = 'LUNGE: ❮❮ LEFT';
      this.telemetryLunge.style.color = '#39ff14';
    } else {
      this.telemetryLunge.textContent = 'LUNGE: NEUTRAL';
      this.telemetryLunge.style.color = 'inherit';
    }

    this.telemetryFps.textContent = `FPS: ${this.tracker.getFps() || 60}`;

    // Live Depth & Distance Guidance
    const lShoulder = frame.rawLandmarks[PoseLandmark.LEFT_SHOULDER];
    const rShoulder = frame.rawLandmarks[PoseLandmark.RIGHT_SHOULDER];
    const depthEl = this.pipContainer.querySelector('#pip-depth-indicator') as HTMLElement;
    if (depthEl && lShoulder && rShoulder && (lShoulder.visibility ?? 1) > 0.35 && (rShoulder.visibility ?? 1) > 0.35) {
      const shoulderSpan = Math.abs(lShoulder.x - rShoulder.x);
      if (shoulderSpan > 0.38) {
        depthEl.textContent = '⚠️ STEP BACK (~2M)';
        depthEl.className = 'pip-depth-badge warning';
      } else if (shoulderSpan < 0.12) {
        depthEl.textContent = '⚠️ STEP CLOSER';
        depthEl.className = 'pip-depth-badge warning';
      } else {
        depthEl.textContent = '✅ OPTIMAL DEPTH';
        depthEl.className = 'pip-depth-badge optimal';
      }
    }

    // Update Posture guidance badge
    const nose = frame.rawLandmarks[PoseLandmark.NOSE];
    const rWrist = frame.rawLandmarks[PoseLandmark.RIGHT_WRIST];
    const lWrist = frame.rawLandmarks[PoseLandmark.LEFT_WRIST];
    const isHandRaised = Boolean(
      rWrist && lWrist && nose &&
      (rWrist.visibility ?? 1) > 0.4 &&
      (lWrist.visibility ?? 1) > 0.4 &&
      rWrist.y < nose.y - 0.12 &&
      lWrist.y < nose.y - 0.12
    );

    if (isHandRaised) {
      this.postureBadge.textContent = '🙌 PAUSE GESTURE';
      this.postureBadge.style.background = 'rgba(255, 0, 85, 0.85)';
      this.postureBadge.style.color = '#fff';
    } else if (frame.metrics.isLungingRight) {
      this.postureBadge.textContent = 'LUNGE RIGHT ❯❯';
      this.postureBadge.style.background = 'rgba(57, 255, 20, 0.2)';
      this.postureBadge.style.color = '#39ff14';
    } else if (frame.metrics.isLungingLeft) {
      this.postureBadge.textContent = '❮❮ LUNGE LEFT';
      this.postureBadge.style.background = 'rgba(57, 255, 20, 0.2)';
      this.postureBadge.style.color = '#39ff14';
    } else if (frame.activeAction && frame.activeAction !== 'READY_STANCE') {
      this.postureBadge.textContent = frame.activeAction.replace('_', ' ');
      this.postureBadge.style.background = 'rgba(0, 242, 254, 0.2)';
      this.postureBadge.style.color = '#00f2fe';
    } else {
      this.postureBadge.textContent = 'READY STANCE';
      this.postureBadge.style.background = 'rgba(0, 0, 0, 0.6)';
      this.postureBadge.style.color = '#94a3b8';
    }

    // Render 2D Skeleton in PIP overlay
    this.renderSkeleton(frame);
  }

  private handleAction(event: ActionEvent): void {
    this.actionTitle.textContent = event.type.replace('_', ' ');
    if (event.type === 'OVERHEAD_SMASH') {
      this.actionCard.classList.add('smash-active');
      this.meterFill.classList.add('smash');
      setTimeout(() => {
        this.actionCard.classList.remove('smash-active');
        this.meterFill.classList.remove('smash');
      }, 600);
    }
  }

  private renderSkeleton(frame: MotionFrame): void {
    const canvas = this.canvasEl;
    const ctx = this.ctx;
    const w = this.pipContainer.clientWidth;
    const h = this.pipContainer.clientHeight;

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    ctx.clearRect(0, 0, w, h);

    const landmarks = frame.rawLandmarks;
    if (!landmarks || landmarks.length < 33) return;

    const isLeft = frame.metrics.dominantArm === 'left';
    const dominantWrist = isLeft ? PoseLandmark.LEFT_WRIST : PoseLandmark.RIGHT_WRIST;
    const dominantElbow = isLeft ? PoseLandmark.LEFT_ELBOW : PoseLandmark.RIGHT_ELBOW;
    const dominantShoulder = isLeft ? PoseLandmark.LEFT_SHOULDER : PoseLandmark.RIGHT_SHOULDER;

    // Draw General Body Skeleton Bones
    ctx.lineWidth = 3.0;
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.65)';
    ctx.beginPath();

    for (const [i1, i2] of SKELETON_CONNECTIONS) {
      // Don't draw swinging arm in base pass (we highlight it separately)
      const isSwingingArm =
        (i1 === dominantShoulder && i2 === dominantElbow) ||
        (i1 === dominantElbow && i2 === dominantWrist);

      if (isSwingingArm) continue;

      const p1 = landmarks[i1];
      const p2 = landmarks[i2];
      if (p1 && p2 && (p1.visibility ?? 1) > 0.3 && (p2.visibility ?? 1) > 0.3) {
        ctx.moveTo(p1.x * w, p1.y * h);
        ctx.lineTo(p2.x * w, p2.y * h);
      }
    }
    ctx.stroke();

    // Draw Swinging/Racket Arm in High-Visibility Neon Lime/Gold
    const pShoulder = landmarks[dominantShoulder];
    const pElbow = landmarks[dominantElbow];
    const pWrist = landmarks[dominantWrist];

    if (pShoulder && pElbow && pWrist && (pWrist.visibility ?? 1) > 0.3) {
      ctx.save();
      ctx.lineWidth = 4.5;
      ctx.strokeStyle = '#39ff14';
      ctx.shadowColor = '#39ff14';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(pShoulder.x * w, pShoulder.y * h);
      ctx.lineTo(pElbow.x * w, pElbow.y * h);
      ctx.lineTo(pWrist.x * w, pWrist.y * h);
      ctx.stroke();
      ctx.restore();
    }

    // Draw Joint Nodes
    for (let i = 0; i < landmarks.length; i++) {
      const lm = landmarks[i];
      if (!lm) continue; // Guard against sparse landmark arrays
      if ((lm.visibility ?? 1) > 0.3) {
        const isSwingingWrist = i === dominantWrist;
        const isOtherWrist = i === (isLeft ? PoseLandmark.RIGHT_WRIST : PoseLandmark.LEFT_WRIST);
        
        ctx.save();
        if (isSwingingWrist) {
          // Dominant Swinging Hand: Highlight with pulse ring
          ctx.fillStyle = '#39ff14';
          ctx.shadowColor = '#39ff14';
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.arc(lm.x * w, lm.y * h, 7, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(lm.x * w, lm.y * h, 11, 0, Math.PI * 2);
          ctx.stroke();
        } else if (isOtherWrist) {
          ctx.fillStyle = '#f59e0b';
          ctx.beginPath();
          ctx.arc(lm.x * w, lm.y * h, 4.5, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = '#00f2fe';
          ctx.beginPath();
          ctx.arc(lm.x * w, lm.y * h, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    }

    // Dynamic Equipment Rendering: Draw Virtual Racket or Paddle directly onto user's hand
    this.renderVirtualEquipment(ctx, frame, w, h);
  }

  private renderVirtualEquipment(
    ctx: CanvasRenderingContext2D,
    frame: MotionFrame,
    w: number,
    h: number
  ): void {
    if (this.currentGameMode === 'sandbox') return;

    const isLeft = frame.metrics.dominantArm === 'left';
    const wristIdx = isLeft ? PoseLandmark.LEFT_WRIST : PoseLandmark.RIGHT_WRIST;
    const elbowIdx = isLeft ? PoseLandmark.LEFT_ELBOW : PoseLandmark.RIGHT_ELBOW;

    const wrist = frame.rawLandmarks[wristIdx];
    const elbow = frame.rawLandmarks[elbowIdx];

    if (!wrist || !elbow || (wrist.visibility ?? 1) < 0.3) return;

    const wx = wrist.x * w;
    const wy = wrist.y * h;
    const ex = elbow.x * w;
    const ey = elbow.y * h;

    const dirX = wx - ex;
    const dirY = wy - ey;
    const len = Math.hypot(dirX, dirY);
    if (len < 4) return;

    const uX = dirX / len;
    const uY = dirY / len;
    const angle = Math.atan2(uY, uX);

    // Scale equipment according to canvas resolution
    const scale = Math.max(1, w / 260);

    ctx.save();

    if (this.currentGameMode === 'badminton') {
      // 1. Grip handle
      ctx.beginPath();
      ctx.moveTo(wx, wy);
      ctx.lineTo(wx + uX * (18 * scale), wy + uY * (18 * scale));
      ctx.strokeStyle = '#39ff14';
      ctx.lineWidth = 4.5 * scale;
      ctx.lineCap = 'round';
      ctx.stroke();

      // 2. Shaft
      ctx.beginPath();
      ctx.moveTo(wx + uX * (18 * scale), wy + uY * (18 * scale));
      ctx.lineTo(wx + uX * (42 * scale), wy + uY * (42 * scale));
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 3 * scale;
      ctx.stroke();

      // 3. Isometric Racket Head Frame
      const headCenterX = wx + uX * (62 * scale);
      const headCenterY = wy + uY * (62 * scale);
      this.pipImpactX = headCenterX;
      this.pipImpactY = headCenterY;

      ctx.save();
      ctx.translate(headCenterX, headCenterY);
      ctx.rotate(angle);

      ctx.shadowColor = '#00f2fe';
      ctx.shadowBlur = 12 * scale;
      ctx.strokeStyle = '#00f2fe';
      ctx.lineWidth = 3 * scale;
      ctx.beginPath();
      ctx.ellipse(0, 0, 20 * scale, 15 * scale, 0, 0, Math.PI * 2);
      ctx.stroke();

      // Strings grid
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.lineWidth = 1.2 * scale;
      ctx.beginPath();
      ctx.moveTo(-16 * scale, 0);
      ctx.lineTo(16 * scale, 0);
      ctx.moveTo(0, -12 * scale);
      ctx.lineTo(0, 12 * scale);
      ctx.moveTo(-8 * scale, -9 * scale);
      ctx.lineTo(-8 * scale, 9 * scale);
      ctx.moveTo(8 * scale, -9 * scale);
      ctx.lineTo(8 * scale, 9 * scale);
      ctx.stroke();

      ctx.restore();

      // Draw Virtual Shuttlecock in Non-Dominant Support Hand
      const supportWristIdx = isLeft ? PoseLandmark.RIGHT_WRIST : PoseLandmark.LEFT_WRIST;
      const sWrist = frame.rawLandmarks[supportWristIdx];
      if (sWrist && (sWrist.visibility ?? 1) > 0.3) {
        this.renderVirtualShuttlecock(ctx, sWrist.x * w, sWrist.y * h, scale, headCenterX, headCenterY);
      }
    } else if (this.currentGameMode === 'tabletennis') {
      // 1. Paddle Handle
      ctx.beginPath();
      ctx.moveTo(wx, wy);
      ctx.lineTo(wx + uX * (16 * scale), wy + uY * (16 * scale));
      ctx.strokeStyle = '#d97706';
      ctx.lineWidth = 6 * scale;
      ctx.lineCap = 'round';
      ctx.stroke();

      // 2. Paddle Rubber Blade
      const bladeCenterX = wx + uX * (32 * scale);
      const bladeCenterY = wy + uY * (32 * scale);
      this.pipImpactX = bladeCenterX;
      this.pipImpactY = bladeCenterY;

      ctx.save();
      ctx.translate(bladeCenterX, bladeCenterY);
      ctx.rotate(angle);

      ctx.shadowColor = '#ff0055';
      ctx.shadowBlur = 12 * scale;
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(0, 0, 16 * scale, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.2 * scale;
      ctx.stroke();

      // Center sweet spot dot
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, 2.5 * scale, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }

    ctx.restore();

    if (this.pipImpactTimer > 0) {
      this.renderPipImpact(ctx, scale);
    }
  }

  private renderVirtualShuttlecock(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    scale: number,
    rx: number,
    ry: number
  ): void {
    ctx.save();
    ctx.translate(sx, sy);

    if (this.isHoldingShuttle) {
      ctx.save();
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.45)';
      ctx.setLineDash([4 * scale, 4 * scale]);
      ctx.lineWidth = 1.8 * scale;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(rx - sx, ry - sy);
      ctx.stroke();
      ctx.restore();
    }

    // Golden halo around holding hand
    ctx.save();
    ctx.shadowColor = '#fbbf24';
    ctx.shadowBlur = 10 * scale;
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    ctx.arc(0, 0, 10 * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // White feathered cone
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(-7 * scale, -8 * scale);
    ctx.lineTo(7 * scale, -8 * scale);
    ctx.lineTo(2.5 * scale, 3 * scale);
    ctx.lineTo(-2.5 * scale, 3 * scale);
    ctx.closePath();
    ctx.fill();

    // Rounded golden cork
    ctx.fillStyle = '#fef08a';
    ctx.beginPath();
    ctx.arc(0, 4 * scale, 3.5 * scale, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  private renderPipImpact(ctx: CanvasRenderingContext2D, scale: number): void {
    const progress = 1 - (this.pipImpactTimer / 0.36);
    const radius = (18 + progress * 55) * scale;
    const alpha = Math.max(0, 1 - progress);

    ctx.save();
    ctx.translate(this.pipImpactX, this.pipImpactY);

    // Expanding shockwave ring
    ctx.strokeStyle = this.pipImpactIsSmash ? `rgba(255, 68, 68, ${alpha})` : `rgba(0, 242, 254, ${alpha})`;
    ctx.lineWidth = Math.max(1, 4 * (1 - progress) * scale);
    ctx.shadowColor = this.pipImpactIsSmash ? '#ff2222' : '#00f2fe';
    ctx.shadowBlur = 16 * scale;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Secondary gold ring
    ctx.strokeStyle = `rgba(251, 191, 36, ${alpha * 0.8})`;
    ctx.lineWidth = Math.max(1, 2 * (1 - progress) * scale);
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.7, 0, Math.PI * 2);
    ctx.stroke();

    // Radial sparks
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2 + progress;
      const sparkDist = (14 + progress * 42) * scale;
      const sx = Math.cos(ang) * sparkDist;
      const sy = Math.sin(ang) * sparkDist;
      ctx.fillStyle = i % 2 === 0 ? '#ffffff' : (this.pipImpactIsSmash ? '#ff0055' : '#39ff14');
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(1, 3.2 * (1 - progress) * scale), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
    this.pipImpactTimer = Math.max(0, this.pipImpactTimer - 0.016);
  }
}


