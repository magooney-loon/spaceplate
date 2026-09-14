<script lang="ts">
	import { T } from '@threlte/core/webgpu';
	import type { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
	import type { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
	import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
	import { BASE_URL } from '$extensions/settings';
	import Nfsu2Piece from './Nfsu2Piece.svelte';

	// The EXPERIMENT map: five NFSU2 rips in public/models/testgame/nfsu2/, each
	// already positioned inside its own GLB — loaded AS IS, identity pose, no
	// per-piece transforms. Track.svelte is untouched; swap the one <Nfsu2Map />
	// line in TestGame.svelte back to <Track /> to revert the experiment.

	let {
		decoders
	}: {
		decoders: {
			dracoLoader: DRACOLoader;
			meshoptDecoder: typeof MeshoptDecoder;
			ktx2Loader: KTX2Loader;
		};
	} = $props();

	// The one pose knobs. Scale applies to visuals AND colliders (AutoColliders
	// bakes world scale into the trimesh vertices at creation); position offsets
	// every piece the same. Both are read at collider creation — editing them
	// needs a reload, not just a re-render.
	const MAP_SCALE = 1;
	const MAP_POSITION: [number, number, number] = [0, -220, 0];

	const PIECES = ['airport', 'airport_drag', 'city_part', 'landscape_biome', 'westfall'];
</script>

<T.Group name="Nfsu2Map" scale={MAP_SCALE} position={MAP_POSITION}>
	{#each PIECES as piece (piece)}
		<Nfsu2Piece name={piece} url={`${BASE_URL}models/testgame/nfsu2/${piece}.glb`} {decoders} />
	{/each}
</T.Group>
