// The paint the car wears, applied to its own GLB — extracted from
// PlayerCar.svelte the way hull.ts's collider math was: a car-agnostic
// function over (root, spec), called from the scene's own effect.
//
// The GLB ships painted in whatever the export baked (Track bRED); the shop
// (the HUD's Paint Shop button — sim/carPaint.svelte) only picks WHICH paint
// and WHICH finish — it has no access to the loaded THREE.Mesh (HTML overlay,
// outside <Canvas>). Applying the pick to the model is scene work, so it stays
// here. The shared paint material is SWAPPED for a MeshPhysicalMaterial
// because clearcoat and iridescence are what separate a solid from a pearl
// and a colour-shift — and it KEEPS the GLB's material name so the shadow
// policy (PlayerCar.svelte's CAR_NON_CASTERS) still reads it. One instance,
// never disposed: useGltf caches the scene, so a remount finds it already on
// the panels and reuses it. Metalness is NOT held back for lack of something
// to reflect — the procedural sky (core/skybox, mounted engine-wide by
// App.svelte's <Skybox />) bakes a live cube map onto scene.environment every
// scene gets for free, so a metallic flake genuinely has a sky to catch. Each
// finish carries its own envMapIntensity (below) so the metal/pearl/shift
// flake reads brighter than a solid's clearcoat-only sheen, without touching
// scene.environmentIntensity — that constant is tuned for the whole renderer
// and paired with the sun's own intensity (core/skybox/Sky.svelte).

import * as THREE from 'three/webgpu';
import type { CarSpec, PaintFinish, PaintOption } from './types';

const FINISHES: Record<
	PaintFinish,
	{
		metalness: number;
		roughness: number;
		clearcoat: number;
		clearcoatRoughness: number;
		iridescence: number;
		iridescenceIOR: number;
		iridescenceThicknessRange: [number, number];
		/** Scales the sky's baked reflection for THIS finish only — solid stays
		 *  near the material default (its shine is the clearcoat, not the flake),
		 *  the flake finishes push past it so the metal/pearl/shift actually
		 *  outshines a plain solid under the same sky. */
		envMapIntensity: number;
	}
> = {
	solid: {
		metalness: 0.05,
		roughness: 0.42,
		clearcoat: 1,
		clearcoatRoughness: 0.1,
		iridescence: 0,
		iridescenceIOR: 1.3,
		iridescenceThicknessRange: [100, 400],
		envMapIntensity: 1
	},
	metallic: {
		metalness: 0.7,
		roughness: 0.4,
		clearcoat: 1,
		clearcoatRoughness: 0.07,
		iridescence: 0,
		iridescenceIOR: 1.3,
		iridescenceThicknessRange: [100, 400],
		envMapIntensity: 1.5
	},
	pearl: {
		metalness: 0.55,
		roughness: 0.38,
		clearcoat: 1,
		clearcoatRoughness: 0.06,
		iridescence: 0.35,
		iridescenceIOR: 1.5,
		iridescenceThicknessRange: [120, 420],
		envMapIntensity: 1.3
	},
	shift: {
		metalness: 0.65,
		roughness: 0.3,
		clearcoat: 1,
		clearcoatRoughness: 0.04,
		iridescence: 1,
		iridescenceIOR: 2,
		iridescenceThicknessRange: [100, 800],
		envMapIntensity: 1.6
	}
};

export function createBodyPaintMaterial(spec: CarSpec): THREE.MeshPhysicalMaterial {
	return new THREE.MeshPhysicalMaterial({ name: spec.model.paintMaterial });
}

/** Re-run on model load AND on every paint-shop selection (the caller's effect
 *  tracks carPaint.id/finish) — the traverse re-walk is cheap and idempotent,
 *  the swap is a no-op after the first run. */
export function applyBodyPaint(
	root: THREE.Object3D,
	spec: CarSpec,
	bodyPaint: THREE.MeshPhysicalMaterial,
	option: PaintOption,
	finish: PaintFinish
): void {
	const target = spec.model.paintMaterial.toLowerCase();
	root.traverse((obj) => {
		const mesh = obj as THREE.Mesh;
		const material = mesh.material as THREE.Material | undefined;
		if (!mesh.isMesh || !material || material.name.toLowerCase() !== target) return;
		if (material !== bodyPaint) mesh.material = bodyPaint;
	});
	const style = FINISHES[finish];
	// .set('#rrggbb') converts sRGB→linear — the space a glTF baseColorFactor
	// lives in, and what the swatch's hex promises on screen.
	bodyPaint.color.set(option.hex);
	bodyPaint.metalness = style.metalness;
	bodyPaint.roughness = style.roughness;
	bodyPaint.clearcoat = style.clearcoat;
	bodyPaint.clearcoatRoughness = style.clearcoatRoughness;
	bodyPaint.iridescence = style.iridescence;
	bodyPaint.iridescenceIOR = style.iridescenceIOR;
	bodyPaint.iridescenceThicknessRange = style.iridescenceThicknessRange;
	bodyPaint.envMapIntensity = style.envMapIntensity;
}
