<script lang="ts">
	import { onDestroy } from 'svelte';
	import { T } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import { color, float, normalView, uv, vec4 } from 'three/tsl';

	// Front headlight rig for the GR86. Mounts INSIDE the car group, so it inherits the
	// hand-tuned scale/rotation/position and lives in car-local units (meters — the
	// model is 4.26 long on Z, 1.99 wide on X, 1.31 tall on Y; the nose is -Z, located
	// via the Engine mesh, which sits at z ≈ -1.28 on this front-engine car).
	//
	// Three layers per side, cheapest-first:
	//   1. a SpotLight for the actual light pool on the road,
	//   2. an additive TSL-shaded cone for the visible volumetric beam (edge + length
	//      fades — the volumetric-lighting example's look without a ray-marched
	//      pipeline pass; this rig is scene content),
	//   3. an HDR lens quad (>1 radiance → tone-maps hot, blooms when Bloom is on).
	//
	// All numbers are tweak-me constants; nothing here is load-bearing elsewhere.

	const LAMP_X = 0.62; // per-side |x| — outer lamp cluster
	const LAMP_Y = 0.65; // lamp height
	const LAMP_Z = -1.64; // nose face (glass front cluster ends ≈ -2.03)
	const BEAM_PITCH = -0.045; // radians, negative dips the aim slightly down

	const BEAM_LENGTH = 7; // car-local meters, narrow→wide away from the lamp
	const BEAM_NEAR_RADIUS = 0.16;
	const BEAM_FAR_RADIUS = 1.5;
	const BEAM_STRENGTH = 0.55; // additive beam brightness

	const LIGHT_INTENSITY = 260;
	const LIGHT_DISTANCE = 55; // world units, not scaled by the group's 2.5
	const LIGHT_ANGLE = 0.38;
	const LIGHT_PENUMBRA = 0.55;
	const LIGHT_DECAY = 1.7;
	const LIGHT_CAST_SHADOW = false; // two shadowed spots over the track trimesh is pricey

	const LENS_SIZE = 0.07; // circular lens diameter (car-local meters)
	const LENS_HEAT = 4; // HDR multiplier — tone-maps to white-hot, feeds bloom

	const WARM_WHITE = new THREE.Color(1.0, 0.93, 0.82);

	// One shared beam material for both cones. CylinderGeometry's v runs 0 (far end,
	// -Y) to 1 (near end, +Y); the mesh is rotated so +Y faces the lamp, so v=1 is at
	// the lamp. Both fades use ascending smoothstep (webgpu-notes.md §1.2).
	const beamMaterial = new THREE.MeshBasicNodeMaterial({
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
		side: THREE.DoubleSide
	});
	beamMaterial.name = 'HeadlightBeam';

	{
		const alongBeam = uv().y.smoothstep(0, 1).pow(1.5); // 1 at lamp → 0 at far end
		const facingCamera = normalView.z.abs().smoothstep(0, 0.7); // grazing edges fade
		const beam = float(BEAM_STRENGTH).mul(alongBeam).mul(facingCamera);
		// colorNode (never fragmentNode — §1.5); vec4 so additive SrcAlpha uses the fades
		beamMaterial.colorNode = vec4(color(1.0, 0.93, 0.82).mul(beam), beam);
	}

	// Round lens: a square quad shaded into a soft disc — radial distance from the UV
	// centre fades the alpha out before the geometry edge, so there is no corner to
	// see and the rim stays soft instead of a hard circle silhouette. Ascending
	// smoothstep + oneMinus per webgpu-notes.md §1.2.
	const lensMaterial = new THREE.MeshBasicNodeMaterial({
		side: THREE.DoubleSide,
		transparent: true,
		depthWrite: false
	});
	lensMaterial.name = 'HeadlightLens';
	{
		const radial = uv().sub(0.5).length(); // 0 centre → 0.5 at edge midpoints
		const disc = radial.smoothstep(0.32, 0.5).oneMinus(); // 1 centre → 0 rim
		lensMaterial.colorNode = vec4(color(1.0, 0.93, 0.82).mul(LENS_HEAT), disc);
	}

	const beamGeometry = new THREE.CylinderGeometry(
		BEAM_NEAR_RADIUS,
		BEAM_FAR_RADIUS,
		BEAM_LENGTH,
		24,
		1,
		true // open ended — the far cap would read as a glowing disc
	);
	const lensGeometry = new THREE.PlaneGeometry(LENS_SIZE, LENS_SIZE);

	// SpotLights aim at light.target's world matrix — the default target is an
	// Object3D at the origin that is NOT in the graph, so each light gets a mounted
	// target, assigned once both refs exist.
	let lightL = $state.raw<THREE.SpotLight>();
	let lightR = $state.raw<THREE.SpotLight>();
	let targetL = $state.raw<THREE.Object3D>();
	let targetR = $state.raw<THREE.Object3D>();

	$effect(() => {
		if (lightL && targetL) lightL.target = targetL;
		if (lightR && targetR) lightR.target = targetR;
	});

	onDestroy(() => {
		beamMaterial.dispose();
		lensMaterial.dispose();
		beamGeometry.dispose();
		lensGeometry.dispose();
	});
</script>

<T.Group name="HeadlightL" position={[-LAMP_X, LAMP_Y, LAMP_Z]} rotation={[BEAM_PITCH, 0, 0]}>
	<T.SpotLight
		bind:ref={lightL}
		color={WARM_WHITE}
		intensity={LIGHT_INTENSITY}
		distance={LIGHT_DISTANCE}
		angle={LIGHT_ANGLE}
		penumbra={LIGHT_PENUMBRA}
		decay={LIGHT_DECAY}
		castShadow={LIGHT_CAST_SHADOW}
	/>
	<T.Object3D bind:ref={targetL} position={[0, 0, -BEAM_LENGTH]} />

	<!-- Volumetric-looking beam cone: cylinder rotated so +Y (v=1, narrow end) points
	     forward (-Z), centred half a beam length ahead. -->
	<T.Mesh
		geometry={beamGeometry}
		material={beamMaterial}
		position={[0, 0, -BEAM_LENGTH / 2]}
		rotation={[-Math.PI / 2, 0, 0]}
		userData={{ selectable: false, hideInTree: true }}
	/>

	<!-- Hot lens, just ahead of the glass. Plane faces +Z by default → flip to -Z. -->
	<T.Mesh
		geometry={lensGeometry}
		material={lensMaterial}
		position={[0, 0, -0.03]}
		rotation={[0, Math.PI, 0]}
		userData={{ selectable: false, hideInTree: true }}
	/>
</T.Group>

<T.Group name="HeadlightR" position={[LAMP_X, LAMP_Y, LAMP_Z]} rotation={[BEAM_PITCH, 0, 0]}>
	<T.SpotLight
		bind:ref={lightR}
		color={WARM_WHITE}
		intensity={LIGHT_INTENSITY}
		distance={LIGHT_DISTANCE}
		angle={LIGHT_ANGLE}
		penumbra={LIGHT_PENUMBRA}
		decay={LIGHT_DECAY}
		castShadow={LIGHT_CAST_SHADOW}
	/>
	<T.Object3D bind:ref={targetR} position={[0, 0, -BEAM_LENGTH]} />

	<T.Mesh
		geometry={beamGeometry}
		material={beamMaterial}
		position={[0, 0, -BEAM_LENGTH / 2]}
		rotation={[-Math.PI / 2, 0, 0]}
		userData={{ selectable: false, hideInTree: true }}
	/>

	<T.Mesh
		geometry={lensGeometry}
		material={lensMaterial}
		position={[0, 0, -0.03]}
		rotation={[0, Math.PI, 0]}
		userData={{ selectable: false, hideInTree: true }}
	/>
</T.Group>
