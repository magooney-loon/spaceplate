// THE SLOT REGISTRY — devices in, slot readings out.
//
// The engine owns exactly this: physical device state, the binding tables, their
// persistence, and the frame stamps that make edges observable. It owns NO game
// actions; every action is a slot in a map some game declared (DOCS/input.md).
//
// ── The two halves ───────────────────────────────────────────────────────────
// Device state, resolved bindings and slot readings are PLAIN objects, recomputed
// on device change and read by physics tasks — `$state` there is an invalidation
// per key per step for values no UI renders. `inputState` below is the reactive
// half: bindings, capture, connected pads, i.e. exactly what Settings renders.
// Same split as `carSim`/`carHud` and the sky descriptor/`skyMeta`.
//
// ── Why there is no "sample input at the top of the frame" step ───────────────
// Keyboard and mouse are event-driven, so slots are recomputed IN the DOM handler;
// the gamepad is recomputed in its poll task. `pressed`/`value`/`axis` are
// therefore never stale, which is what makes them safe to read from a physics
// task, a render task and a HUD alike. Only EDGES need a frame, and they get one
// through a stamp rather than a clear pass — see `advanceInputFrame`.

import { logInput } from '$extensions/logger';
import type {
	AxisDir,
	Binding,
	GamepadButton,
	GamepadStick,
	InputActions,
	InputEdge,
	InputMap,
	InputMapDef,
	InputState,
	MouseButton,
	SlotDef,
	SlotId,
	SlotRecord,
	SlotState,
	StickAxis,
	Vec2
} from './types';

export type * from './types';

const STORAGE_KEY = 'spaceplate-input-bindings';
/** The pre-slot FPS-enum store. Deleted on boot — nothing shipped depends on it. */
const LEGACY_STORAGE_KEY = 'spaceplate-input-settings';
const STORAGE_VERSION = 1;

/** How far an analog source must travel to read as a digital press. */
export const PRESS_THRESHOLD = 0.5;

// ─────────────────────────────────────────────────────────────────────────────
// Binding helpers — the authoring vocabulary for a map definition.
// ─────────────────────────────────────────────────────────────────────────────

export const key = (code: string, dir?: AxisDir): Binding => ({ device: 'key', code, dir });
export const mouse = (button: MouseButton, dir?: AxisDir): Binding => ({
	device: 'mouse',
	button,
	dir
});
export const pad = (button: GamepadButton, dir?: AxisDir): Binding => ({
	device: 'pad',
	button,
	dir
});
export const stick = (s: GamepadStick, axis: StickAxis, dir?: AxisDir): Binding => ({
	device: 'stick',
	stick: s,
	axis,
	dir
});

/**
 * A binding's identity — used to deduplicate, to remove, to detect conflicts and
 * as the `{#each}` key in the settings UI. Bindings carry no id field of their own
 * on purpose: ids would have to be persisted and regenerated, and this is derivable.
 */
export const bindingKey = (b: Binding): string => {
	const dir = b.dir === -1 ? ':-' : '';
	if (b.device === 'key') return `key:${b.code}${dir}`;
	if (b.device === 'mouse') return `mouse:${b.button}${dir}`;
	if (b.device === 'pad') return `pad:${b.button}${dir}`;
	return `stick:${b.stick}:${b.axis}${dir}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// Device state — plain, event-driven.
// ─────────────────────────────────────────────────────────────────────────────

const heldKeys = new Set<string>();
const heldMouse = new Set<MouseButton>();
/** Analog per button — triggers report 0…1, everything else 0 or 1. */
const padButtons = new Map<GamepadButton, number>();
const padSticks: Record<GamepadStick, Vec2> = {
	leftStick: { x: 0, y: 0 },
	rightStick: { x: 0, y: 0 }
};

/** 0…1 for the raw device behind one binding, ignoring `dir`. */
const rawValue = (b: Binding): number => {
	if (b.device === 'key') return heldKeys.has(b.code) ? 1 : 0;
	if (b.device === 'mouse') return heldMouse.has(b.button) ? 1 : 0;
	if (b.device === 'pad') return padButtons.get(b.button) ?? 0;
	return padSticks[b.stick][b.axis];
};

// ─────────────────────────────────────────────────────────────────────────────
// The frame stamp.
// ─────────────────────────────────────────────────────────────────────────────
//
// An edge sets `pressedFrame` to the frame that will OBSERVE it — always the NEXT
// one, `frameId + 1` — and `justPressed` is `pressedFrame === frameId`. No clear
// pass, so nothing can be left latched when the render loop is idle or the Canvas
// never mounted.
//
// ALWAYS the next frame, for both devices, because the two are found at different
// points: a DOM event lands between frames, a gamepad edge inside one (the poll
// task sits in the main stage, after simulation). Stamping the gamepad's edges with
// the CURRENT frame would hide them from the physics stage entirely, which has
// already run. Uniform is the rule worth having: **an edge is observed by every
// stage of exactly one frame.** `on()` callbacks still fire the instant the edge is
// found, so nothing latency-sensitive pays for it.

let frameId = 0;

/** Advanced once per animation frame, ahead of every stage — `InputRuntime.svelte`. */
export const advanceInputFrame = (): void => {
	frameId++;
};

export const inputFrame = (): number => frameId;

/**
 * Called when any slot's reading changed. `InputRuntime.svelte` points this at
 * Threlte's `invalidate` — `renderMode` is 'on-demand', so a stick pushed in an
 * otherwise still scene has to ask for the frame that will show the result.
 */
let onInputChange: (() => void) | null = null;

export const setInputChangeHandler = (fn: (() => void) | null): void => {
	onInputChange = fn;
};

// ─────────────────────────────────────────────────────────────────────────────
// Registry.
// ─────────────────────────────────────────────────────────────────────────────

type Listeners = { press: Set<() => void>; release: Set<() => void> };

type MapRecord = {
	def: InputMapDef;
	handle: InputMap;
	/** `Object.keys(def.slots)`, cached — evaluation runs on the frame path. */
	slotIds: string[];
	/** Stable, plain, one per slot. */
	states: Record<string, SlotState>;
	/** Defaults ⊕ overrides, flattened to plain arrays so evaluation touches no `$state`. */
	resolved: Record<string, Binding[]>;
	listeners: Record<string, Listeners>;
	/** Activation is counted, so two mounts of the same map behave. */
	activations: number;
};

const registry = new Map<string, MapRecord>();
/** Active records, kept as an array — evaluation walks it every device event. */
let activeRecords: MapRecord[] = [];

const refreshActive = (): void => {
	activeRecords = [...registry.values()].filter((r) => r.activations > 0);
};

// ─────────────────────────────────────────────────────────────────────────────
// Reactive state — the settings UI's half.
// ─────────────────────────────────────────────────────────────────────────────

type StoredBindings = Record<string, Record<string, Binding[]>>;

const loadStored = (): { overrides: StoredBindings; gamepad?: Partial<InputState['gamepad']> } => {
	try {
		localStorage.removeItem(LEGACY_STORAGE_KEY);
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return { overrides: {} };
		const parsed = JSON.parse(raw);
		if (parsed?.version !== STORAGE_VERSION) return { overrides: {} };
		return { overrides: parsed.maps ?? {}, gamepad: parsed.gamepad };
	} catch {
		return { overrides: {} };
	}
};

const stored = loadStored();

export const inputState = $state<InputState>({
	maps: {},
	overrides: stored.overrides,
	capture: { active: false, mapId: null, slotId: null, dir: 1, startedAt: null },
	gamepad: {
		enabled: stored.gamepad?.enabled ?? true,
		index: stored.gamepad?.index ?? null,
		deadzoneLeftStick: stored.gamepad?.deadzoneLeftStick ?? 0.2,
		deadzoneRightStick: stored.gamepad?.deadzoneRightStick ?? 0.2
	},
	runtime: { connectedGamepads: [], lastDevice: null }
});

const save = (): void => {
	try {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				version: STORAGE_VERSION,
				maps: $state.snapshot(inputState.overrides),
				gamepad: $state.snapshot(inputState.gamepad)
			})
		);
	} catch {
		/* private mode / quota — bindings just don't persist */
	}
};

// ─────────────────────────────────────────────────────────────────────────────
// Resolution — defaults ⊕ overrides.
// ─────────────────────────────────────────────────────────────────────────────
//
// Overrides are stored PER SLOT and replace that slot's list entirely; a slot with
// no override uses its declared defaults, which is what lets a default changed in
// code reach players who already have a stored binding table.

/** The bindings actually in force for a slot. Reads `$state` — not for hot paths. */
export const bindingsFor = (mapId: string, slotId: string): Binding[] => {
	const override = inputState.overrides[mapId]?.[slotId];
	if (override) return $state.snapshot(override) as Binding[];
	return registry.get(mapId)?.def.slots[slotId]?.defaults ?? [];
};

const resolveSlot = (rec: MapRecord, slotId: string): void => {
	rec.resolved[slotId] = bindingsFor(rec.def.id, slotId);
};

const resolveMap = (rec: MapRecord): void => {
	for (const slotId of rec.slotIds) resolveSlot(rec, slotId);
};

// ─────────────────────────────────────────────────────────────────────────────
// Evaluation.
// ─────────────────────────────────────────────────────────────────────────────

const clamp1 = (v: number): number => (v < -1 ? -1 : v > 1 ? 1 : v);

/** @returns whether this slot's reading moved. */
const evaluateSlot = (rec: MapRecord, slotId: string): boolean => {
	const def: SlotDef = rec.def.slots[slotId];
	const state = rec.states[slotId];
	const bindings = rec.resolved[slotId];

	let value = 0;
	if (def.type === 'axis') {
		// Digital bindings SUM (both arrows held cancels, as they should); the stick
		// competes on magnitude rather than adding, so key + stick can't reach 2.
		let digital = 0;
		let analog = 0;
		for (const b of bindings) {
			const dir = b.dir ?? 1;
			if (b.device === 'stick') {
				const v = rawValue(b) * dir;
				if (Math.abs(v) > Math.abs(analog)) analog = v;
			} else if (rawValue(b) >= PRESS_THRESHOLD) {
				digital += dir;
			}
		}
		digital = clamp1(digital);
		value = Math.abs(analog) > Math.abs(digital) ? analog : digital;
	} else {
		// Loudest source wins — a trigger at 0.3 reads 0.3, a key alongside it reads 1.
		for (const b of bindings) {
			const v = b.device === 'stick' ? rawValue(b) * (b.dir ?? 1) : rawValue(b);
			if (v > value) value = v;
		}
	}

	const pressed = def.type === 'axis' ? value !== 0 : value >= PRESS_THRESHOLD;
	const was = state.pressed;
	const moved = pressed !== was || value !== state.value;
	state.value = value;
	state.pressed = pressed;

	if (pressed !== was) {
		const stamp = frameId + 1;
		if (pressed) {
			state.pressedFrame = stamp;
			emit(rec, slotId, 'press');
		} else {
			state.releasedFrame = stamp;
			emit(rec, slotId, 'release');
		}
	}
	return moved;
};

const emit = (rec: MapRecord, slotId: string, edge: InputEdge): void => {
	const set = rec.listeners[slotId]?.[edge];
	if (!set?.size) return;
	// Copied: a handler that unsubscribes itself must not mutate the set mid-iteration.
	for (const fn of [...set]) fn();
};

/**
 * Recompute every slot of every active map. Called from key/mouse events and from
 * the gamepad poll — ~15 slots × ~2 bindings across one or two active maps, which
 * is cheaper than maintaining a reverse index and cannot fall out of sync with it.
 */
const evaluateAll = (): void => {
	let moved = false;
	for (const rec of activeRecords) {
		for (const slotId of rec.slotIds) {
			if (evaluateSlot(rec, slotId)) moved = true;
		}
	}
	if (moved) onInputChange?.();
};

/** Silently zero a map's readings — no edge callbacks; its consumer is going away. */
const zeroMap = (rec: MapRecord): void => {
	for (const slotId of rec.slotIds) {
		const s = rec.states[slotId];
		s.pressed = false;
		s.value = 0;
	}
};

// ─────────────────────────────────────────────────────────────────────────────
// Device input — called by core/input/Keymapper.svelte and InputRuntime.svelte.
// ─────────────────────────────────────────────────────────────────────────────

export const setKeyDown = (code: string, down: boolean): void => {
	if (down === heldKeys.has(code)) return;
	if (down) heldKeys.add(code);
	else heldKeys.delete(code);
	inputState.runtime.lastDevice = 'keyboard';
	evaluateAll();
};

export const setMouseDown = (button: MouseButton, down: boolean): void => {
	if (down === heldMouse.has(button)) return;
	if (down) heldMouse.add(button);
	else heldMouse.delete(button);
	inputState.runtime.lastDevice = 'mouse';
	evaluateAll();
};

/** Blur / visibility loss: a key released while unfocused must not stick a pedal down. */
export const releaseAllDevices = (): void => {
	if (!heldKeys.size && !heldMouse.size) return;
	heldKeys.clear();
	heldMouse.clear();
	evaluateAll();
};

/** True while the code is physically held — for Keymapper's own `preventDefault` pass. */
export const isCodeHeld = (code: string): boolean => heldKeys.has(code);

/**
 * The gamepad's frame, written every frame by `InputRuntime.svelte` from
 * `useGamepad`. Deadzones are already applied by the caller — this is raw device
 * state, exactly like a key event.
 */
export const applyGamepadFrame = (
	buttons: ReadonlyMap<GamepadButton, number>,
	sticks: Readonly<Record<GamepadStick, Vec2>>
): void => {
	padButtons.clear();
	for (const [name, value] of buttons) padButtons.set(name, value);
	padSticks.leftStick.x = sticks.leftStick.x;
	padSticks.leftStick.y = sticks.leftStick.y;
	padSticks.rightStick.x = sticks.rightStick.x;
	padSticks.rightStick.y = sticks.rightStick.y;
	evaluateAll();
};

/** Every code bound to a slot in an ACTIVE, non-passthrough map. */
export const isCodeBound = (code: string): boolean => {
	for (const rec of activeRecords) {
		for (const slotId of rec.slotIds) {
			if (rec.def.slots[slotId].passthrough) continue;
			for (const b of rec.resolved[slotId]) {
				if (b.device === 'key' && b.code === code) return true;
			}
		}
	}
	return false;
};

// ─────────────────────────────────────────────────────────────────────────────
// defineInputMap.
// ─────────────────────────────────────────────────────────────────────────────

const scratchVector: Vec2 = { x: 0, y: 0 };

const missing = (mapId: string, slotId: string): never => {
	throw new Error(`[input] map '${mapId}' has no slot '${slotId}'`);
};

/**
 * Declare a map. Returns a MODULE SINGLETON handle immediately — no lifecycle, so
 * plain modules (a sim controller, an audio mixer) import it directly instead of
 * having it drilled through props. Declaring registers the map so Settings can list
 * it; it does NOT activate it (see `useInputMap` / `activateInputMap`).
 */
export const defineInputMap = <S extends SlotRecord>(def: InputMapDef<S>): InputMap<S> => {
	// Re-definition (HMR) rebinds the existing record so live handles stay valid.
	const existing = registry.get(def.id);
	if (existing) {
		existing.def = def as InputMapDef;
		existing.slotIds = Object.keys(def.slots);
		for (const slotId of existing.slotIds) {
			existing.states[slotId] ??= {
				id: slotId,
				pressed: false,
				value: 0,
				pressedFrame: -1,
				releasedFrame: -1
			};
			existing.listeners[slotId] ??= { press: new Set(), release: new Set() };
		}
		resolveMap(existing);
		inputState.maps[def.id].label = def.label;
		inputState.maps[def.id].slots = def.slots;
		return existing.handle as InputMap<S>;
	}

	const states: Record<string, SlotState> = {};
	const listeners: Record<string, Listeners> = {};
	for (const slotId of Object.keys(def.slots)) {
		states[slotId] = { id: slotId, pressed: false, value: 0, pressedFrame: -1, releasedFrame: -1 };
		listeners[slotId] = { press: new Set(), release: new Set() };
	}

	const slotOf = (id: string): SlotState => states[id] ?? missing(def.id, id);

	const handle: InputMap<S> = {
		id: def.id,
		label: def.label,
		slots: def.slots,
		get active() {
			return (registry.get(def.id)?.activations ?? 0) > 0;
		},
		slot: (id) => slotOf(id),
		pressed: (id) => slotOf(id).pressed,
		value: (id) => slotOf(id).value,
		axis: (id) => slotOf(id).value,
		vector: (x, y) => {
			scratchVector.x = slotOf(x).value;
			scratchVector.y = slotOf(y).value;
			return scratchVector;
		},
		justPressed: (id) => slotOf(id).pressedFrame === frameId,
		justReleased: (id) => slotOf(id).releasedFrame === frameId,
		on: (id, edge, fn) => {
			const set = (listeners[id] ?? missing(def.id, id as string))[edge];
			set.add(fn);
			return () => set.delete(fn);
		}
	};

	const rec: MapRecord = {
		def: def as InputMapDef,
		handle: handle as InputMap,
		slotIds: Object.keys(def.slots),
		states,
		resolved: {},
		listeners,
		activations: 0
	};
	registry.set(def.id, rec);
	resolveMap(rec);

	inputState.maps[def.id] = {
		id: def.id,
		label: def.label,
		active: false,
		slots: def.slots
	};

	logInput.info('Map declared:', def.id, `(${Object.keys(def.slots).length} slots)`);
	return handle;
};

/**
 * Make a map live. Returns a disposer. Activation is COUNTED, so two components
 * holding the same map both have to release before it goes quiet.
 */
export const activateInputMap = (map: InputMap<SlotRecord>): (() => void) => {
	const rec = registry.get(map.id);
	if (!rec) throw new Error(`[input] map '${map.id}' was never declared`);
	rec.activations++;
	if (rec.activations === 1) {
		resolveMap(rec);
		refreshActive();
		inputState.maps[map.id].active = true;
		evaluateAll();
		logInput.info('Map active:', map.id);
	}
	let released = false;
	return () => {
		if (released) return;
		released = true;
		rec.activations--;
		if (rec.activations === 0) {
			refreshActive();
			inputState.maps[map.id].active = false;
			zeroMap(rec);
			logInput.info('Map inactive:', map.id);
		}
	};
};

/** Every declared map, for the settings UI. Active first, then alphabetical. */
export const registeredMaps = (): string[] =>
	Object.keys(inputState.maps).sort((a, b) => {
		const byActive = Number(inputState.maps[b].active) - Number(inputState.maps[a].active);
		return byActive !== 0 ? byActive : a.localeCompare(b);
	});

/**
 * Other slots in the SAME map that share a binding with this one. Cross-map
 * collisions are not conflicts — different scenes, and two active maps sharing a
 * key is a legitimate composition.
 */
export const conflictsFor = (mapId: string, slotId: string): string[] => {
	const rec = registry.get(mapId);
	if (!rec) return [];
	const mine = new Set(bindingsFor(mapId, slotId).map(bindingKey));
	if (!mine.size) return [];
	const hits: string[] = [];
	for (const other of rec.slotIds) {
		if (other === slotId) continue;
		if (bindingsFor(mapId, other).some((b) => mine.has(bindingKey(b)))) hits.push(other);
	}
	return hits;
};

// ─────────────────────────────────────────────────────────────────────────────
// Actions.
// ─────────────────────────────────────────────────────────────────────────────

const writeOverride = (mapId: string, slotId: string, bindings: Binding[]): void => {
	(inputState.overrides[mapId] ??= {})[slotId] = bindings;
	const rec = registry.get(mapId);
	if (rec) {
		resolveSlot(rec, slotId);
		if (rec.activations > 0) evaluateSlot(rec, slotId);
	}
	save();
};

export const inputActions: InputActions = {
	startCapture(mapId, slotId, dir = 1) {
		inputState.capture = { active: true, mapId, slotId, dir, startedAt: Date.now() };
		logInput.info('Capture started:', mapId, slotId, dir);
	},

	cancelCapture() {
		inputState.capture = { active: false, mapId: null, slotId: null, dir: 1, startedAt: null };
	},

	bind(mapId, slotId, binding) {
		const current = bindingsFor(mapId, slotId);
		const k = bindingKey(binding);
		if (!current.some((b) => bindingKey(b) === k)) {
			writeOverride(mapId, slotId, [...current, binding]);
			logInput.info('Bound:', mapId, slotId, k);
		}
		inputActions.cancelCapture();
	},

	removeBinding(mapId, slotId, binding) {
		const k = bindingKey(binding);
		writeOverride(
			mapId,
			slotId,
			bindingsFor(mapId, slotId).filter((b) => bindingKey(b) !== k)
		);
		logInput.info('Unbound:', mapId, slotId, k);
	},

	resetSlot(mapId, slotId) {
		delete inputState.overrides[mapId]?.[slotId];
		const rec = registry.get(mapId);
		if (rec) {
			resolveSlot(rec, slotId);
			if (rec.activations > 0) evaluateSlot(rec, slotId);
		}
		save();
		logInput.info('Slot reset:', mapId, slotId);
	},

	resetMap(mapId) {
		delete inputState.overrides[mapId];
		const rec = registry.get(mapId);
		if (rec) {
			resolveMap(rec);
			if (rec.activations > 0) evaluateAll();
		}
		save();
		logInput.info('Map reset:', mapId);
	},

	resetAll() {
		inputState.overrides = {};
		for (const rec of registry.values()) resolveMap(rec);
		evaluateAll();
		save();
		logInput.info('All bindings reset');
	},

	setGamepadEnabled(enabled) {
		inputState.gamepad.enabled = enabled;
		save();
	},

	setGamepadIndex(index) {
		inputState.gamepad.index = index;
		save();
	},

	setDeadzone(stickSide, value) {
		if (stickSide === 'left') inputState.gamepad.deadzoneLeftStick = value;
		else inputState.gamepad.deadzoneRightStick = value;
		save();
	}
};

export type { SlotId };
