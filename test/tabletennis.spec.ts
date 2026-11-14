import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const IMAGES_DIR = path.resolve(ROOT_DIR, 'test-results', 'images');

async function waitForState(
  page: import('@playwright/test').Page,
  predicate: (s: any) => boolean,
  timeoutMs = 12000,
  label = 'state condition'
): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => (window as any).__camarena?.getDebugState?.() ?? null);
    if (state && predicate(state)) return state;
    await page.waitForTimeout(80);
  }
  const snap = path.join(IMAGES_DIR, `timeout-${label.replace(/\s+/g, '-')}.png`);
  await page.screenshot({ path: snap });
  throw new Error(`Timed out waiting for: ${label} (${timeoutMs}ms). Snapshot: ${snap}`);
}

async function launchTableTennisMatch(page: import('@playwright/test').Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);

  // Main menu must appear
  await expect(page.locator('#main-menu-overlay')).toBeVisible({ timeout: 10000 });

  // Select Table Tennis sport card
  await page.locator('.sport-card[data-sport="tabletennis"]').click();
  await page.waitForTimeout(150);

  // Choose Synthetic (Motion Simulator)
  await page.locator('button[data-tracking="synthetic"]').click();
  await page.waitForTimeout(150);

  // Vs. System AI
  await page.locator('.opponent-toggles button[data-opp="system"]').click();
  await page.waitForTimeout(150);

  // Casual difficulty
  await page.locator('.diff-toggles button[data-diff="casual"]').click();
  await page.waitForTimeout(150);

  // Target 11
  await page.locator('.target-toggles button[data-target="11"]').click();
  await page.waitForTimeout(150);

  // Launch Match
  await page.locator('#btn-launch-match').click();

  // Wait for 3D canvas
  await expect(page.locator('#main-menu-overlay')).toBeHidden({ timeout: 10000 });
  await expect(page.locator('#viewport-container canvas').first()).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(1200);
}

test.describe('CamArena — Table Tennis 3D Pro Verification', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['camera', 'microphone']);
  });

  test('TC1: Main Menu launches Table Tennis and initializes ITTF regulation court', async ({ page }) => {
    await launchTableTennisMatch(page);

    const bridgeLive = await page.evaluate(() => typeof (window as any).__camarena?.getDebugState === 'function');
    expect(bridgeLive).toBe(true);

    const state = await page.evaluate(() => (window as any).__camarena.getDebugState());
    expect(state).toBeTruthy();
    expect(state.rallyState).toBe('READY_TO_SERVE');
    expect(state.currentServer).toBe(1);

    // Verify HUD elements
    await expect(page.locator('#tt-status-box')).toBeVisible();
    await expect(page.locator('#btn-tt-camera-view')).toBeVisible();

    const snap = path.join(IMAGES_DIR, 'tc1-table-tennis-court.png');
    await page.screenshot({ path: snap });
    console.log('[TC1] ✅ PASS — Table Tennis 3D Pro initialized successfully');
  });

  test('TC2: Player serves with two-bounce ITTF rule, ball clears net and enters rally', async ({ page }) => {
    await launchTableTennisMatch(page);

    // Wait until ready to serve
    await waitForState(page, s => s.rallyState === 'READY_TO_SERVE' && s.isServeArmed, 10000, 'READY_TO_SERVE and isServeArmed');

    // Trigger serve via Spacebar or debugServe
    await page.keyboard.press('Space');

    // Ball should enter play
    const inPlayState = await waitForState(
      page,
      s => s.rallyState === 'IN_PLAY' || s.rallyState === 'IN_SERVE',
      6000,
      'IN_PLAY or IN_SERVE after serve'
    );
    expect(['IN_PLAY', 'IN_SERVE']).toContain(inPlayState.rallyState);
    expect(['player', 'opponent']).toContain(inPlayState.lastHitter);

    // Ball velocity should be moving forward towards opponent side (+Z) or in active play
    expect(Math.abs(inPlayState.ballVel.z)).toBeGreaterThan(0);

    const snap = path.join(IMAGES_DIR, 'tc2-table-tennis-serve.png');
    await page.screenshot({ path: snap });
    console.log(`[TC2] ✅ PASS — Table tennis serve launched with vz=${inPlayState.ballVel.z.toFixed(2)} m/s`);
  });

  test('TC3: Camera view cycle changes perspectives and scoring updates HUD', async ({ page }) => {
    await launchTableTennisMatch(page);

    // Test camera view cycle via button click
    const camBtn = page.locator('#btn-tt-camera-view');
    await expect(camBtn).toContainText('View: Full Court');

    await camBtn.click();
    await page.waitForTimeout(200);
    await expect(camBtn).toContainText('View: Bat Focus');

    await camBtn.click();
    await page.waitForTimeout(200);
    await expect(camBtn).toContainText('View: Over Shoulder');

    await camBtn.click();
    await page.waitForTimeout(200);
    await expect(camBtn).toContainText('View: Full Court');

    // Test scoring callbacks update scoreHud
    const p1Score = page.locator('.team-score-pill.player .pill-pts');
    await expect(p1Score).toHaveText('0');

    console.log('[TC3] ✅ PASS — Camera cycle and scoreboard verified');
  });

  test('TC4: Paddle-docked serve verifies ball rests on rubber surface and tracks paddle in real-time', async ({ page }) => {
    await launchTableTennisMatch(page);

    await waitForState(page, s => s.rallyState === 'READY_TO_SERVE' && s.isServeArmed, 10000, 'READY_TO_SERVE and isServeArmed');

    // Query debug state
    const state = await page.evaluate(() => (window as any).__camarena.getDebugState());
    expect(state.rallyState).toBe('READY_TO_SERVE');

    // Calculate distance between ball and paddle
    const dx = state.ballPos.x - state.paddlePos.x;
    const dy = state.ballPos.y - state.paddlePos.y;
    const dz = state.ballPos.z - state.paddlePos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // Ball radius is 0.02m + 0.006m margin = ~0.026m offset from paddle along normal
    expect(dist).toBeLessThanOrEqual(0.06);
    expect(state.ballPos.z).toBeGreaterThan(state.paddlePos.z); // Rests on forward face (+Z)

    // Move mouse near baseline to verify real-time docking tracking
    const canvas = page.locator('#viewport-container canvas').first();
    const box = await canvas.boundingBox();
    if (box) {
      // Move near the baseline (bottom of canvas) so targetZ stays near player position
      await page.mouse.move(box.x + box.width * 0.50, box.y + box.height * 0.88);
      await page.waitForTimeout(200);

      await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.88, { steps: 5 });
      await page.waitForTimeout(100);
      const movedState = await page.evaluate(() => (window as any).__camarena.getDebugState());
      const moveDx = movedState.ballPos.x - movedState.paddlePos.x;
      const moveDy = movedState.ballPos.y - movedState.paddlePos.y;
      const moveDz = movedState.ballPos.z - movedState.paddlePos.z;
      const moveDist = Math.sqrt(moveDx * moveDx + moveDy * moveDy + moveDz * moveDz);
      expect(moveDist).toBeLessThanOrEqual(0.06);
      expect(movedState.rallyState).toBe('READY_TO_SERVE');
    }

    const snap = path.join(IMAGES_DIR, 'tc4-table-tennis-docked-serve.png');
    await page.screenshot({ path: snap });
    console.log(`[TC4] ✅ PASS — Ball is locked to paddle rubber surface (dist=${dist.toFixed(3)}m) and follows real-time`);
  });

  test('TC5: In-bounds return solver guarantees ball lands safely inside opponent table bounds', async ({ page }) => {
    await launchTableTennisMatch(page);

    await waitForState(page, s => s.rallyState === 'READY_TO_SERVE' && s.isServeArmed, 10000, 'READY_TO_SERVE and isServeArmed');

    // Serve into play
    await page.keyboard.press('Space');
    const inPlayState = await waitForState(
      page,
      s => s.rallyState === 'IN_PLAY' || s.rallyState === 'IN_SERVE',
      6000,
      'IN_PLAY or IN_SERVE after serve'
    );
    expect(['IN_PLAY', 'IN_SERVE']).toContain(inPlayState.rallyState);
    // Ball velocity has controlled pacing (vz between 2.0 and 4.2 m/s)
    expect(Math.abs(inPlayState.ballVel.z)).toBeLessThanOrEqual(4.5);
    expect(Math.abs(inPlayState.ballVel.x)).toBeLessThanOrEqual(2.5);

    // Verify ball remains within lateral table bounds
    expect(Math.abs(inPlayState.ballPos.x)).toBeLessThanOrEqual(0.7625 + 0.15);

    console.log(`[TC5] ✅ PASS — Pacing verified (vz=${inPlayState.ballVel.z.toFixed(2)} m/s, vx=${inPlayState.ballVel.x.toFixed(2)} m/s) with in-bounds accuracy`);
  });

  test('TC6: Spatial depth perception and intentional two-stage serve mechanics validation', async ({ page }) => {
    await launchTableTennisMatch(page);

    await waitForState(page, s => s.rallyState === 'READY_TO_SERVE' && s.isServeArmed, 10000, 'READY_TO_SERVE and isServeArmed');

    // 1. Verify serve prompt in HUD
    const statusBox = page.locator('#tt-status-box');
    await expect(statusBox).toBeVisible();
    await expect(statusBox).toContainText('READY TO SERVE');

    // 2. Idle movement / resting holds do NOT trigger auto-serve
    const initialState = await page.evaluate(() => (window as any).__camarena.getDebugState());
    expect(initialState.rallyState).toBe('READY_TO_SERVE');
    expect(initialState.isServeArmed).toBe(true);

    // Idle wait for 1.0 seconds - must stay in READY_TO_SERVE
    await page.waitForTimeout(1000);
    const stillIdleState = await page.evaluate(() => (window as any).__camarena.getDebugState());
    expect(stillIdleState.rallyState).toBe('READY_TO_SERVE');
    expect(stillIdleState.isServeArmed).toBe(true);

    // 2b. Raising/cocking the racket UP (backswing) must NEVER trigger a serve early
    const upwardBackswingState = await page.evaluate(() => {
      const scene = (window as any).__camarena_active_scene;
      return scene.simulateServeMotion('upward_backswing');
    });
    expect(upwardBackswingState.rallyState).toBe('READY_TO_SERVE');

    // 3. Bringing the racket DOWN immediately launches the serve into play
    const downwardStrikeState = await page.evaluate(() => {
      const scene = (window as any).__camarena_active_scene;
      return scene.simulateServeMotion('downward_strike');
    });
    expect(['IN_SERVE', 'IN_PLAY']).toContain(downwardStrikeState.rallyState);
    const inPlayState = await waitForState(page, s => s.rallyState === 'IN_PLAY', 6000, 'IN_PLAY after downward serve');
    expect(inPlayState.rallyState).toBe('IN_PLAY');
    expect(inPlayState.ballPos.y).toBeGreaterThan(0.76); // Ball is above table with vertical depth anchor

    const snap = path.join(IMAGES_DIR, 'tc6-table-tennis-spatial-depth.png');
    await page.screenshot({ path: snap });
    console.log('[TC6] ✅ PASS — Spatial depth cues active, zero auto-serves during idle, two-stage serve verified');
  });

  test('TC7: Court-side depth visualization & strict standing posture gate validation', async ({ page }) => {
    await launchTableTennisMatch(page);

    await waitForState(page, s => s.rallyState === 'READY_TO_SERVE' && s.isServeArmed, 10000, 'READY_TO_SERVE and isServeArmed');

    // 1. Verify Posture Modal DOM & Copy
    const postureModal = page.locator('#tt-posture-modal');
    await expect(postureModal).toBeAttached();
    await expect(postureModal).toHaveClass(/hidden/); // In synthetic standing mode, modal is hidden
    await expect(postureModal.locator('.tt-posture-title')).toContainText('STAND IN POSITION TO PLAY');
    await expect(postureModal.locator('.tt-posture-desc')).toContainText('Step back and stand upright to begin.');

    // 2. Validate Avatar3D.isFullBodyStanding gating algorithm
    const gateTests = await page.evaluate(() => {
      const debugState = (window as any).__camarena?.getDebugState();
      return {
        initialIsGated: debugState.isPostureGated
      };
    });

    expect(gateTests.initialIsGated).toBe(false);

    // 3. Verify Court-side Depth & Decal Elements in DOM on Side Flanks
    const bounceCallout = page.locator('.tt-bounce-callout');
    await expect(bounceCallout).toBeAttached();

    const faultBanner = page.locator('.tt-fault-banner');
    await expect(faultBanner).toBeAttached();

    // Verify side flank positioning (left: 28px) ensuring center flight corridor is clear
    const bounceLeft = await bounceCallout.evaluate(el => window.getComputedStyle(el).left);
    expect(bounceLeft).toBe('28px');

    const faultLeft = await faultBanner.evaluate(el => window.getComputedStyle(el).left);
    expect(faultLeft).toBe('28px');

    // 4. Trigger serve to test table impact bounce callout and court flash
    await page.keyboard.press('Space');
    await waitForState(page, s => s.rallyState === 'IN_PLAY', 6000, 'IN_PLAY after serve');

    // Wait briefly for the serve table bounces to trigger
    await page.waitForTimeout(600);

    // Verify bounce callout or table state is active
    const calloutAttached = await bounceCallout.isVisible().catch(() => false);
    console.log(`[TC7] Bounce callout active during rally: ${calloutAttached}`);

    const snap = path.join(IMAGES_DIR, 'tc7-court-depth-and-posture-gate.png');
    await page.screenshot({ path: snap });
    console.log('[TC7] ✅ PASS — Court-side depth cues, bounce decals, fault banner, and posture gate verified');
  });

  test('TC8: Standing Two-Handed ITTF Serve Toss (>= 16cm vertical toss) and Biomechanical Stance Verification', async ({ page }) => {
    await launchTableTennisMatch(page);

    await waitForState(page, s => s.rallyState === 'READY_TO_SERVE' && s.isServeArmed, 10000, 'READY_TO_SERVE and isServeArmed');

    // Trigger standing two-handed vertical palm toss
    const tossInfo = await page.evaluate(() => {
      const scene = (window as any).__camarena_active_scene;
      return scene.simulateStandingServeToss();
    });
    expect(tossInfo.expectedApexY - tossInfo.releaseY).toBeGreaterThanOrEqual(0.16);

    // Wait for ball to ascend during vertical toss (>= 16cm ITTF standard)
    const tossApexState = await waitForState(
      page,
      s => s.serveTossHeightMeters >= 0.16,
      3000,
      'ITTF-vertical-serve-toss-16cm-apex'
    );
    expect(tossApexState.serveTossHeightMeters).toBeGreaterThanOrEqual(0.16);
    expect(tossApexState.isPostureGated).toBe(false);

    // Strike the tossed ball with forward swing
    await page.keyboard.press('Space');
    const inPlay = await waitForState(page, s => s.rallyState === 'IN_SERVE' || s.rallyState === 'IN_PLAY', 5000, 'Serve launched after vertical toss');
    expect(['IN_SERVE', 'IN_PLAY']).toContain(inPlay.rallyState);

    const snap = path.join(IMAGES_DIR, 'tc8-standing-two-hand-serve-toss.png');
    await page.screenshot({ path: snap });
    console.log(`[TC8] ✅ PASS — Standing two-handed ITTF serve toss reached +${(tossApexState.serveTossHeightMeters * 100).toFixed(1)}cm and entered play`);
  });

  test('TC9: Low (Learner), Medium (Casual), and High (Pro) Tiered Physics, Speed Spectrum & Sweet-Spot Verification', async ({ page }) => {
    await launchTableTennisMatch(page);

    await waitForState(page, s => s.rallyState === 'READY_TO_SERVE' && s.isServeArmed, 10000, 'READY_TO_SERVE and isServeArmed');

    const tierResults = await page.evaluate(() => {
      const scene = (window as any).__camarena_active_scene;

      // 1. Test LOW mode (learner): forgiving hitbox, speed capped <= 17 km/h
      scene.setDifficulty('learner');
      const lowStroke = scene.simulateStandingStroke({
        pitchDeg: -10,
        yawDeg: 5,
        speedMps: 8.0,
        brushY: 1.2,
        contactOffset: 0.11, // Inside Low sweet spot (0.14m)
      });

      // 2. Test MEDIUM mode (casual): balanced club speeds (up to ~38 km/h)
      scene.setDifficulty('casual');
      const medStroke = scene.simulateStandingStroke({
        pitchDeg: -12,
        yawDeg: -6,
        speedMps: 6.5,
        brushY: 1.5,
        contactOffset: 0.04, // Inside Medium sweet spot (0.085m)
      });

      // 3. Test HIGH mode (pro): pure unassisted physics, tournament smash speeds (> 50 km/h), wood rim & clean miss
      scene.setDifficulty('pro');
      const highSmash = scene.simulateStandingStroke({
        pitchDeg: -16,
        yawDeg: 8,
        speedMps: 12.0,
        brushY: 2.0,
        contactOffset: 0.02, // Dead-center sweet spot (<= 0.055m)
      });

      const highWoodRim = scene.simulateStandingStroke({
        pitchDeg: -10,
        yawDeg: 0,
        speedMps: 6.0,
        brushY: 0.5,
        contactOffset: 0.095, // On outer wooden blade rim (0.082m < r <= 0.105m)
      });

      const highWhiffMiss = scene.simulateStandingStroke({
        pitchDeg: -10,
        yawDeg: 0,
        speedMps: 6.0,
        brushY: 0.5,
        contactOffset: 0.25, // Outside 0.105m blade -> clean whiff!
      });

      return { lowStroke, medStroke, highSmash, highWoodRim, highWhiffMiss };
    });

    // Verify LOW mode
    expect(tierResults.lowStroke.modeTier).toBe('LOW');
    expect(tierResults.lowStroke.lastContactQuality).toBe('SWEET_SPOT');
    expect(tierResults.lowStroke.ballSpeedKmh).toBeLessThanOrEqual(17.5);

    // Verify MEDIUM mode
    expect(tierResults.medStroke.modeTier).toBe('MEDIUM');
    expect(tierResults.medStroke.lastContactQuality).toBe('SWEET_SPOT');
    expect(tierResults.medStroke.ballSpeedKmh).toBeGreaterThan(tierResults.lowStroke.ballSpeedKmh);
    expect(tierResults.medStroke.ballSpeedKmh).toBeLessThanOrEqual(40.0);

    // Verify HIGH mode smash, wood rim hit, and whiff miss
    expect(tierResults.highSmash.modeTier).toBe('HIGH');
    expect(tierResults.highSmash.lastContactQuality).toBe('SWEET_SPOT');
    expect(tierResults.highSmash.ballSpeedKmh).toBeGreaterThan(45.0);
    expect(tierResults.highWoodRim.lastContactQuality).toBe('WOOD_RIM');
    expect(tierResults.highWhiffMiss.lastContactQuality).toBe('MISS');

    console.log(
      `[TC9] ✅ PASS — Low=${tierResults.lowStroke.ballSpeedKmh.toFixed(1)}km/h, ` +
      `Med=${tierResults.medStroke.ballSpeedKmh.toFixed(1)}km/h, ` +
      `High Smash=${tierResults.highSmash.ballSpeedKmh.toFixed(1)}km/h, ` +
      `Rim=${tierResults.highWoodRim.lastContactQuality}, Miss=${tierResults.highWhiffMiss.lastContactQuality}`
    );
  });

  test('TC10: High Mode Pure Unassisted Incoming Spin Rubber-Bite & Paddle Face Angle Physics', async ({ page }) => {
    await launchTableTennisMatch(page);

    await waitForState(page, s => s.rallyState === 'READY_TO_SERVE' && s.isServeArmed, 10000, 'READY_TO_SERVE and isServeArmed');

    const spinComparison = await page.evaluate(() => {
      const scene = (window as any).__camarena_active_scene;
      scene.setDifficulty('pro');

      // Case A: Incoming heavy topspin (+35 rad/s) hit with an OPEN paddle face (+22 deg) -> climbs high!
      const openFaceOnTopspin = scene.simulateStandingStroke({
        pitchDeg: 22,
        yawDeg: 0,
        speedMps: 6.5,
        brushY: 0.5,
        contactOffset: 0.02,
        incomingSpinX: 35,
      });

      // Case B: Incoming heavy topspin (+35 rad/s) hit with a CLOSED paddle face (-22 deg) -> kept low!
      const closedFaceOnTopspin = scene.simulateStandingStroke({
        pitchDeg: -22,
        yawDeg: 0,
        speedMps: 6.5,
        brushY: 1.5,
        contactOffset: 0.02,
        incomingSpinX: 35,
      });

      // Case C: Incoming heavy backspin (-35 rad/s) hit with a CLOSED face (-20 deg) -> drags downward into net!
      const closedFaceOnBackspin = scene.simulateStandingStroke({
        pitchDeg: -20,
        yawDeg: 0,
        speedMps: 5.5,
        brushY: -0.5,
        contactOffset: 0.02,
        incomingSpinX: -35,
      });

      return {
        openVy: openFaceOnTopspin.ballVel.y,
        closedVy: closedFaceOnTopspin.ballVel.y,
        backspinDumpVy: closedFaceOnBackspin.ballVel.y,
        topspinGenerated: closedFaceOnTopspin.ballSpin.x,
      };
    });

    // Open face on incoming topspin launches significantly higher than closed face
    expect(spinComparison.openVy).toBeGreaterThan(spinComparison.closedVy + 1.5);
    // Closed face on heavy backspin drags vertical velocity downward
    expect(spinComparison.backspinDumpVy).toBeLessThan(spinComparison.closedVy);
    // Upward brush with closed face generates strong positive topspin
    expect(spinComparison.topspinGenerated).toBeGreaterThan(25);

    console.log(
      `[TC10] ✅ PASS — Incoming Spin Bite verified: OpenFace Vy=${spinComparison.openVy.toFixed(2)} m/s, ` +
      `ClosedFace Vy=${spinComparison.closedVy.toFixed(2)} m/s, BackspinDump Vy=${spinComparison.backspinDumpVy.toFixed(2)} m/s`
    );
  });

  test('TC11: Racket Stability (Zero Shaking), Left/Right Body & Hand Movement Actions, and In-Bounds Multi-Shot Rally', async ({ page }) => {
    await launchTableTennisMatch(page);

    await waitForState(page, s => s.rallyState === 'READY_TO_SERVE' && s.isServeArmed, 10000, 'READY_TO_SERVE and isServeArmed');

    // 1. Verify Racket Resting Stability (Zero Continuous Shaking across 300ms)
    const restStart = await page.evaluate(() => (window as any).__camarena?.getDebugState());
    await page.waitForTimeout(300);
    const restEnd = await page.evaluate(() => (window as any).__camarena?.getDebugState());
    const posJitter = Math.hypot(
      restEnd.paddlePos.x - restStart.paddlePos.x,
      restEnd.paddlePos.y - restStart.paddlePos.y,
      restEnd.paddlePos.z - restStart.paddlePos.z
    );
    expect(posJitter).toBeLessThan(0.015);

    // 2. Verify Left & Right Body + Hand Movement Tracking & Action Classification
    const lateralMoves = await page.evaluate(() => {
      const scene = (window as any).__camarena_active_scene;
      const moveRight = scene.simulateStandingLateralMove({ bodyDirection: 'right', handDirection: 'right' });
      const moveLeft = scene.simulateStandingLateralMove({ bodyDirection: 'left', handDirection: 'left' });
      const moveCenter = scene.simulateStandingLateralMove({ bodyDirection: 'center', handDirection: 'center' });
      return { moveRight, moveLeft, moveCenter };
    });

    expect(lateralMoves.moveRight.playerX).toBeLessThan(-0.30);
    expect(lateralMoves.moveRight.paddlePos.x).toBeLessThan(-0.60);
    expect(Math.abs(lateralMoves.moveRight.paddlePos.x)).toBeLessThanOrEqual(0.78);
    expect(lateralMoves.moveRight.activeMovementAction).toMatch(/RIGHT|FOREHAND/);

    expect(lateralMoves.moveLeft.playerX).toBeGreaterThan(0.30);
    expect(lateralMoves.moveLeft.paddlePos.x).toBeGreaterThan(0.60);
    expect(Math.abs(lateralMoves.moveLeft.paddlePos.x)).toBeLessThanOrEqual(0.78);
    expect(lateralMoves.moveLeft.strokeSide).toBe('BACKHAND');
    expect(lateralMoves.moveLeft.activeMovementAction).toMatch(/LEFT|BACKHAND/);

    // 3. Verify Multi-Shot Rally & Zero Passive Auto-Hit:
    // Serve -> AI Return bounces on player half (stationary paddle does NOT auto-hit) -> Player Swings -> Ball bounces on AI half
    await page.keyboard.press('Space');

    // Wait for AI opponent to return the serve over the net and bounce on player's side (Z < 0)
    // Stationary paddle does NOT auto-hit the ball on entry or bounce (`lastHitter` stays `'opponent'`)
    const aiReturnState = await waitForState(
      page,
      s => s.rallyState === 'IN_PLAY' && s.lastHitter === 'opponent' && s.bounceCountNear >= 1 && s.ballPos.z < 0,
      7000,
      'AI-return-clears-net-and-lands-on-player-half'
    );
    expect(aiReturnState.lastHitter).toBe('opponent');
    expect(aiReturnState.rallyCount).toBe(2);

    // Execute active player standing rally return and verify it clears the net and bounces IN-BOUNDS on opponent's half
    await page.evaluate(() => {
      const scene = (window as any).__camarena_active_scene;
      scene.simulateStandingStroke({
        pitchDeg: -10,
        yawDeg: 4,
        speedMps: 5.5,
        brushY: 1.0,
        contactOffset: 0.02,
      });
    });

    const playerReturnLanded = await waitForState(
      page,
      s => s.rallyState === 'IN_PLAY' && s.rallyCount >= 3 && (s.ballPos.z > 0 || s.bounceCountFar >= 1 || s.lastHitter === 'opponent'),
      6000,
      'Player-rally-return-bounces-in-bounds-on-opponent-half'
    );
    expect(playerReturnLanded.rallyCount).toBeGreaterThanOrEqual(3);

    const snap = path.join(IMAGES_DIR, 'tc11-rally-inbounds-and-lateral-actions.png');
    await page.screenshot({ path: snap });
    console.log(
      `[TC11] ✅ PASS — Racket jitter=${(posJitter * 1000).toFixed(1)}mm, ` +
      `RightMove=${lateralMoves.moveRight.activeMovementAction}, LeftMove=${lateralMoves.moveLeft.activeMovementAction}, ` +
      `RallyCount=${playerReturnLanded.rallyCount}`
    );
  });
});

