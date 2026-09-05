import {
  GameModeId,
  OpponentMode,
  DifficultyLevel,
  MotionFrame,
  ActionEvent
} from '../motion/Types';
import { SoundSynthesizer } from '../audio/SoundSynthesizer';

export interface GameScoreState {
  player1Score: number;
  player2Score: number;
  currentServer: 1 | 2;
  rallyCount: number;
  isGameOver: boolean;
  winner: 1 | 2 | null;
  lastPointWinner: 1 | 2 | null;
}

export interface IGameScene {
  readonly id: GameModeId;
  readonly title: string;

  init(
    container: HTMLElement,
    audio: SoundSynthesizer,
    config?: { opponentMode: OpponentMode; difficulty: DifficultyLevel }
  ): Promise<void> | void;

  start(): void;
  pause(): void;
  resume(): void;
  reset(): void;

  update(deltaTime: number, motionFrame: MotionFrame | null): void;
  onAction(event: ActionEvent): void;
  onResize(width: number, height: number): void;

  getScore(): GameScoreState;
  onScoreChange?(callback: (score: GameScoreState) => void): () => void;

  destroy(): void;
}
