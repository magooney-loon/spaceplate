# Spaceplate

Boilerplate for real-time 3D web apps: **Svelte 5** (runes) + **Threlte 8 / Three.js WebGPU** + **SpacetimeDB 2.x**.
Vite app (not SvelteKit) — single-page, no router, no SSR.

## Repo layout

```
src/               — Frontend: Threlte scenes, HUD overlays, engine core, extensions
                     → see src/CLAUDE.md (index) and the per-area CLAUDE.md files
                       under src/core/, src/extensions/ and src/scenes/
spacetimedb/       — SpacetimeDB module (server): tables, reducers, views
                     → see spacetimedb/CLAUDE.md (API reference)
                     → see spacetimedb/CLI.md   (spacetime CLI reference)
src/module_bindings/ — Generated client bindings — DO NOT EDIT, regenerate instead
public/            — Static assets (sounds, models, textures)
patches/           — pnpm patches for @threlte/extras and @threlte/studio
DOCS/              — webgpu-notes.md (WebGPU/Studio gotchas — read before debugging
                     anything renderer-shaped), RAPIER.md (Rapier physics notes) and
                     best-practices.md (performance reference: what the engine already
                     handles, the open gaps, and the rules for new scene content)
                     are the permanent references. post-processing.md,
                     weather-system.md and scene-environment.md are superseded
                     plans — their content lives in the CLAUDE.md files now and they
                     will be deleted. Plus vendored three.js / threlte sources
                     (three.js-dev/) for reference
```

`DOCS/` is reference material, not app code — Vite denies serving it (`server.fs.deny`).

## Commands

```bash
pnpm dev                          # Vite dev server
pnpm build                        # Production build (also writes stats.html bundle report)
pnpm preview

pnpm spacetime:generate           # Regenerate src/module_bindings from spacetimedb/
pnpm spacetime:publish:local      # Publish module to local server
pnpm spacetime:publish:local:fresh # Publish with --delete-data
pnpm spacetime:publish            # Publish to maincloud

npx svelte-check                  # Type-check (tsconfig is noEmit)
```

Studio mode (dev-only 3D editor toolbar): `VITE_GAME_ENGINE=true pnpm dev`.

Target database and server live in `spacetime.json` (`spaceplate-j29m7` on `maincloud`).
Client connection host/db come from `VITE_SPACETIMEDB_HOST` / `VITE_SPACETIMEDB_DB_NAME` (see `.env.example`).

## Path aliases

Defined in both `vite.config.ts` and `tsconfig.json` — keep the two in sync when adding one.

| Alias | Path |
|-------|------|
| `$root` | `src/` |
| `$core` | `src/core/` |
| `$extensions` | `src/extensions/` |
| `$scenes` | `src/scenes/` |
| `$lib` | `src/lib/` |
| `$bindings` | `src/module_bindings/` |

## Conventions

- **Svelte 5 runes only** — no stores, no legacy `export let`. Reactive state lives in `.svelte.ts` modules.
- **Plain scoped CSS** in components — no Tailwind, no CSS or Svelte transitions.
- **pnpm** is the package manager (`pnpm@11.5.2`); workspace covers `.` and `spacetimedb`.
- Prettier with tabs + single quotes (`.prettierrc`).

## Editing behavior

- Make the smallest change necessary; don't touch unrelated files, configs, or dependencies.
- Don't invent SpacetimeDB or Threlte APIs — use what exists in the docs above or in this repo.
- Never edit `src/module_bindings/` by hand.
