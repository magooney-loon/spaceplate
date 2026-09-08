# Input — the slot system

> **Status: steps 1–4 built, step 5 (TestGame) outstanding.** The engine side is done and the
> reference material has already moved into `src/extensions/input/CLAUDE.md` +
> `src/core/input/CLAUDE.md` — read those for how the system works. What is left here is the
> RATIONALE (why the old system was replaced, what was considered and rejected) and the
> TestGame migration table. Delete this file once step 5 lands and its table is folded into
> `src/scenes/TestGame/CLAUDE.md`.
>
> Two things ended up different from the plan below, both for the better; the CLAUDE.md files
> carry the corrected version:
>
> - **Bindings are one flat list per slot**, for axis and button slots alike, with `dir` on
>   the binding. The plan had axis slots carrying separate `negative`/`positive`/`stick`
>   fields, which would have meant two storage shapes, two UI shapes and two evaluator paths.
> - **Edges always stamp the NEXT frame**, for keyboard and gamepad alike, rather than the
>   plan's per-device offset. The gamepad poll runs in the main stage, after simulation, so
>   stamping the current frame would have hidden its edges from the physics stage entirely.

## Why

The engine currently hardcodes a **22-action FPS enum** — `moveForward`, `jump`, `reload`,
`slot1`… — in three places at once: `extensions/input/types.ts` declares it,
`extensions/input/input.svelte.ts` gives it defaults, and `MainMenu/SettingsHud.svelte`
re-declares the whole thing a third time as `ACTION_GROUPS` + `ACTION_LABELS` for display.
Adding one action means editing three files; shipping a game that isn't an FPS means editing
all three and deleting most of what's there.

TestGame is the proof: it needs `↑ ↓ ← → Space Q E Shift` plus five latched switches, none of
which is an FPS action, so it built its own `svelte:window` keymap in
`sim/carInput.svelte.ts` and the shared system went unused. Nothing in the app calls
`inputQueries` today except `MouseLook.svelte` (itself unmounted), and `advanceInputFrame()`
— the thing that makes `wasPressed` work at all — is called by nobody, so edge detection has
never functioned.

**The fix is to invert ownership.** The engine stops knowing what actions exist. It owns
devices, binding, rebinding, persistence and the settings UI; the *game* declares what its
inputs are called, how they're grouped, what they default to, and reads them back. The unit of
that declaration is a **slot**.

## The model

```
     GAME                          ENGINE
     ────                          ──────
     input map  ──declares──▶  registry ──▶ Settings ▸ Controls (generic UI)
       slots                       │
         │                    device state (keyboard / mouse / gamepad)
         │                         │
         └────────reads───────  slot states  ◀── bindings (defaults ⊕ user overrides)
```

- **Slot** — one rebindable input line. Has a stable id, a human label, a group, a type, and a
  list of default bindings. `throttle`, `handbrake`, `steer`.
- **Binding** — one physical thing that drives a slot: a key code, a mouse button, a gamepad
  button, a gamepad stick axis. A slot holds a *list* — several bindings can drive one slot
  (both Shift keys are one nitrous pedal).
- **Input map** — a named set of slots, declared by a game/scene. `testgame.car`.
- **Active** — a map only listens and only appears in Settings while it is active. Scenes
  activate their map on mount and release it on unmount.

The engine ships exactly **one** built-in map — `engine`, holding `toggleUi` and
`openSettings` — and no gameplay actions of any kind. There is no built-in FPS map; a
first-person game declares its own, same as everyone else.

## Slot types

Two, and only two.

### `button`

Digital, held. Analog when a binding provides it (a gamepad trigger drives `value` 0–1 while
`pressed` is the digital reading past a threshold).

```ts
throttle: { label: 'Throttle', group: 'Driving', defaults: [key('ArrowUp'), pad('rightTrigger')] }
```

### `axis`

Bipolar, −1…+1. Declared with two key sets and an optional stick, so steering is **one row**
in the settings UI rather than two, and gets analog stick input for free.

```ts
steer: {
  type: 'axis', label: 'Steering', group: 'Driving',
  negative: [key('ArrowLeft')], positive: [key('ArrowRight')],
  stick: stick('leftStick', 'x')
}
```

There is no `toggle` type. **Latched switches are game state, not engine state.** Headlights,
ignition and view mode are `button` slots as far as the engine is concerned; the game
subscribes to their press edge and does its own latching. The engine has no business knowing
that `lights` is a switch and `handbrake` is a pedal — that's the semantics the game owns, and
baking it in is how we got a 22-action FPS enum in the first place.

## Declaring a map

Plain `.ts` — the definition is data, only the engine's binding store is `$state`.

```ts
// src/scenes/TestGame/sim/carControls.ts
import { defineInputMap, key, mouse, pad, stick } from '$extensions/input';

export const carControls = defineInputMap({
	id: 'testgame.car',
	label: 'Car',
	slots: {
		throttle:  { label: 'Throttle',   group: 'Driving', defaults: [key('ArrowUp'),    pad('rightTrigger')] },
		brake:     { label: 'Brake',      group: 'Driving', defaults: [key('ArrowDown'),  pad('leftTrigger')] },
		handbrake: { label: 'Handbrake',  group: 'Driving', defaults: [key('Space'),      pad('clusterRight')] },
		nitrous:   { label: 'Nitrous',    group: 'Driving', defaults: [key('ShiftLeft'), key('ShiftRight'), pad('clusterBottom')] },
		shiftUp:   { label: 'Shift Up',   group: 'Gearbox', defaults: [key('KeyE'),       pad('rightBumper')] },
		shiftDown: { label: 'Shift Down', group: 'Gearbox', defaults: [key('KeyQ'),       pad('leftBumper')] },
		steer: {
			type: 'axis', label: 'Steering', group: 'Driving',
			negative: [key('ArrowLeft')], positive: [key('ArrowRight')],
			stick: stick('leftStick', 'x')
		},
		lights:    { label: 'Headlights',      group: 'Car', defaults: [key('KeyL')] },
		highBeam:  { label: 'Main Beam',       group: 'Car', defaults: [key('KeyK')] },
		ignition:  { label: 'Ignition',        group: 'Car', defaults: [key('KeyM')] },
		handling:  { label: 'Handling Setup',  group: 'Car', defaults: [key('KeyG')] },
		view:      { label: 'View / Debug Rig', group: 'Car', defaults: [key('KeyB')] }
	}
});
```

`defineInputMap` returns a **module singleton handle**, immediately, with no lifecycle. That's
deliberate: `sim/controller.ts` is a plain module created by the scene, and `carAudio.ts`,
`CarHeadlights.svelte` and `DebugRig.svelte` are scattered across the tree. They import the
handle directly, exactly as they import `carInput` today — no prop drilling, no context.

Declaring a map registers it (so Settings can list it). It does **not** activate it.

## Activating a map

```svelte
<script>
	import { useInputMap } from '$extensions/input';
	import { carControls } from './sim/carControls';

	useInputMap(carControls); // active while this component is mounted
</script>
```

`useInputMap` activates on mount and releases on destroy. Non-component callers use
`activateInputMap(map)`, which returns a disposer.

While inactive a map's slots read as zero, its bindings don't `preventDefault`, and it doesn't
appear under Settings ▸ Controls. Two active maps may bind the same key — both fire. That's a
feature (a vehicle map and a camera map coexisting), not a conflict.

## Reading a map

```ts
carControls.pressed('handbrake');        // boolean — live, always current
carControls.value('throttle');           // 0..1 — analog if the active binding is analog
carControls.axis('steer');               // -1..1
carControls.vector('steer', 'pitch');    // { x, y } — scratch object, don't retain
carControls.justPressed('shiftUp');      // edge, latched for one frame
carControls.justReleased('handbrake');
carControls.slot('throttle');            // stable SlotState — { pressed, value, ... }
carControls.on('lights', 'press', fn);   // edge callback; returns an unsubscribe
```

### `pressed` / `value` / `axis` are live, not frame-sampled

Keyboard and mouse are event-driven, so slot states are recomputed **in the DOM event
handler**; the gamepad is recomputed **in its poll task**. There is no "sample the input at the
top of the frame" step, which means there is no stale-by-one-frame hazard anywhere and these
are correct to call from a physics task, a render task or a HUD alike.

They are also **allocation-free and cache-free at the call site**: slot states are stable plain
objects updated on device change, so `pressed()` is a map lookup and a field read. `carSim`'s
budget is safe. For the hottest paths, hoist the `SlotState` once:

```ts
const throttle = carControls.slot('throttle');
// per physics step:
if (throttle.pressed) { … }
```

### `justPressed` is a frame latch — **do not poll it from a physics task**

Edges are set by the event and cleared by an end-of-frame task (`{ after: autoRenderTask }`,
the last thing in the frame), so they are visible to every stage for exactly one frame. But a
`usePhysicsTask` runs `ceil(accumulator / rate)` times per frame — 0 or 1 at 60 Hz, 3–4 at
200 Hz — so a polled `justPressed` fires **zero or several times** per real key press. This is
the same substep hazard `CarWheels` and `CarExhaustFlames` already document.

**The rule:**

| Kind of input                        | How to read it                                            |
| ------------------------------------ | --------------------------------------------------------- |
| Continuous (throttle, steer, brake)  | `pressed()` / `value()` / `axis()` — anywhere, incl. physics |
| Discrete (shift, toggle, fire once)  | `on(slot, 'press', fn)` — fires exactly once per real edge |
| Discrete, in a render-stage task     | `justPressed()` is fine (render stage runs once per frame) |

`on()` callbacks fire from the originating event (keydown) or the gamepad poll, so they cannot
be missed and cannot double-fire, including for a limiter-bounce-style edge that comes and goes
inside one rendered frame.

## Devices

### Keyboard — `KeyboardEvent.code`, never `.key`

Codes are physical positions, so a binding survives layout switches and modifier state
(`ShiftLeft` is a binding, not a modifier that transforms other bindings). This is also where
Threlte's `useInputMap` diverges from us — it matches on `.key`, case-insensitively, which
means `Shift` can never be a normal held binding and an AZERTY user's WASD is QZSD.

### Mouse

Buttons only (`left` / `right` / `middle`). Mouse *movement* is not a slot — that's
`core/input/mouseLook.svelte.ts`, which stays exactly as it is. Wheel is out of scope until
something needs it.

### Gamepad — wrap `useGamepad` from `@threlte/extras`

We do **not** reimplement gamepad polling. `useGamepad()` already gives us standard-mapping
button names, per-stick deadzones, connection tracking, a vendor:product mapping table for
non-standard pads, analog trigger values and its own edge flags — and its button names
(`clusterBottom`, `leftTrigger`, `directionalTop`) are exactly the ones our current `types.ts`
copied out of it anyway.

The wrapper is one component, `core/input/InputRuntime.svelte`, mounted **inside `<Canvas>`**
(`useGamepad` is a Threlte hook and needs the context; keyboard/mouse stay in `Keymapper.svelte`
outside it). It runs one task, ordered after `gamepad.task`, which reads the pad into the
device state and recomputes affected slots.

Consequence, accepted: with `capabilityState.tier === 'none'` there is no Canvas, so there is
no gamepad. There is also no game, so this is free.

### What we take from Threlte, and what we don't

| Threlte              | Verdict                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `useGamepad`         | **Wrap it.** Standard mappings + deadzones + analog + hotplug, already solved.                                                   |
| `useKeyboard`        | **No.** `.key`-based (see above), and it needs Threlte context — our capture UI and HUD live outside the Canvas.                 |
| `useInputMap`        | **No, but copy the shape.** Its `ActionState` / `action` / `axis` / `vector` API is the right ergonomics and we mirror it. What we can't use: bindings are frozen inside the definition function, so there is no runtime rebinding, no persistence, no settings UI, and no per-scene activation. |

## Bindings, defaults and persistence

A binding is a small discriminated union, authored through helpers:

```ts
key('ArrowUp')                      // { device: 'key',   code: 'ArrowUp' }
mouse('left')                       // { device: 'mouse', button: 'left' }
pad('rightTrigger')                 // { device: 'pad',   button: 'rightTrigger' }
stick('leftStick', 'x')             // { device: 'stick', stick: 'leftStick', axis: 'x' }        — axis slots
padAxis('leftStick', 'y', -1)       // { device: 'padAxis', …, dir: -1, threshold: 0.5 }         — button slots
```

### Store overrides, not the resolved set

localStorage key `spaceplate-input-bindings`, `version: 1`:

```json
{
	"version": 1,
	"maps": { "testgame.car": { "handbrake": [{ "device": "key", "code": "KeyH" }] } },
	"gamepad": { "enabled": true, "index": null, "deadzoneLeftStick": 0.2, "deadzoneRightStick": 0.2 }
}
```

Only slots the player actually changed are stored. A slot with no entry resolves to its code
default, so **changing a default in code reaches existing players** — the current system
serialises the entire resolved map, which freezes every default forever behind whatever was in
a user's browser the first time they loaded the app. Reset = delete the entry.

Entries for maps or slots that no longer exist are **kept, not pruned** (switching git
branches shouldn't destroy your binds) and ignored at resolve time.

The old `spaceplate-input-settings` key is deleted on first boot — clean slate, nothing shipped
depends on it.

## Rebinding & the capture flow

Unchanged in spirit from today, generalised in scope: `startCapture(mapId, slotId, side?)`
where `side` is `'negative' | 'positive'` for axis slots. `Escape` cancels; the next key,
mouse button, pad button or stick deflection binds.

New: **same-map conflict detection.** Binding a code already used by another slot in the same
map flags both rows amber and names the collision. It does not auto-unbind — that's the
player's call, and some collisions are legitimate (a modifier-free game may deliberately double
up). Cross-map collisions are not flagged; different scenes.

**Dev-only extra:** when `VITE_GAME_ENGINE=true`, a key that collides with Studio's bare-letter
binds (`w a s z t r c v m`) is flagged too. TestGame's `KeyM` ignition is the known live case,
documented as accepted in its CLAUDE.md; the point is that the next one gets noticed at bind
time instead of at "why doesn't M work".

## `preventDefault` and typing guards

One owner, in `Keymapper.svelte`:

- A key event whose target is a typing target (`input, textarea, select, [contenteditable]`)
  never reaches any map. Studio's tweakpane panes are real `<input>`s — this is why TestGame
  has its own `isTypingTarget`, and that helper moves into `core/input/domGuards.ts` as the
  single copy.
- A key bound to a slot in an **active** map is `preventDefault`ed (arrows must not scroll the
  page). Nothing else is touched — an unbound key is never swallowed.
- `Ctrl` / `Meta` chords are never treated as slot input, so `Ctrl+H` (UI toggle) and browser
  shortcuts survive.
- `blur` clears all held device state. Slot states recompute, so a Shift released while the
  window was unfocused cannot stick a pedal down — the thing `resetCarInput`'s held-code set
  exists to do today, now handled once for everyone.

## The settings UI becomes generic

`SettingsHud.svelte`'s Controls tab currently hardcodes `ACTION_GROUPS`, `ACTION_LABELS`,
`GAMEPAD_BUTTON_LABELS`, `KEY_CODE_LABELS` and `formatBinding` — ~110 lines of the file. All of
it except the markup moves to `extensions/input/bindingLabels.ts`; the tab then renders:

```
for each registered map (active first)
  for each group in the map
    for each slot in the group   → label + binding chips + add / remove / reset
```

Labels and grouping come from the manifest, so a new slot appears in Settings with no HUD edit,
and a game with no FPS actions shows no FPS actions. Slots marked `system: true`
(`toggleUi`, `openSettings`) stay hidden from the rebind list exactly as today.

An inactive map is shown greyed with its scene name — you can still rebind the car's controls
from the main menu, which you currently cannot do for anything.

## `MouseLook` stops knowing about FPS actions

`MouseLook.svelte` reads `inputQueries.isPressed('player1', 'secondaryAction')` to switch to
aim sensitivity. That action ceases to exist. It takes an optional prop instead:

```svelte
<MouseLook aiming={() => fpsControls.pressed('aim')} />
```

defaulting to `() => false`. The component is unmounted everywhere today, so this costs
nothing now and removes the last engine→FPS coupling.

## Single local player

`PlayerId` and the `player1`–`player4` split are removed. `player2`–`player4` are empty stubs,
no local co-op exists, and carrying a player id through every call site and every settings row
doubles the API and the UI for nothing. `carControls.pressed('handbrake')`, not
`isPressed('player1', 'handbrake')`.

If local multiplayer ever lands, the re-add is mechanical: maps gain an owner and the registry
keys on `(mapId, owner)`. Designing for it now is designing for a game that doesn't exist.

## Reactivity split

Follows the project's existing plain-object / `$state`-mirror rule (`carSim` vs `carHud`, the
sky descriptor vs `skyMeta`):

| Data                                            | Kind          | Why                                                                |
| ----------------------------------------------- | ------------- | ------------------------------------------------------------------ |
| Slot states, held codes, gamepad axes           | plain objects | Read every physics step. `$state` here is an invalidation per key per step, for values no UI renders. |
| Binding overrides, registered maps + active flag | `$state`     | The Settings UI renders exactly this.                              |
| Capture state, connected pads, `lastInputSource` | `$state`     | The capture banner and the System tab render exactly this.         |

## Files

```
src/extensions/input/
  types.ts            — Binding / SlotDef / InputMapDef / SlotState / registry types.  NO game actions.
  input.svelte.ts     — registry, device state, slot resolution, persistence, capture actions
  bindingLabels.ts    — code → human label, binding → chip text (moved out of SettingsHud)
  useInputMap.ts      — Svelte lifecycle activation helper
  engineMap.ts        — the one built-in map: toggleUi, openSettings (system: true)
  index.ts            — barrel

src/core/input/
  Keymapper.svelte    — window keyboard/mouse → device state + capture + preventDefault  (outside Canvas)
  InputRuntime.svelte — useGamepad poll + end-of-frame edge clear                        (inside Canvas)  ← new
  domGuards.ts        — isTypingTarget, the single copy                                                    ← new
  MouseLook.svelte    — takes an `aiming` prop; no longer imports inputQueries
  mouseLook.svelte.ts — unchanged

src/scenes/TestGame/sim/
  carControls.ts        — the car's input map                                                              ← new
  carInput.svelte.ts    — keeps the latched switches + restart token; loses the keymap and held-code set
```

## TestGame migration

Pedals and gearbox move onto the map; latched switches stay TestGame's, driven by `on()`.
`TestGame.svelte`'s `svelte:window` handlers, `CAR_INPUT_KEYS`, `CAR_TOGGLE_KEYS`,
`ACTION_CODES`, `heldCodes`, `setCarInputKey` and `resetCarInput` all delete.

| Today                                | After                                                              |
| ------------------------------------ | ------------------------------------------------------------------ |
| `carInput.up`                        | `throttle.pressed`                                                 |
| `carInput.down`                      | `brake.pressed`                                                    |
| `(carInput.left?1:0)-(carInput.right?1:0)` | `carControls.axis('steer')` — analog stick for free, keys unchanged |
| `carInput.handbrake`                 | `handbrake.pressed`                                                |
| `carInput.nitrous`                   | `nitrous.pressed` — both Shifts are just two bindings on one slot  |
| `carInput.shiftUp/shiftDown`         | `shiftUp.pressed` / `shiftDown.pressed`                            |
| `applyCarToggle('lights')` in keydown | `carControls.on('lights', 'press', () => carLights.on = !carLights.on)` |
| `resetCarInput()` on blur            | engine-side; blur clears device state for every map                |

**The migration is behaviour-preserving and must stay that way.** The driving model's tune is
validated (0-60 5.7 s, the yaw figures, the stability rule) and none of it may move here:
`throttle.pressed` is the same boolean `carInput.up` was, `axis('steer')` returns exactly
±1 or 0 for key input. Analog throttle/brake off a trigger is available afterwards
(`value()`), and taking it is a separate, deliberate tuning change — not part of this.

Left alone: `carLights`, `carIgnition`, `carHandling`, `carView`, `carRestart` and every
consumer of them. They are game state and stay game state. They also keep their current
survives-`reset`, survives-Restart semantics for free, because the engine never touches them.

## Implementation order

1. ~~**Types + registry + resolution**~~ — `types.ts`, `input.svelte.ts`, `engineMap.ts`,
   `defineInputMap` / `useInputMap`. ✅
2. ~~**Keymapper rewrite**~~ — device state, `preventDefault`, `domGuards.ts`, capture
   generalised to `(mapId, slotId, dir)`. ✅
3. ~~**Settings ▸ Controls goes generic**~~ — `bindingLabels.ts`, registry-driven rendering,
   conflict + Studio-collision flags. Old `ACTION_*` tables deleted. ✅
4. ~~**Gamepad**~~ — `InputRuntime.svelte` + `GamepadInput.svelte` wrapping `useGamepad`,
   analog `value()`, stick axes, per-stick deadzones, the connected-pad list. ✅
5. **TestGame migration** — `sim/carControls.ts`, the table above, delete the old keymap.
   **Verified by driving it, not by inspection** — the driving tune is validated and the
   migration must be behaviour-preserving.
6. **Docs** — fold the TestGame table into `scenes/TestGame/CLAUDE.md`; delete this file.
   (The engine half of the docs already moved — see the status note at the top.)

Steps 1–4 landed together: the old system is unusable in between, and 4 is small enough not
to be worth a separate pass. Until 5 lands, no game has declared a map, so Settings ▸
Controls shows only its empty state and TestGame still drives off its own `svelte:window`
keymap — nothing regressed, nothing gained yet.
