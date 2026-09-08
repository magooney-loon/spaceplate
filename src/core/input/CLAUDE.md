# Input (`src/core/input/`)

```
Keymapper.svelte      — the app's ONE keyboard/mouse listener (OUTSIDE <Canvas>)
InputRuntime.svelte   — input frame stage + invalidate hook + gamepad (INSIDE <PhysicsWorld>)
GamepadInput.svelte   — useGamepad (@threlte/extras) → device state, per-stick deadzones
domGuards.ts          — isTypingTarget / isUiTarget, the single copy
MouseLook.svelte      — mouse-look rig (mount in a scene to enable pointer-locked look)
mouseLook.svelte.ts   — mouse look state + pointer lock lifecycle (cross-browser hardened)
```

The **input extension** (`$extensions/input`) owns slots, bindings and persistence —
`carControls.pressed('throttle')`; the device plumbing lives here. Read
`extensions/input/CLAUDE.md` first, then this.

## The two halves, and why they are two

- **`Keymapper.svelte` is outside `<Canvas>`** (App.svelte mounts it first). The settings
  overlay and its capture banner are HTML siblings of the canvas, and with
  `capabilityState.tier === 'none'` there is no canvas at all — rebinding still has to work.
- **`InputRuntime.svelte` is inside `<PhysicsWorld>`**, and that mount point is
  load-bearing: it pins its own stage `before: simulationStage`, and that stage only exists
  inside the Rapier world. `useGamepad` also needs Threlte context.

## Keymapper — the DOM concerns, and nothing else

- **Typing guard first.** Studio's tweakpane panes are real `<input>`s, so nothing reaches a
  slot while one is focused. This is why `TestGame.svelte` had its own copy of
  `isTypingTarget`; `domGuards.ts` is the single one now.
- **Keyup is NEVER guarded**, only keydown. A key pressed in the game and released after
  focus moved into a tweakpane field would otherwise stay held forever.
- **`preventDefault` only for codes bound to a slot in an ACTIVE map** — arrows must not
  scroll the page while driving, and an unbound key stays the browser's. It runs **before**
  the auto-repeat bail: a held ArrowDown fires repeats, and skipping those would scroll from
  the second event on.
- **Ctrl/Meta chords never reach a slot.** Ctrl+H (UI toggle) is hardcoded here — a chord is
  something the slot system deliberately cannot express; the engine map's `toggleUi` slot
  exists only to name it in one place.
- **Blur and tab-hide release every device.** A key let go while unfocused sends no keyup,
  and a stuck pedal is the result. This is the job TestGame's `heldCodes` set used to do
  per-scene.
- Capture (rebinding) takes priority over everything except Ctrl+H; Escape cancels.

## InputRuntime — the frame, and on-demand rendering

One task, in a stage pinned `before: simulationStage`, advancing the input frame counter.
It must run **every animation frame, rendered or not** — an edge stamped while on-demand
rendering is idle still has to expire — so it is a plain stage task, never
`{ after: autoRenderTask }`.

It also hands `invalidate` to the extension via `setInputChangeHandler`, so a stick pushed
in an otherwise still scene asks for the frame that will show the result.

## GamepadInput — wrapping `useGamepad`, not reimplementing it

`useGamepad` from `@threlte/extras` already owns standard-mapping button names, the
vendor:product table for non-standard pads, hotplug, analog triggers and an
`autoInvalidate: false` poll. Its button names (`clusterBottom`, `leftTrigger`, …) are the
ones our binding types were copied from. What it does not do — bindings, persistence, a
settings UI — is the part that lives in the extension.

- **Registered `{ after: gamepad.task }`**, which puts it in useGamepad's own (main) stage,
  right behind the poll that fills it. The input frame stage runs earlier, before
  simulation, so a poll placed there would read the previous frame's snapshot.
- **Deadzones are applied here, not by `useGamepad`.** Its `axisDeadzone` is one number for
  the whole pad and a hard cut; Settings exposes a per-stick value, and the magnitude is
  **rescaled** from (deadzone…1] onto (0…1] so a slow stick stays usable instead of snapping
  to zero and then jumping.
- **Keyed on the pad index by the parent** — `useGamepad` takes its options once, so
  selecting a different pad is a fresh instance.
- One last zeroed frame on unplug, so a held trigger doesn't stay held.

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

```ts
import { mouseLookState, mouseLookActions, BASE_SENS } from '$core';
// yaw/pitch in radians — consume them from a task to drive a camera
```

## MouseLook.svelte — currently unused

Mount inside a scene to enable it: auto-requests lock on mount, falls back to the first
non-UI click/keydown, releases on unmount. No scene mounts it today — DemoScene dropped it;
the demo camera is a static `[0, 1, 12]` vantage.

**`aiming` is the scene's to supply**, not the engine's: it used to read
`isPressed('player1', 'secondaryAction')` from the old FPS action enum, and the engine no
longer declares any gameplay slot to have an opinion about.

```svelte
<MouseLook aiming={() => fpsControls.pressed('aim')} />
```
