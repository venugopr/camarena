import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.resolve(__dirname, '..');
const IMAGES_DIR = path.resolve(ROOT_DIR, 'test-results', 'images');
const VIDEO_DIR = path.resolve(ROOT_DIR, 'test-results', 'video');

// Ensure destination directories exist
if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
if (!fs.existsSync(VIDEO_DIR)) fs.mkdirSync(VIDEO_DIR, { recursive: true });

test.describe('CamArena 3D Sports Motion Platform - E2E Suite', () => {
  let videoArtifactPath: string | null = null;

  test.beforeEach(async ({ context }) => {
    // Grant camera and microphone permissions
    await context.grantPermissions(['camera', 'microphone']);
  });

  test('Full Experience Tour: Main Menu, Badminton, Table Tennis, and Motion Mirror', async ({ page, context }) => {
    // 1. Navigate to application
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    // Verify Main Menu overlay appears on startup
    const mainMenuOverlay = page.locator('#main-menu-overlay');
    await expect(mainMenuOverlay).toBeVisible({ timeout: 10000 });

    // Capture 01: Main Menu Initial Screen
    const img01 = path.join(IMAGES_DIR, '01-main-menu.png');
    await page.screenshot({ path: img01, fullPage: true });
    console.log(`[Playwright] Captured screenshot: ${img01}`);

    // 2. Configure Game Settings in Main Menu
    // Switch tracking controller to Motion Simulator for deterministic automated testing
    const simulatorBtn = page.locator('.tracking-toggles button[data-tracking="synthetic"]');
    await simulatorBtn.click();
    await page.waitForTimeout(400);

    // Select "Vs. System (AI)" opponent mode
    const systemOpponentBtn = page.locator('.opponent-toggles button[data-opp="system"]');
    await systemOpponentBtn.click();
    await page.waitForTimeout(300);

    // Select "Casual" difficulty
    const casualDiffBtn = page.locator('.diff-toggles button[data-diff="casual"]');
    await casualDiffBtn.click();
    await page.waitForTimeout(300);

    // Verify summary text reflects choices
    const rulesSummary = page.locator('#menu-rules-summary');
    await expect(rulesSummary).toContainText('Badminton 3D');
    await expect(rulesSummary).toContainText('Motion Simulator');

    // Capture 02: Menu Configured
    const img02 = path.join(IMAGES_DIR, '02-menu-configured.png');
    await page.screenshot({ path: img02, fullPage: true });
    console.log(`[Playwright] Captured screenshot: ${img02}`);

    // 3. Launch Match (Badminton 3D)
    const launchBtn = page.locator('#btn-launch-match');
    await expect(launchBtn).toBeVisible();
    await launchBtn.click();

    // Verify main menu fades out and 3D Canvas becomes active
    await expect(mainMenuOverlay).toBeHidden({ timeout: 10000 });
    const canvas = page.locator('#viewport-container canvas').first();
    await expect(canvas).toBeVisible({ timeout: 10000 });

    // Wait for 3D court and HUD to initialize
    await page.waitForTimeout(2000);

    // Capture 03: Badminton Court Initial View
    const img03 = path.join(IMAGES_DIR, '03-badminton-court.png');
    await page.screenshot({ path: img03 });
    console.log(`[Playwright] Captured screenshot: ${img03}`);

    // Simulate player action / rally interaction
    await page.keyboard.press('Space'); // Trigger hit/serve
    await page.waitForTimeout(1000);
    await page.keyboard.press('Space');
    await page.waitForTimeout(2000);

    // Capture 04: Badminton Active Rally & HUD
    const img04 = path.join(IMAGES_DIR, '04-badminton-active-rally.png');
    await page.screenshot({ path: img04 });
    console.log(`[Playwright] Captured screenshot: ${img04}`);

    // 4. Switch to Table Tennis 3D Scene
    const tableTennisTab = page.locator('.game-tab-btn').filter({ hasText: /Table Tennis/i }).first();
    await tableTennisTab.click();
    await page.waitForTimeout(3000);

    // Capture 05: Table Tennis Court
    const img05 = path.join(IMAGES_DIR, '05-table-tennis-court.png');
    await page.screenshot({ path: img05 });
    console.log(`[Playwright] Captured screenshot: ${img05}`);

    // Simulate Table Tennis rallies & paddle movement
    await page.mouse.move(640, 360);
    await page.mouse.move(700, 400, { steps: 5 });
    await page.keyboard.press('Space');
    await page.waitForTimeout(2000);

    // Capture 06: Table Tennis Active Rally
    const img06 = path.join(IMAGES_DIR, '06-table-tennis-rally.png');
    await page.screenshot({ path: img06 });
    console.log(`[Playwright] Captured screenshot: ${img06}`);

    // 5. Switch to Motion Mirror (Sandbox Calibration Scene)
    const sandboxTab = page.locator('.game-tab-btn').filter({ hasText: /Motion Mirror/i }).first();
    await sandboxTab.click();
    await page.waitForTimeout(3000);

    // Capture 07: Motion Mirror Sandbox
    const img07 = path.join(IMAGES_DIR, '07-motion-mirror.png');
    await page.screenshot({ path: img07 });
    console.log(`[Playwright] Captured screenshot: ${img07}`);

    // 6. Return to Main Menu via Top Bar Button
    const returnMainMenuBtn = page.locator('#btn-nav-main-menu');
    if (await returnMainMenuBtn.isVisible()) {
      await returnMainMenuBtn.click();
      await page.waitForTimeout(1200);
      await expect(mainMenuOverlay).toBeVisible();

      // Capture 08: Main Menu Re-opened
      const img08 = path.join(IMAGES_DIR, '08-main-menu-return.png');
      await page.screenshot({ path: img08 });
      console.log(`[Playwright] Captured screenshot: ${img08}`);
    }

    // Save reference to video
    const video = page.video();
    if (video) {
      videoArtifactPath = await video.path();
    }
  });

  test.afterEach(async ({ page, context }) => {
    // Close context to ensure Playwright flushes and writes the video file to disk
    const video = page.video();
    await page.close();
    await context.close();

    if (video) {
      try {
        const recordedPath = await video.path();
        if (recordedPath && fs.existsSync(recordedPath)) {
          const targetVideoPath = path.join(VIDEO_DIR, 'camarena-gameplay-tour.webm');
          fs.copyFileSync(recordedPath, targetVideoPath);
          console.log(`[Playwright] Successfully saved video recording to: ${targetVideoPath}`);
        }
      } catch (err) {
        console.warn('[Playwright] Video save notice:', err);
      }
    }
  });
});
