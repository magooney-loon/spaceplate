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

- **Scene Manager** — Application state machine (`mainMenu` / `demoScene`) with animated transitions, per-scene HUD routing, and a preset assignment system for PP/skybox
- **Task Scheduling** — Threlte-based render pipeline with ordered stages:
  - `physicsStage` — Game logic (runs only in demoScene, pauses in menus)
  - `renderStage` — 3D rendering (default)
  - `uiStage` — UI updates (after render)
  - `audioStage` — Audio (always runs)
- **Studio Extensions** (`VITE_GAME_ENGINE=true`) — Threlte Studio toolbar panels:
  - `SceneExtension` — Scene switcher + preset manager (assign PP/skybox presets per scene or globally)
  - `PostProcessingExtension` — 25+ effects, preset save/load/update, bundled presets, conflict detection
  - `SkyboxExtension` — 11 sky presets, 5 star configs, animated transitions, user presets
  - `SoundExtension` — Volume controls + audio channel toggles
  - `LoggerExtension` — Per-channel log toggles (engine, settings, sound, postprocessing, skybox, cache, gltf)
  - `GltfViewerExtension` — Load GLTF/GLB from file or path; transform, multi-animation with crossfade blending
- **Sound system** — Polyphonic + one-shot audio, never unmounts, safe from race conditions
- **Settings** — Persistent audio, graphics quality (DPR + power preference), UI visibility — saved to localStorage
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

### Extensions
Each extension is self-contained: reactive state (`.svelte.ts`), actions, and a Studio UI panel (dev only).

```
extensions/
├── scene/              # Scene state machine + preset assignment system
├── settings/           # Persistent audio/graphics/general settings
├── postprocessing/     # 25+ effects, presets, bundledPresets.ts
├── skybox/             # Sky + stars presets, bundledPresets.ts
├── sound/              # Positional audio state
├── logger/             # Multi-channel styled logging
└── gltf-viewer/        # GLTF/GLB loader with animation + crossfade (dev only)
```

State always works in production — Studio panels are purely dev-time UI on top of the same state.

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
