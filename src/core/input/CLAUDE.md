# Input (`src/core/input/`)

```
Keymapper.svelte      — global keyboard/mouse listeners; routes into the input extension
MouseLook.svelte      — mouse-look rig (mount in a scene to enable pointer-locked look)
mouseLook.svelte.ts   — mouse look state + pointer lock lifecycle (cross-browser hardened)
```

The **input extension** (`$extensions/input`) owns button mappings and player state —
`inputQueries.isPressed('player1', 'jump')`; the window listeners themselves live here
in `Keymapper.svelte`.

## Mouse look & pointer lock

Driven by `settingsState.general.mouseSensitivity` / `aimSensitivity`:

- `BASE_SENS = 0.004` rad/px × user sensitivity (`aiming` flag switches to
  `aimSensitivity`).
- `movementX/Y` deltas are consumed **only while pointer-locked** — locked deltas are
  CSS pixels everywhere; unlocked deltas differ per browser/DPI.
- Single-event deltas clamped (±300px) — guards the lock-engagement spike some browsers
  emit.
- Lock is requested on `document.body`, never the canvas (avoids WebGL driver
  interaction).
- Handles promise-based and legacy `requestPointerLock()`; `pointerlockerror` → 800 ms
  retry cooldown; in-flight guard.
- Never locks in Studio mode (`VITE_GAME_ENGINE=true`) or while the settings overlay is
  open; opening the overlay always releases the lock.
- While mounted, `secondaryAction` (RMB / Q) engages aim sensitivity; context menu
  suppressed while locked.

```ts
import { mouseLookState, mouseLookActions, BASE_SENS } from '$core';
// yaw/pitch in radians — consume them from a task to drive a camera
```

## MouseLook.svelte — currently unused

Mount inside a scene to enable it: auto-requests lock on mount, falls back to the first
non-UI click/keydown, releases on unmount. No scene mounts it today — DemoScene dropped
it; the demo camera is a static `[0, 1, 12]` vantage.
