export type TennisPointWinner = 1 | 2;

export interface TennisScoreDetails {
  player1Points: number;
  player2Points: number;
  player1Games: number;
  player2Games: number;
  player1Sets: number;
  player2Sets: number;
  p1DisplayScore: string;
  p2DisplayScore: string;
  scoreboardText: string;
  isDeuce: boolean;
  isAdIn: boolean;
  isAdOut: boolean;
  isTiebreak: boolean;
  tiebreakP1: number;
  tiebreakP2: number;
  currentServer: 1 | 2;
  isSecondServe: boolean;
  serveCourtSide: 'deuce' | 'ad';
  isMatchPoint: boolean;
  isBreakPoint: boolean;
  isSetPoint: boolean;
  isGameOver: boolean;
  matchWinner: 1 | 2 | null;
  lastPointReason: string;
}

export class TennisRules {
  public p1Points = 0;
  public p2Points = 0;
  public p1Games = 0;
  public p2Games = 0;
  public p1Sets = 0;
  public p2Sets = 0;

  public currentServer: 1 | 2 = 1;
  public startingServer: 1 | 2 = 1;
  public isSecondServe = false;
  public serveCourtSide: 'deuce' | 'ad' = 'deuce';

  public isTiebreak = false;
  public tiebreakP1 = 0;
  public tiebreakP2 = 0;

  public targetGamesPerSet = 3; // 3 games for snappy arcade match, configurable
  public targetSetsToWin = 1;

  public isGameOver = false;
  public matchWinner: 1 | 2 | null = null;
  public lastPointReason = 'Ready for serve';
  public lastPointWinner: 1 | 2 | null = null;
  public rallyCount = 0;

  constructor(targetGames = 3, targetSets = 1) {
    this.targetGamesPerSet = targetGames;
    this.targetSetsToWin = targetSets;
    this.resetMatch();
  }

  public resetMatch(): void {
    this.p1Points = 0;
    this.p2Points = 0;
    this.p1Games = 0;
    this.p2Games = 0;
    this.p1Sets = 0;
    this.p2Sets = 0;
    this.currentServer = 1;
    this.startingServer = 1;
    this.isSecondServe = false;
    this.serveCourtSide = 'deuce';
    this.isTiebreak = false;
    this.tiebreakP1 = 0;
    this.tiebreakP2 = 0;
    this.isGameOver = false;
    this.matchWinner = null;
    this.lastPointReason = 'Match started. Service ready.';
    this.lastPointWinner = null;
    this.rallyCount = 0;
  }

  /**
   * Evaluates whether a ball landing is inside the correct diagonal service box on serve
   */
  public isServeInCorrectBox(x: number, z: number, server: 1 | 2): boolean {
    const singlesHalfW = 4.115;
    const serviceLineDist = 6.40;

    if (server === 1) {
      // Server 1 serves from near court (Z < 0) into far court (Z > 0)
      // Must land between net (Z = 0) and service line (Z = 6.40)
      if (z < 0 || z > serviceLineDist) return false;

      // Deuce serve (from right X > 0) lands in receiver's deuce box (X in [-4.115, 0])
      // Ad serve (from left X < 0) lands in receiver's ad box (X in [0, 4.115])
      if (this.serveCourtSide === 'deuce') {
        return x >= -singlesHalfW && x <= 0;
      } else {
        return x >= 0 && x <= singlesHalfW;
      }
    } else {
      // Server 2 serves from far court (Z > 0) into near court (Z < 0)
      // Must land between net (Z = 0) and service line (Z = -6.40)
      if (z > 0 || z < -serviceLineDist) return false;

      // Opponent deuce serve lands in player's deuce box (X in [0, 4.115])
      // Opponent ad serve lands in player's ad box (X in [-4.115, 0])
      if (this.serveCourtSide === 'deuce') {
        return x >= 0 && x <= singlesHalfW;
      } else {
        return x >= -singlesHalfW && x <= 0;
      }
    }
  }

  /**
   * Evaluates whether a rally shot is inside the regulation singles boundary
   */
  public isShotInSinglesCourt(x: number, z: number): boolean {
    const singlesHalfW = 4.115;
    const baselineDist = 11.885;
    return Math.abs(x) <= singlesHalfW && Math.abs(z) <= baselineDist;
  }

  /**
   * Awards a point to player 1 or 2 and advances tennis score state
   */
  public awardPoint(winner: TennisPointWinner, reason: string): void {
    if (this.isGameOver) return;

    this.lastPointWinner = winner;
    this.lastPointReason = reason;

    if (this.isTiebreak) {
      this.handleTiebreakPoint(winner);
      return;
    }

    if (winner === 1) {
      this.p1Points++;
    } else {
      this.p2Points++;
    }

    // Check for game resolution
    const p1 = this.p1Points;
    const p2 = this.p2Points;

    if (p1 >= 4 && p1 - p2 >= 2) {
      // Player 1 wins the game
      this.winGame(1);
    } else if (p2 >= 4 && p2 - p1 >= 2) {
      // Player 2 wins the game
      this.winGame(2);
    } else {
      // Point ended, advance service court side (alternates deuce / ad)
      const totalPoints = p1 + p2;
      this.serveCourtSide = totalPoints % 2 === 0 ? 'deuce' : 'ad';
      this.isSecondServe = false;
    }
  }

  private handleTiebreakPoint(winner: TennisPointWinner): void {
    if (winner === 1) {
      this.tiebreakP1++;
    } else {
      this.tiebreakP2++;
    }

    const t1 = this.tiebreakP1;
    const t2 = this.tiebreakP2;
    const totalPoints = t1 + t2;

    // In tiebreak, server rotates after point 1, then every 2 points
    if (totalPoints % 2 === 1) {
      this.currentServer = this.currentServer === 1 ? 2 : 1;
    }
    this.serveCourtSide = totalPoints % 2 === 0 ? 'deuce' : 'ad';
    this.isSecondServe = false;

    // First to 7 points with a 2-point margin wins tiebreak set
    if (t1 >= 7 && t1 - t2 >= 2) {
      this.p1Games++;
      this.winSet(1);
    } else if (t2 >= 7 && t2 - t1 >= 2) {
      this.p2Games++;
      this.winSet(2);
    }
  }

  private winGame(gameWinner: 1 | 2): void {
    if (gameWinner === 1) {
      this.p1Games++;
    } else {
      this.p2Games++;
    }

    // Reset game points
    this.p1Points = 0;
    this.p2Points = 0;
    this.isSecondServe = false;
    this.serveCourtSide = 'deuce';

    // Check if set won
    const g1 = this.p1Games;
    const g2 = this.p2Games;
    const target = this.targetGamesPerSet;

    if (g1 >= target && g1 - g2 >= 2) {
      this.winSet(1);
    } else if (g2 >= target && g2 - g1 >= 2) {
      this.winSet(2);
    } else if (g1 === target && g2 === target) {
      // Trigger Tiebreaker
      this.isTiebreak = true;
      this.tiebreakP1 = 0;
      this.tiebreakP2 = 0;
      this.lastPointReason = 'Games tied! Deciding 7-Point Tiebreak starts!';
    } else {
      // Rotate server for next game
      this.currentServer = this.currentServer === 1 ? 2 : 1;
      this.lastPointReason = `Game won by ${gameWinner === 1 ? 'Player' : 'Opponent'}! (${g1} - ${g2})`;
    }
  }

  private winSet(setWinner: 1 | 2): void {
    if (setWinner === 1) {
      this.p1Sets++;
    } else {
      this.p2Sets++;
    }

    this.isTiebreak = false;
    this.tiebreakP1 = 0;
    this.tiebreakP2 = 0;

    if (this.p1Sets >= this.targetSetsToWin) {
      this.isGameOver = true;
      this.matchWinner = 1;
      this.lastPointReason = 'Championship Point Won! Match Victory!';
    } else if (this.p2Sets >= this.targetSetsToWin) {
      this.isGameOver = true;
      this.matchWinner = 2;
      this.lastPointReason = 'Match Defeat registered. Opponent claims victory.';
    } else {
      // Start next set
      this.p1Games = 0;
      this.p2Games = 0;
      this.currentServer = this.currentServer === 1 ? 2 : 1;
      this.lastPointReason = `Set won by ${setWinner === 1 ? 'Player' : 'Opponent'}! Starting next set.`;
    }
  }

  /**
   * Returns current tennis point score as formatted string (0, 15, 30, 40, Deuce, Ad)
   */
  public getPointDisplay(): { p1: string; p2: string; status: string } {
    if (this.isTiebreak) {
      return {
        p1: `${this.tiebreakP1}`,
        p2: `${this.tiebreakP2}`,
        status: `TIEBREAK (${this.tiebreakP1} - ${this.tiebreakP2})`
      };
    }

    const p1 = this.p1Points;
    const p2 = this.p2Points;

    if (p1 >= 3 && p2 >= 3) {
      if (p1 === p2) {
        return { p1: '40', p2: '40', status: 'DEUCE' };
      } else if (p1 > p2) {
        const isServerAd = this.currentServer === 1;
        return { p1: 'AD', p2: '40', status: isServerAd ? 'AD-IN' : 'AD-OUT' };
      } else {
        const isServerAd = this.currentServer === 2;
        return { p1: '40', p2: 'AD', status: isServerAd ? 'AD-IN' : 'AD-OUT' };
      }
    }

    const scores = ['0', '15', '30', '40'];
    const p1Str = scores[Math.min(3, p1)] ?? '0';
    const p2Str = scores[Math.min(3, p2)] ?? '0';
    return { p1: p1Str, p2: p2Str, status: `${p1Str} - ${p2Str}` };
  }

  public getScoreDetails(): TennisScoreDetails {
    const pt = this.getPointDisplay();
    const isDeuce = pt.status === 'DEUCE';
    const isAdIn = pt.status === 'AD-IN';
    const isAdOut = pt.status === 'AD-OUT';

    // Break point check: receiver is 1 point away from winning game
    let isBreakPoint = false;
    let isMatchPoint = false;
    let isSetPoint = false;

    if (!this.isGameOver) {
      if (this.isTiebreak) {
        if (this.tiebreakP1 >= 6 && this.tiebreakP1 > this.tiebreakP2) isMatchPoint = true;
        if (this.tiebreakP2 >= 6 && this.tiebreakP2 > this.tiebreakP1) isMatchPoint = true;
      } else {
        const isP1Serving = this.currentServer === 1;
        if (isP1Serving && (this.p2Points >= 3 && this.p2Points > this.p1Points)) {
          isBreakPoint = true;
        } else if (!isP1Serving && (this.p1Points >= 3 && this.p1Points > this.p2Points)) {
          isBreakPoint = true;
        }

        // Set & Match point
        if (this.p1Games === this.targetGamesPerSet - 1 && this.p1Points >= 3 && this.p1Points > this.p2Points) {
          isSetPoint = true;
          if (this.p1Sets === this.targetSetsToWin - 1) isMatchPoint = true;
        }
        if (this.p2Games === this.targetGamesPerSet - 1 && this.p2Points >= 3 && this.p2Points > this.p1Points) {
          isSetPoint = true;
          if (this.p2Sets === this.targetSetsToWin - 1) isMatchPoint = true;
        }
      }
    }

    const scoreboardText = `${this.p1Games}-${this.p2Games} (${pt.status})`;

    return {
      player1Points: this.p1Points,
      player2Points: this.p2Points,
      player1Games: this.p1Games,
      player2Games: this.p2Games,
      player1Sets: this.p1Sets,
      player2Sets: this.p2Sets,
      p1DisplayScore: pt.p1,
      p2DisplayScore: pt.p2,
      scoreboardText,
      isDeuce,
      isAdIn,
      isAdOut,
      isTiebreak: this.isTiebreak,
      tiebreakP1: this.tiebreakP1,
      tiebreakP2: this.tiebreakP2,
      currentServer: this.currentServer,
      isSecondServe: this.isSecondServe,
      serveCourtSide: this.serveCourtSide,
      isMatchPoint,
      isBreakPoint,
      isSetPoint,
      isGameOver: this.isGameOver,
      matchWinner: this.matchWinner,
      lastPointReason: this.lastPointReason
    };
  }
}
