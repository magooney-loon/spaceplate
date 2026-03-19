<div align="center">
  <h1>🪐 Spaceplate</h1>
  <p>Svelte 5 + Threlte + SpacetimeDB boilerplate for real-time 3D web apps</p>
</div>

<img width="1900" height="1955" alt="Screenshot_2026-03-09_19-16-56" src="https://github.com/user-attachments/assets/69ce0322-4c56-4d2c-b403-487354e3e11f" />

<div align="center">
  <table>
    <tr>
      <td align="center"><a href="https://svelte.dev"><img src="https://img.shields.io/badge/Svelte-5-ff3e00.svg" alt="Svelte 5"></a></td>
      <td align="center"><a href="https://threlte.xyz"><img src="https://img.shields.io/badge/Threlte-8-ff3e00.svg" alt="Threlte 8"></a></td>
      <td align="center"><a href="https://threejs.org"><img src="https://img.shields.io/badge/Three.js-000000?style=flat&logo=three.js" alt="Three.js"></a></td>
      <td align="center"><a href="https://spacetimedb.com"><img src="https://img.shields.io/badge/SpacetimeDB-2.0-7b2ff7.svg" alt="SpacetimeDB"></a></td>
      <td align="center"><a href="https://vitejs.dev"><img src="https://img.shields.io/badge/Vite-6-646cff.svg" alt="Vite 6"></a></td>
      <td align="center"><a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-5-blue.svg" alt="TypeScript 5"></a></td>
      <td align="center"><a href="https://tailwindcss.com"><img src="https://img.shields.io/badge/TailwindCSS-4-38bdf8.svg" alt="TailwindCSS 4"></a></td>
    </tr>
  </table>
</div>

---

A minimal, opinionated boilerplate that wires together a Svelte 5 frontend, a Threlte 3D scene, and a SpacetimeDB real-time backend — so you can skip the setup and start building.

## What's included

- **Scene Manager** — Application state machine (`mainMenu` / `demoScene` / `settings`) with transitions and scene-specific HUD routing
- **Task Scheduling** — Threlte-based render pipeline with specialized stages:
  - `physicsStage` — Game logic (runs only in demoScene, pauses in menus)
  - `renderStage` — 3D rendering (default)
  - `uiStage` — UI updates (after render)
  - `audioStage` — Audio updates (always runs)
- **Extensions** — Threlte Studio toolbar extensions:
  - `StageExtension` — Scene switcher buttons
  - `CameraControlsExtension` — Camera position/angle controls
  - `PostProcessingExtension` — Full post-processing stack (Bloom, SSAO, GodRays, etc.)
- **Sound system** — Polyphonic + one-shot audio, never unmounts, safe from race conditions
- **Settings** — Persistent audio, graphics quality (DPR + power preference), UI visibility — saved to localStorage
- **SpacetimeDB wiring** — Connection setup, generated bindings, example table subscription
- **Debug logging** — Env-gated log channels (`VITE_GAME_ENGINE_LOGS`)
- **TailwindCSS** — Utility-first CSS framework via `@tailwindcss/vite`

---

## Architecture

### Scene System
```
src/
├── core/
│   ├── SceneManager.svelte.ts    # App state & transitions
│   └── tasks.ts                   # Task scheduling hook
├── scenes/
│   ├── MainMenu.svelte + HUD     # Menu scene
│   ├── DemoScene.svelte + HUD    # Demo with physics
│   └── SettingsHud.svelte        # Settings panel
└── Scene.svelte                  # Scene router
```

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

### Extensions
Each extension is self-contained with state, actions, and UI:
```
extensions/
├── StageExtension.svelte         # Scene switcher toolbar
├── camera/                       # Camera controls
└── postprocessing/               # 27 post-processing effects
    ├── PostProcessingExtension.svelte
    ├── types.ts
    └── usePostProcessing.ts
```

---

## Getting Started

```sh
# install dependencies
npm install       # or pnpm install

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
| `VITE_GAME_ENGINE` | `true` to enable Threlte Studio + PerfMonitor in dev |
| `VITE_GAME_ENGINE_LOGS` | `true` to enable debug logging |
