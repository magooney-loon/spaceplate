<script lang="ts">
	// The moon disc: a textured sphere on the sky dome, phase-shaded by the sun — see
	// ../CLAUDE.md ("celestial/"). A descriptor consumer: reads `descriptor.moon` /
	// `.sun` in a task, no $effect, no reactive props, so no cycle can form.
	import { untrack } from 'svelte';
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import { dot, float, mix, positionWorld, smoothstep, texture, uniform } from 'three/tsl';
	import { BASE_URL } from '$extensions/settings';
	import { clamp01, descriptor, smooth01 } from '../../model';
	import { domeVertexNode, skyLayerMaterial, SKY_LAYER_USERDATA } from '../skyLayer';

	interface Props {
		/** Distance the disc is placed at. Cosmetic only -- depth is pinned to the far plane. */
		radius?: number;
		/** Apparent diameter. The real moon is 0.52 deg, which reads as a speck in a game. */
		angularSizeDeg?: number;
		/**
		 * Brightness of the unlit limb. Earthshine -- what makes a CRESCENT's dark side
		 * faintly visible rather than a bitten-off disc. It is deliberately not what
		 * carries a new moon: `newMoonFade` below removes the disc there instead.
		 */
		earthshine?: number;
		/** How far the disc fades out once the sun is up. 1 = invisible by day. */
		daylightFade?: number;
		/**
		 * Multiplier on the albedo map. Above 1 on purpose: the disc is tone-mapped along
		 * with everything else, and night runs at ~0.62 exposure, so an unboosted 0.8-grey
		 * texture lands as dishwater instead of the brightest thing in the sky.
		 */
		brightness?: number;
	}

	let {
		radius = 1000,
		angularSizeDeg = 2.2,
		earthshine = 0.07,
		daylightFade = 0.82,
		brightness = 2.6
	}: Props = $props();

	const { invalidate, autoRenderTask } = useThrelte();

	// TextureLoader.load() returns the Texture synchronously and fills it in when the
	// image arrives, so it can be handed to TSL immediately. That avoids @threlte/extras'
	// useTexture, which returns an AsyncWritable -- a store, and this repo is runes-only.
	const moonMap = new THREE.TextureLoader().load(`${BASE_URL}textures/skybox/moon.jpg`, () =>
		invalidate()
	);
	moonMap.colorSpace = THREE.SRGBColorSpace;
	moonMap.anisotropy = 4;

	const sunDirection = uniform(new THREE.Vector3(0, 1, 0));
	const moonCenter = uniform(new THREE.Vector3());
	const discOpacity = uniform(0);

	// `toneMapped` on, unlike the emissive layers: the disc sits in the same exposure
	// space as the SkyMesh dome it's seen against. Convex and single-sided from here, so
	// it never needs to depth-sort against itself despite `depthWrite = false`.
	const material = skyLayerMaterial({ toneMapped: true });

	// Depth pinned to the far plane, exactly as SkyMesh does (see pinFarPlane in skyLayer.ts).
	material.vertexNode = domeVertexNode();

	// The lit fraction is the angle between the surface normal and the sun -- which IS
	// the phase. The normal is rebuilt from world position rather than read from
	// `normalWorld` so it stays correct regardless of what the custom vertexNode above
	// does to the vertex stage.
	const surfaceNormal = positionWorld.sub(moonCenter).normalize();
	const lit = smoothstep(-0.08, 0.28, dot(surfaceNormal, sunDirection));

	// `untrack` on purpose: these two are baked into the node graph, which is built once.
	// Changing them later needs a remount, so reading the initial value is the intent,
	// not an oversight. Everything that must animate goes through a uniform instead.
	material.colorNode = texture(moonMap)
		.rgb.mul(mix(float(untrack(() => earthshine)), float(1), lit))
		.mul(float(untrack(() => brightness)));
	material.opacityNode = discOpacity;

	// SphereGeometry puts the texture's centre (u=0.5, v=0.5) on +X. Rotating the
	// geometry by -90 deg about Y moves it to +Z, which is the axis Object3D.lookAt aims
	// at its target for a non-camera object. Together with the lookAt below that tidally
	// locks the near face to the observer -- otherwise the moon appears to spin as it
	// crosses the sky.
	const geometry = new THREE.SphereGeometry(1, 48, 32);
	geometry.rotateY(-Math.PI / 2);

	const DEG = Math.PI / 180;
	// Half-angle: a sphere of this radius at `radius` subtends angularSizeDeg.
	const discScale = $derived(radius * Math.tan(angularSizeDeg * 0.5 * DEG));

	let moon = $state.raw<THREE.Mesh>();

	useTask(
		() => {
			if (!moon) return;

			const { moon: body, sun } = descriptor;

			moon.position.set(
				body.direction.x * radius,
				body.direction.y * radius,
				body.direction.z * radius
			);
			moon.scale.setScalar(discScale);
			// Aims local +Z (the texture's near face, after the geometry rotation) at the
			// origin. Cheap, and it has to run after position is set.
			moon.lookAt(0, 0, 0);
			moon.updateMatrixWorld();

			moonCenter.value.copy(moon.position);
			sunDirection.value.set(sun.direction.x, sun.direction.y, sun.direction.z);

			// Daylight term: a real moon stays faintly visible by day, so this dims rather
			// than hides it.
			const daylight = clamp01((sun.elevation + 2) / 8);
			// newMoonFade hides the disc near new moon (see ../CLAUDE.md) -- narrow on
			// purpose, 4% lit is inside the crescent the shading already gets right.
			const newMoonFade = smooth01(0, 0.04, descriptor.moonPhase.illumination);
			discOpacity.value = body.visibility * (1 - daylightFade * daylight) * newMoonFade;

			moon.visible = discOpacity.value > 0.002;
		},
		{ before: autoRenderTask, autoInvalidate: false }
	);

	$effect(() => {
		return () => {
			geometry.dispose();
			material.dispose();
			moonMap.dispose();
		};
	});
</script>

<T.Mesh
	bind:ref={moon}
	{geometry}
	{material}
	renderOrder={2}
	frustumCulled={false}
	userData={SKY_LAYER_USERDATA}
/>
