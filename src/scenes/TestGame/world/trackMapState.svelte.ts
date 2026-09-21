// The minimap outline's handoff from the scene to the HUD.
//
// `world/Track.svelte` lives inside <Canvas>; `TrackMinimap.svelte` is an HTML
// sibling OUTSIDE it (src/CLAUDE.md's HUD-vs-3D rule), so they cannot pass
// props and a module is the only channel between them.
//
// It is `$state`, unlike `carSim` — but it is written EXACTLY TWICE per visit
// (once when the GLB lands, once to null on unmount), not every step, so the
// telemetry mirror discipline has nothing to say about it. The shape is a plain
// object with one field rather than a bare exported `let`: a reassigned module
// binding is not reactive across an import boundary.

import type { TrackMap } from './trackMap';

export const trackMapState = $state<{ map: TrackMap | null }>({ map: null });

export function setTrackMap(map: TrackMap | undefined): void {
	trackMapState.map = map ?? null;
}

/** Scene exit — the next mount rebuilds from its own GLB. */
export function clearTrackMap(): void {
	trackMapState.map = null;
}
