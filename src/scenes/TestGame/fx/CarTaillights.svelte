<script lang="ts">
	import { onDestroy } from 'svelte';
	import { useThrelte } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import { mix, positionLocal, step, texture, uniform, vec3 } from 'three/tsl';
	import { logGltf } from '$extensions/logger';
	import { carLights, carIgnition } from '../sim/carSwitches.svelte';
	import { carHud } from '../sim/carTelemetry.svelte';

	// Tail glow + brake flare, driven through the GLB's OWN lamp material rather
	// than additive cards. The model's `Light_Bucket` mesh — the housings behind
	// the lenses, front AND rear clusters merged into one mesh (the `Light_Glass`
	// over them has no emissive; the glow always came from the bucket) — ships
	// with an emissive texture at KHR_materials_emissive_strength 10, so both
	// ends' interiors glow as exported, ignition or not. This rig takes over:
	//
	//   - the bucket is baked into car-local space (the CarWheels procedure) and
	//     re-materialised: per-end behaviour on a merged mesh is a per-vertex
	//     `step()` on the baked z, not a second material — same draw calls;
	//   - the EXPORTED textured emissive is kept as-is at both ends (the GLB
	//     already paints head white and tail red) — all this rig does is SCALE
	//     it per end: the head follows the ignition, the tail is the lamp logic;
	//   - the TAIL gain is ×1 with the lights on, ×2 on the brake pedal, and 0
	//     with the car off — same colours, no substituted red;
	//   - the interior's other emissives (cluster screens, accent strips) are
	//     dimmed to zero with the ignition too: a dead parked car has no lit
	//     screens either.
	//
	// No reverse light (deliberate — the rear palette stays red-only). Brake
	// state is `carHud.brake`, the reactive view of the pedal; the controller
	// already zeroes it with the ignition off, so the flare needs no gate of its
	// own.

	let { scene }: { scene: THREE.Group } = $props();

	// The GLB contract: the lamp-interior material's name. Like the wheel
	// material prefix, a new car's GLB must match or this rig stays dark (with a
	// warning in the log).
	const BUCKET_MATERIAL = 'Light_Bucket';
	/** Car-local metres: everything aft of this is the tail cluster (the front
	 * cluster ends ≈ −1.5, the rear starts ≈ +1.6, between them is cabin). */
	const TAIL_Z = 1.0;
	/** Tail gains on the exported emissive: ×1 as exported with the lights on,
	 * ×2 on the brake (bright enough to feed Bloom through the night exposure,
	 * same hue — no colour substitution). */
	const TAIL_ON = 1;
	const TAIL_BRAKE = 2;
	/** Pedal travel that counts as braking (trigger rest noise). */
	const BRAKE_EPSILON = 0.02;
	/** Interior emissives that die with the ignition — GLB material names. */
	const INTERIOR_EMISSIVES = new Set(['Screen', 'Screen_2', 'Interior_Accents']);

	// The mode-dependent half. Uniforms, not material rebuilds, so braking and
	// toggling write numbers (the graph is shared by both lamp clusters and both
	// terms of the emissive).
	const uHeadGain = uniform(1);
	const uTailGain = uniform(TAIL_ON);

	const { invalidate } = useThrelte();

	let bakedMesh: THREE.Mesh | null = null;
	let origMesh: THREE.Mesh | null = null;
	const interior: { material: THREE.MeshStandardMaterial; heat: number }[] = [];

	// ── The bake ──────────────────────────────────────────────────────────────
	//
	// Runs once per scene prop (the GLB is the prop's lifetime). Timing note
	// stolen from CarWheels: one consistent world-matrix pass FIRST, because
	// effect order vs Threlte's prop effects is undefined and dividing a fresh
	// matrixWorld by a stale scene matrixWorld bakes ancestor scale into the
	// geometry.
	$effect(() => {
		interior.length = 0;
		const buckets: THREE.Mesh[] = [];
		scene.traverse((obj) => {
			const mesh = obj as THREE.Mesh;
			if (!mesh.isMesh || mesh.name.startsWith('Tail_')) return; // our own baked mesh
			const name = (mesh.material as THREE.Material | undefined)?.name;
			if (name === BUCKET_MATERIAL) buckets.push(mesh);
			if (name && INTERIOR_EMISSIVES.has(name)) {
				const material = mesh.material as THREE.MeshStandardMaterial;
				interior.push({ material, heat: material.emissiveIntensity });
			}
		});
		const bucket = buckets[0];
		if (!bucket) {
			logGltf.warn(
				`CarTaillights: no ${BUCKET_MATERIAL} mesh in the car model — lamps stay as exported`
			);
			return;
		}

		scene.updateWorldMatrix(true, true);
		const rootInv = new THREE.Matrix4().copy(scene.matrixWorld).invert();
		const m = new THREE.Matrix4();
		bucket.updateWorldMatrix(true, false);
		m.copy(rootInv).multiply(bucket.matrixWorld);
		const geometry = bucket.geometry.clone().applyMatrix4(m);

		// A node clone of the bucket's material: same maps and factors, with the
		// emissive rebuilt as the EXPORTED texture scaled per end. `emissiveNode`
		// REPLACES the built-in emissive chain, so the GLB's baked strength
		// (KHR_materials_emissive_strength, landed on `emissiveIntensity` by the
		// loader) is multiplied in by hand. One texture, one heat — the region
		// split only picks WHICH gain scales it, so the exported colours are
		// preserved exactly (adding a second emissive term on top of the texture
		// here is what blew the tail out to white the first time around).
		const orig = bucket.material as THREE.MeshStandardMaterial;
		const material = new THREE.MeshStandardNodeMaterial();
		material.name = 'Tail_LightBucket';
		material.map = orig.map;
		material.roughness = orig.roughness;
		material.metalness = orig.metalness;
		material.side = orig.side;
		const heat = orig.emissiveIntensity;
		const head = orig.emissiveMap ? texture(orig.emissiveMap).rgb.mul(heat) : vec3(0);
		// step+oneMinus+mix: the branchless region select (CarWheels' quadrant
		// trick, one axis) — front vertices ride uHeadGain, rear ride uTailGain.
		const isTail = step(TAIL_Z, positionLocal.z);
		material.emissiveNode = head.mul(mix(uHeadGain, uTailGain, isTail));

		const baked = new THREE.Mesh(geometry, material);
		baked.name = 'Tail_LightBucket';
		baked.castShadow = true; // matches the original (not in TestGame's CAR_NON_CASTERS)
		baked.receiveShadow = true;
		scene.add(baked);
		bucket.visible = false; // keep the node, hide the merged mesh

		origMesh = bucket;
		bakedMesh = baked;

		logGltf.info('CarTaillights: Light_Bucket baked — tail glow + brake flare live');
	});

	// ── The state ─────────────────────────────────────────────────────────────
	//
	// One effect, three reactive inputs, uniform/scalar writes only. The tail is
	// a real car's logic: position lamps follow the LIGHTS switch, the brake
	// flare overrides them and needs only the ignition (the pedal itself is
	// already dead with the engine off), and a car that is off is dark at both
	// ends and inside.
	$effect(() => {
		const ign = carIgnition.on;
		const braking = carHud.brake > BRAKE_EPSILON;

		uHeadGain.value = ign ? 1 : 0;
		uTailGain.value = !ign ? 0 : braking ? TAIL_BRAKE : carLights.on ? TAIL_ON : 0;

		for (const { material, heat } of interior) material.emissiveIntensity = ign ? heat : 0;

		// On-demand: none of these writes move a frame on their own.
		invalidate();
	});

	onDestroy(() => {
		if (bakedMesh) {
			scene.remove(bakedMesh);
			bakedMesh.geometry.dispose();
			(bakedMesh.material as THREE.Material).dispose();
		}
		// Hand the exported mesh back exactly as it was.
		if (origMesh) origMesh.visible = true;
		for (const { material, heat } of interior) material.emissiveIntensity = heat;
	});
</script>
