// Shared handle on the demo's mirror floor, so the cube-capture tasks in
// DemoPhysicsBodies can take the reflector out of the graph while they render.
//
// WHY: the floor's material carries a `reflector()` node with `bounces` at its default
// (true), which sets the node's update type to RENDER — three re-renders the reflection
// once per render PASS that draws the floor, not once per frame. Two things make that
// expensive here:
//
//   1. Each cube capture is six scene renders (six faces), and the floor is in all of
//      them. At the capture rates in DemoPhysicsBodies that is 6×30 + 6×15 = 270 passes
//      per second, each dragging a full reflection render behind it.
//   2. The reflection is NOT rendered at the size of whatever is being drawn into.
//      `ReflectorBaseNode._updateResolution()` reads `renderer.getDrawingBufferSize()`
//      — the canvas — so a reflection rendered for a 96px cube face is still a
//      half-canvas full-scene render. And `getRenderTarget()` caches one such target
//      per camera in a plain Map, so every one of the 12 cube-face cameras was
//      allocating its own half-canvas HalfFloat target (~4 MB each at 1080p, ~16 MB at
//      DPR 2) on top of the main camera's.
//
// So the captures swap the floor to a plain material for their duration: the reflector
// node is not in the graph, nothing reflects, and no per-face targets are created. The
// captures see a flat gray floor instead of a mirrored one — on a 0.8-radius ball, a
// reflection of a reflection is not something anyone can pick out.

import type { Material, Mesh } from 'three/webgpu';

let mesh: Mesh | null = null;
let reflective: Material | null = null;
let plain: Material | null = null;

/** DemoScene owns the floor and both materials; it registers them on mount. */
export function registerMirrorFloor(
	floorMesh: Mesh,
	reflectiveMaterial: Material,
	plainMaterial: Material
): void {
	mesh = floorMesh;
	reflective = reflectiveMaterial;
	plain = plainMaterial;
}

export function unregisterMirrorFloor(): void {
	mesh = null;
	reflective = null;
	plain = null;
}

/**
 * Run `capture` with the floor's reflection switched off. Restores in a finally, so a
 * throwing capture can never leave the floor stuck on the plain material.
 * A no-op (just runs the callback) until DemoScene has registered the floor.
 */
export function withoutReflection(capture: () => void): void {
	if (mesh === null || plain === null || reflective === null) {
		capture();
		return;
	}
	mesh.material = plain;
	try {
		capture();
	} finally {
		mesh.material = reflective;
	}
}
