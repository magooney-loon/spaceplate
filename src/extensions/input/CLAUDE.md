# Slot-based input (`input/`)

**The engine declares no gameplay actions.** It owns devices, binding, rebinding,
persistence and the settings UI; the GAME declares what its inputs are called. The unit of
that declaration is a **slot**. Full design rationale and the migration plan:
`DOCS/input.md`.

```
types.ts          — Binding / SlotDef / InputMap / SlotState / registry types. NO game actions.
input.svelte.ts   — registry, device state, slot evaluation, persistence, capture actions
bindingLabels.ts  — KeyboardEvent.code → human label, binding → chip text, Studio-collision flag
useInputMap.ts    — Svelte lifecycle helper: active while the component is mounted
engineMap.ts      — the ONE built-in map (openSettings, toggleUi) — both `system: true`
index.ts          — barrel; imports engineMap for its side effect
```

## Declaring and using a map

```ts
// plain .ts — the definition is data
export const carControls = defineInputMap({
	id: 'testgame.car',
	label: 'Car',
	slots: {
		throttle: { label: 'Throttle', group: 'Driving', defaults: [key('ArrowUp'), pad('rightTrigger')] },
		steer: {
			type: 'axis', label: 'Steering', group: 'Driving',
			defaults: [key('ArrowLeft', -1), key('ArrowRight', 1), stick('leftStick', 'x')]
		}
	}
});
```

`defineInputMap` returns a **module singleton handle immediately** — no lifecycle, so plain
modules (a sim controller, an audio mixer) import it directly instead of having it drilled
through props. Declaring registers the map so Settings can list it; it does not activate it.

```svelte
useInputMap(carControls); // active while this component is mounted
```

Inactive maps read as zero, don't `preventDefault`, and show dimmed in Settings. Two active
maps may bind the same key — both fire; that's composition, not a conflict.

## Reading

| Call                              | Notes                                                     |
| --------------------------------- | --------------------------------------------------------- |
| `pressed(id)` / `value(id)` / `axis(id)` | **Live, never stale** — safe in physics, render, HUD |
| `slot(id)`                        | The stable `SlotState`; hoist it out of hot loops          |
| `vector(x, y)`                    | Scratch object — read it, don't retain it                  |
| `on(id, 'press'\|'release', fn)`  | Fires once per real edge, from the event; returns unsubscribe |
| `justPressed(id)` / `justReleased(id)` | One-frame latch — see the rule below                  |

**There is no "sample input at the top of the frame" step.** Keyboard and mouse are
recomputed inside the DOM handler, the gamepad inside its poll task, so nothing is ever a
frame stale and slot states are plain objects (a lookup and a field read, no allocation).

**`justPressed` must not be polled from a physics task.** A `usePhysicsTask` runs
`ceil(accumulator / rate)` times per frame — 0 or 1 at 60 Hz, 3–4 at 200 Hz — so it would
fire zero or several times per real press. Same substep hazard `CarWheels` and
`CarExhaustFlames` document. Use `on()` for anything discrete; it fires from the originating
event and cannot be missed or doubled.

## Slot types

Two, and only two. **`button`** (digital held, analog `value` when the binding provides it)
and **`axis`** (bipolar −1…+1). There is no `toggle` type: latched switches are game state.
A game subscribes to a button slot's press edge and does its own latching — the engine has
no business knowing that `lights` is a switch and `handbrake` is a pedal.

Bindings are **one flat list per slot whatever the type**, which is what `dir` buys: on an
axis slot it's the sign a binding contributes (← and → are two bindings on one slot); on a
button slot it only picks which way a stick must be pushed. Storage, the settings UI and the
evaluator all see one shape. Helpers: `key(code, dir?)`, `mouse(button, dir?)`,
`pad(button, dir?)`, `stick(stick, axis, dir?)`.

Evaluation: an axis slot **sums** its digital bindings (both arrows cancel) and lets the
stick **compete on magnitude** rather than add, so key + stick can't reach 2. A button slot
takes the loudest source.

## The frame stamp — why there is no clear pass

An edge stamps `pressedFrame = frameId + 1`, the frame that will observe it, and
`justPressed` is `pressedFrame === frameId`. Nothing to clear, so nothing is left latched
when the render loop is idle or the Canvas never mounted.

**Always the next frame, for both devices**, because the two are found at different points:
a DOM event lands between frames, a gamepad edge inside one (its poll sits in the main
stage, after simulation). Stamping the gamepad's edges with the current frame would hide
them from the physics stage entirely. The rule worth having is uniform: **an edge is
observed by every stage of exactly one frame.** `advanceInputFrame` runs in its own stage
pinned before simulation — `core/input/InputRuntime.svelte`.

## Persistence — overrides, not the resolved set

localStorage `spaceplate-input-bindings`, `version: 1`. **Only slots the player actually
changed are stored**; a slot with no entry resolves to its code default, so changing a
default in code reaches existing players. The pre-slot system serialised the whole resolved
map, which froze every default forever behind whatever was in a user's browser on first
load. Reset = delete the entry. Entries for maps/slots that no longer exist are kept, not
pruned — switching branches shouldn't destroy your binds.

The old `spaceplate-input-settings` key is deleted on boot.

## Reactivity split

The project's plain/`$state`-mirror rule (`carSim` vs `carHud`, sky descriptor vs
`skyMeta`): slot states, held codes and gamepad axes are **plain** — read every physics
step, and `$state` there is an invalidation per key per step for values no UI renders.
`inputState` (bindings, registered maps, capture, connected pads) is `$state`, because that
is exactly what Settings renders.

`setInputChangeHandler` is how on-demand rendering gets told: `InputRuntime.svelte` points
it at Threlte's `invalidate`, so a stick pushed in a still scene asks for the frame that
shows the result. Registered rather than imported, so this extension stays free of Threlte
context.

## Settings ▸ Controls is fully generic

`MainMenu/SettingsHud.svelte` iterates `registeredMaps()` → groups → slots and renders
labels from the manifest. A new slot appears with no HUD edit. `conflictsFor` flags two
slots in the same map sharing a binding (amber ⚠, never auto-unbound — some collisions are
deliberate); `collidesWithStudio` flags Studio's bare-letter binds (`w a s z t r c v m`).
