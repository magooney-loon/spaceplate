<script lang="ts">
	// The moon disc: a textured sphere on the sky dome, phase-shaded by the sun.
	//
	// A descriptor consumer like Sky and SkyLight -- it reads `descriptor.moon` and
	// `descriptor.sun` in a task and writes the three object directly. No $effect, no
	// reactive props, so no cycle can form (DOCS/webgpu-notes.md §3).
	//
	// §17 sketched this as a billboard with "phase from the sun-moon angle". A sphere is
	// barely more work and strictly better: the phase falls out of the surface normal for
	// free, and the equirectangular map wraps it properly instead of being cropped. The
	// terminator therefore tracks `moonLag` (§3.4) with no extra plumbing -- set the lag
	// away from opposition and you get a crescent.
	import { untrack } from 'svelte';
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import {
		cameraProjectionMatrix,
		dot,
		float,
		mix,
		modelViewMatrix,
		positionLocal,
		positionWorld,
		smoothstep,
		texture,
		uniform,
		vec4
	} from 'three/tsl';
	import { BASE_URL } from '$extensions/settings';
	import { descriptor } from './model';

	interface Props {
		/** Distance the disc is placed at. Cosmetic only -- depth is pinned to the far plane. */
		radius?: number;
		/** Apparent diameter. The real moon is 0.52 deg, which reads as a speck in a game. */
		angularSizeDeg?: number;
		/** Brightness of the unlit limb. Earthshine, so a new moon is not a black hole. */
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

	const material = new THREE.MeshBasicNodeMaterial();
	material.transparent = true;
	// The disc is convex and single-sided from here, so it never needs to depth-sort
	// against itself; writing depth would only let it punch a hole in the sky.
	material.depthWrite = false;
	material.toneMapped = true;

	// Depth pinned to the far plane, exactly as SkyMesh does (`position.z = position.w`).
	// This is load-bearing, not an optimisation: the camera's far plane is 144 while the
	// dome sits at radius 1000, so a normally-projected moon would be clipped away
	// entirely. Pinning z also guarantees the disc sorts behind all scene geometry.
	const clip = cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(positionLocal, 1))).toVar();
	material.vertexNode = vec4(clip.xy, clip.w, clip.w);

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

	const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

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

			// `visibility` already ramps smoothly across the horizon (sunPath.ts), so the
			// disc fades in at moonrise instead of popping. The daylight term is separate:
			// a real moon stays faintly visible by day, so this dims rather than hides.
			const daylight = clamp01((sun.elevation + 2) / 8);
			discOpacity.value = body.visibility * (1 - daylightFade * daylight);

			invalidate();
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
	userData={{ hideInTree: true, selectable: false }}
/>
