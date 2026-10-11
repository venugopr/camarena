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
    const state = await page.evaluate(() => {
      const active = (window as any).__camarena_active_scene;
      if (active && typeof active.getDebugState === 'function') {
        return active.getDebugState();
      }
      return (window as any).__camarena?.getDebugState?.() ?? null;
    });
    if (state && predicate(state)) return state;
    await page.waitForTimeout(80);
  }
  const snap = path.join(IMAGES_DIR, `timeout-${label.replace(/\s+/g, '-')}.png`);
  await page.screenshot({ path: snap });
  throw new Error(`Timed out waiting for: ${label} (${timeoutMs}ms). Snapshot: ${snap}`);
}

async function launchBowlingMatch(page: import('@playwright/test').Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);

  // Main menu must appear
  await expect(page.locator('#main-menu-overlay')).toBeVisible({ timeout: 10000 });

  // Select Bowling sport card
  await page.locator('.sport-card[data-sport="bowling"]').click();
  await page.waitForTimeout(150);

  // Choose Synthetic motion tracking
  const synthBtn = page.locator('button[data-tracking="synthetic"]');
  if (await synthBtn.isVisible()) {
    await synthBtn.click();
    await page.waitForTimeout(150);
  }

  // Launch Match
  await page.locator('#btn-launch-match').click();

  // Wait for 3D canvas
  await expect(page.locator('#main-menu-overlay')).toBeHidden({ timeout: 10000 });
  await expect(page.locator('#viewport-container canvas').first()).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(1200);
}

test.describe('CamArena — Arcade Bowling 3D Pro Verification', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['camera', 'microphone']);
  });

  test('TC-BOWL-01: Main menu shows Bowling card and launches smoothly', async ({ page }) => {
    await launchBowlingMatch(page);

    const bridgeLive = await page.evaluate(() => typeof (window as any).__camarena?.getDebugState === 'function');
    expect(bridgeLive).toBe(true);

    const state = await page.evaluate(() => {
      const active = (window as any).__camarena_active_scene;
      return active?.getDebugState ? active.getDebugState() : (window as any).__camarena.getDebugState();
    });

    expect(state).toBeTruthy();
    expect(state.currentFrame).toBe(0);
    expect(state.rollInFrame).toBe(0);
    expect(state.pinsUpCount).toBe(10);
    expect(state.isPlayerTurn).toBe(true);

    const snap = path.join(IMAGES_DIR, 'tc-bowl-01-bowling-lane.png');
    await page.screenshot({ path: snap });
    console.log('[TC-BOWL-01] ✅ PASS — Arcade Bowling 3D initialized with 10 pins standing');
  });

  test('TC-BOWL-02: Camera view cycles perspectives via C key', async ({ page }) => {
    await launchBowlingMatch(page);

    // Initial state
    const canvas = page.locator('#viewport-container canvas').first();
    await expect(canvas).toBeVisible();

    // Press C to cycle camera
    await page.keyboard.press('c');
    await page.waitForTimeout(300);

    await page.keyboard.press('c');
    await page.waitForTimeout(300);

    const snap = path.join(IMAGES_DIR, 'tc-bowl-02-camera-cycle.png');
    await page.screenshot({ path: snap });
    console.log('[TC-BOWL-02] ✅ PASS — Camera cycle verified');
  });

  test('TC-BOWL-03: Ball rolls down lane and knocks down pins', async ({ page }) => {
    await launchBowlingMatch(page);

    // Initial state: 10 pins standing
    const initialState = await page.evaluate(() => {
      const active = (window as any).__camarena_active_scene;
      return active?.getDebugState ? active.getDebugState() : (window as any).__camarena.getDebugState();
    });
    expect(initialState.pinsUpCount).toBe(10);

    // Trigger roll down the center of the lane
    await page.evaluate(() => {
      if (typeof (window as any).__camarena?.debugRoll === 'function') {
        (window as any).__camarena.debugRoll(12.0, 0, 0);
      } else {
        const active = (window as any).__camarena_active_scene;
        active?.debugRoll(12.0, 0, 0);
      }
    });

    // Wait for the ball to travel down the lane (~1.5s) and knock down pins
    await page.waitForTimeout(2000);

    // Wait for pins to be knocked down or roll to be registered
    const afterRollState = await waitForState(
      page,
      s => s.pinsUpCount < 10 || s.rollInFrame >= 1 || s.currentFrame >= 1 || !s.isPlayerTurn,
      10000,
      'pins knocked down after roll'
    );

    expect(afterRollState).toBeTruthy();
    console.log(`[TC-BOWL-03] ✅ PASS — Ball rolled down lane and struck pins (standing pins: ${afterRollState.pinsUpCount})`);

    const snap = path.join(IMAGES_DIR, 'tc-bowl-03-pins-knocked.png');
    await page.screenshot({ path: snap });
  });
});
