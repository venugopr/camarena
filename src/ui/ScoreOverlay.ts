import { GameScoreState } from '../core/scene/IGameScene';
import { GameSceneManager } from '../core/scene/GameSceneManager';

export class ScoreOverlay {
  private container: HTMLElement;
  private sceneManager: GameSceneManager;

  private scoreHud!: HTMLElement;
  private p1ScoreText!: HTMLElement;
  private p2ScoreText!: HTMLElement;
  private rallyBadge!: HTMLElement;
  private serverDot!: HTMLElement;
  private modalOverlay!: HTMLElement;

  constructor(container: HTMLElement, sceneManager: GameSceneManager) {
    this.container = container;
    this.sceneManager = sceneManager;
    this.buildDOM();
    this.bindEvents();
  }

  private buildDOM(): void {
    // Scoreboard Panel
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
    this.serverDot.title = 'Server';
    this.rallyBadge = document.createElement('span');
    this.rallyBadge.className = 'rally-badge';
    this.rallyBadge.textContent = 'RALLY: 0';
    divider.appendChild(this.serverDot);
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
    this.container.appendChild(this.scoreHud);

    // Victory / Game Over Modal
    this.modalOverlay = document.createElement('div');
    this.modalOverlay.className = 'modal-overlay';
    this.modalOverlay.style.display = 'none';

    const modal = document.createElement('div');
    modal.className = 'victory-modal glass-panel';
    modal.innerHTML = `
      <h2 class="victory-title" id="victory-title">MATCH WON! 🏆</h2>
      <div class="victory-score-display" id="victory-score">11 - 8</div>
      <button class="icon-btn primary" id="btn-rematch" style="padding: 12px 28px; font-size: 1rem;">
        Play Next Match 🚀
      </button>
    `;

    this.modalOverlay.appendChild(modal);
    this.container.appendChild(this.modalOverlay);

    const rematchBtn = modal.querySelector('#btn-rematch') as HTMLButtonElement;
    rematchBtn.onclick = () => {
      this.modalOverlay.style.display = 'none';
      this.sceneManager.resetCurrentGame();
    };
  }

  private bindEvents(): void {
    this.sceneManager.onScoreChange((score: GameScoreState) => {
      this.updateScore(score);
    });

    this.sceneManager.onSceneChange((sceneId: string) => {
      // If sandbox mode, customize label
      if (sceneId === 'sandbox') {
        this.scoreHud.style.display = 'none';
      } else {
        this.scoreHud.style.display = 'flex';
      }
      this.modalOverlay.style.display = 'none';
    });
  }

  private updateScore(score: GameScoreState): void {
    this.p1ScoreText.textContent = `${score.player1Score}`;
    this.p2ScoreText.textContent = `${score.player2Score}`;
    this.rallyBadge.textContent = `RALLY: ${score.rallyCount}`;

    // Position server indicator dot towards active server
    if (score.currentServer === 1) {
      this.serverDot.style.transform = 'translateX(-18px)';
    } else {
      this.serverDot.style.transform = 'translateX(18px)';
    }

    if (score.isGameOver) {
      const title = document.getElementById('victory-title');
      const scoreDisp = document.getElementById('victory-score');

      if (title && scoreDisp) {
        const didWin = score.winner === 1;
        title.textContent = didWin ? 'VICTORY! 🏆' : 'DEFEAT ⚡';
        title.style.color = didWin ? '#00f2fe' : '#ff0055';
        scoreDisp.textContent = `${score.player1Score} - ${score.player2Score}`;
      }
      this.modalOverlay.style.display = 'flex';
    }
  }
}
