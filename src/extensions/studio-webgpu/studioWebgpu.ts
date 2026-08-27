// Compatibility shims that let @threlte/studio (0.4.3) run against WebGPURenderer.
// Dev-only: nothing here is mounted unless VITE_GAME_ENGINE=true.
//
// Studio's render-modes extension is written against WebGLRenderer and touches two
// things that only exist on the WebGL backend. Both shims are no-ops on WebGL, so
// they stay safe if Studio gains native WebGPU support and we drop them.
//
// See DOCS/webgpu-migration-roadmap.md §7.

import type { Material, Object3D, Scene } from 'three';

/**
 * Studio's RenderModes.svelte does `renderer.renderBufferDirect.bind(renderer)` at
 * setup. `renderBufferDirect` is a WebGLRenderer-only method — on WebGPURenderer it
 * is `undefined`, so the bind throws and takes down the whole Studio subtree with it
 * (every extension after render-modes, plus <Scene />, is nested inside it).
 *
 * Installing a no-op is enough: WebGPU's renderer never calls renderBufferDirect, so
 * Studio's wrapper is dead code there. This only unblocks the crash — the behaviour
 * that wrapper implements is restored by `patchSceneOverrideMaterial` below.
 */
export const patchRendererForStudio = (renderer: object): void => {
	const r = renderer as { renderBufferDirect?: unknown };
	if (typeof r.renderBufferDirect === 'function') return; // WebGL — leave it alone
	r.renderBufferDirect = () => {};
};

const hasMaterial = (object: Object3D): object is Object3D & { material: Material } => {
	return 'material' in object;
};

/**
 * Studio marks its own helpers (grid, axes, bounding boxes, selection quad) with
 * `userData.ignoreOverrideMaterial` and relies on the patched `renderBufferDirect` to
 * skip them while a wireframe/solid override material is active. Without that, Studio's
 * own gizmos render as white wireframe along with the scene.
 *
 * WebGPU has a first-class equivalent: `Material.allowOverride = false` (honoured in
 * three's common Renderer). Bridge one to the other by syncing on assignment of
 * `scene.overrideMaterial`, which is exactly when the set of affected objects matters.
 */
export const patchSceneOverrideMaterial = (scene: Scene): void => {
	let current: Material | null = scene.overrideMaterial;
	let lastSynced: Material | null = null;

	const sync = () => {
		scene.traverse((object) => {
			if (!object.userData.ignoreOverrideMaterial || !hasMaterial(object)) return;
			// Studio helpers are never meant to be overridden, so this is set-once —
			// no need to restore it when the override material is cleared.
			object.material.allowOverride = false;
		});
	};

	Object.defineProperty(scene, 'overrideMaterial', {
		get: () => current,
		set: (value: Material | null) => {
			current = value;
			// Skip re-traversing when a caller round-trips the same material — Studio's
			// selection pass nulls and restores it every single frame.
			if (value !== null && value !== lastSynced) {
				lastSynced = value;
				sync();
			}
		},
		configurable: true
	});
};
