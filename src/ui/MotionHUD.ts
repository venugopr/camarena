import { MotionFrame, ActionEvent, PoseLandmark } from '../core/motion/Types';
import { PoseTracker } from '../core/motion/PoseTracker';
import { SKELETON_CONNECTIONS } from '../scenes/components/Avatar3D';

export class MotionHUD {
  private container: HTMLElement;
  private tracker: PoseTracker;

  // DOM elements
  private pipContainer!: HTMLElement;
  private videoEl!: HTMLVideoElement;
  private canvasEl!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private statusDot!: HTMLElement;
  private statusText!: HTMLElement;

  private actionCard!: HTMLElement;
  private actionTitle!: HTMLElement;
  private actionSpeed!: HTMLElement;
  private meterFill!: HTMLElement;
  private telemetryYaw!: HTMLElement;
  private telemetryLunge!: HTMLElement;
  private telemetryFps!: HTMLElement;

  constructor(container: HTMLElement, tracker: PoseTracker) {
    this.container = container;
    this.tracker = tracker;
    this.buildDOM();
    this.bindEvents();
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

    const statusBadge = document.createElement('div');
    statusBadge.className = 'pip-status-badge';
    this.statusDot = document.createElement('span');
    this.statusDot.className = 'status-dot';
    this.statusText = document.createElement('span');
    this.statusText.textContent = 'SIMULATOR 60FPS';
    statusBadge.appendChild(this.statusDot);
    statusBadge.appendChild(this.statusText);

    this.pipContainer.appendChild(this.videoEl);
    this.pipContainer.appendChild(this.canvasEl);
    this.pipContainer.appendChild(statusBadge);

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

    // Draw Skeleton Bones
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.7)';
    ctx.beginPath();

    for (const [i1, i2] of SKELETON_CONNECTIONS) {
      const p1 = landmarks[i1];
      const p2 = landmarks[i2];
      if (p1 && p2 && (p1.visibility ?? 1) > 0.3 && (p2.visibility ?? 1) > 0.3) {
        ctx.moveTo(p1.x * w, p1.y * h);
        ctx.lineTo(p2.x * w, p2.y * h);
      }
    }
    ctx.stroke();

    // Draw Joint Nodes
    for (let i = 0; i < landmarks.length; i++) {
      const lm = landmarks[i];
      if (!lm) continue;
      if ((lm.visibility ?? 1) > 0.3) {
        const isWrist = i === PoseLandmark.RIGHT_WRIST || i === PoseLandmark.LEFT_WRIST;
        const radius = isWrist ? 5 : 3;
        ctx.fillStyle = isWrist ? '#39ff14' : '#00f2fe';
        ctx.beginPath();
        ctx.arc(lm.x * w, lm.y * h, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
