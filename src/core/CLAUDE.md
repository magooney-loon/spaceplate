# Engine core (`src/core/`)

Engine parts shared by every scene/extension. Import from `'$core'` (barrel in
`index.ts`); modules inside core/ import each other directly, never via the barrel
(circular graph). Each area has its own `CLAUDE.md`:

```
Camera.svelte   — PerspectiveCamera + AudioListener; orbits origin in demoScene via mouse look
audio/          — GlobalAudio + sound triggers/actions + weather audio  → audio/CLAUDE.md
input/          — Keymapper, mouse-look rig + pointer-lock lifecycle    → input/CLAUDE.md
skybox/         — everything sky / time / weather / environment         → skybox/CLAUDE.md
postprocessing/ — effect registry + pipeline builder                    → postprocessing/CLAUDE.md
utils/          — engine clock, boot probe, Loader, Renderer, telemetry → utils/CLAUDE.md
```

Cross-cutting rules that span these areas (frame tasks, HUD vs 3D, the WebGPU
entrypoints) live in `src/CLAUDE.md`.
