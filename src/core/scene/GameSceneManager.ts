import { IGameScene, GameScoreState } from './IGameScene';
import {
  GameModeId,
  OpponentMode,
  DifficultyLevel,
  MotionFrame,
  ActionEvent
} from '../motion/Types';
import { SoundSynthesizer } from '../audio/SoundSynthesizer';

export class GameSceneManager {
  private container: HTMLElement;
  private audio: SoundSynthesizer;
  private scenes: Map<GameModeId, IGameScene> = new Map();
  private activeScene: IGameScene | null = null;
  private activeSceneId: GameModeId | null = null;

  private opponentMode: OpponentMode = 'system';
  private difficulty: DifficultyLevel = 'casual';
  private targetScore: number = 11;
  private isPaused: boolean = false;

  private scoreChangeCallbacks: ((score: GameScoreState) => void)[] = [];
  private sceneChangeCallbacks: ((sceneId: GameModeId, title: string) => void)[] = [];
  private pauseChangeCallbacks: ((isPaused: boolean) => void)[] = [];
  private scoreUnsubscribe: (() => void) | null = null;

  constructor(container: HTMLElement, audio: SoundSynthesizer) {
    this.container = container;
    this.audio = audio;

    window.addEventListener('resize', () => {
      if (this.activeScene) {
        this.activeScene.onResize(this.container.clientWidth, this.container.clientHeight);
      }
    });

    // Global Pause shortcut keys: Escape and P
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
        // Prevent default only if not typing in an input
        if ((e.target as HTMLElement)?.tagName !== 'INPUT') {
          this.togglePause();
        }
      }
    });
  }

  public registerScene(scene: IGameScene): void {
    this.scenes.set(scene.id, scene);
  }

  public getActiveScene(): IGameScene | null {
    return this.activeScene;
  }

  public getActiveSceneId(): GameModeId | null {
    return this.activeSceneId;
  }

  public setOpponentMode(mode: OpponentMode): void {
    this.opponentMode = mode;
    if (this.activeSceneId) {
      this.switchScene(this.activeSceneId);
    }
  }

  public getOpponentMode(): OpponentMode {
    return this.opponentMode;
  }

  public setDifficulty(diff: DifficultyLevel): void {
    this.difficulty = diff;
    if (this.activeSceneId) {
      this.switchScene(this.activeSceneId);
    }
  }

  public getDifficulty(): DifficultyLevel {
    return this.difficulty;
  }

  public setTargetScore(target: number): void {
    this.targetScore = target;
    if (this.activeScene && this.activeScene.setTargetScore) {
      this.activeScene.setTargetScore(target);
    }
  }

  public getTargetScore(): number {
    return this.targetScore;
  }

  public isGamePaused(): boolean {
    return this.isPaused;
  }

  public pause(): void {
    if (this.isPaused) return;
    this.isPaused = true;
    if (this.activeScene) {
      this.activeScene.pause();
    }
    for (const cb of this.pauseChangeCallbacks) {
      cb(true);
    }
  }

  public resume(): void {
    if (!this.isPaused) return;
    this.isPaused = false;
    if (this.activeScene) {
      this.activeScene.resume();
    }
    for (const cb of this.pauseChangeCallbacks) {
      cb(false);
    }
  }

  public togglePause(): void {
    if (this.isPaused) {
      this.resume();
    } else {
      this.pause();
    }
  }

  public onPauseChange(cb: (isPaused: boolean) => void): () => void {
    this.pauseChangeCallbacks.push(cb);
    return () => {
      this.pauseChangeCallbacks = this.pauseChangeCallbacks.filter(c => c !== cb);
    };
  }

  public async switchScene(sceneId: GameModeId): Promise<void> {
    const nextScene = this.scenes.get(sceneId);
    if (!nextScene) {
      console.error(`Scene with id "${sceneId}" is not registered.`);
      return;
    }

    // Unpause when switching scenes
    this.isPaused = false;
    for (const cb of this.pauseChangeCallbacks) {
      cb(false);
    }

    // Smooth transition if another scene was running
    if (this.activeScene) {
      this.container.classList.add('fading-out');
      await new Promise(resolve => setTimeout(resolve, 180));
    }

    // Cleanup previous scene
    if (this.scoreUnsubscribe) {
      this.scoreUnsubscribe();
      this.scoreUnsubscribe = null;
    }

    if (this.activeScene) {
      this.activeScene.destroy();
      this.activeScene = null;
    }

    this.container.innerHTML = '';
    this.activeSceneId = sceneId;
    this.activeScene = nextScene;

    await nextScene.init(this.container, this.audio, {
      opponentMode: this.opponentMode,
      difficulty: this.difficulty,
      targetScore: this.targetScore
    });

    if (nextScene.setTargetScore) {
      nextScene.setTargetScore(this.targetScore);
    }

    nextScene.start();

    // Smooth fade-in
    requestAnimationFrame(() => {
      this.container.classList.remove('fading-out');
    });

    if (nextScene.onScoreChange) {
      this.scoreUnsubscribe = nextScene.onScoreChange((score) => {
        for (const cb of this.scoreChangeCallbacks) {
          cb(score);
        }
      });
      // Initial score emit
      const initialScore = nextScene.getScore();
      for (const cb of this.scoreChangeCallbacks) {
        cb(initialScore);
      }
    }

    for (const cb of this.sceneChangeCallbacks) {
      cb(sceneId, nextScene.title);
    }
  }

  public update(deltaTime: number, motionFrame: MotionFrame | null): void {
    if (this.activeScene) {
      // When paused: freeze simulation physics time (deltaTime = 0)
      // but continue passing motionFrame so player skeleton and tracking remain live!
      const effectiveDt = this.isPaused ? 0 : deltaTime;
      this.activeScene.update(effectiveDt, motionFrame);
    }
  }

  public onAction(event: ActionEvent): void {
    // Ignore gameplay hit actions while paused
    if (this.isPaused) return;

    if (this.activeScene) {
      this.activeScene.onAction(event);
    }
  }

  public onScoreChange(cb: (score: GameScoreState) => void): () => void {
    this.scoreChangeCallbacks.push(cb);
    return () => {
      this.scoreChangeCallbacks = this.scoreChangeCallbacks.filter(c => c !== cb);
    };
  }

  public onSceneChange(cb: (sceneId: GameModeId, title: string) => void): () => void {
    this.sceneChangeCallbacks.push(cb);
    return () => {
      this.sceneChangeCallbacks = this.sceneChangeCallbacks.filter(c => c !== cb);
    };
  }

  public resetCurrentGame(): void {
    if (this.activeScene) {
      this.activeScene.reset();
    }
    // Resume when restarting
    if (this.isPaused) {
      this.resume();
    }
  }
}

