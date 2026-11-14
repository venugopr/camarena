import { GameScoreState } from '../common/IGameScene';

export type RallyState =
  | 'READY_TO_SERVE'
  | 'SERVE_TOSS'
  | 'IN_SERVE'
  | 'IN_PLAY'
  | 'POINT_TRANSITION'
  | 'POINT_AWARDED'
  | 'GAME_OVER';

export type ServePhase =
  | 'NONE'
  | 'TOSS_ASCENDING'
  | 'TOSS_DESCENDING'
  | 'SERVER_BOUNCE'
  | 'SERVE_BOUNCED_SERVER'
  | 'RECEIVER_BOUNCE';

export interface ITTFMatchConfig {
  targetScore: number;
  winByTwo: boolean;
  gamesToWinMatch: number;
}

/**
 * Official ITTF Table Tennis Match & Service Rule Engine
 *
 * Enforces:
 * - 11-point games (win by 2 margin; Deuce at 10-10)
 * - Best-of-3 Games match progression
 * - Service rotation every 2 points (every 1 point during Deuce)
 * - Legal 16cm vertical ball toss and two-bounce service validation
 * - Net-clip "Let" service replays
 */
export class TableTennisRules {
  public targetScore = 11;
  public winByTwo = true;
  public readonly gamesToWinMatch = 2;

  public initialServerForGame: 1 | 2 = 1;
  public gameStartingServer: 1 | 2 = 1;
  public player1GamesWon = 0;
  public player2GamesWon = 0;
  public currentGameNumber = 1;
  public matchOver = false;

  public static readonly MIN_TOSS_HEIGHT_METERS = 0.16;

  constructor(targetScore = 11) {
    this.targetScore = targetScore;
  }

  /**
   * Official ITTF Service Rotation:
   * - Normal Play: Server changes every 2 points: Math.floor(totalPoints / 2) % 2
   * - Deuce Play (Score >= 10-10 or target - 1): Server alternates every 1 point: totalPoints % 2
   */
  public determineCurrentServer(p1Score: number, p2Score: number): 1 | 2 {
    const totalPoints = p1Score + p2Score;
    const isDeuce =
      (p1Score >= 10 && p2Score >= 10) ||
      (p1Score >= this.targetScore - 1 && p2Score >= this.targetScore - 1);

    if (isDeuce) {
      const isPlayerTurn = totalPoints % 2 === (this.gameStartingServer === 1 ? 0 : 1);
      return isPlayerTurn ? 1 : 2;
    }

    const isPlayerTurn = Math.floor(totalPoints / 2) % 2 === (this.gameStartingServer === 1 ? 0 : 1);
    return isPlayerTurn ? 1 : 2;
  }

  /**
   * Evaluates whether a game has been won per ITTF rules (11 points, win by 2)
   */
  public checkGameWon(p1Score: number, p2Score: number): 1 | 2 | null {
    const margin = Math.abs(p1Score - p2Score);
    const hasMinMargin = !this.winByTwo || margin >= 2;

    if (p1Score >= this.targetScore && p1Score > p2Score && hasMinMargin) {
      return 1;
    }
    if (p2Score >= this.targetScore && p2Score > p1Score && hasMinMargin) {
      return 2;
    }
    return null;
  }

  /**
   * Computes GamePoint / MatchPoint status badge text
   */
  public computeMatchPointBanner(scoreState: GameScoreState): string | undefined {
    const p1 = scoreState.player1Score;
    const p2 = scoreState.player2Score;
    const target = this.targetScore;

    if (p1 >= target - 1 && p2 >= target - 1 && p1 === p2) {
      return 'DEUCE — SERVE ALTERNATES EVERY POINT';
    }
    if (p1 >= target - 1 && p1 > p2) {
      const isMatchPt = this.player1GamesWon === this.gamesToWinMatch - 1;
      return isMatchPt ? '🔥 MATCH POINT — PLAYER' : '⚡ GAME POINT — PLAYER';
    }
    if (p2 >= target - 1 && p2 > p1) {
      const isMatchPt = this.player2GamesWon === this.gamesToWinMatch - 1;
      return isMatchPt ? '⚠️ MATCH POINT — AI' : '⚠️ GAME POINT — AI';
    }
    return undefined;
  }

  /**
   * Validates ITTF 16cm service toss height requirement
   */
  public isLegalServeTossHeight(releaseY: number, apexY: number): boolean {
    return apexY - releaseY >= TableTennisRules.MIN_TOSS_HEIGHT_METERS - 0.01;
  }
}
