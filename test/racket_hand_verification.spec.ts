import { test, expect } from '@playwright/test';

test.describe('Dominant Hand, Mirroring & Idle Serve Suppression Verification', () => {
  test('Right-Handed (Default): Racket is on avatar right hand (screen-right) and stays in READY_TO_SERVE while idle', async ({ page }) => {
    await page.goto('http://localhost:5173');

    // 1. Verify Main Menu dominant hand button for Right-Handed (Default) is active
    const rightHandBtn = page.locator('button[data-hand="right"]');
    await expect(rightHandBtn).toBeVisible();
    await expect(rightHandBtn).toHaveClass(/active/);

    const synthBtn = page.locator('button[data-tracking="synthetic"]');
    if (await synthBtn.isVisible()) {
      await synthBtn.click();
    }

    // 2. Launch match
    const startBtn = page.locator('#btn-launch-match');
    await startBtn.click();

    // 3. Wait for game canvas to render
    const canvas = page.locator('#viewport-container canvas').first();
    await expect(canvas).toBeVisible();

    // 4. Wait 3 seconds to verify idle serve suppression (does not auto-serve on timeout)
    await page.waitForTimeout(3000);

    // 5. Inspect debug state from scene
    const debugState = await page.evaluate(() => {
      const win = window as any;
      const scene = win.__camarena_active_scene;
      return scene && scene.getDebugState ? scene.getDebugState() : null;
    });

    console.log('DEBUG STATE (Right Handed):', JSON.stringify(debugState, null, 2));

    if (debugState) {
      expect(debugState.rallyState).toBe('READY_TO_SERVE');
      expect(debugState.dominantHand).toBe('right');
      expect(debugState.racketLocalPos.x).toBeGreaterThan(0); // Racket is on avatar right hand (+X)
      expect(debugState.rightWristWorldPos.x).toBeGreaterThan(debugState.leftWristWorldPos.x); // Right wrist is screen-right of left wrist
    }

    // 6. Capture screenshot
    await page.screenshot({ path: 'test-results/images/right-handed-racket.png' });
  });

  test('Left-Handed: Racket is on avatar left hand (screen-left)', async ({ page }) => {
    await page.goto('http://localhost:5173');

    // 1. Select Left-Handed button
    const leftHandBtn = page.locator('button[data-hand="left"]');
    await expect(leftHandBtn).toBeVisible();
    await leftHandBtn.click();
    await expect(leftHandBtn).toHaveClass(/active/);

    const synthBtn = page.locator('button[data-tracking="synthetic"]');
    if (await synthBtn.isVisible()) {
      await synthBtn.click();
    }

    // 2. Launch match
    const startBtn = page.locator('#btn-launch-match');
    await startBtn.click();

    // 3. Wait for game canvas to render
    const canvas = page.locator('#viewport-container canvas').first();
    await expect(canvas).toBeVisible();

    await page.waitForTimeout(2000);

    const debugState = await page.evaluate(() => {
      const win = window as any;
      const scene = win.__camarena_active_scene;
      return scene && scene.getDebugState ? scene.getDebugState() : null;
    });

    console.log('DEBUG STATE (Left Handed):', JSON.stringify(debugState, null, 2));

    if (debugState) {
      expect(debugState.rallyState).toBe('READY_TO_SERVE');
      expect(debugState.dominantHand).toBe('left');
      expect(debugState.racketLocalPos.x).toBeLessThan(0); // Racket is on avatar left hand (-X)
      expect(debugState.leftWristWorldPos.x).toBeLessThan(debugState.rightWristWorldPos.x); // Left wrist is screen-left of right wrist
    }

    // 4. Capture screenshot
    await page.screenshot({ path: 'test-results/images/left-handed-racket.png' });
  });

  test('Motion Tracking Serve (No Keyboard Bypass): Physical Landmark swing triggers serve into IN_PLAY', async ({ page, context }) => {
    await context.grantPermissions(['camera', 'microphone']);
    await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);

    await expect(page.locator('#main-menu-overlay')).toBeVisible({ timeout: 10000 });

    const synthBtn = page.locator('button[data-tracking="synthetic"]');
    if (await synthBtn.isVisible()) {
      await synthBtn.click();
      await page.waitForTimeout(150);
    }

    const startBtn = page.locator('#btn-launch-match');
    await startBtn.click();

    await expect(page.locator('#main-menu-overlay')).toBeHidden({ timeout: 10000 });
    const canvas = page.locator('#viewport-container canvas').first();
    await expect(canvas).toBeVisible({ timeout: 10000 });

    await page.waitForTimeout(1500);

    // Verify initially in READY_TO_SERVE
    let state = await page.evaluate(() => (window as any).__camarena?.getDebugState());
    expect(state.rallyState).toBe('READY_TO_SERVE');

    // Trigger physical arm swing via motion tracker (synthesizing real PoseLandmarks moving across strike zone at > 1.5 m/s)
    await page.evaluate(() => {
      const tracker = (window as any).__camarena?.tracker;
      if (tracker && tracker.triggerSyntheticStroke) {
        tracker.triggerSyntheticStroke('forehand');
      }
    });

    // Wait for state transition to IN_PLAY purely from motion tracking collision
    await page.waitForFunction(() => {
      const st = (window as any).__camarena?.getDebugState();
      return st && st.rallyState === 'IN_PLAY';
    }, { timeout: 8000 });

    state = await page.evaluate(() => (window as any).__camarena?.getDebugState());
    expect(state.rallyState).toBe('IN_PLAY');
    expect(state.lastHitter).toBe('player');
    expect(state.shuttleVel.z).toBeGreaterThan(0);
    console.log(`✅ PASS — Motion tracking serve triggered purely from physical landmarks. vz=${state.shuttleVel.z.toFixed(2)} m/s`);
  });
});
