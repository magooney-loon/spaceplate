// The SLOT input system's vocabulary. There are no game actions in this file and
// there must never be any: the engine owns devices, binding and persistence, and
// the GAME declares what its inputs are called (DOCS/input.md).

export const extensionScope = 'input';

// ── Devices ──────────────────────────────────────────────────────────────────

export type MouseButton = 'left' | 'right' | 'middle';

/** Standard-mapping button names — the set `useGamepad` (@threlte/extras) reports. */
export type GamepadButton =
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

export type GamepadStick = 'leftStick' | 'rightStick';
export type StickAxis = 'x' | 'y';

export type InputDevice = 'keyboard' | 'mouse' | 'gamepad';

// ── Bindings ─────────────────────────────────────────────────────────────────
//
// ONE FLAT LIST PER SLOT, whatever the slot's type. `dir` is what lets that work:
// on an AXIS slot it is the sign a binding contributes (so ← and → are two
// bindings on one slot, and inverting a stick is a data change); on a BUTTON slot
// it only selects which way a stick has to be pushed. Storage, the settings UI and
// the evaluator therefore all see the same shape.

/** −1 or +1. Absent means +1. */
export type AxisDir = -1 | 1;

/** `KeyboardEvent.code` — a physical position, so bindings survive layout changes. */
export type KeyBinding = { device: 'key'; code: string; dir?: AxisDir };
export type MouseBinding = { device: 'mouse'; button: MouseButton; dir?: AxisDir };
export type PadBinding = { device: 'pad'; button: GamepadButton; dir?: AxisDir };
export type StickBinding = {
	device: 'stick';
	stick: GamepadStick;
	axis: StickAxis;
	dir?: AxisDir;
};

export type Binding = KeyBinding | MouseBinding | PadBinding | StickBinding;

// ── Slots ────────────────────────────────────────────────────────────────────

export type SlotType = 'button' | 'axis';

export type SlotDef = {
	/** Defaults to `'button'`. */
	type?: SlotType;
	/** Shown in Settings ▸ Controls. */
	label: string;
	/** Section heading in Settings ▸ Controls. Defaults to `'General'`. */
	group?: string;
	defaults?: Binding[];
	/** Engine-reserved: hidden from the rebind UI. */
	system?: boolean;
	/** Never `preventDefault()` this slot's keys. */
	passthrough?: boolean;
};

export type SlotRecord = Record<string, SlotDef>;
export type SlotId<S extends SlotRecord> = keyof S & string;

/**
 * The per-slot reading, a STABLE PLAIN OBJECT — never `$state`. It is recomputed
 * on device change (key event / gamepad poll), so reading it is a field access and
 * costs nothing per physics step, and it produces no Svelte invalidation for values
 * no UI renders. The reactive half of this extension is `inputState` (bindings,
 * capture, connected pads) — the plain/`$state`-mirror split the sky descriptor and
 * `carSim` already use.
 */
export type SlotState = {
	readonly id: string;
	/** Button: `value >= PRESS_THRESHOLD`. Axis: `value !== 0`. */
	pressed: boolean;
	/** Button: 0…1. Axis: −1…+1. Analog when the active binding is analog. */
	value: number;
	/** Frame stamp of the last press edge — compare against `inputFrame()`. */
	pressedFrame: number;
	/** Frame stamp of the last release edge. */
	releasedFrame: number;
};

export type InputEdge = 'press' | 'release';

export type Vec2 = { x: number; y: number };

// ── Maps ─────────────────────────────────────────────────────────────────────

export type InputMapDef<S extends SlotRecord = SlotRecord> = {
	/** Stable, namespaced, and the persistence key: `'testgame.car'`. */
	id: string;
	/** Shown as the section title in Settings ▸ Controls. */
	label: string;
	slots: S;
};

/**
 * The handle `defineInputMap` returns — a module singleton, available immediately,
 * with no lifecycle. Consumers import it directly rather than having it drilled
 * through props; `useInputMap` / `activateInputMap` control whether it is live.
 */
export type InputMap<S extends SlotRecord = SlotRecord> = {
	readonly id: string;
	readonly label: string;
	readonly slots: S;
	/** Whether the map is currently listening. Inactive slots read as zero. */
	readonly active: boolean;

	/** The stable `SlotState` — hoist it out of hot loops. */
	slot(id: SlotId<S>): SlotState;
	pressed(id: SlotId<S>): boolean;
	/** Button: 0…1. Axis: −1…+1. */
	value(id: SlotId<S>): number;
	/** −1…+1 for an axis slot; the digital reading of a button slot otherwise. */
	axis(id: SlotId<S>): number;
	/** Scratch object — read it, don't retain it. */
	vector(x: SlotId<S>, y: SlotId<S>): Vec2;

	/**
	 * Edge, latched for exactly one frame. **Never poll this from a physics task** —
	 * a `usePhysicsTask` runs `ceil(accumulator / rate)` times per frame, so it would
	 * fire zero or several times per real press. Use `on()` there.
	 */
	justPressed(id: SlotId<S>): boolean;
	justReleased(id: SlotId<S>): boolean;

	/**
	 * Edge callback, fired from the originating DOM event or the gamepad poll —
	 * exactly once per real edge, never missed, never doubled. The right tool for
	 * every discrete action (shifting, toggles, one-shot fire).
	 *
	 * @returns unsubscribe
	 */
	on(id: SlotId<S>, edge: InputEdge, fn: () => void): () => void;
};

// ── Reactive state (the settings UI's half) ──────────────────────────────────

export type CaptureState = {
	active: boolean;
	mapId: string | null;
	slotId: string | null;
	/** For an axis slot, which side the captured binding will drive. */
	dir: AxisDir;
	startedAt: number | null;
};

export type GamepadSettings = {
	enabled: boolean;
	/** `null` = first connected pad. */
	index: number | null;
	deadzoneLeftStick: number;
	deadzoneRightStick: number;
};

export type ConnectedGamepad = { index: number; id: string };

/** What the settings UI lists — the static half of a map, plus its live activation. */
export type MapSummary = {
	id: string;
	label: string;
	active: boolean;
	slots: SlotRecord;
};

export type InputState = {
	/** Registered maps, by id. Activation flips `active` in place. */
	maps: Record<string, MapSummary>;
	/** USER OVERRIDES ONLY, by map id then slot id — never the resolved set. */
	overrides: Record<string, Record<string, Binding[]>>;
	capture: CaptureState;
	gamepad: GamepadSettings;
	runtime: {
		connectedGamepads: ConnectedGamepad[];
		lastDevice: InputDevice | null;
	};
};

export type InputActions = {
	startCapture: (mapId: string, slotId: string, dir?: AxisDir) => void;
	cancelCapture: () => void;
	/** Appends to the slot's bindings (deduplicated) and ends any capture. */
	bind: (mapId: string, slotId: string, binding: Binding) => void;
	removeBinding: (mapId: string, slotId: string, binding: Binding) => void;
	/** Drops the override, so the slot falls back to its declared defaults. */
	resetSlot: (mapId: string, slotId: string) => void;
	resetMap: (mapId: string) => void;
	resetAll: () => void;
	setGamepadEnabled: (enabled: boolean) => void;
	setGamepadIndex: (index: number | null) => void;
	setDeadzone: (stick: 'left' | 'right', value: number) => void;
};
