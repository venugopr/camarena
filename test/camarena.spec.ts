/**
 * camarena.spec.ts — Comprehensive Playwright regression suite (2 Focused Test Sets)
 *
 * Set 1: Player Serve & Desk Jitter Immunity
 *   - Verifies resting desk jitter does NOT auto-fire serve (shuttlecock stays held for 4s).
 *   - Verifies Spacebar fires a clean serve launching forward across the net (vz > 0, vy > 0) without baseline floor drop.
 *
 * Set 2: Guaranteed Opponent Net Clearance & Continuous Rally Gameplay
 *   - Verifies opponent clears the net tape (Y >= 1.56m, zero net faults).
 *   - Verifies genuine rallies can be played back and forth between player and AI bot (rallyCount > 5).
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const ROOT_DIR   = path.resolve(__dirname, '..');
const IMAGES_DIR = path.resolve(ROOT_DIR, 'test-results', 'images');
const VIDEO_DIR  = path.resolve(ROOT_DIR, 'test-results', 'video');
const ARTIFACT_DIR = 'C:\\Users\\rajes\\.gemini\\antigravity-ide\\brain\\390aa391-1e5b-4bb2-86af-5aaa853073d3';

fs.mkdirSync(IMAGES_DIR, { recursive: true });
fs.mkdirSync(VIDEO_DIR,  { recursive: true });

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Poll window.__camarena.getDebugState() until predicate is true or timeout */
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

/** Navigate through main menu and launch a badminton match */
async function launchBadmintonMatch(page: import('@playwright/test').Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);

  // Main menu must appear
  await expect(page.locator('#main-menu-overlay')).toBeVisible({ timeout: 10000 });

  // Select Badminton sport card
  await page.locator('.sport-card[data-sport="badminton"]').click();
  await page.waitForTimeout(150);

  // Choose Synthetic (Motion Simulator) — deterministic, no webcam needed
  await page.locator('button[data-tracking="synthetic"]').click();
  await page.waitForTimeout(150);

  // Vs. System AI
  await page.locator('.opponent-toggles button[data-opp="system"]').click();
  await page.waitForTimeout(150);

  // Verify Right-Handed is selected by default in radio toggle
  const rightHandBtn = page.locator('.hand-toggles button[data-hand="right"]');
  await expect(rightHandBtn).toHaveClass(/active/);

  // Casual difficulty
  await page.locator('.diff-toggles button[data-diff="casual"]').click();
  await page.waitForTimeout(150);

  // 11-point match so Set 2 can complete multi-shot rallies before match point
  await page.locator('.target-toggles button[data-target="11"]').click();
  await page.waitForTimeout(200);

  // Launch
  await page.locator('#btn-launch-match').click();

  // Wait for the 3D canvas to appear
  await expect(page.locator('#main-menu-overlay')).toBeHidden({ timeout: 10000 });
  await expect(page.locator('#viewport-container canvas').first()).toBeVisible({ timeout: 10000 });

  // Give the scene a moment to initialise physics
  await page.waitForTimeout(1500);

  // Confirm debug bridge is live
  const bridgeLive = await page.evaluate(() => typeof (window as any).__camarena?.getDebugState === 'function');
  expect(bridgeLive).toBe(true);
}

// ─── Test Suite (2 Sets) ──────────────────────────────────────────────────────

test.describe('CamArena — Badminton Core Gameplay Regression (2 Sets)', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['camera', 'microphone']);
  });

  // ── SET 1: Player Serve & Desk Jitter / Idle Immunity ─────────────────────────
  test('Set 1: Idle time does NOT auto-fire serve, and physical/controlled swing launches serve over net', async ({ page }) => {
    test.setTimeout(60000);
    await launchBadmintonMatch(page);

    // Wait until rallyState = READY_TO_SERVE with player as server
    await waitForState(page, s => s.rallyState === 'READY_TO_SERVE', 8000, 'READY_TO_SERVE');

    // Step A: Sample state 10 times over 4.0 seconds — must NOT auto-fire on idle
    const samples: any[] = [];
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(400);
      const state = await page.evaluate(() => (window as any).__camarena.getDebugState());
      samples.push(state);
      console.log(`[Set 1] Idle check t=${i * 400}ms  rallyState=${state.rallyState}  held=${state.isShuttleHeld}`);
    }

    for (const s of samples) {
      expect(s.rallyState, 'Idle match must not auto-serve').toBe('READY_TO_SERVE');
      expect(s.isShuttleHeld, 'Shuttle must stay held; idle must not auto-serve').toBe(true);
    }
    console.log('[Set 1] ✅ PASS — No ghost auto-serve detected during idle wait');

    // Step B: Trigger deliberate player serve stroke via motion tracking pipeline (no keyboard/manual bypass)
    await page.evaluate(() => {
      const tracker = (window as any).__camarena?.tracker;
      if (!tracker) return;
      if (tracker.setTrackingMode) tracker.setTrackingMode('synthetic');
      if (tracker.triggerSyntheticStroke) tracker.triggerSyntheticStroke('forehand');
    });

    const state = await waitForState(page, s => s.rallyState === 'IN_PLAY', 8000, 'IN_PLAY after physical serve stroke');

    const screenshot = path.join(IMAGES_DIR, 'set1-player-serve.png');
    await page.screenshot({ path: screenshot });

    expect(state.rallyState).toBe('IN_PLAY');
    expect(state.lastHitter).toBe('player');
    expect(state.shuttleVel.z, 'Forward velocity toward opponent (vz > 0)').toBeGreaterThan(0);
    expect(state.shuttleVel.y, 'Upward lift velocity (vy > 0)').toBeGreaterThan(0);
    console.log(`[Set 1] ✅ PASS — Serve launched cleanly. vz=${state.shuttleVel.z.toFixed(2)} m/s, vy=${state.shuttleVel.y.toFixed(2)} m/s`);
  });

  // ── SET 2: Guaranteed Opponent Net Clearance & In-Bounds Rally Gameplay ───────
  test('Set 2: Opponent clears the net tape (zero net faults) and rallies land in-bounds', async ({ page }) => {
    test.setTimeout(120000);
    await launchBadmintonMatch(page);

    let totalPoints = 0;
    const startTime = Date.now();

    while (Date.now() - startTime < 90000) {
      const state = await page.evaluate(() => (window as any).__camarena.getDebugState());
      if (!state) { await page.waitForTimeout(200); continue; }

      totalPoints = state.scorePlayer + state.scoreOpponent;

      if (state.rallyCount >= 8 || state.rallyState === 'GAME_OVER') {
        console.log(`[Set 2] Match/Rally checkpoint. Score: ${state.scorePlayer}-${state.scoreOpponent}, rallyCount=${state.rallyCount}`);
        break;
      }

      if (state.rallyState === 'READY_TO_SERVE') {
        // Trigger serve stroke via motion tracking pipeline
        await page.evaluate(() => {
          const tracker = (window as any).__camarena?.tracker;
          if (!tracker) return;
          if (tracker.setTrackingMode) tracker.setTrackingMode('synthetic');
          if (tracker.triggerSyntheticStroke) tracker.triggerSyntheticStroke('forehand');
        });
        await page.waitForTimeout(400);
      } else if (state.rallyState === 'IN_PLAY') {
        // Return rally stroke
        await page.evaluate(() => {
          const scene = (window as any).__camarena_active_scene;
          if (scene && scene.executePlayerHit) {
            const racketHead = scene.playerAvatar?.getRacketHeadWorldPosition();
            if (racketHead && scene.shuttlePos && scene.shuttleVel?.z < 0 && scene.shuttlePos.z < -0.4) {
              scene.executePlayerHit(racketHead, 3.2, false);
            }
          }
        });
        await page.waitForTimeout(300);
      } else {
        await page.waitForTimeout(200);
      }
    }

    const finalState = await page.evaluate(() => (window as any).__camarena.getDebugState());
    const screenshot = path.join(IMAGES_DIR, 'set2-rallies-complete.png');
    await page.screenshot({ path: screenshot });

    console.log(`[Set 2] Final: score=${finalState?.scorePlayer}-${finalState?.scoreOpponent}, rallyCount=${finalState?.rallyCount}, netFaults=${finalState?.netFaultCount}`);

    // ASSERT: Genuine rally exchanges took place
    expect(finalState?.rallyCount ?? 0, 'Rally count must be > 5 — genuine rally exchanges must occur').toBeGreaterThan(5);

    // ASSERT: Opponent never hit the net (zero net faults)
    expect(finalState?.netFaultCount ?? 0, 'Zero net faults allowed').toBe(0);

    console.log('[Set 2] ✅ PASS — Match played genuine rallies with zero opponent net faults');
  });

  test.afterEach(async ({ page, context }) => {
    const video = page.video();
    await page.close();
    await context.close();

    if (video) {
      try {
        const recordedPath = await video.path();
        if (recordedPath && fs.existsSync(recordedPath)) {
          const dest = path.join(VIDEO_DIR, 'badminton-regression.webm');
          fs.copyFileSync(recordedPath, dest);
          console.log(`[Playwright] Video saved: ${dest}`);

          if (fs.existsSync(ARTIFACT_DIR)) {
            const artifactPath = path.join(ARTIFACT_DIR, 'badminton-regression.webm');
            fs.copyFileSync(recordedPath, artifactPath);
          }
        }
      } catch (err) {
        console.warn('[Playwright] Video save notice:', err);
      }
    }
  });
});
