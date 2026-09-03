# Skybox environment mode (`src/core/skybox/environment/`)

Which environment lights the scene — orthogonal to time and weather.

- `environmentState.mode`: `'sky'` (procedural, default) | `'environment'` (HDR/EXR) |
  `'cube'` (cubemap). `Skybox.svelte` switches on it; in procedural mode the dome +
  `layers/` mount, otherwise Threlte's `<Environment>` / `<CubeEnvironment>` do.
- `environmentActions` — `setMode`, `setEnvTexture`, `setCubeTexture`,
  `toggleEnvBackground`, `toggleCubeBackground`, `toggleEnvGround`. The Studio panel
  drives these like any other caller.
- Mode + last-picked textures persist to localStorage (`spaceplate-skybox-*` keys) as a
  dev convenience. Authored sky data (curve, weathers) is a different story — see
  _Planned: authored sky data_ in `../CLAUDE.md`.
- Texture lists live in `environmentTextures.ts` (`ENV_TEXTURES`, `CUBE_TEXTURES`).
  Register by dropping files into `public/textures/skybox/{hdr,exr,equi_env}/` (or
  6-face sets under `cube/<name>/`, face order px nx py ny pz nz) and adding an entry.

**Why this is core and not an extension:** it used to be `extensions/skybox` state,
but `Skybox.svelte` consumes it in every build — engine state dressed as an optional
add-on, with a backwards core→extensions import. The Studio panel is just a caller.
