import { GameScoreState } from '../core/scene/IGameScene';
import { GameSceneManager } from '../core/scene/GameSceneManager';

export class ScoreOverlay {
  private container: HTMLElement;
  private sceneManager: GameSceneManager;

  // Scoreboard elements
  private scoreHud!: HTMLElement;
  private p1ScoreText!: HTMLElement;
  private p2ScoreText!: HTMLElement;
  private rallyBadge!: HTMLElement;
  private serverDot!: HTMLElement;
  private serverText!: HTMLElement;
  private rulesBanner!: HTMLElement;
  private matchPointBanner!: HTMLElement;
  private pointToast!: HTMLElement;
  private toastTimer: any = null;

  // Modals
  private pauseModalOverlay!: HTMLElement;
  private victoryModalOverlay!: HTMLElement;
  private rulesModalOverlay!: HTMLElement;

  constructor(container: HTMLElement, sceneManager: GameSceneManager) {
    this.container = container;
    this.sceneManager = sceneManager;
    this.buildDOM();
    this.bindEvents();
  }

  public setVisible(visible: boolean): void {
    const wrapper = this.container.querySelector('.score-wrapper') as HTMLElement;
    if (wrapper) {
      wrapper.style.display = visible ? 'flex' : 'none';
    }
    // When hiding the score overlay (returning to main menu), close all modals too
    if (!visible) {
      if (this.pauseModalOverlay) this.pauseModalOverlay.style.display = 'none';
      if (this.victoryModalOverlay) this.victoryModalOverlay.style.display = 'none';
      if (this.rulesModalOverlay) this.rulesModalOverlay.style.display = 'none';
      if (this.matchPointBanner) this.matchPointBanner.style.display = 'none';
      if (this.pointToast) this.pointToast.style.display = 'none';
    }
  }


  private buildDOM(): void {
    // 1. Scoreboard Panel Container
    const scoreWrapper = document.createElement('div');
    scoreWrapper.className = 'score-wrapper';

    this.scoreHud = document.createElement('div');
    this.scoreHud.className = 'score-hud glass-panel';

    // Player 1 (You)
    const p1 = document.createElement('div');
    p1.className = 'team-score team-player';
    const p1Label = document.createElement('span');
    p1Label.className = 'team-label';
    p1Label.textContent = 'PLAYER (YOU)';
    this.p1ScoreText = document.createElement('span');
    this.p1ScoreText.className = 'team-points';
    this.p1ScoreText.textContent = '0';
    p1.appendChild(p1Label);
    p1.appendChild(this.p1ScoreText);

    // Center Divider & Rally
    const divider = document.createElement('div');
    divider.className = 'score-divider';
    this.serverDot = document.createElement('div');
    this.serverDot.className = 'server-dot';
    this.serverDot.title = 'Current Server';

    this.serverText = document.createElement('span');
    this.serverText.className = 'server-text';
    this.serverText.textContent = 'YOU SERVE';

    this.rallyBadge = document.createElement('span');
    this.rallyBadge.className = 'rally-badge';
    this.rallyBadge.textContent = 'RALLY: 0';
    divider.appendChild(this.serverDot);
    divider.appendChild(this.serverText);
    divider.appendChild(this.rallyBadge);

    // Player 2 / Opponent AI
    const p2 = document.createElement('div');
    p2.className = 'team-score team-opponent';
    const p2Label = document.createElement('span');
    p2Label.className = 'team-label';
    p2Label.textContent = 'OPPONENT';
    this.p2ScoreText = document.createElement('span');
    this.p2ScoreText.className = 'team-points';
    this.p2ScoreText.textContent = '0';
    p2.appendChild(p2Label);
    p2.appendChild(this.p2ScoreText);

    this.scoreHud.appendChild(p1);
    this.scoreHud.appendChild(divider);
    this.scoreHud.appendChild(p2);

    // Transparent Rules Banner (Always visible under scoreboard)
    this.rulesBanner = document.createElement('div');
    this.rulesBanner.className = 'rules-banner glass-panel';
    this.rulesBanner.innerHTML = `
      <span class="rules-badge">RULES</span>
      <span class="rules-summary" id="rules-summary-text">FIRST TO 11 PTS • WIN BY 2 MARGIN • FLOOR DROP = POINT LOST</span>
      <button class="rules-info-btn" id="btn-open-rules" title="Click to view detailed scoring & defeat rules">ℹ️ Rules Guide</button>
    `;

    // Match Point & Deuce Alert Banner
    this.matchPointBanner = document.createElement('div');
    this.matchPointBanner.className = 'match-point-banner';
    this.matchPointBanner.style.display = 'none';

    // Point-Reason Toast
    this.pointToast = document.createElement('div');
    this.pointToast.className = 'point-toast';
    this.pointToast.style.display = 'none';

    scoreWrapper.appendChild(this.scoreHud);
    scoreWrapper.appendChild(this.matchPointBanner);
    scoreWrapper.appendChild(this.pointToast);
    scoreWrapper.appendChild(this.rulesBanner);
    this.container.appendChild(scoreWrapper);

    // 2. Pause Menu Modal
    this.buildPauseModal();

    // 3. Victory / Defeat Modal
    this.buildVictoryModal();

    // 4. Detailed Rules Guide Modal
    this.buildRulesModal();

    // Bind rules guide button
    const rulesBtn = this.rulesBanner.querySelector('#btn-open-rules') as HTMLButtonElement;
    if (rulesBtn) {
      rulesBtn.onclick = () => {
        this.rulesModalOverlay.style.display = 'flex';
      };
    }
  }

  private buildPauseModal(): void {
    this.pauseModalOverlay = document.createElement('div');
    this.pauseModalOverlay.className = 'modal-overlay pause-overlay';
    this.pauseModalOverlay.style.display = 'none';

    const modal = document.createElement('div');
    modal.className = 'pause-modal glass-panel';
    modal.innerHTML = `
      <div class="pause-header">
        <span class="pause-icon">⏸</span>
        <h2 class="pause-title">GAME PAUSED</h2>
      </div>
      <p class="pause-subtitle">Physics and game loop are frozen. Motion tracking remains active.</p>

      <div class="pause-score-card">
        <div class="pause-score-row">
          <div class="pause-team">
            <span class="pause-team-name">PLAYER (YOU)</span>
            <span class="pause-team-score" id="pause-p1-score">0</span>
          </div>
          <span class="pause-vs">VS</span>
          <div class="pause-team">
            <span class="pause-team-name">OPPONENT</span>
            <span class="pause-team-score" id="pause-p2-score">0</span>
          </div>
        </div>
        <div class="pause-rules-reminder" id="pause-rules-reminder">
          🎯 Target: First to 11 points (must lead by 2)
        </div>
      </div>

      <div class="pause-actions">
        <button class="icon-btn primary large" id="btn-pause-resume">
          <span>▶</span><span>Resume Match (Esc / P)</span>
        </button>
        <button class="icon-btn large" id="btn-pause-restart">
          <span>🔄</span><span>Restart Current Game</span>
        </button>
        <button class="icon-btn large" id="btn-pause-menu">
          <span>🏠</span><span>Main Menu</span>
        </button>
        <button class="icon-btn large" id="btn-pause-rules">
          <span>📖</span><span>Scoring Rules</span>
        </button>
      </div>

      <div class="pause-footer-hint">
        💡 Gesture Shortcut: Raise your hand above your head to pause or resume at any time.
      </div>
    `;

    this.pauseModalOverlay.appendChild(modal);
    this.container.appendChild(this.pauseModalOverlay);

    const resumeBtn = modal.querySelector('#btn-pause-resume') as HTMLButtonElement;
    resumeBtn.onclick = () => {
      this.sceneManager.resume();
    };

    const restartBtn = modal.querySelector('#btn-pause-restart') as HTMLButtonElement;
    restartBtn.onclick = () => {
      this.sceneManager.resetCurrentGame();
    };

    const menuBtn = modal.querySelector('#btn-pause-menu') as HTMLButtonElement;
    menuBtn.onclick = () => {
      this.pauseModalOverlay.style.display = 'none';
      window.dispatchEvent(new CustomEvent('open-main-menu'));
    };

    const rulesBtn = modal.querySelector('#btn-pause-rules') as HTMLButtonElement;
    rulesBtn.onclick = () => {
      this.rulesModalOverlay.style.display = 'flex';
    };
  }

  private buildVictoryModal(): void {
    this.victoryModalOverlay = document.createElement('div');
    this.victoryModalOverlay.className = 'modal-overlay victory-overlay';
    this.victoryModalOverlay.style.display = 'none';

    const modal = document.createElement('div');
    modal.className = 'victory-modal glass-panel';
    modal.innerHTML = `
      <div class="victory-banner-badge" id="victory-badge">MATCH CONCLUDED</div>
      <h2 class="victory-title" id="victory-title">VICTORY! 🏆</h2>
      <p class="victory-subtitle" id="victory-subtitle">Congratulations! You won the match!</p>
      
      <div class="victory-score-display" id="victory-score">11 - 8</div>
      <div class="victory-margin-badge" id="victory-margin">Won by 3 points margin</div>

      <div class="victory-stats-grid">
        <div class="stat-box">
          <span class="stat-label">TOTAL RALLIES</span>
          <span class="stat-val" id="stat-rallies">19</span>
        </div>
        <div class="stat-box">
          <span class="stat-label">WINNING CRITERIA</span>
          <span class="stat-val" id="stat-target">11 Pts (Win by 2)</span>
        </div>
        <div class="stat-box full-width">
          <span class="stat-label">FINAL DECIDING POINT</span>
          <span class="stat-val reason" id="stat-final-reason">Clean smash landing in court</span>
        </div>
      </div>

      <div class="victory-actions">
        <button class="icon-btn primary large" id="btn-rematch">
          <span>🚀</span><span>Play Rematch</span>
        </button>
        <button class="icon-btn large" id="btn-victory-restart">
          <span>🔄</span><span>Reset Match</span>
        </button>
        <button class="icon-btn large" id="btn-victory-main-menu">
          <span>🏠</span><span>Main Menu</span>
        </button>
      </div>
    `;

    this.victoryModalOverlay.appendChild(modal);
    this.container.appendChild(this.victoryModalOverlay);

    const rematchBtn = modal.querySelector('#btn-rematch') as HTMLButtonElement;
    rematchBtn.onclick = () => {
      this.victoryModalOverlay.style.display = 'none';
      this.sceneManager.resetCurrentGame();
    };

    const restartBtn = modal.querySelector('#btn-victory-restart') as HTMLButtonElement;
    restartBtn.onclick = () => {
      this.victoryModalOverlay.style.display = 'none';
      this.sceneManager.resetCurrentGame();
    };

    const victoryMenuBtn = modal.querySelector('#btn-victory-main-menu') as HTMLButtonElement;
    victoryMenuBtn.onclick = () => {
      this.victoryModalOverlay.style.display = 'none';
      window.dispatchEvent(new CustomEvent('open-main-menu'));
    };
  }

  private buildRulesModal(): void {
    this.rulesModalOverlay = document.createElement('div');
    this.rulesModalOverlay.className = 'modal-overlay rules-overlay';
    this.rulesModalOverlay.style.display = 'none';

    const modal = document.createElement('div');
    modal.className = 'rules-modal glass-panel';
    modal.innerHTML = `
      <div class="rules-modal-header">
        <div class="rules-modal-title">
          <span>📖</span>
          <h2>CamArena Official Scoring & Defeat Rules</h2>
        </div>
        <button class="icon-btn close-btn" id="btn-close-rules">✕</button>
      </div>

      <div class="rules-grid">
        <!-- Badminton Card -->
        <div class="rules-card">
          <div class="rules-card-title">🏸 Badminton 3D Regulations</div>
          <ul class="rules-list">
            <li><strong>Rally Point System:</strong> Every single rally earns a point for the winner.</li>
            <li><strong>Winning Condition:</strong> First to reach target points (11 or 21) leading by at least 2 clear points.</li>
            <li><strong>Deuce Cap:</strong> If tied at 10-10 or 20-20, play continues until a 2-point lead is secured (max cap at 15/30).</li>
            <li><strong>Floor Drop = Point Lost:</strong> If the shuttlecock lands on the court on your side, the opponent scores a point.</li>
            <li><strong>Out of Bounds:</strong> If a shot lands beyond the outer boundary lines, the hitting player loses the point.</li>
            <li><strong>Net Fault:</strong> Shuttlecock failing to clear the net immediately awards a point to the opposing side.</li>
          </ul>
        </div>

        <!-- Table Tennis Card -->
        <div class="rules-card">
          <div class="rules-card-title">🏓 Table Tennis 3D Regulations</div>
          <ul class="rules-list">
            <li><strong>ITTF 11-Point Match:</strong> First to 11 points wins. Must win by a 2-point margin.</li>
            <li><strong>Service Rotation:</strong> Service alternates between players every 2 points.</li>
            <li><strong>Deuce Service:</strong> At 10-10 deuce, service rotates after <em>every single point</em>.</li>
            <li><strong>Table Bounce Rule:</strong> Ball must hit the opponent's side of the table once. Missing the table forfeits the point.</li>
            <li><strong>Net Strike:</strong> Ball hitting the net without landing on the opponent's side loses the point.</li>
            <li><strong>Double Bounce:</strong> Allowing the ball to bounce twice on your table side results in defeat for that rally.</li>
          </ul>
        </div>

        <!-- Controls & Gestures Card -->
        <div class="rules-card full">
          <div class="rules-card-title">🎮 Motion Tracking & Pause Controls</div>
          <div class="rules-controls-row">
            <div class="control-item">
              <span class="control-key">Esc / P</span>
              <span>Dedicated keyboard shortcut to freeze game loop and open pause menu.</span>
            </div>
            <div class="control-item">
              <span class="control-key">🖐️ Hand Raise</span>
              <span>Raise dominant hand above head/eye level for 0.6s to trigger instant game pause.</span>
            </div>
            <div class="control-item">
              <span class="control-key">🏸 Auto Prop</span>
              <span>Virtual racket/paddle attaches automatically to your active hand in 3D & on camera.</span>
            </div>
          </div>
        </div>
      </div>

      <div class="rules-modal-footer">
        <button class="icon-btn primary" id="btn-understood-rules" style="padding: 10px 24px;">
          Understood, Return to Game 🚀
        </button>
      </div>
    `;

    this.rulesModalOverlay.appendChild(modal);
    this.container.appendChild(this.rulesModalOverlay);

    const closeBtn = modal.querySelector('#btn-close-rules') as HTMLButtonElement;
    closeBtn.onclick = () => {
      this.rulesModalOverlay.style.display = 'none';
    };

    const understoodBtn = modal.querySelector('#btn-understood-rules') as HTMLButtonElement;
    understoodBtn.onclick = () => {
      this.rulesModalOverlay.style.display = 'none';
    };
  }

  private bindEvents(): void {
    this.sceneManager.onScoreChange((score: GameScoreState) => {
      this.updateScore(score);
    });

    this.sceneManager.onPauseChange((isPaused: boolean) => {
      this.pauseModalOverlay.style.display = isPaused ? 'flex' : 'none';
      if (isPaused) {
        const score = this.sceneManager.getActiveScene()?.getScore();
        if (score) {
          const p1El = document.getElementById('pause-p1-score');
          const p2El = document.getElementById('pause-p2-score');
          const reminderEl = document.getElementById('pause-rules-reminder');
          if (p1El) p1El.textContent = `${score.player1Score}`;
          if (p2El) p2El.textContent = `${score.player2Score}`;
          if (reminderEl) {
            reminderEl.textContent = `🎯 Target: First to ${score.targetScore} points (${score.winByTwo ? 'win by 2 margin' : 'sudden death'})`;
          }
        }
      }
    });

    this.sceneManager.onSceneChange((sceneId: string) => {
      if (sceneId === 'sandbox') {
        this.scoreHud.style.display = 'none';
        this.rulesBanner.style.display = 'none';
      } else {
        this.scoreHud.style.display = 'flex';
        this.rulesBanner.style.display = 'flex';
      }
      this.victoryModalOverlay.style.display = 'none';
      this.pauseModalOverlay.style.display = 'none';
      this.matchPointBanner.style.display = 'none';
      this.pointToast.style.display = 'none';
      this.updateRulesBannerText(sceneId);
    });
  }

  private updateRulesBannerText(sceneId: string): void {
    const summaryText = document.getElementById('rules-summary-text');
    if (!summaryText) return;
    const target = this.sceneManager.getTargetScore();

    if (sceneId === 'badminton') {
      summaryText.textContent = `TARGET: FIRST TO ${target} PTS • WIN BY 2 • FLOOR DROP OR OUT = POINT LOST`;
    } else if (sceneId === 'tabletennis') {
      summaryText.textContent = `TARGET: FIRST TO ${target} PTS • WIN BY 2 • 2-PT SERVICE ROTATION • NET/OUT = POINT LOST`;
    } else {
      summaryText.textContent = 'FREE PRACTICE & BIOMECHANICAL MOTION MIRROR';
    }
  }

  private showPointToast(winner: 1 | 2, reason: string): void {
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
    }
    const isPlayer = winner === 1;
    this.pointToast.className = `point-toast ${isPlayer ? 'player-point' : 'opponent-point'}`;
    this.pointToast.innerHTML = `
      <span class="point-badge">${isPlayer ? '🟢 +1 PLAYER' : '🔴 +1 OPPONENT'}</span>
      <span class="point-reason">${reason}</span>
    `;
    this.pointToast.style.display = 'flex';

    this.toastTimer = setTimeout(() => {
      this.pointToast.style.display = 'none';
    }, 2800);
  }

  private updateScore(score: GameScoreState): void {
    this.p1ScoreText.textContent = `${score.player1Score}`;
    this.p2ScoreText.textContent = `${score.player2Score}`;
    this.rallyBadge.textContent = `RALLY: ${score.rallyCount}`;

    // Position server indicator dot towards active server
    if (score.currentServer === 1) {
      this.serverDot.style.transform = 'translateX(-22px)';
      this.serverText.textContent = 'YOU SERVE';
      this.serverText.style.color = '#00f2fe';
    } else {
      this.serverDot.style.transform = 'translateX(22px)';
      this.serverText.textContent = 'AI SERVES';
      this.serverText.style.color = '#ff0055';
    }

    // Rules banner target reflection
    this.updateRulesBannerText(this.sceneManager.getActiveSceneId() || 'badminton');

    // Show last point reason toast
    if (score.lastPointReason && score.lastPointWinner) {
      this.showPointToast(score.lastPointWinner, score.lastPointReason);
    }

    // Match point / Deuce banner
    if (score.matchPointText && !score.isGameOver) {
      this.matchPointBanner.textContent = score.matchPointText;
      this.matchPointBanner.style.display = 'block';
    } else {
      this.matchPointBanner.style.display = 'none';
    }

    // Victory / Defeat Modal Display
    if (score.isGameOver) {
      const title = document.getElementById('victory-title');
      const subtitle = document.getElementById('victory-subtitle');
      const scoreDisp = document.getElementById('victory-score');
      const marginDisp = document.getElementById('victory-margin');
      const badge = document.getElementById('victory-badge');
      const ralliesEl = document.getElementById('stat-rallies');
      const targetEl = document.getElementById('stat-target');
      const reasonEl = document.getElementById('stat-final-reason');

      const didWin = score.winner === 1;
      const margin = Math.abs(score.player1Score - score.player2Score);

      if (title && subtitle && scoreDisp && marginDisp && badge) {
        if (didWin) {
          title.textContent = 'MATCH VICTORY! 🏆';
          title.style.color = '#00f2fe';
          subtitle.textContent = 'Superb match! You outplayed the opponent and secured the win!';
          badge.textContent = 'VICTORY ACHIEVED';
          badge.style.background = 'rgba(0, 242, 254, 0.2)';
          badge.style.borderColor = '#00f2fe';
        } else {
          title.textContent = 'MATCH DEFEAT ⚡';
          title.style.color = '#ff0055';
          subtitle.textContent = 'Match Lost. Defeat registered! Ready for a comeback in the rematch?';
          badge.textContent = 'DEFEAT REGISTERED';
          badge.style.background = 'rgba(255, 0, 85, 0.2)';
          badge.style.borderColor = '#ff0055';
        }

        scoreDisp.textContent = `${score.player1Score} - ${score.player2Score}`;
        marginDisp.textContent = `${didWin ? 'Won' : 'Lost'} by ${margin} points margin (${score.targetScore} pts target rule)`;

        if (ralliesEl) ralliesEl.textContent = `${score.rallyCount}`;
        if (targetEl) targetEl.textContent = `${score.targetScore} Pts (${score.winByTwo ? 'Win by 2' : 'Direct'})`;
        if (reasonEl) reasonEl.textContent = score.lastPointReason || 'Deciding match point won';
      }

      this.victoryModalOverlay.style.display = 'flex';
    }
  }
}

