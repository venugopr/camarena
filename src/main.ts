import './index.css';
import { PoseTracker } from './core/motion/PoseTracker';
import { SoundSynthesizer } from './core/audio/SoundSynthesizer';
import { GameSceneManager } from './core/scene/GameSceneManager';
import { MotionHUD } from './ui/MotionHUD';
import { MenuUI } from './ui/MenuUI';
import { ScoreOverlay } from './ui/ScoreOverlay';
import { MainMenuUI } from './ui/MainMenuUI';

// Scenes
import { BadmintonScene } from './scenes/BadmintonScene';
import { TableTennisScene } from './scenes/TableTennisScene';
import { SandboxScene } from './scenes/SandboxScene';
import { MotionFrame } from './core/motion/Types';

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

  // 2. Register Game Scenes
  sceneManager.registerScene(new BadmintonScene());
  sceneManager.registerScene(new TableTennisScene());
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

  // Show Main Menu immediately on boot
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

  console.log('⚡ CamArena Sports Motion Tracking Platform Initialized — Main Menu Active!');
}

window.addEventListener('DOMContentLoaded', bootstrap);

