// Barrel for the input extension — import from '$extensions/input'.
//
// `useInputMap` IS exported here, unlike the `useX.ts` path-import exception in
// src/CLAUDE.md: that rule is about Studio-aware hooks with fallbacks, and this is
// the primary way a scene turns its map on.
//
// `engineMap` is imported for its side effect (declare + activate the engine map)
// so that anything importing this barrel gets Escape / Ctrl+H wired up.

import './engineMap';

export * from './input.svelte';
export { useInputMap } from './useInputMap';
export { engineControls } from './engineMap';
export * from './bindingLabels';
export type * from './types';
