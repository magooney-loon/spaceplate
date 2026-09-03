// A plain callback registry. Deliberately not stores and not runes: events fire
// from the model tick, which is pure and must stay outside Svelte's reactive graph.

import type { SkyEvent } from './types';

type Handler = (payload?: unknown) => void;

const handlers = new Map<SkyEvent, Set<Handler>>();

export const on = (event: SkyEvent, handler: Handler): (() => void) => {
	let set = handlers.get(event);
	if (!set) {
		set = new Set();
		handlers.set(event, set);
	}
	set.add(handler);
	return () => off(event, handler);
};

export const off = (event: SkyEvent, handler: Handler): void => {
	handlers.get(event)?.delete(handler);
};

export const emit = (event: SkyEvent, payload?: unknown): void => {
	const set = handlers.get(event);
	if (!set) return;
	// Iterate a copy so a handler may unsubscribe itself without skipping a sibling.
	for (const handler of [...set]) handler(payload);
};

export const clearAll = (): void => handlers.clear();
