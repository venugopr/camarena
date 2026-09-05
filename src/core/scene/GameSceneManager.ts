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

  private scoreChangeCallbacks: ((score: GameScoreState) => void)[] = [];
  private sceneChangeCallbacks: ((sceneId: GameModeId, title: string) => void)[] = [];
  private scoreUnsubscribe: (() => void) | null = null;

  constructor(container: HTMLElement, audio: SoundSynthesizer) {
    this.container = container;
    this.audio = audio;

    window.addEventListener('resize', () => {
      if (this.activeScene) {
        this.activeScene.onResize(this.container.clientWidth, this.container.clientHeight);
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

  public async switchScene(sceneId: GameModeId): Promise<void> {
    const nextScene = this.scenes.get(sceneId);
    if (!nextScene) {
      console.error(`Scene with id "${sceneId}" is not registered.`);
      return;
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
      difficulty: this.difficulty
    });

    nextScene.start();

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
      this.activeScene.update(deltaTime, motionFrame);
    }
  }

  public onAction(event: ActionEvent): void {
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
  }
}
