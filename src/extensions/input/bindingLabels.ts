// Binding → human text. Lifted wholesale out of MainMenu/SettingsHud.svelte, which
// had no business owning it: the HUD renders chips, the engine decides what a
// KeyboardEvent.code is called.

import type { Binding, GamepadButton, MouseButton } from './types';

/**
 * Codes whose tail is not already readable. Everything else falls through
 * `Key*` → the letter, `Digit*`/`Numpad*` → the digit, and finally the raw code.
 */
const KEY_CODE_LABELS: Record<string, string> = {
	Space: 'Space',
	Escape: 'Esc',
	Enter: 'Enter',
	NumpadEnter: 'Num Enter',
	Backspace: 'Backspace',
	Tab: 'Tab',
	CapsLock: 'Caps',
	ArrowUp: '↑',
	ArrowDown: '↓',
	ArrowLeft: '←',
	ArrowRight: '→',
	ShiftLeft: 'L Shift',
	ShiftRight: 'R Shift',
	ControlLeft: 'L Ctrl',
	ControlRight: 'R Ctrl',
	AltLeft: 'L Alt',
	AltRight: 'R Alt',
	MetaLeft: 'L Meta',
	MetaRight: 'R Meta',
	Comma: ',',
	Period: '.',
	Slash: '/',
	Semicolon: ';',
	Quote: "'",
	BracketLeft: '[',
	BracketRight: ']',
	Backslash: '\\',
	Minus: '−',
	Equal: '=',
	Backquote: '`',
	Insert: 'Ins',
	Delete: 'Del',
	Home: 'Home',
	End: 'End',
	PageUp: 'PgUp',
	PageDown: 'PgDn'
};

const MOUSE_LABELS: Record<MouseButton, string> = {
	left: 'LMB',
	right: 'RMB',
	middle: 'MMB'
};

const GAMEPAD_BUTTON_LABELS: Record<GamepadButton, string> = {
	clusterBottom: 'A / ✕',
	clusterRight: 'B / ○',
	clusterLeft: 'X / □',
	clusterTop: 'Y / △',
	leftBumper: 'LB',
	rightBumper: 'RB',
	leftTrigger: 'LT',
	rightTrigger: 'RT',
	select: 'Select',
	start: 'Start',
	center: 'Guide',
	leftStickButton: 'L3',
	rightStickButton: 'R3',
	directionalTop: 'D-Pad ↑',
	directionalBottom: 'D-Pad ↓',
	directionalLeft: 'D-Pad ←',
	directionalRight: 'D-Pad →'
};

export const keyCodeLabel = (code: string): string => {
	const known = KEY_CODE_LABELS[code];
	if (known) return known;
	if (code.startsWith('Key')) return code.slice(3);
	if (code.startsWith('Digit')) return code.slice(5);
	if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
	return code;
};

/** The chip text for one binding. `dir` is rendered by the caller, not baked in here. */
export const bindingLabel = (b: Binding): string => {
	if (b.device === 'key') return keyCodeLabel(b.code);
	if (b.device === 'mouse') return MOUSE_LABELS[b.button];
	if (b.device === 'pad') return GAMEPAD_BUTTON_LABELS[b.button];
	const side = b.stick === 'leftStick' ? 'L' : 'R';
	return `${side} Stick ${b.axis.toUpperCase()}`;
};

/** `−` / `+` for an axis slot's chips; empty for button slots. */
export const dirLabel = (b: Binding, isAxis: boolean): string => {
	if (!isAxis || b.device === 'stick') return '';
	return b.dir === -1 ? '−' : '+';
};

/**
 * Studio's dev-mode toolbar binds these BARE letters, so a slot bound to one of
 * them silently fights the editor while `VITE_GAME_ENGINE=true`. Flagged at bind
 * time rather than discovered as "why doesn't M work" — TestGame's ignition key is
 * the known accepted case.
 */
const STUDIO_CODES = new Set([
	'KeyW',
	'KeyA',
	'KeyS',
	'KeyZ',
	'KeyT',
	'KeyR',
	'KeyC',
	'KeyV',
	'KeyM'
]);

export const collidesWithStudio = (b: Binding): boolean =>
	b.device === 'key' && STUDIO_CODES.has(b.code);
