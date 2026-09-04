<script lang="ts">
	import { T } from '@threlte/core/webgpu';
	import { useGltf, useDraco, useKtx2, useMeshopt } from '@threlte/extras';
	import { AutoColliders } from '@threlte/rapier';
	import { REVISION, type Mesh } from 'three/webgpu';
	import { BASE_URL } from '$extensions/settings';
	import { logGltf } from '$extensions/logger';

	// Test Game 3D scene — driving prototype.
	// Controls: arrows drive, Space handbrake, Q/E shift down/up — deliberately keys
	// Studio doesn't bind (w a s z t r c v m), so dev-mode shortcuts don't fight the car.
	// Will consume its own svelte:window keymap; the shared keymapper needs a rework first.

	// Both models are draco + KTX2 compressed, so the decoders must be handed to useGltf
	// (same setup as the gltf-viewer extension: DRACO/KTX2 fetch their decoder binaries
	// on demand from a CDN pinned to the installed three version; Meshopt ships in three).
	const threeCdn = `https://cdn.jsdelivr.net/npm/three@0.${REVISION}`;
	const dracoLoader = useDraco(`${threeCdn}/examples/jsm/libs/draco/gltf/`);
	const meshoptDecoder = useMeshopt();
	const ktx2Loader = useKtx2(`${threeCdn}/examples/jsm/libs/basis/`);

	const decoders = { dracoLoader, meshoptDecoder, ktx2Loader };

	const city = useGltf(`${BASE_URL}models/testgame/city.glb`, decoders);
	const car = useGltf(`${BASE_URL}models/testgame/2023_toyota_gr86_compressed.glb`, decoders);

	$effect(() => {
		if ($city?.scene) logGltf.info('TestGame city loaded');
		if ($car?.scene) logGltf.info('TestGame car loaded');
	});

	// Shadows — both cast and receive. SkyLight auto-fits its shadow frustum to the
	// visible casters, so scene-sized geometry just lands on a bigger quantised radius
	// band; nothing to configure here.
	$effect(() => {
		for (const root of [$city?.scene, $car?.scene]) {
			if (!root) continue;
			root.traverse((obj) => {
				const mesh = obj as Mesh;
				if (mesh.isMesh) {
					mesh.castShadow = true;
					mesh.receiveShadow = true;
				}
			});
		}
	});
</script>

{#if $city}
	<T.Group name="City" scale={0.01}>
		<!-- Trimesh per mesh (the GLB is ~22 named building/prop/road meshes): exact
		     collision for a drivable city, fixed bodies by AutoColliders' default. -->
		<AutoColliders shape="trimesh">
			<T is={$city.scene} />
		</AutoColliders>
	</T.Group>
{/if}

<!-- Player car — scale/position deliberately left as-authored, tuned by hand. -->
{#if $car}
	<T.Group name="GR86" scale={2}>
		<T is={$car.scene} />
	</T.Group>
{/if}
