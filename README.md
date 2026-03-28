<div align="center">
  <h1>🪐 Spaceplate</h1>
  <p>Svelte 5 + Threlte + SpacetimeDB boilerplate for real-time 3D web apps</p>
  <p>Example Game: <a href="https://github.com/magooney-loon/JustSurvive">⚔️ JustSurvive</a></p>
</div>

<img width="2507" height="1587" alt="engi1" src="https://github.com/user-attachments/assets/19b9ee92-866d-427c-a03a-a6618447d0ed" />
<img width="2507" height="1587" alt="engi2" src="https://github.com/user-attachments/assets/428ac85b-3de4-4475-ae18-387fdd728717" />
<img width="2507" height="1587" alt="engi3" src="https://github.com/user-attachments/assets/07682e13-e066-4e58-a55a-4d9b94fdc331" />

<div align="center">
  <table>
    <tr>
      <td align="center"><a href="https://svelte.dev"><img src="https://img.shields.io/badge/Svelte-5-ff3e00.svg" alt="Svelte 5"></a></td>
      <td align="center"><a href="https://threlte.xyz"><img src="https://img.shields.io/badge/Threlte-8-ff3e00.svg" alt="Threlte 8"></a></td>
      <td align="center"><a href="https://threejs.org"><img src="https://img.shields.io/badge/Three.js-000000?style=flat&logo=three.js" alt="Three.js"></a></td>
      <td align="center"><a href="https://spacetimedb.com"><img src="https://img.shields.io/badge/SpacetimeDB-2.1-7b2ff7.svg" alt="SpacetimeDB 2.1"></a></td>
      <td align="center"><a href="https://vitejs.dev"><img src="https://img.shields.io/badge/Vite-8-646cff.svg" alt="Vite 8"></a></td>
      <td align="center"><a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-6-blue.svg" alt="TypeScript 6"></a></td>
      <td align="center"><a href="https://tailwindcss.com"><img src="https://img.shields.io/badge/TailwindCSS-4-38bdf8.svg" alt="TailwindCSS 4"></a></td>
    </tr>
  </table>
</div>

---

A minimal, opinionated boilerplate that wires together a Svelte 5 frontend, a Threlte 3D scene, and a SpacetimeDB real-time backend — so you can skip the setup and start building.

## What's included

- **Scene Manager** — Application state machine (`mainMenu` / `demoScene`) with animated transitions, per-scene HUD routing, and a preset assignment system for PP/skybox
- **Task Scheduling** — Threlte-based render pipeline with ordered stages:
  - `physicsStage` — Game logic (typically runs in `demoScene`, pauses in menus)
  - `renderStage` — 3D rendering (default)
  - `uiStage` — UI updates (after render)
  - `audioStage` — Audio (always runs)
- **Input System** — Action-based keyboard/mouse/gamepad mapping with per-player bindings, rebinding UI, and localStorage persistence
- **Studio Extensions** (`VITE_GAME_ENGINE=true`) — Threlte Studio toolbar panels:
  - `SceneExtension` — Scene switcher + preset manager (assign PP/skybox presets per scene or globally)
  - `PostProcessingExtension` — 25+ effects, preset save/load/update, bundled presets, conflict detection
  - `SkyboxExtension` — Sky/stars presets, animated transitions, environment textures, user presets
  - `SoundExtension` — Volume controls + audio channel toggles
  - `LoggerExtension` — Per-channel log toggles (`engine`, `settings`, `sound`, `postprocessing`, `skybox`, `cache`, `gltf`, `physics`, `input`)
  - `GltfViewerExtension` — Load GLTF/GLB from file or path; inspect animations and colliders in `demoScene`
  - `PhysicsExtension` — Rapier world controls, spawn defaults, attractor controls, and quick body spawning
- **Sound system** — Polyphonic + one-shot audio, never unmounts, safe from race conditions
- **Settings** — Tabbed settings HUD (General / Audio / Controls) — all persistent via localStorage
- **Physics sandbox** — `@threlte/rapier` world wiring, debug collider toggle, attractor modes, and spawnable balls/boxes
- **SpacetimeDB wiring** — Connection setup, generated bindings, example table subscription
- **Debug logging** — Multi-channel styled logging with timestamp; channels auto-generate Studio UI checkboxes
- **TailwindCSS** — Utility-first CSS framework via `@tailwindcss/vite`

---

### Task Scheduling
```typescript
import { useGameTasks } from '$core/tasks';

const { createPhysicsTask, createUiTask } = useGameTasks();

// Physics only runs in demoScene
createPhysicsTask((delta) => {
  // Update game objects
});

// UI runs in all scenes
createUiTask((delta) => {
  // Animate UI
});
```

### Input System
Action-based input that works in production without any editor tooling.

```typescript
import { inputQueries, advanceInputFrame } from '$extensions/input/input.svelte';

// In a frame task
createPhysicsTask((delta) => {
  advanceInputFrame(); // advance wasPressed edge detection

  const { x, y } = inputQueries.getMoveVector('player1');
  if (inputQueries.wasPressed('player1', 'jump')) { /* ... */ }
  if (inputQueries.isPressed('player1', 'sprint')) { /* ... */ }
});
```

Default player1 bindings out of the box:

| Keys | Action |
|---|---|
| W A S D / Arrows | Move |
| Space | Jump |
| Shift | Sprint |
| E | Interact |
| LMB / Q | Primary / Secondary |
| R F C X Z T | Reload / Use / Crouch / Drop / Prone / Emote |
| 1 2 3 4 | Slots |
| Esc | Pause |

Players can rebind everything from the in-game **Settings → Controls** tab.

### Extensions
Each extension is self-contained: reactive state (`.svelte.ts`), actions, and an optional Studio UI panel (dev only).

```
extensions/
├── scene/              # Scene state machine + preset assignment system
├── settings/           # Persistent audio/graphics/general settings
├── input/              # Action-based input mapping, bindings, queries
├── postprocessing/     # 25+ effects, presets, bundledPresets.ts
├── skybox/             # Sky + stars presets, envTextures.ts, bundledPresets.ts
├── sound/              # Positional audio state
├── logger/             # Multi-channel styled logging
├── gltf-viewer/        # GLTF/GLB loader, animation controls, collider toggles (dev only)
└── physics/            # Rapier world state, attractor, debug controls, spawnable bodies
```

State always works in production — Studio panels are purely dev-time UI on top of the same state.

### Physics
The boilerplate includes a ready-to-tweak Rapier sandbox inside the demo scene.

- World controls for gravity, framerate, and debug colliders
- Spawn defaults for restitution, friction, damping, CCD, sleep, and random spawn positions
- Attractor controls with `static`, `linear`, and `newtonian` gravity falloff
- Quick body spawning via `physicsActions.spawnBall()` / `spawnBox()`
- Leaving `demoScene` clears spawned physics bodies automatically

---

## Getting Started

```sh
# install dependencies
npm install

# run dev server
npm run dev

# build for production
npm run build
```

### SpacetimeDB

```sh
# start local SpacetimeDB server
spacetime start

# publish module (local)
npm run spacetime:publish:local

# publish module (local, wipe db)
npm run spacetime:publish:local:fresh

# publish module (maincloud)
npm run spacetime:publish

# regenerate client bindings after schema changes
npm run spacetime:generate
```

---

## Configuration

Copy `.env.example` to `.env.local` and fill in your values.

| Variable | Description |
|---|---|
| `VITE_SPACETIMEDB_DB_NAME` | Your SpacetimeDB database name |
| `VITE_SPACETIMEDB_HOST` | SpacetimeDB host (`https://maincloud.spacetimedb.com` for maincloud) |
| `SPACETIMEDB_DB_NAME` | Same as above, used by the `spacetime` CLI |
| `SPACETIMEDB_HOST` | Same as above, used by the `spacetime` CLI |
| `VITE_GAME_ENGINE` | `true` to enable Threlte Studio + PerfMonitor + all Studio extensions |
