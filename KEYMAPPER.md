# Keymapper Plan

## Goal

Build a real input-mapping system that:

- works in production without Studio
- persists to `localStorage`
- supports keyboard and gamepad
- can be edited from a Threlte Studio extension when `VITE_GAME_ENGINE=true`
- exposes one runtime API for gameplay code

This should follow the same model as the existing settings system:

- runtime state lives in a `.svelte.ts` module
- Studio is only an editor UI on top of that state
- stored values survive reloads and are available outside Studio

---

## Scope

First version should support:

- keyboard bindings
- standard gamepad bindings
- multiple players in state, with sane defaults for `player1`
- action-based input, not raw key checks
- rebinding from runtime UI and Studio UI
- conflict detection and clear/reset actions

First version does not need:

- per-device deadzone curves UI beyond a simple deadzone value
- WebXR controller mappings
- input profiles synced to backend
- chord bindings like `Ctrl+Shift+X`
- text-input-safe context routing beyond a basic "ignore while capturing" rule

---

## Core Design

### 1. Input is action-based

Game code should ask for actions like:

- `moveForward`
- `moveBackward`
- `moveLeft`
- `moveRight`
- `jump`
- `interact`
- `pause`
- `toggleUi`

Game code should not care whether the source was:

- `KeyW`
- `ArrowUp`
- gamepad left stick
- gamepad south button

That abstraction is the whole point of the keymapper.

### 2. Runtime state owns the truth

Create a new extension:

```text
src/extensions/input/
  input.svelte.ts
  types.ts
  useInput.ts
  InputExtension.svelte
```

Optional later:

```text
  InputCapture.svelte
  gamepad.ts
```

`input.svelte.ts` is the single source of truth.

### 3. Studio only edits runtime state

Like audio/settings:

- production uses `inputState` and `inputActions`
- Studio UI edits the same state
- nothing input-critical lives only inside `InputExtension.svelte`

---

## Player Model

Use player slots even if only one player is active now.

```ts
type PlayerId = 'player1' | 'player2' | 'player3' | 'player4';
```

Initial implementation should fully support `player1`.

`player2+` should exist in types and storage shape so the system does not need redesign later.

---

## Action Model

Use named gameplay/UI actions.

### Digital actions

```ts
type InputAction =
  | 'moveForward'
  | 'moveBackward'
  | 'moveLeft'
  | 'moveRight'
  | 'jump'
  | 'interact'
  | 'pause'
  | 'toggleUi'
  | 'primaryAction'
  | 'secondaryAction'
  | 'openSettings'
```

### Analog actions

For the first version, store analog mappings as named axes instead of arbitrary expressions:

```ts
type InputAxisAction =
  | 'moveX'
  | 'moveY'
  | 'lookX'
  | 'lookY'
```

This keeps the runtime simple and covers the important cases.

---

## Binding Model

Support multiple bindings per action.

### Keyboard binding

```ts
type KeyboardBinding = {
  id: string;
  device: 'keyboard';
  code: string;
}
```

Use `KeyboardEvent.code`, not `key`.

Reason:

- `code` is layout-stable
- it matches game-style rebinding expectations
- `Ctrl+H` in `App.svelte` already demonstrates code-driven keyboard handling logic

### Gamepad button binding

Use semantic button names, not raw indices in saved state.

```ts
type GamepadButton =
  | 'clusterBottom'
  | 'clusterRight'
  | 'clusterLeft'
  | 'clusterTop'
  | 'leftBumper'
  | 'rightBumper'
  | 'leftTrigger'
  | 'rightTrigger'
  | 'select'
  | 'start'
  | 'center'
  | 'leftStickButton'
  | 'rightStickButton'
  | 'directionalTop'
  | 'directionalBottom'
  | 'directionalLeft'
  | 'directionalRight';

type GamepadButtonBinding = {
  id: string;
  device: 'gamepad';
  button: GamepadButton;
}
```

These names match `@threlte/extras` `useGamepad` semantics.

### Gamepad axis binding

```ts
type GamepadAxis =
  | 'leftStickX'
  | 'leftStickY'
  | 'rightStickX'
  | 'rightStickY';

type GamepadAxisBinding = {
  id: string;
  device: 'gamepad-axis';
  axis: GamepadAxis;
  direction?: 'positive' | 'negative';
}
```

Use axis bindings for:

- digital action fallback if needed
- analog action assignment

---

## State Shape

Recommended shape:

```ts
type PlayerInputMap = {
  actions: Record<InputAction, Array<KeyboardBinding | GamepadButtonBinding | GamepadAxisBinding>>;
  axes: Record<InputAxisAction, GamepadAxisBinding | null>;
  gamepad: {
    enabled: boolean;
    index: number | null;
    deadzoneLeftStick: number;
    deadzoneRightStick: number;
  };
};

type InputCaptureState = {
  active: boolean;
  playerId: PlayerId | null;
  action: InputAction | InputAxisAction | null;
  bindingType: 'action' | 'axis' | null;
  startedAt: number | null;
};

type InputRuntimeState = {
  connectedGamepads: Array<{
    index: number;
    id: string;
    connected: boolean;
  }>;
  keyboardPressed: Record<string, boolean>;
  lastInputSource: 'keyboard' | 'gamepad' | null;
};

type InputState = {
  players: Record<PlayerId, PlayerInputMap>;
  capture: InputCaptureState;
  runtime: InputRuntimeState;
};
```

Important separation:

- `players` is persistent
- `capture` is transient UI state
- `runtime` is transient live input state

Do not store transient pressed-state data in `localStorage`.

---

## Persistence

Use one dedicated storage key:

```ts
const INPUT_SETTINGS_KEY = 'spaceplate-input-settings';
```

Persist only:

- player bindings
- gamepad enable/index/deadzone settings

Do not persist:

- currently pressed keys
- currently connected pads
- capture mode state

### Default loading rule

Follow the same pattern as `settings.svelte.ts`:

- load from `localStorage`
- validate shape
- fall back to defaults if invalid

### Reset behavior

Add:

- `resetPlayerBindings(playerId)`
- `resetAction(playerId, action)`
- `resetAxis(playerId, axis)`
- `resetAllInputSettings()`

---

## Default Bindings

### Player 1 keyboard defaults

```ts
moveForward:  KeyW, ArrowUp
moveBackward: KeyS, ArrowDown
moveLeft:     KeyA, ArrowLeft
moveRight:    KeyD, ArrowRight
jump:         Space
interact:     KeyE
pause:        Escape
toggleUi:     KeyH + ctrlHandledSpecialCase? no
primaryAction: Mouse later, gamepad now optional
secondaryAction: KeyQ
openSettings: Comma
```

Important:

- `toggleUi` should not be implemented as a plain `KeyH` action if the intended shortcut is `Ctrl+H`
- global meta shortcuts like the current HUD toggle should remain handled explicitly in the app-level listener

Recommended approach:

- keep `Ctrl+H` as a dedicated app shortcut for now
- later extend keymapper with modifier-aware bindings if needed

### Player 1 gamepad defaults

```ts
moveX: leftStickX
moveY: leftStickY
lookX: rightStickX
lookY: rightStickY

jump: clusterBottom
interact: clusterRight
pause: start
primaryAction: rightTrigger
secondaryAction: leftTrigger
openSettings: select
```

For digital movement fallback:

```ts
moveForward: directionalTop
moveBackward: directionalBottom
moveLeft: directionalLeft
moveRight: directionalRight
```

---

## Runtime API

Gameplay code should consume a clean API, not raw binding tables.

### Exports

`input.svelte.ts` should export:

```ts
export const inputState
export const inputActions
export const inputQueries
```

### `inputActions`

Recommended actions:

```ts
startCapture(playerId, target, bindingType)
cancelCapture()
bindKeyboard(playerId, action, code)
bindGamepadButton(playerId, action, button)
bindGamepadAxis(playerId, axisAction, axis)
removeBinding(playerId, action, bindingId)
clearActionBindings(playerId, action)
setGamepadEnabled(playerId, enabled)
setGamepadIndex(playerId, index)
setDeadzone(playerId, stick, value)
resetAction(playerId, action)
resetAxis(playerId, axis)
resetPlayerBindings(playerId)
```

### `inputQueries`

Recommended runtime helpers:

```ts
isPressed(playerId, action): boolean
wasPressed(playerId, action): boolean
getAxis(playerId, axisAction): number
getMoveVector(playerId): { x: number; y: number }
```

`wasPressed` needs per-frame edge detection. That can be implemented once the runtime update loop exists.

---

## Keyboard Input Handling

### App-level listeners

Keyboard events should be registered centrally, likely in `App.svelte` or a dedicated `InputCapture` component mounted once.

Needed listeners:

- `keydown`
- `keyup`
- optionally `blur` to clear pressed keys when the window loses focus

### Rules

- ignore repeats for one-shot capture logic where appropriate
- do not capture while typing in `input`, `textarea`, or contenteditable fields
- when capture mode is active, the next valid keyboard/gamepad input becomes the binding
- `Escape` during capture should cancel

### About `Ctrl+H`

Current behavior in `App.svelte`:

- `Ctrl+H` toggles UI visibility directly through `generalActions.toggleUiVisible()`

Keep that pattern for global engine shortcuts.

Reason:

- modifier shortcuts are a separate problem from simple action mappings
- this keeps player mappings clean
- it avoids conflicts between game input and editor/system shortcuts

Later, global shortcuts can become a second input layer:

- player actions
- engine/editor shortcuts

---

## Gamepad Support

Use `useGamepad` from `@threlte/extras` for the actual device read layer.

### Recommended strategy

Create a small component mounted once inside the app or scene tree:

```text
src/extensions/input/InputGamepads.svelte
```

It should:

- create `useGamepad({ index: 0 })`
- optionally create more indexes later
- update transient runtime state
- drive capture mode for gamepad buttons/axes

### Why a component

`useGamepad` is a hook tied to Svelte component context, so the live gamepad polling should happen in a mounted component, not directly inside a plain `.ts` module.

That component should write into `inputState.runtime`.

### Mapped controls to support first

- `leftStick`
- `rightStick`
- all standard face buttons
- bumpers
- triggers
- start/select
- dpad
- stick buttons

### Deadzone handling

Apply deadzones in runtime queries, not in saved bindings.

Per-player values:

- `deadzoneLeftStick`
- `deadzoneRightStick`

Recommended default:

```ts
0.2
```

### Connected pad selection

Per player:

- `gamepad.enabled`
- `gamepad.index`

If `index` is `null`:

- use the first connected matching standard gamepad for that player

If explicit index is set:

- prefer that gamepad only

---

## Capture Flow

### Keyboard capture

1. user clicks "rebind Jump"
2. `startCapture('player1', 'jump', 'action')`
3. UI shows "Press a key or gamepad button"
4. next valid `keydown` assigns the binding
5. save to storage
6. exit capture mode

### Gamepad capture

1. capture mode starts
2. runtime listens for first button `down` event or strong axis movement
3. assign semantic button/axis name
4. save to storage
5. exit capture mode

### Axis capture threshold

For analog sticks during capture:

- require absolute axis value > `0.5`

This prevents noise from creating accidental bindings.

---

## Conflict Policy

Need deterministic behavior.

### Same binding used by multiple actions

Allow it, but show warning in UI.

Reason:

- users sometimes want duplicate mappings
- hard-blocking causes friction

### Same action with multiple bindings

Allow it.

This is required.

### Capture replacement mode

Provide two operations:

- `Add Binding`
- `Replace Binding`

Default Studio/runtime UI should probably use `Replace` for clarity and include a separate add button.

---

## Studio Extension UI

Create:

```text
src/extensions/input/InputExtension.svelte
```

### Panel sections

- `Player`
  - active player selection
  - connected gamepad info
- `Actions`
  - one row per digital action
  - current bindings
  - rebind / add / clear / reset
- `Axes`
  - `moveX`, `moveY`, `lookX`, `lookY`
  - current axis assignment
  - deadzone controls
- `Gamepad`
  - enabled toggle
  - gamepad index select
- `Capture`
  - current capture target
  - cancel button
- `Utilities`
  - reset player
  - reset all

### Important rule

Studio UI must call `inputActions`, not mutate persisted state directly.

The current `SoundExtension.svelte` bypasses some setting actions via direct mutation. Do not repeat that pattern here.

---

## Runtime UI

Later, player-facing settings UI should use the same state/actions.

Likely target:

```text
src/scenes/SettingsHud.svelte
```

That UI should expose:

- current keyboard bindings
- gamepad enabled/index
- deadzones
- reset buttons
- capture prompt

Same state, same actions, no separate logic.

---

## Integration Points

### App-level

`App.svelte`

- central `keydown` / `keyup` listeners
- clear pressed state on blur
- preserve explicit global engine shortcuts like `Ctrl+H`

### Scene/gameplay-level

Gameplay systems should read:

```ts
inputQueries.isPressed('player1', 'jump')
inputQueries.getAxis('player1', 'moveX')
```

Not:

```ts
window.addEventListener(...)
e.key === 'w'
```

### Debug logging

Input should get its own logger channel later:

- `input`

Useful logs:

- capture started/cancelled/completed
- gamepad connected/disconnected
- binding reset
- invalid storage fallback

---

## Proposed File Plan

### Phase 1: state and types

```text
src/extensions/input/types.ts
src/extensions/input/input.svelte.ts
src/extensions/input/useInput.ts
```

### Phase 2: runtime listeners

```text
src/extensions/input/InputGamepads.svelte
```

and wire keyboard listeners in `App.svelte`

### Phase 3: Studio editor

```text
src/extensions/input/InputExtension.svelte
```

and register it in `App.svelte`

### Phase 4: player-facing settings UI

integrate into `SettingsHud.svelte`

---

## Suggested Defaults

### Storage

```ts
spaceplate-input-settings
```

### Deadzones

```ts
leftStick: 0.2
rightStick: 0.2
```

### Gamepad player assignment

```ts
player1.index = 0
player2.index = 1
player3.index = 2
player4.index = 3
```

This is a good default, even if only `player1` is used at first.

---

## Constraints

- use `KeyboardEvent.code`
- keep runtime logic outside Studio components
- persist only real settings, not transient input state
- global engine shortcuts stay explicit until modifier-aware mapping exists
- game code consumes semantic actions, not browser events
- support both keyboard and gamepad from the same action layer

---

## Recommended Next Step

Implement the base extension with:

1. `src/extensions/input/types.ts`
2. `src/extensions/input/input.svelte.ts`
3. `src/extensions/input/useInput.ts`
4. app-level keyboard state wiring in `App.svelte`
5. minimal `InputExtension.svelte` for player1 keyboard bindings first

Then add gamepad capture and axis queries on top of that base.
