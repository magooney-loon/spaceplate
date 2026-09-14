<script lang="ts">
	import { T } from '@threlte/core/webgpu';
	import { useGltf } from '@threlte/extras';
	import { AutoColliders } from '@threlte/rapier';
	import { untrack } from 'svelte';
	import type { Mesh } from 'three/webgpu';
	import type { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
	import type { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
	import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
	import { logGltf } from '$extensions/logger';

	// One GLB of the NFSU2 map experiment — the per-piece half of Nfsu2Map.svelte,
	// same shape as the gltf-viewer extension's instance: one useGltf per
	// component, keyed by URL in the parent's {#each}.

	let {
		name,
		url,
		decoders
	}: {
		name: string;
		url: string;
		decoders: {
			dracoLoader: DRACOLoader;
			meshoptDecoder: typeof MeshoptDecoder;
			ktx2Loader: KTX2Loader;
		};
	} = $props();

	// untrack: URL and decoders are fixed per mount — the parent keys its {#each}
	// by piece name, and useGltf is an init-time hook anyway (same pattern as
	// Track.svelte and the gltf-viewer extension's instance).
	const gltf = useGltf(untrack(() => url), untrack(() => decoders));

	// The world RECEIVES, it does not cast — the scene's shadow policy. The track's
	// half of the story (and why a blanket caster flip is a fill-rate problem, not
	// just a style choice) lives in world/Track.svelte.
	$effect(() => {
		const root = $gltf?.scene;
		if (!root) return;
		root.traverse((obj) => {
			const mesh = obj as Mesh;
			if (!mesh.isMesh) return;
			mesh.castShadow = false;
			mesh.receiveShadow = true;
		});
	});

	$effect(() => {
		if ($gltf?.scene) logGltf.info(`NFSU2 map piece loaded: ${untrack(() => name)}`);
	});
</script>

{#if $gltf}
	<T.Group name={`Nfsu2_${name}`}>
		<!-- Quick-experiment colliders: plain <AutoColliders shape="trimesh"> per
		     the gltf-viewer extension. NOTE: AutoColliders cannot pass trimesh
		     flags, so there is NO FIX_INTERNAL_EDGES here — flat tessellated roads
		     may ghost-bump at triangle seams, which is the exact problem
		     world/trackColliders.ts solves the long way if this map graduates
		     from experiment. -->
		<AutoColliders shape="trimesh">
			<T is={$gltf.scene} />
		</AutoColliders>
	</T.Group>
{/if}
