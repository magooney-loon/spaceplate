/**
 * Is this event aimed at something the user is TYPING into?
 *
 * Studio's tweakpane panes are real `<input>`s, which is why every keyboard
 * consumer in the app needs this and why there used to be a copy of it in
 * `TestGame.svelte`. One copy now: `Keymapper.svelte` applies it before any key
 * reaches the slot system, so nothing downstream has to think about it.
 */
export const isTypingTarget = (target: EventTarget | null): boolean => {
	if (!(target instanceof HTMLElement)) return false;
	return !!target.closest('input, textarea, select, [contenteditable="true"]');
};

/** UI chrome — a click here is interacting with the page, not with the game. */
export const isUiTarget = (target: EventTarget | null): boolean => {
	if (!(target instanceof HTMLElement)) return false;
	return !!target.closest('button, input, select, textarea, a, label');
};
