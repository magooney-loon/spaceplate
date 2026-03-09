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
    </tr>
  </table>
</div>

---

A minimal, opinionated boilerplate that wires together a Svelte 5 frontend, a Threlte 3D scene, and a SpacetimeDB real-time backend — so you can skip the setup and start building.

## What's included

- **Stage system** — simple state machine (`home` / `galaxy` / `settings`) with per-stage camera positions, animated transitions, and a HUD router
- **Threlte Studio integration** — dev-only toolbar extension for switching stages; easily extend with your own controls
- **Sound system** — polyphonic + one-shot audio, never unmounts, safe from race conditions
- **Settings** — persistent audio, graphics quality (DPR + power preference), and UI visibility — all saved to localStorage
- **Post-processing** — Bloom, SMAA, Vignette via `postprocessing`
- **SpacetimeDB wiring** — connection setup, generated bindings, example table subscription in `HomeHud`
- **Debug logging** — env-gated log channels (`VITE_GAME_ENGINE_LOGS`)

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
