import './index.css';
import { PoseTracker } from './core/motion/PoseTracker';
import { SoundSynthesizer } from './core/audio/SoundSynthesizer';
import { GameSceneManager } from './core/scene/GameSceneManager';
import { MotionHUD } from './ui/MotionHUD';
import { MenuUI } from './ui/MenuUI';
import { ScoreOverlay } from './ui/ScoreOverlay';

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
  const motionHud = new MotionHUD(appContainer, tracker);
  new MenuUI(appContainer, sceneManager, tracker, audio);
  new ScoreOverlay(appContainer, sceneManager);

  // 4. Connect Unified Motion Stream to Active Scene and HUD
  let currentFrame: MotionFrame | null = null;
  tracker.onFrame((frame) => {
    currentFrame = frame;
    motionHud.update(frame);
  });

  tracker.onAction((actionEvent) => {
    sceneManager.onAction(actionEvent);
  });

  // 5. Start Default Game Scene (Badminton 3D)
  await sceneManager.switchScene('badminton');

  // 6. Initialize Pose Tracker with PIP video element
  await tracker.init(motionHud.getVideoElement());

  // 7. Global Animation / Simulation Loop
  let lastTime = performance.now();
  function animationLoop(currentTime: number) {
    const dt = Math.max((currentTime - lastTime) / 1000, 0.001);
    lastTime = currentTime;

    sceneManager.update(dt, currentFrame);

    requestAnimationFrame(animationLoop);
  }
  requestAnimationFrame(animationLoop);

  console.log('⚡ CamArena Sports Motion Tracking Platform Initialized Successfully!');
}

window.addEventListener('DOMContentLoaded', bootstrap);
