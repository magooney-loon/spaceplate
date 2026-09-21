// Shared handle on the demo's mirror floor, so the cube-capture tasks in
// DemoPhysicsBodies can take the reflector out of the graph while they render.
//
// The floor's reflector re-renders once per render PASS, not once per frame — each cube
// capture is six passes, so at the capture rates in DemoPhysicsBodies that's 270
// reflection renders/sec, each at the FULL CANVAS resolution (`ReflectorBaseNode`
// sizes off `renderer.getDrawingBufferSize()`, not the target it's captured into) and
// each caching its own half-canvas HalfFloat target per camera. Swapping to a plain
// material for the capture's duration removes both costs — a reflection of a
// reflection isn't visible on a 0.8-radius ball anyway.

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
