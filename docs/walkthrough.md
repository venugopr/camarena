# Walkthrough — CamArena: Modular Multi-Game Motion Tracking Sports Platform

**CamArena** is an athletic 3D motion tracking sports arena built with **HTML5, TypeScript, Three.js, MediaPipe Pose, and Web Audio API**. It supports **Badminton 3D**, **Table Tennis 3D**, and a **Motion Mirror & Biomechanical Calibration Sandbox**.

This document details all implemented features, user experience overhauls, gameplay mechanics, controls, and verification results.

---

## 📸 Key Features & Visual Showcase

### 1. Main Menu First Flow
- On launch, CamArena boots directly into a polished full-screen glassmorphic **Main Menu**.
- Players configure their sport, opponent (`AI`, `PvP`, or `Solo Practice`), match length (`11` or `21` points with win-by-2), AI reaction speed (`Casual`, `Pro`, `Legend`), and tracking input (`Live Webcam` or `Motion Simulator`).

### 2. Badminton 3D Pro
- **Court Geometry & Visuals**: Regulation BWF court lines, dynamic court lighting, and realistic net mesh.
- **Player Racket**: High-visibility cyan racket head attached to hand tracking with first-person floating racket mode.
- **Ghost Avatar Mode**: Semi-transparent silhouette (`opacity: 0.28`) ensuring the user's avatar body never occludes incoming shuttles, net, or opponent.
- **Serve Guidance**: Cyan pulsating banner `🏸 YOUR SERVE — Click or press SPACE to serve!` waits for player input.
- **Camera Views** (toggle with `C` or `🎥 View`):
  - `court_level` (Default): Player eye-level with full-court depth.
  - `broadcast`: Stadium overhead view showing entire court and both avatars.
  - `over_shoulder`: Elevated dynamic smash view.

### 3. Table Tennis 3D Pro
- **Table & Net**: ITTF regulation table proportions, white boundary lines, high-restitution ball physics, and procedural acoustic paddle/table bounces.
- **High-Visibility Equipment**: Dual-rubber tournament bat (red/black) responsive to hand position and mouse movements.
- **Neon Trajectory Trail**: Multi-segment visual trail for clear ball tracking during high-speed rallies.
- **Fair Serve System**: Player controls serve timing; AI serve gives a 2.0s alert countdown.
- **Camera Views** (toggle with `C` or `🎥 View`):
  - `bat_focus`: Focused player paddle and table perspective.
  - `broadcast`: Broadcast view showing the entire table and opponent.
  - `over_shoulder`: High rear perspective.

### 4. 3D Motion Mirror & Biomechanical Sandbox
- Real-time 3D holographic avatar mirroring body movements.
- Joint telemetry HUD showing velocity gauges, spine orientation, and action classifiers (Overhead Smash, Forehand Drive, Backhand, Lunge).
- Interactive floating target orbs for stroke and footwork calibration.

---

## 🎮 Controls & Interaction Guide

CamArena supports full dual-control input:

| Control Mode | Input | Action |
|---|---|---|
| **Webcam Motion** | Full-body movement | Moves avatar across court/table |
| **Webcam Motion** | Overhead swing / snap | Triggers Smash, Drive, or Lift stroke |
| **Webcam Motion** | Raise both hands | Triggers Pause menu |
| **Mouse Fallback** | Mouse Move | Moves racket / paddle across court and height |
| **Mouse Fallback** | Click / `Space` | Swings racket/paddle and initiates serve |
| **Keyboard** | `Arrow Keys` / `WASD` | Fine-tune footwork positioning (±0.55m) |
| **Keyboard** | `C` | Cycle through camera view presets |
| **Keyboard** | `Esc` or `P` | Pause / Unpause game |

---

## 🛠️ Architecture & Core Components

```
src/
├── core/
│   ├── audio/
│   │   └── SoundSynthesizer.ts     # Procedural Web Audio API sound effects
│   ├── motion/
│   │   ├── ActionStateMachine.ts   # Biomechanical stroke classifier
│   │   ├── OcclusionPredictor.ts   # Kinematic dead-reckoning for occluded joints
│   │   ├── OneEuroFilter.ts        # Adaptive jitter & latency filter
│   │   ├── PoseTracker.ts          # MediaPipe Pose + synthetic motion generator
│   │   ├── Types.ts                # Unified motion and scene type definitions
│   │   └── VectorNormalizer.ts     # Torso/hip-invariant orthonormal basis
│   └── scene/
│       ├── GameSceneManager.ts     # Standardized scene lifecycle & transitions
│       └── IGameScene.ts           # Game scene interface contract
├── scenes/
│   ├── components/
│   │   └── Avatar3D.ts             # Procedural 3D humanoid avatar & equipment
│   ├── BadmintonScene.ts           # 3D Badminton physics, AI & collision loop
│   ├── SandboxScene.ts             # Motion calibration & biomechanics sandbox
│   └── TableTennisScene.ts         # 3D Table Tennis physics, AI & collision loop
├── ui/
│   ├── MainMenuUI.ts               # Startup game selection & setup modal
│   ├── MenuUI.ts                   # In-game top navigation bar & settings
│   ├── MotionHUD.ts                # Live camera PIP skeleton overlay & metrics
│   └── ScoreOverlay.ts             # Scoreboard HUD, rules, pause & victory modals
├── index.css                       # Design system, glassmorphic HUD & animations
└── main.ts                         # Application entrypoint & engine orchestration
```

---

## ⚙️ Detailed Gameplay & Systems Implementations

### 1. Motion HUD & Skeleton Overlay
- **Fix**: Added null-guard check `if (!lm) continue;` before reading `lm.visibility` in `MotionHUD.renderSkeleton()`, preventing silent `TypeError` exceptions during sparse landmark frames.
- **PIP Mirror**: Live video feed with colored joint nodes, confidence indicators, and real-time FPS counter.

### 2. Equipment Geometry & Physical Collision
- **Avatar3D**: Implemented `getRacketWorldPosition(): THREE.Vector3` calculating exact 3D coordinates of the racket head by applying handle-to-head offsets along the equipment's quaternion rotation.
- **Proximity Interception**: Scenes run continuous Euclidean `distanceTo()` checks between projectile and equipment blade (`< 1.0m` radius in player's half). Auto-catches incoming shots to prevent projectile phase-through.

### 3. Fair Serve System & Guidance Banner
- Fixed issue where AI immediately auto-served and scored before the player was ready.
- Shuttlecock/ball stays anchored beside the player's racket/paddle until clicked or Space is pressed.
- Pulsating cyan guidance banner (`@keyframes servePulse`) clearly directs the player.
- AI serve incorporates a fair 2.0–2.5 second warning banner before launching.

### 4. Net Collision Physics & Feedback
- Physical collision detection against the net mesh.
- Striking the net dampens velocity realistically, ending the rally.
- High-visibility `⛔ HIT NET!` banner with entry flash animation (`@keyframes netHitFlash`) and procedural audio feedback.

### 5. Scoreboard HUD Polish & Modals
- **Typography**: Scores scaled to `3.4rem` with neon drop shadows (Cyan for Player, Magenta for Opponent).
- **Glassmorphic Contrast**: `backdrop-filter: blur(24px)` with dark gradient backdrop for optimal readability over bright 3D arenas.
- **Match Point & Deuce Indicator**: Glowing gold banner (`#fbbf24`).
- **Modal Stack Isolation**: `ScoreOverlay.setVisible(false)` explicitly cleans up and hides all modal overlays when returning to the Main Menu.

### 6. Smooth Scene Transitions
- `GameSceneManager.switchScene()` applies `#viewport-container.fading-out` before scene teardown and fades back in after scene initialization, preventing visual flashes.

---

## 🧪 Verification & Build Results

### TypeScript & Production Build
```bash
$ npm run build
> tsc && vite build
vite v6.4.3 building for production...
✓ 23 modules transformed.
dist/index.html                   1.07 kB
dist/assets/index-CEMmIP4y.css   26.69 kB
dist/assets/index-BgH5tF-c.js   613.02 kB
✓ built in 2.34s
```
- **TypeScript strict mode**: Passed with 0 errors.
- **Dev Server**: Running on `http://localhost:5173`.
