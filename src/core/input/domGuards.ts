/** Is this event aimed at something the user is TYPING into (incl. Studio's tweakpane inputs)? */
export const isTypingTarget = (target: EventTarget | null): boolean => {
	if (!(target instanceof HTMLElement)) return false;
	return !!target.closest('input, textarea, select, [contenteditable="true"]');
};

/** UI chrome — a click here is interacting with the page, not with the game. */
export const isUiTarget = (target: EventTarget | null): boolean => {
	if (!(target instanceof HTMLElement)) return false;
	return !!target.closest('button, input, select, textarea, a, label');
};
