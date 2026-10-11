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

async function launchBoxingMatch(page: import('@playwright/test').Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);

  // Main menu must appear
  await expect(page.locator('#main-menu-overlay')).toBeVisible({ timeout: 10000 });

  // Select Arcade Boxing 3D Pro sport card
  await page.locator('.sport-card[data-sport="boxing"]').click();
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

  // Launch Match
  await page.locator('#btn-launch-match').click();

  // Wait for 3D canvas
  await expect(page.locator('#main-menu-overlay')).toBeHidden({ timeout: 10000 });
  await expect(page.locator('#viewport-container canvas').first()).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(600);

  // Confirm debug bridge is live
  const bridgeLive = await page.evaluate(() => typeof (window as any).__camarena?.getDebugState === 'function');
  expect(bridgeLive).toBe(true);
}

test.describe('CamArena — Arcade Boxing 3D Pro Verification', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['camera', 'microphone']);
  });

  test('TC-BOXING-01: Main menu shows Arcade Boxing 3D Pro card, launches with 3s countdown banner and how-to-play card', async ({ page }) => {
    await launchBoxingMatch(page);

    const debugState = await page.evaluate(() => (window as any).__camarena.getDebugState());
    expect(debugState).toBeTruthy();
    expect(debugState.playerHealth).toBe(100);
    expect(debugState.opponentHealth).toBe(100);

    // Verify HUD elements are mounted
    await expect(page.locator('.boxing-hud-root')).toBeVisible();
    await expect(page.locator('#player-hp-text')).toHaveText(/100/);
    await expect(page.locator('#how-to-play-card')).toBeVisible();
    await expect(page.locator('#countdown-banner')).toBeVisible();

    const snap = path.join(IMAGES_DIR, 'tc-boxing-01-arena-launch.png');
    await page.screenshot({ path: snap });
    console.log('[TC-BOXING-01] ✅ PASS — Arcade Boxing 3D Pro launched with 3s countdown banner & guide card');
  });

  test('TC-BOXING-02: Camera presets toggle between Over-The-Shoulder and First-Person via C key', async ({ page }) => {
    await launchBoxingMatch(page);

    const initial = await page.evaluate(() => (window as any).__camarena.getDebugState().cameraPreset);
    expect(initial).toBe('arcade_ots');

    // Press 'C' key
    await page.keyboard.press('c');
    await page.waitForTimeout(300);

    const second = await page.evaluate(() => (window as any).__camarena.getDebugState().cameraPreset);
    expect(second).toBe('first_person');

    // Press 'C' again to return to Over-The-Shoulder
    await page.keyboard.press('c');
    await page.waitForTimeout(300);

    const third = await page.evaluate(() => (window as any).__camarena.getDebugState().cameraPreset);
    expect(third).toBe('arcade_ots');

    const snap = path.join(IMAGES_DIR, 'tc-boxing-02-camera-toggle.png');
    await page.screenshot({ path: snap });
    console.log('[TC-BOXING-02] ✅ PASS — Camera toggled between Over-The-Shoulder and First-Person views');
  });

  test('TC-BOXING-03: After countdown expires, punches register impacts and deduct opponent health', async ({ page }) => {
    await launchBoxingMatch(page);

    // Wait for 3-second countdown to expire and round to activate
    await waitForState(page, (s) => s.isRoundActive === true, 6000, 'round active state');

    const initialHP = await page.evaluate(() => (window as any).__camarena.getDebugState().opponentHealth);

    // Throw Jab via debugServe
    await page.evaluate(() => (window as any).__camarena.debugServe());
    await page.waitForTimeout(300);

    const stateAfterHit = await page.evaluate(() => (window as any).__camarena.getDebugState());
    expect(stateAfterHit.opponentHealth).toBeLessThan(initialHP);
    expect(stateAfterHit.totalPlayerHits).toBeGreaterThanOrEqual(1);

    // Verify callout badge appears
    await expect(page.locator('#callout-badge')).toHaveClass(/active/);

    const snap = path.join(IMAGES_DIR, 'tc-boxing-03-punch-impact.png');
    await page.screenshot({ path: snap });
    console.log('[TC-BOXING-03] ✅ PASS — Punch impact registered with damage and arcade callout badge');
  });

  test('TC-BOXING-04: Match restart on R key resets fighter health and restarts 3s countdown', async ({ page }) => {
    await launchBoxingMatch(page);

    // Wait for round to activate
    await waitForState(page, (s) => s.isRoundActive === true, 6000, 'round active');

    // Damage opponent
    await page.evaluate(() => (window as any).__camarena.debugServe());
    await page.waitForTimeout(200);

    // Press 'R' to restart
    await page.keyboard.press('r');
    await page.waitForTimeout(300);

    const stateAfterRestart = await page.evaluate(() => (window as any).__camarena.getDebugState());
    expect(stateAfterRestart.playerHealth).toBe(100);
    expect(stateAfterRestart.opponentHealth).toBe(100);
    expect(stateAfterRestart.roundCountdown).toBeGreaterThan(0);

    const snap = path.join(IMAGES_DIR, 'tc-boxing-04-match-restart.png');
    await page.screenshot({ path: snap });
    console.log('[TC-BOXING-04] ✅ PASS — Match restart reset all parameters to Round 1 start state');
  });
});
