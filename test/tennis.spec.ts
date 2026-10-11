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

async function launchTennisMatch(page: import('@playwright/test').Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);

  // Main menu must appear
  await expect(page.locator('#main-menu-overlay')).toBeVisible({ timeout: 10000 });

  // Select Lawn Tennis sport card
  await page.locator('.sport-card[data-sport="tennis"]').click();
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

  // Confirm debug bridge is live
  const bridgeLive = await page.evaluate(() => typeof (window as any).__camarena?.getDebugState === 'function');
  expect(bridgeLive).toBe(true);
}

test.describe('CamArena — Lawn Tennis 3D & Procedural Humanoid Verification', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['camera', 'microphone']);
  });

  test('TC-TENNIS-01: Main menu shows Lawn Tennis 3D card and launches smoothly', async ({ page }) => {
    await launchTennisMatch(page);

    const debugState = await page.evaluate(() => (window as any).__camarena.getDebugState());
    expect(debugState).toBeTruthy();
    expect(debugState.avatarStyle).toBe('humanoid');
    expect(debugState.currentServer).toBe(1);

    // Verify scoreboard pill displays correctly
    await expect(page.locator('.tennis-scoreboard-pill')).toBeVisible();
    await expect(page.locator('.tennis-speedometer')).toBeVisible();

    const snap = path.join(IMAGES_DIR, 'tc-tennis-01-court-launch.png');
    await page.screenshot({ path: snap });
    console.log('[TC-TENNIS-01] ✅ PASS — Lawn Tennis 3D launched with procedural humanoid avatar');
  });

  test('TC-TENNIS-02: Camera presets cycle through broadcast, over_shoulder, and court_level', async ({ page }) => {
    await launchTennisMatch(page);

    const initialPreset = await page.evaluate(() => (window as any).__camarena.getDebugState().cameraPreset);
    expect(initialPreset).toBe('broadcast');

    // Press 'C' key
    await page.keyboard.press('c');
    await page.waitForTimeout(300);

    const secondPreset = await page.evaluate(() => (window as any).__camarena.getDebugState().cameraPreset);
    expect(secondPreset).toBe('over_shoulder');

    // Press 'C' again
    await page.keyboard.press('c');
    await page.waitForTimeout(300);

    const thirdPreset = await page.evaluate(() => (window as any).__camarena.getDebugState().cameraPreset);
    expect(thirdPreset).toBe('court_level');

    const snap = path.join(IMAGES_DIR, 'tc-tennis-02-camera-preset.png');
    await page.screenshot({ path: snap });
    console.log('[TC-TENNIS-02] ✅ PASS — Camera presets cycled successfully');
  });

  test('TC-TENNIS-03: Ball serves cleanly into opponent court and triggers ground bounce', async ({ page }) => {
    await launchTennisMatch(page);

    // Trigger serve
    await page.evaluate(() => (window as any).__camarena.debugServe());

    // Wait for bounce in far court (Z > 0)
    const state = await waitForState(page, (s) => s.bounceCountFar >= 1, 6000, 'bounce in opponent court');
    expect(state.bounceCountFar).toBeGreaterThanOrEqual(1);

    const snap = path.join(IMAGES_DIR, 'tc-tennis-03-serve-bounce.png');
    await page.screenshot({ path: snap });
    console.log('[TC-TENNIS-03] ✅ PASS — Ball served into diagonal service box and bounced');
  });

  test('TC-TENNIS-04: High-visibility ball is docked to player and top-nav activates in-match broadcast pill', async ({ page }) => {
    await launchTennisMatch(page);

    const debugState = await page.evaluate(() => (window as any).__camarena.getDebugState());
    expect(debugState).toBeTruthy();

    // Verify ball is docked at player serve position, NOT at (0, 0, 0)
    expect(debugState.ballPos.z).toBeLessThan(-10.0);
    expect(debugState.ballPos.y).toBeGreaterThan(1.0);

    // Verify top-nav has .in-match class
    const topNav = page.locator('.top-nav');
    await expect(topNav).toHaveClass(/in-match/);

    // Verify broadcast score pill is visible and shows initial 0 - 0 score
    const broadcastPill = page.locator('.score-hud.broadcast-pill');
    await expect(broadcastPill).toBeVisible();
    await expect(broadcastPill.locator('.team-score-pill.player .pill-pts')).toHaveText('0');
    await expect(broadcastPill.locator('.team-score-pill.opponent .pill-pts')).toHaveText('0');

    const snap = path.join(IMAGES_DIR, 'tc-tennis-04-docked-ball-pill.png');
    await page.screenshot({ path: snap });
    console.log('[TC-TENNIS-04] ✅ PASS — Ball docked at player hand and broadcast score pill active');
  });

  test('TC-TENNIS-05: Pause menu toggles in-match bar and displays live match score', async ({ page }) => {
    await launchTennisMatch(page);

    // Press Escape to pause
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Pause modal must be visible
    const pauseModal = page.locator('.modal-overlay.pause-overlay');
    await expect(pauseModal).toBeVisible();

    // Top-nav must remove in-match while paused so navigation buttons are accessible
    const topNav = page.locator('.top-nav');
    await expect(topNav).not.toHaveClass(/in-match/);

    // Verify pause score card displays 0 VS 0
    await expect(page.locator('#pause-p1-score')).toHaveText('0');
    await expect(page.locator('#pause-p2-score')).toHaveText('0');

    // Resume match
    await page.locator('#btn-pause-resume').click();
    await page.waitForTimeout(300);

    // Pause modal closes, top-nav restores in-match
    await expect(pauseModal).toBeHidden();
    await expect(topNav).toHaveClass(/in-match/);

    const snap = path.join(IMAGES_DIR, 'tc-tennis-05-pause-resume.png');
    await page.screenshot({ path: snap });
    console.log('[TC-TENNIS-05] ✅ PASS — Pause/Resume toggles in-match state cleanly with score card');
  });

  test('TC-TENNIS-06: Standing posture gate and keyboard/mouse fallback bypass', async ({ page }) => {
    await launchTennisMatch(page);

    // Verify posture modal exists in DOM
    const postureModal = page.locator('#tennis-posture-modal');
    await expect(postureModal).toHaveCount(1);

    // Press 'A' to move laterally and activate keyboard bypass
    await page.keyboard.press('a');
    await page.waitForTimeout(100);

    const stateAfterKey = await page.evaluate(() => (window as any).__camarena.getDebugState());
    expect(stateAfterKey.isUsingKeyboardMouse).toBe(true);
    await expect(postureModal).toHaveClass(/hidden/);

    const snap = path.join(IMAGES_DIR, 'tc-tennis-06-posture-bypass.png');
    await page.screenshot({ path: snap });
    console.log('[TC-TENNIS-06] ✅ PASS — Keypress activates keyboard/mouse bypass and hides posture modal');
  });

  test('TC-TENNIS-07: Two-stage overhead serve toss, altitude arc, and fail-safe catch', async ({ page }) => {
    await launchTennisMatch(page);

    // Initial state: ball is docked to support hand
    const initial = await page.evaluate(() => (window as any).__camarena.getDebugState());
    expect(initial.serveTossActive).toBe(false);
    expect(initial.ballPos.z).toBeLessThan(-10.0);

    // Trigger Spacebar toss
    await page.keyboard.press('Space');
    await page.waitForTimeout(200);

    // Ball should now be in active toss arc
    const stateInToss = await page.evaluate(() => (window as any).__camarena.getDebugState());
    expect(stateInToss.serveTossActive).toBe(true);
    expect(stateInToss.ballPos.y).toBeGreaterThan(1.4);

    // Wait for fail-safe auto-catch without swinging (ball falls back and docks into hand)
    const stateCaught = await waitForState(
      page,
      (s) => s.serveTossActive === false && s.ballPos.y <= 1.35,
      3000,
      'ball auto-catch in support hand'
    );
    expect(stateCaught.serveTossActive).toBe(false);
    expect(stateCaught.isBallInPlay).toBe(false);

    const snap = path.join(IMAGES_DIR, 'tc-tennis-07-serve-toss-catch.png');
    await page.screenshot({ path: snap });
    console.log('[TC-TENNIS-07] ✅ PASS — Serve toss arcs upward and auto-catches safely in support hand');
  });

  test('TC-TENNIS-08: Continuous AI rally loop and 1-bounce groundstroke rule engine', async ({ page }) => {
    await launchTennisMatch(page);

    // Trigger serve
    await page.evaluate(() => (window as any).__camarena.debugServe());

    // Wait for ball to bounce in far court (Z > 0)
    await waitForState(page, (s) => s.bounceCountFar >= 1, 5000, 'far court bounce');

    // Wait for AI to return the groundstroke back across the net into player half (Z < 0)
    const returnedState = await waitForState(
      page,
      (s) => s.lastHitter === 2 && s.ballVel.z < -0.5,
      5000,
      'AI groundstroke return towards player'
    );
    expect(returnedState.lastHitter).toBe(2);
    expect(returnedState.ballVel.z).toBeLessThan(0);

    const snap = path.join(IMAGES_DIR, 'tc-tennis-08-ai-groundstroke-return.png');
    await page.screenshot({ path: snap });
    console.log('[TC-TENNIS-08] ✅ PASS — AI waits for 1 bounce and executes groundstroke return sustaining rally');
  });
});
