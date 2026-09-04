<script lang="ts">
	import { onDestroy } from 'svelte';
	import { usePhysicsTask } from '@threlte/rapier';
	import type { RigidBody as RapierRigidBody, Rotation, Vector } from '@dimforge/rapier3d-compat';
	import * as THREE from 'three/webgpu';
	import { cos, mix, positionLocal, sin, step, uniform, vec3 } from 'three/tsl';
	import { sceneState } from '$extensions/scene';
	import { logGltf } from '$extensions/logger';
	import { carInput } from './carInput.svelte';

	// Steerable + rolling wheels for the GR86.
	//
	// The GLB merges ALL FOUR wheels into each wheel material's mesh (every Wheel*Mtl
	// mesh spans the whole car length), so per-wheel node rotation is impossible. Fix:
	// at mount, bake each wheel mesh into car-local space (root⁻¹ · matrixWorld), then
	// do the steering/rolling PER VERTEX in material.positionNode — each vertex is
	// rotated around its own wheel's pivot (measured from the baked geometry), front
	// wheels get the steer rotation, all wheels roll. Same draw calls, no splitting.
	//
	// Caveat: normals are not rotated (no normalNode) — at ≤0.45 rad steer and a
	// spinning tire you will not see it.

	let { scene, body }: { scene: THREE.Group; body?: RapierRigidBody } = $props();

	const MAX_STEER_ANGLE = 0.42; // rad ≈ 24° — the visual lock
	const STEER_SMOOTH = 12; // visual steer lerp rate
	const WHEEL_MAT = /^wheel/i;

	// One shared uniform pair across all six wheel materials.
	const uSteer = uniform(0);
	const uRoll = uniform(0);

	let bakedMeshes: THREE.Mesh[] = [];
	let wheelRadius = 0.33;

	$effect(() => {
		const wheelMeshes: THREE.Mesh[] = [];
		scene.traverse((obj) => {
			const mesh = obj as THREE.Mesh;
			if (mesh.name.startsWith('Wheels_')) return; // our own baked meshes
			const name = (mesh.material as THREE.Material | undefined)?.name;
			if (mesh.isMesh && name && WHEEL_MAT.test(name)) wheelMeshes.push(mesh);
		});
		if (wheelMeshes.length === 0) {
			logGltf.warn('CarWheels: no wheel meshes found in the car model');
			return;
		}

		// One consistent world-matrix pass over the whole subtree FIRST. Effect timing
		// vs Threlte's prop effects (the scale={2.5} group) and the RigidBody's first
		// sync is undefined — dividing a FRESH mesh.matrixWorld by a STALE
		// scene.matrixWorld leaves ancestor scale/translation baked into the geometry,
		// which put the wheels floating in the air.
		scene.updateWorldMatrix(true, true);
		const rootInv = new THREE.Matrix4().copy(scene.matrixWorld).invert();
		const m = new THREE.Matrix4();
		const baked: { geometry: THREE.BufferGeometry; material: THREE.Material }[] = [];
		for (const mesh of wheelMeshes) {
			mesh.updateWorldMatrix(true, false);
			m.copy(rootInv).multiply(mesh.matrixWorld);
			baked.push({
				geometry: mesh.geometry.clone().applyMatrix4(m),
				material: mesh.material as THREE.Material
			});
			mesh.visible = false; // keep the node, hide the merged mesh
		}

		// Measure the four wheels from the baked positions: overall bounds → split
		// axes, then per-quadrant bounds → pivots + radius.
		let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
		for (const { geometry } of baked) {
			const pos = geometry.getAttribute('position');
			for (let i = 0; i < pos.count; i++) {
				const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
				if (x < minX) minX = x;
				if (x > maxX) maxX = x;
				if (y < minY) minY = y;
				if (y > maxY) maxY = y;
				if (z < minZ) minZ = z;
				if (z > maxZ) maxZ = z;
			}
		}
		const splitX = (minX + maxX) / 2;
		const splitZ = (minZ + maxZ) / 2;

		const quad = [
			{ minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity },
			{ minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity },
			{ minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity },
			{ minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity }
		]; // FL, FR, RL, RR
		for (const { geometry } of baked) {
			const pos = geometry.getAttribute('position');
			for (let i = 0; i < pos.count; i++) {
				const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
				const q = quad[(z < splitZ ? 0 : 2) + (x < splitX ? 0 : 1)];
				if (x < q.minX) q.minX = x;
				if (x > q.maxX) q.maxX = x;
				if (y < q.minY) q.minY = y;
				if (y > q.maxY) q.maxY = y;
				if (z < q.minZ) q.minZ = z;
				if (z > q.maxZ) q.maxZ = z;
			}
		}
		const pivotY = (minY + maxY) / 2;
		const trackHalf = Math.abs((quad[0].minX + quad[0].maxX) / 2);
		const frontZ = (quad[0].minZ + quad[0].maxZ) / 2;
		const rearZ = (quad[2].minZ + quad[2].maxZ) / 2;
		wheelRadius = quad.reduce((sum, q) => sum + (q.maxY - q.minY) / 2, 0) / quad.length;

		const measured = [pivotY, trackHalf, frontZ, rearZ, wheelRadius, splitX, splitZ];
		const rigOK = measured.every(Number.isFinite);
		if (!rigOK) logGltf.warn('CarWheels: non-finite wheel measurements — wheels stay static');

		// The vertex rotation. Pure expression (no assign → no Fn stack needed,
		// webgpu-notes.md §1.3); step+oneMinus+mix are the branchless selects (§1.2).
		// Built lazily: on a measurement failure the baked meshes still render, just
		// without steer/roll — never leave the car wheel-less.
		let wheelNode: ReturnType<typeof buildWheelNode> | null = null;
		function buildWheelNode() {
			const p = positionLocal.toVar();
			const leftF = step(splitX, p.x).oneMinus(); // 1 when x < split (left)
			const frontF = step(splitZ, p.z).oneMinus(); // 1 when z < split (front)
			const pivotX = mix(trackHalf, -trackHalf, leftF);
			const pivotZ = mix(rearZ, frontZ, frontF);
			const rel = p.sub(vec3(pivotX, pivotY, pivotZ));

			const cr = cos(uRoll),
				sr = sin(uRoll);
			const rolled = vec3(
				rel.x,
				rel.y.mul(cr).sub(rel.z.mul(sr)),
				rel.y.mul(sr).add(rel.z.mul(cr))
			);
			const cs = cos(uSteer),
				ss = sin(uSteer);
			const steered = vec3(
				rolled.x.mul(cs).add(rolled.z.mul(ss)),
				rolled.y,
				rolled.x.negate().mul(ss).add(rolled.z.mul(cs))
			);
			return mix(rolled, steered, frontF).add(vec3(pivotX, pivotY, pivotZ));
		}
		if (rigOK) wheelNode = buildWheelNode();

		for (const { geometry, material } of baked) {
			const mesh = new THREE.Mesh(geometry, material);
			mesh.name = `Wheels_${material.name}`;
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			scene.add(mesh);
			bakedMeshes.push(mesh);
			if (wheelNode) {
				// 1:1 mesh↔material in this model, so mutating the material is safe.
				(material as THREE.MeshStandardNodeMaterial).positionNode = wheelNode;
				material.needsUpdate = true;
			}
		}

		logGltf.info(
			`CarWheels: ${baked.length} meshes baked — track ±${trackHalf.toFixed(2)}, axles ${frontZ.toFixed(2)}/${rearZ.toFixed(2)}, r=${wheelRadius.toFixed(2)}`
		);
	});

	onDestroy(() => {
		for (const mesh of bakedMeshes) {
			scene.remove(mesh);
			mesh.geometry.dispose();
		}
		bakedMeshes = [];
	});

	// ── Per-step uniform updates ─────────────────────────────────────────────────

	const _q = new THREE.Quaternion();
	const _forward = new THREE.Vector3();
	const _rot = { x: 0, y: 0, z: 0, w: 1 } as Rotation;
	const _lin = { x: 0, y: 0, z: 0 } as Vector;
	let visSteer = 0;

	usePhysicsTask((delta) => {
		if (sceneState.currentScene !== 'testGame') return;

		// Visual steer from raw input — works at standstill, like a real car.
		const target = ((carInput.left ? 1 : 0) - (carInput.right ? 1 : 0)) * MAX_STEER_ANGLE;
		visSteer += (target - visSteer) * Math.min(1, STEER_SMOOTH * delta);
		uSteer.value = visSteer;

		if (!body) return;
		// Roll from forward speed (negative: rolling toward -Z spins the wheel -X).
		const rot = body.rotation(_rot);
		_q.set(rot.x, rot.y, rot.z, rot.w);
		_forward.set(0, 0, -1).applyQuaternion(_q);
		const lv = body.linvel(_lin);
		const vForward = _forward.x * lv.x + _forward.y * lv.y + _forward.z * lv.z;
		uRoll.value -= (vForward / wheelRadius) * delta;
	});
</script>
