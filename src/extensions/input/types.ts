export const extensionScope = 'input';

export type PlayerId = 'player1' | 'player2' | 'player3' | 'player4';

export type InputAction =
	| 'moveForward'
	| 'moveBackward'
	| 'moveLeft'
	| 'moveRight'
	| 'jump'
	| 'sprint'
	| 'interact'
	| 'primaryAction'
	| 'secondaryAction'
	| 'reload'
	| 'use'
	| 'crouch'
	| 'drop'
	| 'prone'
	| 'emote'
	| 'slot1'
	| 'slot2'
	| 'slot3'
	| 'slot4'
	| 'pause'
	| 'toggleUi'
	| 'openSettings';

export type InputAxisAction = 'moveX' | 'moveY' | 'lookX' | 'lookY';

export type MouseButton = 'left' | 'right' | 'middle';

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

export type GamepadAxis = 'leftStickX' | 'leftStickY' | 'rightStickX' | 'rightStickY';

export type KeyboardBinding = {
	id: string;
	device: 'keyboard';
	code: string;
};

export type MouseBinding = {
	id: string;
	device: 'mouse';
	button: MouseButton;
};

export type GamepadButtonBinding = {
	id: string;
	device: 'gamepad';
	button: GamepadButton;
};

export type GamepadAxisBinding = {
	id: string;
	device: 'gamepad-axis';
	axis: GamepadAxis;
	direction?: 'positive' | 'negative';
};

export type AnyBinding = KeyboardBinding | MouseBinding | GamepadButtonBinding | GamepadAxisBinding;

export type PlayerInputMap = {
	actions: Record<InputAction, AnyBinding[]>;
	axes: Record<InputAxisAction, GamepadAxisBinding | null>;
	gamepad: {
		enabled: boolean;
		index: number | null;
		deadzoneLeftStick: number;
		deadzoneRightStick: number;
	};
};

export type InputCaptureState = {
	active: boolean;
	playerId: PlayerId | null;
	action: InputAction | InputAxisAction | null;
	bindingType: 'action' | 'axis' | null;
	startedAt: number | null;
};

export type InputRuntimeState = {
	connectedGamepads: Array<{ index: number; id: string; connected: boolean }>;
	keyboardPressed: Record<string, boolean>;
	mousePressed: Record<MouseButton, boolean>;
	lastInputSource: 'keyboard' | 'mouse' | 'gamepad' | null;
};

export type InputState = {
	players: Record<PlayerId, PlayerInputMap>;
	capture: InputCaptureState;
	runtime: InputRuntimeState;
};

export type InputActions = {
	startCapture: (
		playerId: PlayerId,
		action: InputAction | InputAxisAction,
		bindingType: 'action' | 'axis'
	) => void;
	cancelCapture: () => void;
	bindKeyboard: (playerId: PlayerId, action: InputAction, code: string) => void;
	bindMouse: (playerId: PlayerId, action: InputAction, button: MouseButton) => void;
	bindGamepadButton: (playerId: PlayerId, action: InputAction, button: GamepadButton) => void;
	bindGamepadAxis: (playerId: PlayerId, axisAction: InputAxisAction, axis: GamepadAxis) => void;
	removeBinding: (playerId: PlayerId, action: InputAction, bindingId: string) => void;
	clearActionBindings: (playerId: PlayerId, action: InputAction) => void;
	setGamepadEnabled: (playerId: PlayerId, enabled: boolean) => void;
	setGamepadIndex: (playerId: PlayerId, index: number | null) => void;
	setDeadzone: (playerId: PlayerId, stick: 'left' | 'right', value: number) => void;
	resetAction: (playerId: PlayerId, action: InputAction) => void;
	resetAxis: (playerId: PlayerId, axis: InputAxisAction) => void;
	resetPlayerBindings: (playerId: PlayerId) => void;
	resetAllInputSettings: () => void;
};

export type InputQueries = {
	isPressed: (playerId: PlayerId, action: InputAction) => boolean;
	wasPressed: (playerId: PlayerId, action: InputAction) => boolean;
	getAxis: (playerId: PlayerId, axisAction: InputAxisAction) => number;
	getMoveVector: (playerId: PlayerId) => { x: number; y: number };
};
