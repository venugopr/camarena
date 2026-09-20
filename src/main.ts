import './index.css';
import { PoseTracker } from './util/motion/PoseTracker';
import { SoundSynthesizer } from './util/audio/SoundSynthesizer';
import { GameSceneManager } from './common/GameSceneManager';
import { MotionHUD } from './ui/MotionHUD';
import { MenuUI } from './ui/MenuUI';
import { ScoreOverlay } from './ui/ScoreOverlay';
import { MainMenuUI } from './ui/MainMenuUI';

// Scenes — all sports
import { BowlingScene } from './bowling/BowlingScene';
import { BoxingScene } from './boxing/BoxingScene';
import { TableTennisScene } from './tabletennis/TableTennisScene';
import { TennisScene } from './tennis/TennisScene';
import { BadmintonScene } from './badminton/BadmintonScene';
import { SandboxScene } from './scenes/SandboxScene';
import { MotionFrame } from './common/Types';

// ─── Playwright / Dev Debug Bridge ─────────────────────────────────────────────
// window.__camarena is intentionally set in all environments so Playwright tests
// can read live physics state without relying on visual-only DOM assertions.
declare global {
  interface Window {
    __camarena: {
      getDebugState: () => ReturnType<BadmintonScene['getDebugState']> | null;
      debugServe: () => void;
      tracker: PoseTracker;
    };
  }
}

async function bootstrap() {
  const appContainer = document.getElementById('app');
  const viewportContainer = document.getElementById('viewport-container');

  if (!appContainer || !viewportContainer) {
    console.error('App containers not found');
    return;
  }

  // 1. Initialize Core Engines
  const audio = new SoundSynthesizer();
  const tracker = new PoseTracker();
  const sceneManager = new GameSceneManager(viewportContainer, audio);

  // 2. Register Game Scenes — all 6 sports
  const badmintonScene = new BadmintonScene();
  sceneManager.registerScene(new BowlingScene());
  sceneManager.registerScene(new BoxingScene());
  sceneManager.registerScene(new TableTennisScene());
  sceneManager.registerScene(new TennisScene());
  sceneManager.registerScene(badmintonScene);
  sceneManager.registerScene(new SandboxScene());

  // 3. Mount UI Layers
  const motionHud = new MotionHUD(appContainer, tracker, sceneManager);
  new MenuUI(appContainer, sceneManager, tracker, audio);
  const scoreOverlay = new ScoreOverlay(appContainer, sceneManager);
  scoreOverlay.setVisible(false); // Hidden until match launches

  // 4. Connect Unified Motion Stream to Active Scene and HUD
  let currentFrame: MotionFrame | null = null;
  tracker.onFrame((frame) => {
    currentFrame = frame;
    motionHud.update(frame);
  });

  tracker.onAction((actionEvent) => {
    sceneManager.onAction(actionEvent);
  });

  tracker.onGesturePause(() => {
    if (sceneManager.getActiveSceneId() === 'bowling') return;
    sceneManager.togglePause();
  });

  // 5. Mount Main Menu UI (Enforce Main Menu First on Application Startup)
  const mainMenu = new MainMenuUI(
    appContainer,
    sceneManager,
    tracker,
    audio,
    () => motionHud.getVideoElement()
  );

  // Show Main Menu immediately on boot — Bowling is pre-selected as default
  mainMenu.show();

  // Listen for Return to Main Menu events
  window.addEventListener('open-main-menu', () => {
    sceneManager.pause();
    scoreOverlay.setVisible(false);
    mainMenu.show();
  });

  // 6. Global Animation / Simulation Loop
  let lastTime = performance.now();
  function animationLoop(currentTime: number) {
    const dt = Math.max((currentTime - lastTime) / 1000, 0.001);
    lastTime = currentTime;

    sceneManager.update(dt, currentFrame);

    requestAnimationFrame(animationLoop);
  }
  requestAnimationFrame(animationLoop);

  // 7. Developer & Desk-Testing Shortcut: 'M' toggles between Webcam and Synthetic Simulator
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'm' || e.key === 'M') {
      const curMode = tracker.getTrackingMode();
      const nextMode = curMode === 'webcam' ? 'synthetic' : 'webcam';
      tracker.setTrackingMode(nextMode);
      console.log(`[CamArena] 'M' key pressed — Toggled tracking mode to: ${nextMode.toUpperCase()}`);
    }
  });

  // 8. Expose window.__camarena debug bridge for Playwright automated tests
  window.__camarena = {
    getDebugState: () => badmintonScene.getDebugState(),
    debugServe: () => badmintonScene.debugServe(),
    tracker,
  };

  console.log('⚡ CamArena Sports Motion Tracking Platform Initialized — Main Menu Active! (6 Sports Ready)');
}

window.addEventListener('DOMContentLoaded', bootstrap);
