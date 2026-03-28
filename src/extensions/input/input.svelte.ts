import { logInput } from '$extensions/logger/logger.svelte';
import type {
	InputState,
	InputActions,
	InputQueries,
	PlayerInputMap,
	PlayerId,
	InputAction,
	InputAxisAction,
	KeyboardBinding,
	MouseBinding,
	GamepadButtonBinding,
	GamepadAxisBinding,
	GamepadButton,
	GamepadAxis,
	MouseButton,
	AnyBinding
} from './types';

export type {
	InputState,
	InputActions,
	InputQueries,
	PlayerInputMap,
	PlayerId,
	InputAction,
	InputAxisAction,
	AnyBinding
} from './types';

const INPUT_SETTINGS_KEY = 'spaceplate-input-settings';
const SETTINGS_VERSION = 1;

let _idCounter = 0;
const newId = () => `b${++_idCounter}`;

const kb = (code: string): KeyboardBinding => ({ id: newId(), device: 'keyboard', code });
const mb = (button: MouseButton): MouseBinding => ({ id: newId(), device: 'mouse', button });
const gp = (button: GamepadButton): GamepadButtonBinding => ({
	id: newId(),
	device: 'gamepad',
	button
});
const ga = (
	axis: GamepadAxis,
	direction?: 'positive' | 'negative'
): GamepadAxisBinding => ({
	id: newId(),
	device: 'gamepad-axis',
	axis,
	direction
});

const ALL_ACTIONS: InputAction[] = [
	'moveForward',
	'moveBackward',
	'moveLeft',
	'moveRight',
	'jump',
	'sprint',
	'interact',
	'primaryAction',
	'secondaryAction',
	'reload',
	'use',
	'crouch',
	'drop',
	'prone',
	'emote',
	'slot1',
	'slot2',
	'slot3',
	'slot4',
	'pause',
	'toggleUi',
	'openSettings'
];


const defaultPlayer1Actions = (): Record<InputAction, AnyBinding[]> => ({
	moveForward: [kb('KeyW'), kb('ArrowUp'), gp('directionalTop')],
	moveBackward: [kb('KeyS'), kb('ArrowDown'), gp('directionalBottom')],
	moveLeft: [kb('KeyA'), kb('ArrowLeft'), gp('directionalLeft')],
	moveRight: [kb('KeyD'), kb('ArrowRight'), gp('directionalRight')],
	jump: [kb('Space'), gp('clusterBottom')],
	sprint: [kb('ShiftLeft'), kb('ShiftRight'), gp('leftStickButton')],
	interact: [kb('KeyE'), gp('clusterRight')],
	primaryAction: [mb('left'), gp('rightTrigger')],
	secondaryAction: [mb('right'), kb('KeyQ'), gp('leftTrigger')],
	reload: [kb('KeyR'), gp('clusterLeft')],
	use: [kb('KeyF'), gp('leftBumper')],
	crouch: [kb('KeyC'), gp('rightStickButton')],
	drop: [kb('KeyX')],
	prone: [kb('KeyZ')],
	emote: [kb('KeyT'), gp('clusterTop')],
	slot1: [kb('Digit1')],
	slot2: [kb('Digit2')],
	slot3: [kb('Digit3')],
	slot4: [kb('Digit4')],
	pause: [kb('Escape'), gp('start')],
	toggleUi: [],
	openSettings: [kb('Comma'), gp('select')]
});

const defaultPlayer1Axes = (): Record<InputAxisAction, GamepadAxisBinding | null> => ({
	moveX: ga('leftStickX'),
	moveY: ga('leftStickY'),
	lookX: ga('rightStickX'),
	lookY: ga('rightStickY')
});

const defaultPlayerMap = (playerId: PlayerId): PlayerInputMap => {
	const gamepadIndex = { player1: 0, player2: 1, player3: 2, player4: 3 }[playerId];
	const actions = {} as Record<InputAction, AnyBinding[]>;
	ALL_ACTIONS.forEach((a) => (actions[a] = []));
	const axes: Record<InputAxisAction, GamepadAxisBinding | null> = {
		moveX: null,
		moveY: null,
		lookX: null,
		lookY: null
	};
	return {
		actions: playerId === 'player1' ? defaultPlayer1Actions() : actions,
		axes: playerId === 'player1' ? defaultPlayer1Axes() : axes,
		gamepad: {
			enabled: true,
			index: gamepadIndex,
			deadzoneLeftStick: 0.2,
			deadzoneRightStick: 0.2
		}
	};
};

const defaultAllPlayers = (): Record<PlayerId, PlayerInputMap> => ({
	player1: defaultPlayerMap('player1'),
	player2: defaultPlayerMap('player2'),
	player3: defaultPlayerMap('player3'),
	player4: defaultPlayerMap('player4')
});

const loadFromStorage = (): Record<PlayerId, PlayerInputMap> | null => {
	try {
		const raw = localStorage.getItem(INPUT_SETTINGS_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (parsed?.version !== SETTINGS_VERSION || !parsed?.players?.player1) return null;
		return parsed.players as Record<PlayerId, PlayerInputMap>;
	} catch {
		return null;
	}
};

const saveToStorage = (players: Record<PlayerId, PlayerInputMap>): void => {
	try {
		localStorage.setItem(INPUT_SETTINGS_KEY, JSON.stringify({ version: SETTINGS_VERSION, players }));
	} catch {
		/* ignore */
	}
};

export const inputState = $state<InputState>({
	players: loadFromStorage() ?? defaultAllPlayers(),
	capture: {
		active: false,
		playerId: null,
		action: null,
		bindingType: null,
		startedAt: null
	},
	runtime: {
		connectedGamepads: [],
		keyboardPressed: {},
		mousePressed: { left: false, right: false, middle: false },
		lastInputSource: null
	}
});

// --- prev-frame pressed state for wasPressed edge detection ---
const _prevPressed: Record<PlayerId, Record<InputAction, boolean>> = {
	player1: {} as Record<InputAction, boolean>,
	player2: {} as Record<InputAction, boolean>,
	player3: {} as Record<InputAction, boolean>,
	player4: {} as Record<InputAction, boolean>
};

const checkBindingActive = (binding: AnyBinding): boolean => {
	if (binding.device === 'keyboard') {
		return !!inputState.runtime.keyboardPressed[binding.code];
	}
	if (binding.device === 'mouse') {
		return !!inputState.runtime.mousePressed[binding.button];
	}
	// gamepad handled by InputGamepads.svelte writing into runtime (Phase 2)
	return false;
};

const isActionActive = (playerId: PlayerId, action: InputAction): boolean => {
	const bindings = inputState.players[playerId]?.actions[action];
	if (!bindings) return false;
	return bindings.some(checkBindingActive);
};

export const inputQueries: InputQueries = {
	isPressed(playerId, action) {
		return isActionActive(playerId, action);
	},
	wasPressed(playerId, action) {
		const current = isActionActive(playerId, action);
		const prev = !!_prevPressed[playerId][action];
		return current && !prev;
	},
	getAxis(playerId, axisAction) {
		// Analog gamepad axis — Phase 2 will write into runtime.gamepadAxes
		// Fallback: derive from digital key bindings for moveX/moveY
		if (axisAction === 'moveX') {
			return (
				(isActionActive(playerId, 'moveRight') ? 1 : 0) -
				(isActionActive(playerId, 'moveLeft') ? 1 : 0)
			);
		}
		if (axisAction === 'moveY') {
			return (
				(isActionActive(playerId, 'moveForward') ? 1 : 0) -
				(isActionActive(playerId, 'moveBackward') ? 1 : 0)
			);
		}
		return 0;
	},
	getMoveVector(playerId) {
		return {
			x: inputQueries.getAxis(playerId, 'moveX'),
			y: inputQueries.getAxis(playerId, 'moveY')
		};
	}
};

// Call once per frame to advance wasPressed buffer
export const advanceInputFrame = (): void => {
	const players: PlayerId[] = ['player1', 'player2', 'player3', 'player4'];
	for (const playerId of players) {
		for (const action of ALL_ACTIONS) {
			_prevPressed[playerId][action] = isActionActive(playerId, action);
		}
	}
};

export const inputActions: InputActions = {
	startCapture(playerId, action, bindingType) {
		inputState.capture = {
			active: true,
			playerId,
			action,
			bindingType,
			startedAt: Date.now()
		};
		logInput.info('Capture started:', playerId, action);
	},

	cancelCapture() {
		inputState.capture = {
			active: false,
			playerId: null,
			action: null,
			bindingType: null,
			startedAt: null
		};
		logInput.info('Capture cancelled');
	},

	bindKeyboard(playerId, action, code) {
		const binding: KeyboardBinding = { id: newId(), device: 'keyboard', code };
		inputState.players[playerId].actions[action].push(binding);
		saveToStorage(inputState.players);
		logInput.info('Bound keyboard:', playerId, action, code);
		inputActions.cancelCapture();
	},

	bindMouse(playerId, action, button) {
		const binding: MouseBinding = { id: newId(), device: 'mouse', button };
		inputState.players[playerId].actions[action].push(binding);
		saveToStorage(inputState.players);
		logInput.info('Bound mouse:', playerId, action, button);
		inputActions.cancelCapture();
	},

	bindGamepadButton(playerId, action, button) {
		const binding: GamepadButtonBinding = { id: newId(), device: 'gamepad', button };
		inputState.players[playerId].actions[action].push(binding);
		saveToStorage(inputState.players);
		logInput.info('Bound gamepad button:', playerId, action, button);
		inputActions.cancelCapture();
	},

	bindGamepadAxis(playerId, axisAction, axis) {
		const binding: GamepadAxisBinding = { id: newId(), device: 'gamepad-axis', axis };
		inputState.players[playerId].axes[axisAction] = binding;
		saveToStorage(inputState.players);
		logInput.info('Bound gamepad axis:', playerId, axisAction, axis);
		inputActions.cancelCapture();
	},

	removeBinding(playerId, action, bindingId) {
		const bindings = inputState.players[playerId].actions[action];
		const idx = bindings.findIndex((b) => b.id === bindingId);
		if (idx !== -1) {
			bindings.splice(idx, 1);
			saveToStorage(inputState.players);
			logInput.info('Removed binding:', playerId, action, bindingId);
		}
	},

	clearActionBindings(playerId, action) {
		inputState.players[playerId].actions[action] = [];
		saveToStorage(inputState.players);
		logInput.info('Cleared bindings:', playerId, action);
	},

	setGamepadEnabled(playerId, enabled) {
		inputState.players[playerId].gamepad.enabled = enabled;
		saveToStorage(inputState.players);
		logInput.info('Gamepad enabled:', playerId, enabled);
	},

	setGamepadIndex(playerId, index) {
		inputState.players[playerId].gamepad.index = index;
		saveToStorage(inputState.players);
		logInput.info('Gamepad index:', playerId, index);
	},

	setDeadzone(playerId, stick, value) {
		if (stick === 'left') {
			inputState.players[playerId].gamepad.deadzoneLeftStick = value;
		} else {
			inputState.players[playerId].gamepad.deadzoneRightStick = value;
		}
		saveToStorage(inputState.players);
		logInput.info('Deadzone:', playerId, stick, value);
	},

	resetAction(playerId, action) {
		const defaults = defaultPlayerMap(playerId).actions[action];
		inputState.players[playerId].actions[action] = defaults;
		saveToStorage(inputState.players);
		logInput.info('Reset action:', playerId, action);
	},

	resetAxis(playerId, axis) {
		const defaults = defaultPlayerMap(playerId).axes[axis];
		inputState.players[playerId].axes[axis] = defaults;
		saveToStorage(inputState.players);
		logInput.info('Reset axis:', playerId, axis);
	},

	resetPlayerBindings(playerId) {
		inputState.players[playerId] = defaultPlayerMap(playerId);
		saveToStorage(inputState.players);
		logInput.info('Reset player bindings:', playerId);
	},

	resetAllInputSettings() {
		const fresh = defaultAllPlayers();
		inputState.players.player1 = fresh.player1;
		inputState.players.player2 = fresh.player2;
		inputState.players.player3 = fresh.player3;
		inputState.players.player4 = fresh.player4;
		saveToStorage(inputState.players);
		logInput.info('Reset all input settings');
	}
};
