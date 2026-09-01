# Action-Based Input System (`input/`)

## Files

```
types.ts            — PlayerId, InputAction (22), InputAxisAction (4), binding types, runtime state
input.svelte.ts     — $state, inputActions, inputQueries, advanceInputFrame()
useInput.ts         — convenience hook (path import, not barrel)
index.ts            — barrel re-exports state + types only
```

## State shape

- **players**: `Record<PlayerId, PlayerInputMap>` (player1–player4). Each has `actions`, `axes`, `gamepad` config.
- **capture**: Rebinding UI state — `active`, `playerId`, `action`, `bindingType`, `startedAt`.
- **runtime**: `connectedGamepads`, `keyboardPressed`, `mousePressed`, `lastInputSource`. Written by `core/input/Keymapper.svelte`.

## Default player1 bindings

WASD+arrows → move, Space → jump, Shift → sprint, E → interact, Q/RMB → secondary, LMB → primary, R → reload, F → use, C → crouch, X → drop, Z → prone, T → emote, 1–4 → slots, Escape → settings.

`toggleUi` / `openSettings` are engine-reserved — hidden from rebind UI.

## Queries

- `isPressed(playerId, action)` — current frame.
- `wasPressed(playerId, action)` — edge detect, requires `advanceInputFrame()` each frame.
- `getAxis(playerId, axisAction)` — digital fallback for moveX/moveY, returns 0 for look.
- `getMoveVector(playerId)` — `{ x, z }` from moveX + moveY.

## Key behavior

- `advanceInputFrame()` must be called once per frame (in `useTask`) to enable `wasPressed` edge detection.
- Binding IDs use an incrementing counter, not UUIDs.
- localStorage key: `spaceplate-input-settings` with `version: 2`. Only bindings and gamepad config persist.
- Gamepad support is partially implemented — Phase 2 notes indicate analog axes currently fall back to digital key bindings.
