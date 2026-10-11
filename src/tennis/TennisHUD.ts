import { TennisScoreDetails } from './TennisRules';
import { TennisShotType } from './TennisPhysics';

export class TennisHUD {
  private container: HTMLElement;
  private rootEl: HTMLElement;
  private scoreboardEl!: HTMLElement;
  private p1ScoreEl!: HTMLElement;
  private p2ScoreEl!: HTMLElement;
  private p1GamesEl!: HTMLElement;
  private p2GamesEl!: HTMLElement;
  private serverIndicatorEl!: HTMLElement;
  private matchStatusEl!: HTMLElement;

  private speedometerEl!: HTMLElement;
  private speedValEl!: HTMLElement;
  private strokeBadgeEl!: HTMLElement;

  private calloutEl!: HTMLElement;
  private calloutTimer: any = null;

  private cameraBadgeEl!: HTMLElement;

  constructor(container: HTMLElement, onCameraToggle: () => void) {
    this.container = container;
    this.rootEl = document.createElement('div');
    this.rootEl.className = 'tennis-hud-root';
    this.buildDOM(onCameraToggle);
    this.container.appendChild(this.rootEl);
  }

  private buildDOM(onCameraToggle: () => void): void {
    // 1. Broadcast Scoreboard Pill (Top Center)
    this.scoreboardEl = document.createElement('div');
    this.scoreboardEl.className = 'tennis-scoreboard-pill glass-panel';
    this.scoreboardEl.innerHTML = `
      <div class="tennis-team p1">
        <span class="tennis-name">🎾 YOU</span>
        <span class="tennis-games" id="tennis-p1-games">0</span>
        <span class="tennis-points" id="tennis-p1-points">0</span>
      </div>
      <div class="tennis-divider">
        <span class="tennis-server-badge" id="tennis-server-badge">SERVE</span>
        <span class="tennis-status-line" id="tennis-status-line">SET 1</span>
      </div>
      <div class="tennis-team p2">
        <span class="tennis-points" id="tennis-p2-points">0</span>
        <span class="tennis-games" id="tennis-p2-games">0</span>
        <span class="tennis-name">AI 🤖</span>
      </div>
    `;
    this.rootEl.appendChild(this.scoreboardEl);

    this.p1ScoreEl = this.scoreboardEl.querySelector('#tennis-p1-points') as HTMLElement;
    this.p2ScoreEl = this.scoreboardEl.querySelector('#tennis-p2-points') as HTMLElement;
    this.p1GamesEl = this.scoreboardEl.querySelector('#tennis-p1-games') as HTMLElement;
    this.p2GamesEl = this.scoreboardEl.querySelector('#tennis-p2-games') as HTMLElement;
    this.serverIndicatorEl = this.scoreboardEl.querySelector('#tennis-server-badge') as HTMLElement;
    this.matchStatusEl = this.scoreboardEl.querySelector('#tennis-status-line') as HTMLElement;

    // 2. Speedometer & Stroke Quality Gauge (Bottom Right)
    this.speedometerEl = document.createElement('div');
    this.speedometerEl.className = 'tennis-speedometer glass-panel';
    this.speedometerEl.innerHTML = `
      <div class="speed-label">STROKE VELOCITY</div>
      <div class="speed-row">
        <span class="speed-number" id="tennis-speed-val">0</span>
        <span class="speed-unit">KM/H</span>
      </div>
      <div class="stroke-badge" id="tennis-stroke-badge">READY</div>
    `;
    this.rootEl.appendChild(this.speedometerEl);

    this.speedValEl = this.speedometerEl.querySelector('#tennis-speed-val') as HTMLElement;
    this.strokeBadgeEl = this.speedometerEl.querySelector('#tennis-stroke-badge') as HTMLElement;

    // 3. Arcade Line Callout (In/Out/Fault/Ace/Let)
    this.calloutEl = document.createElement('div');
    this.calloutEl.className = 'tennis-callout';
    this.calloutEl.style.display = 'none';
    this.rootEl.appendChild(this.calloutEl);

    // 4. Camera Switch Floating Action Button (Top Right)
    this.cameraBadgeEl = document.createElement('button');
    this.cameraBadgeEl.className = 'tennis-cam-btn glass-panel';
    this.cameraBadgeEl.id = 'btn-tennis-cam';
    this.cameraBadgeEl.innerHTML = '<span>📹</span><span id="tennis-cam-name">BROADCAST</span>';
    this.cameraBadgeEl.title = 'Switch Camera Angle (C)';
    this.cameraBadgeEl.onclick = onCameraToggle;
    this.rootEl.appendChild(this.cameraBadgeEl);

    this.injectStyles();
  }

  private injectStyles(): void {
    if (document.getElementById('tennis-hud-styles')) return;

    const style = document.createElement('style');
    style.id = 'tennis-hud-styles';
    style.textContent = `
      .tennis-hud-root {
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 5;
        font-family: 'Outfit', 'Inter', system-ui, sans-serif;
      }
      .tennis-scoreboard-pill {
        position: absolute;
        top: 68px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 6px 20px;
        background: rgba(10, 20, 38, 0.85);
        border: 1px solid rgba(0, 242, 254, 0.35);
        border-radius: 999px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
        backdrop-filter: blur(12px);
      }
      .tennis-team {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .tennis-name {
        font-size: 0.8rem;
        font-weight: 700;
        letter-spacing: 1px;
        color: #94a3b8;
      }
      .tennis-team.p1 .tennis-name { color: #00f2fe; }
      .tennis-team.p2 .tennis-name { color: #ff0055; }
      .tennis-games {
        font-size: 1.1rem;
        font-weight: 800;
        color: #f8fafc;
        background: rgba(255, 255, 255, 0.1);
        padding: 2px 8px;
        border-radius: 6px;
      }
      .tennis-points {
        font-size: 1.25rem;
        font-weight: 900;
        color: #facc15;
        min-width: 32px;
        text-align: center;
      }
      .tennis-divider {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 0 8px;
        border-left: 1px solid rgba(255, 255, 255, 0.15);
        border-right: 1px solid rgba(255, 255, 255, 0.15);
      }
      .tennis-server-badge {
        font-size: 0.65rem;
        font-weight: 800;
        color: #38ef7d;
        letter-spacing: 1.5px;
      }
      .tennis-status-line {
        font-size: 0.7rem;
        font-weight: 600;
        color: #94a3b8;
      }
      .tennis-speedometer {
        position: absolute;
        bottom: 24px;
        right: 24px;
        padding: 12px 18px;
        background: rgba(10, 20, 38, 0.85);
        border: 1px solid rgba(0, 242, 254, 0.3);
        border-radius: 14px;
        backdrop-filter: blur(12px);
        text-align: right;
      }
      .speed-label {
        font-size: 0.65rem;
        font-weight: 700;
        letter-spacing: 1.5px;
        color: #94a3b8;
        margin-bottom: 2px;
      }
      .speed-row {
        display: flex;
        align-items: baseline;
        justify-content: flex-end;
        gap: 4px;
      }
      .speed-number {
        font-size: 2.2rem;
        font-weight: 900;
        color: #00f2fe;
        line-height: 1;
      }
      .speed-unit {
        font-size: 0.8rem;
        font-weight: 800;
        color: #64748b;
      }
      .stroke-badge {
        display: inline-block;
        margin-top: 6px;
        padding: 3px 10px;
        font-size: 0.7rem;
        font-weight: 800;
        letter-spacing: 1px;
        color: #facc15;
        background: rgba(250, 204, 21, 0.15);
        border: 1px solid rgba(250, 204, 21, 0.4);
        border-radius: 6px;
      }
      .tennis-callout {
        position: absolute;
        top: 24%;
        left: 50%;
        transform: translate(-50%, -50%);
        font-size: 2.6rem;
        font-weight: 900;
        letter-spacing: 4px;
        color: #fff;
        text-shadow: 0 0 24px rgba(0, 242, 254, 0.8);
        padding: 10px 32px;
        border-radius: 999px;
        border: 2px solid #00f2fe;
        background: rgba(0, 15, 35, 0.88);
        backdrop-filter: blur(10px);
        transition: opacity 0.25s ease-out;
      }
      .tennis-callout.in {
        color: #38ef7d;
        border-color: #38ef7d;
        text-shadow: 0 0 24px rgba(56, 239, 125, 0.8);
      }
      .tennis-callout.out {
        color: #ff0055;
        border-color: #ff0055;
        text-shadow: 0 0 24px rgba(255, 0, 85, 0.8);
      }
      .tennis-cam-btn {
        position: absolute;
        top: 68px;
        right: 24px;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 14px;
        background: rgba(15, 23, 42, 0.8);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 999px;
        color: #f8fafc;
        font-size: 0.75rem;
        font-weight: 700;
        cursor: pointer;
        pointer-events: auto;
        transition: all 0.2s ease;
      }
      .tennis-cam-btn:hover {
        background: rgba(0, 242, 254, 0.2);
        border-color: #00f2fe;
      }
    `;
    document.head.appendChild(style);
  }

  public updateScore(score: TennisScoreDetails): void {
    this.p1ScoreEl.textContent = score.p1DisplayScore;
    this.p2ScoreEl.textContent = score.p2DisplayScore;
    this.p1GamesEl.textContent = `${score.player1Games}`;
    this.p2GamesEl.textContent = `${score.player2Games}`;

    const serverName = score.currentServer === 1 ? 'YOU SERVE' : 'AI SERVE';
    const serveSide = score.serveCourtSide.toUpperCase();
    const second = score.isSecondServe ? ' (2ND)' : '';
    this.serverIndicatorEl.textContent = `${serverName} [${serveSide}]${second}`;
    this.serverIndicatorEl.style.color = score.currentServer === 1 ? '#00f2fe' : '#ff0055';

    if (score.isTiebreak) {
      this.matchStatusEl.textContent = `TIEBREAK ${score.tiebreakP1}-${score.tiebreakP2}`;
    } else if (score.isDeuce) {
      this.matchStatusEl.textContent = 'DEUCE';
    } else if (score.isAdIn) {
      this.matchStatusEl.textContent = 'ADVANTAGE IN';
    } else if (score.isAdOut) {
      this.matchStatusEl.textContent = 'ADVANTAGE OUT';
    } else {
      this.matchStatusEl.textContent = `SET ${score.player1Sets + score.player2Sets + 1}`;
    }
  }

  public showSpeed(kmh: number, stroke: TennisShotType | string): void {
    const rounded = Math.round(kmh);
    this.speedValEl.textContent = rounded.toString();
    this.strokeBadgeEl.textContent = `${rounded} KM/H ${stroke.toUpperCase()}`;
  }

  public showCallout(text: string, type: 'in' | 'out' | 'ace' | 'fault' | 'net' = 'in', durationMs = 1200): void {
    if (this.calloutTimer) clearTimeout(this.calloutTimer);

    this.calloutEl.className = `tennis-callout ${type}`;
    this.calloutEl.textContent = text;
    this.calloutEl.style.display = 'block';
    this.calloutEl.style.opacity = '1';

    this.calloutTimer = setTimeout(() => {
      this.calloutEl.style.opacity = '0';
      setTimeout(() => {
        this.calloutEl.style.display = 'none';
      }, 250);
    }, durationMs);
  }

  public setCameraName(name: string): void {
    const el = this.cameraBadgeEl.querySelector('#tennis-cam-name');
    if (el) el.textContent = name.toUpperCase();
  }

  public destroy(): void {
    this.rootEl.remove();
  }
}
