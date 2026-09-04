<script lang="ts">
	import { onDestroy } from 'svelte';
	import { usePhysicsTask } from '@threlte/rapier';
	import type { RigidBody as RapierRigidBody, Rotation, Vector } from '@dimforge/rapier3d-compat';
	import * as THREE from 'three/webgpu';
	import {
		Fn,
		cos,
		mix,
		normalLocal,
		positionLocal,
		positionPrevious,
		sin,
		step,
		uniform,
		vec3
	} from 'three/tsl';
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
	// Normals get the same rotation (normalNode), and so does `positionPrevious` — a
	// vertex-deforming material owns BOTH ends of the velocity buffer or motion blur
	// smears it against its own rest pose. See buildWheelNodes.

	let { scene, body, visualScale = 1 }: { scene: THREE.Group; body?: RapierRigidBody; visualScale?: number } = $props();

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
		wheelRadius = quad.reduce((sum, q) => sum + (q.maxY - q.minY) / 2, 0) / quad.length;

		// Per-wheel pivots from each quadrant's OWN bbox — an overall-centre pivot makes
		// wheels orbit slightly while rolling (reads as wobble/blur at speed).
		const centres = quad.map((q) => ({
			x: (q.minX + q.maxX) / 2,
			y: (q.minY + q.maxY) / 2,
			z: (q.minZ + q.maxZ) / 2
		}));

		const measured = [
			...centres.flatMap((c) => [c.x, c.y, c.z]),
			wheelRadius,
			splitX,
			splitZ
		];
		const rigOK = measured.every(Number.isFinite);
		if (!rigOK) logGltf.warn('CarWheels: non-finite wheel measurements — wheels stay static');

		// The vertex rotation. step+oneMinus+mix are the branchless selects
		// (webgpu-notes.md §1.2). Built lazily: on a measurement failure the baked meshes
		// still render, just without steer/roll — never leave the car wheel-less.
		let wheelNodes: { position: ReturnType<typeof buildWheelNodes>['position']; normal: ReturnType<typeof buildWheelNodes>['normal'] } | null =
			null;
		function buildWheelNodes() {
			const [FL, FR, RL, RR] = centres.map((c) => vec3(c.x, c.y, c.z));
			const p = positionLocal.toVar();
			const leftF = step(splitX, p.x).oneMinus(); // 1 when x < split (left)
			const frontF = step(splitZ, p.z).oneMinus(); // 1 when z < split (front)
			const frontPivot = mix(FR, FL, leftF);
			const rearPivot = mix(RR, RL, leftF);
			const pivot = mix(rearPivot, frontPivot, frontF);

			const cr = cos(uRoll),
				sr = sin(uRoll);
			const cs = cos(uSteer),
				ss = sin(uSteer);

			// Roll about X (all four), then steer about Y (front pair only). Rotation
			// only, so it serves vertices (fed the pivot-relative offset) and normals
			// (fed the normal) alike — otherwise the shading stays frozen while the
			// geometry spins, which reads as mush.
			// (`any` throughout: node-graph plumbing, per postprocessing/CLAUDE.md.)
			const spin = (v: any) => {
				const rolled = vec3(
					v.x,
					v.y.mul(cr).sub(v.z.mul(sr)),
					v.y.mul(sr).add(v.z.mul(cr))
				);
				const steered = vec3(
					rolled.x.mul(cs).add(rolled.z.mul(ss)),
					rolled.y,
					rolled.x.negate().mul(ss).add(rolled.z.mul(cs))
				);
				return mix(rolled, steered, frontF);
			};
			const place = (src: any) => spin(src.sub(pivot).toVar()).add(pivot);

			// An Fn (a stack, webgpu-notes.md §1.3) rather than a pure expression for one
			// reason: VELOCITY. VelocityNode measures ndc(positionLocal) − ndc(positionPrevious),
			// and `positionPrevious` defaults to the RAW geometry attribute — three only
			// overwrites it for skinning/instancing/batching, never for a material's
			// positionNode. So a deformed wheel reported (deformed − rest pose) as its
			// per-frame motion: a large constant velocity at every steer/roll angle except
			// the rest pose, which is exactly the permanent smear motion blur was drawing.
			// Feeding the SAME deformation into positionPrevious makes the deformation
			// contribute zero velocity, so the wheels blur from the car's motion like every
			// other mesh. Gated on needsPreviousData() (three's own guard) so the extra
			// varying is only emitted for a pass that actually writes the velocity attachment.
			const position = Fn((builder: any) => {
				if (builder.needsPreviousData()) {
					positionPrevious.assign(place(positionPrevious.toVar()));
				}
				return place(p);
			}, 'vec3')();

			const normal = spin(normalLocal.toVar());
			return { position, normal };
		}
		if (rigOK) wheelNodes = buildWheelNodes();

		for (const { geometry, material } of baked) {
			const mesh = new THREE.Mesh(geometry, material);
			mesh.name = `Wheels_${material.name}`;
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			scene.add(mesh);
			bakedMeshes.push(mesh);
			if (wheelNodes) {
				// 1:1 mesh↔material in this model, so mutating the material is safe.
				const material = mesh.material as THREE.MeshStandardNodeMaterial;
				material.positionNode = wheelNodes.position;
				material.normalNode = wheelNodes.normal;
				material.needsUpdate = true;
			}
		}

		logGltf.info(
			`CarWheels: ${baked.length} meshes baked — pivots FL(${centres[0].x.toFixed(2)}, ${centres[0].y.toFixed(2)}, ${centres[0].z.toFixed(2)}) r=${wheelRadius.toFixed(2)}, scale ×${visualScale}`
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

	const TAU = Math.PI * 2;
	const wrapAngle = (a: number): number => {
		const wrapped = a % TAU;
		return wrapped > Math.PI ? wrapped - TAU : wrapped < -Math.PI ? wrapped + TAU : wrapped;
	};

	usePhysicsTask((delta) => {
		if (sceneState.currentScene !== 'testGame') return;

		// Visual steer from raw input — works at standstill, like a real car.
		const target = ((carInput.left ? 1 : 0) - (carInput.right ? 1 : 0)) * MAX_STEER_ANGLE;
		visSteer += (target - visSteer) * Math.min(1, STEER_SMOOTH * delta);
		uSteer.value = visSteer;

		if (!body) return;
		// Roll from forward speed. The angle lives in car-local space but vForward is
		// WORLD units — divide by the WORLD radius (local × visualScale), or the wheels
		// spin visualScale× too fast and strobe into mush. Wrapped to ±π so the f32
		// sin/cos in the shader never loses precision on long drives.
		const rot = body.rotation(_rot);
		_q.set(rot.x, rot.y, rot.z, rot.w);
		_forward.set(0, 0, -1).applyQuaternion(_q);
		const lv = body.linvel(_lin);
		const vForward = _forward.x * lv.x + _forward.y * lv.y + _forward.z * lv.z;
		uRoll.value = wrapAngle(uRoll.value - (vForward / (wheelRadius * visualScale)) * delta);
	});
</script>
