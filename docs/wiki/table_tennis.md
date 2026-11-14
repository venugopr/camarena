# Table Tennis 3D Pro Wiki

**Module Path**: [`src/tabletennis/TableTennisScene.ts`](file:///src/tabletennis/TableTennisScene.ts) | [`src/tabletennis/TableTennisPhysics.ts`](file:///src/tabletennis/TableTennisPhysics.ts) | [`src/tabletennis/TableTennisSpatialTracker.ts`](file:///src/tabletennis/TableTennisSpatialTracker.ts) | [`src/tabletennis/TableTennisRules.ts`](file:///src/tabletennis/TableTennisRules.ts) | [`src/tabletennis/TableTennisAI.ts`](file:///src/tabletennis/TableTennisAI.ts) | [`src/tabletennis/TableTennisArena.ts`](file:///src/tabletennis/TableTennisArena.ts)  
**Game Mode ID**: `'tabletennis'`  
**Governing Standard**: International Table Tennis Federation (ITTF) Official Rules of Table Tennis  

---

## 1. Executive Summary & Sport Overview

**Table Tennis 3D Pro** is an ultra-low-latency 3D standing table tennis simulator that translates markerless webcam full-body posture, forearm pronation/supination, and wrist kinematics into competitive 60+ FPS ping-pong gameplay. Featuring ITTF regulation table proportions, a modular aerodynamic and impulse physics engine, tiered difficulty realism (**Low / Medium / High**), incoming spin rubber-bite mechanics, a two-handed ITTF vertical service toss, and a two-tone 3-star spin visualizer ball, CamArena delivers authentic standing tournament table tennis without VR headsets or physical controllers.

### ITTF Tournament Regulations:
- **Match Format**: Contested as a **Best of 3 Games** (first player to win 2 games wins the match).
- **Game Scoring**: Each game is played to **11 points**. A player must win by a margin of at least **2 points** (e.g., $11\text{--}9$, $12\text{--}10$, $14\text{--}12$).
- **Service Rotation**:
  - Service alternates every **2 points**.
  - At **Deuce** ($10\text{--}10$), service alternates after every single point.
- **Legal Service Rules**:
  - **Vertical Palm Toss**: The server rests the ball on the open palm of the non-dominant hand and projects it vertically upward at least **$16\text{ cm}$** ($0.16\text{ m}$) before striking it on descent behind the end-line.
  - **Two-Bounce Sequence**: The ball must bounce first on the server's own half of the table, clear the net assembly, and bounce on the receiver's half.
  - **Let Service**: If the ball touches the net assembly during service but lands legally on the receiver's court, a **"Let"** is called and the point is replayed without penalty.

---

## 2. Modular Engine Architecture

```
src/tabletennis/
├── TableTennisScene.ts           # Main scene coordinator, 3D WebGL renderer, camera & HUD
├── TableTennisPhysics.ts         # 3D impulse collision, rubber spin bite, Magnus aerodynamics
├── TableTennisSpatialTracker.ts  # Standing biomechanics, 1:1 face angle, FH/BH & serve toss
├── TableTennisRules.ts           # ITTF 11-point scoring, Deuce rotation, 16cm toss & Let rules
├── TableTennisAI.ts              # Spin-aware opponent AI (Loops, Chops, Drives, Corner Smashes)
└── TableTennisArena.ts           # Regulation ITTF table geometry, lighting & surface materials
```

---

## 3. Table & Arena Geometry

CamArena enforces precise ITTF regulation specifications for all arena objects:

| Specification | ITTF Official Standard | CamArena In-Engine Metric | Engine Constant |
|---|---|---|---|
| **Table Length** | $2.74\text{ m}$ ($9.0\text{ ft}$) | $2.74\text{ m}$ ($Z = -1.37$ to $+1.37$) | `TABLE_LENGTH = 2.74` |
| **Table Width** | $1.525\text{ m}$ ($5.0\text{ ft}$) | $1.525\text{ m}$ ($X = -0.7625$ to $+0.7625$) | `TABLE_WIDTH = 1.525` |
| **Table Surface Height** | $0.76\text{ m}$ ($30\text{ in}$) | $0.76\text{ m}$ above room floor | `TABLE_HEIGHT = 0.76` |
| **Net Height** | $15.25\text{ cm}$ ($0.1525\text{ m}$) | $0.1525\text{ m}$ (Top at $Y = 0.9125\text{ m}$) | `NET_HEIGHT = 0.1525` |
| **Net Total Width** | $1.83\text{ m}$ (Overhangs $15.25\text{cm}$) | $1.83\text{ m}$ centered at $Z = 0.0$ | `NET_WIDTH = 1.83` |
| **Ball Diameter** | $40\text{ mm}$ ($0.040\text{ m}$) | Radius $0.020\text{ m}$ ($2\text{ cm}$), Two-Tone 3-Star | `BALL_RADIUS = 0.02` |
| **Player Half** | Near Table Surface | $Z \in [-1.37, 0.0]\text{ m}$ | `playerTableMesh` |
| **Opponent Half** | Far Table Surface | $Z \in [0.0, +1.37]\text{ m}$ | `opponentTableMesh` |

---

## 4. Biomechanical Standing Simulation (`TableTennisSpatialTracker.ts`)

1. **1:1 Racket Face Orientation (Pitch, Yaw, Roll)**:
   - Derived from the 3D kinematic chain (`ELBOW` $\rightarrow$ `WRIST` $\rightarrow$ `INDEX` / `PINKY`).
   - **Closed Face ($\text{Pitch} < 0^\circ$)**: Tilts blade downward to drive topspin loops and counteract incoming topspin.
   - **Open Face ($\text{Pitch} > 0^\circ$)**: Tilts blade upward to slice backspin pushes/chops and lift incoming underspin over the net.
   - **Cross-Court vs. Down-the-Line Yaw**: Steers the 3D surface normal $\hat{n}_{\text{paddle}}$ laterally across the table.
2. **Dynamic Forehand vs. Backhand Classification**:
   - Tracks wrist position relative to the torso shoulder midline (`LEFT_SHOULDER`, `RIGHT_SHOULDER`), automatically switching between `FOREHAND` (Red rubber) and `BACKHAND` (Black rubber) blade roll postures.
3. **Standing Footwork & Head-Tracked Motion Parallax**:
   - **Lateral Shuffling ($X \in [-1.25\text{ m}, +1.25\text{ m}]$)** & **Depth Mobility ($Z \in [-1.78\text{ m}, -0.95\text{ m}]$)**: Stepping in over the table for short drop shots or backing up behind the baseline for loops.
   - **3D Motion Parallax**: Tracks the player's `NOSE` landmark to apply subtle perspective shifts on the camera, delivering natural stereoscopic depth cues on a 2D monitor.

---

## 5. Tiered Physics Modes: Low, Medium & High (`TableTennisPhysics.ts`)

| Parameter | **Low Mode** (`learner`) | **Medium Mode** (`casual`) | **High Mode** (`pro` / `legend`) |
|---|---|---|---|
| **Mode Tier ID** | `'LOW'` | `'MEDIUM'` | `'HIGH'` |
| **Physics Assist Weight** | $0.88$ (Guided in-bounds arc) | $0.52$ (Balanced club assist) | **$0.00$ (100% Pure Unassisted Impulse)** |
| **Sweet-Spot Radius** | $0.140\text{ m}$ | $0.085\text{ m}$ | **$0.055\text{ m}$** |
| **Outer Blade / Rim Radius** | $0.28\text{ m}$ / $0.44\text{ m}$ | $0.19\text{ m}$ / $0.34\text{ m}$ | **$0.082\text{ m}$ / $0.105\text{ m}$ (True 15cm Blade)** |
| **Ball Velocity Spectrum** | $2.8\text{--}4.6\text{ m/s}$ ($10\text{--}16.5\text{ km/h}$) | $3.1\text{--}10.8\text{ m/s}$ ($11\text{--}39\text{ km/h}$) | **$4.2\text{--}22.5\text{ m/s}$ ($15\text{--}81\text{ km/h}$)** |
| **Incoming Spin Grip** | $12\%$ (Forgiving) | $48\%$ (Moderate rubber bite) | **$100\%$ (Full Rubber Spin Sensitivity)** |

### Impulse & Incoming Spin Rubber-Bite Formulation:
$$\vec{v}_{\text{rel}} = \vec{v}_{\text{ball}} - \vec{v}_{\text{paddle}}, \qquad J_n = -(1 + e)\min(0, \vec{v}_{\text{rel}} \cdot \hat{n}_{\text{paddle}})$$
$$\Delta v_{y,\text{spin}} = \omega_{x,\text{in}} \cdot R_{\text{ball}} \cdot \mu_{\text{grip}}$$
- **Sweet Spot (`SWEET_SPOT`)**: Clean high restitution ($e = 0.88$), crisp sponge pop.
- **Outer Blade (`OUTER_BLADE`)**: Moderate restitution ($e = 0.68$).
- **Wood Blade Rim (`WOOD_RIM`)**: Low restitution ($e = 0.40$), erratic lateral/vertical deflection, and distinct wooden rim clack audio.
- **Incoming Spin Reaction**: Blocking heavy incoming topspin ($\omega_{x,\text{in}} > 0$) with an open paddle face causes the ball to climb up the rubber and fly long off the end of the table; hitting heavy incoming backspin ($\omega_{x,\text{in}} < 0$) with a flat/closed face drags the ball straight into the net.

---

## 6. Spin Aerodynamics & Visual Depth Perception

1. **Two-Tone 3-Star ITTF Spin Ball**:
   - High-contrast dual-hemisphere texture (Pure White + Tournament Orange with equator seam and `★★★ 40+` stamp) rotating at the ball's exact 3D angular velocity $\vec{\omega} = (\omega_x, \omega_y, \omega_z)$.
2. **Vertical Altitude Drop-Stem & Table Contact Shadow**:
   - Dynamic drop-stem laser line and crisp contact shadow projected onto the tabletop ($Y = 0.76\text{ m}$) for instant elevation reading.
3. **Multi-Layered Procedural Acoustics (`SoundSynthesizer.ts`)**:
   - Differentiates sweet-spot sponge compression (`tableTennisPaddleHit`), high-frequency rubber spin brush "zip", and hollow wooden rim clacks (`isWoodRim = true`).
