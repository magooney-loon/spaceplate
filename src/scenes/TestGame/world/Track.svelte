<script lang="ts">
	import { T } from '@threlte/core/webgpu';
	import { useGltf } from '@threlte/extras';
	import { Collider } from '@threlte/rapier';
	import { untrack } from 'svelte';
	import * as THREE from 'three/webgpu';
	import type { Mesh } from 'three/webgpu';
	import type { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
	import type { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
	import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
	import { BASE_URL } from '$extensions/settings';
	import { logGltf } from '$extensions/logger';
	import { buildTrackColliders } from './trackColliders';

	// The WORLD's one map so far: the test track. Everything map-shaped lives in
	// world/ — the GLB load, the scene pose (scale ×1.5, −60° yaw), the static
	// colliders (trackColliders.ts) and this half of the shadow policy. A second
	// map is a sibling component + swapping the one <Track /> line in
	// TestGame.svelte. The decoders arrive as a PROP so the whole scene shares
	// ONE DRACO/KTX2/Meshopt instance with the car's load (a second KTX2Loader
	// would spin up its own transcoder workers for nothing).

	let {
		decoders
	}: {
		decoders: {
			dracoLoader: DRACOLoader;
			meshoptDecoder: typeof MeshoptDecoder;
			ktx2Loader: KTX2Loader;
		};
	} = $props();

	// untrack: the decoders (like the URL) are fixed per mount — TestGame creates
	// the loader set once and never swaps it, and useGltf is an init-time hook
	// anyway (same pattern as the gltf-viewer extension's instance).
	const track = useGltf(
		`${BASE_URL}models/testgame/track.glb`,
		untrack(() => decoders)
	);

	// Static collision for the track — built once when the GLB lands. Hand-rolled
	// instead of <AutoColliders> because the trimesh flags (FIX_INTERNAL_EDGES,
	// which stops ghost bumps at internal triangle seams on the flat roads)
	// can only be passed through explicit args. See trackColliders.ts.
	const trackColliders = $derived($track?.scene ? buildTrackColliders($track.scene) : []);

	// ── Shadow casting is a POLICY, not a blanket flag — the track's half ──────
	//
	// This used to be `castShadow = receiveShadow = true` on every mesh in both
	// GLBs, and that was wrong in both directions at once. `SkyLight` USED TO fit
	// its ONE shadow cascade to the bounding sphere of the visible CASTERS,
	// clamped at `maxShadowRadius` = 400 world units. The track's `Metal` mesh
	// spans ~2 970 × 2 540 world units, so:
	//
	//   • the fit saturated at 400 and centred on the caster bounds — roughly
	//     (-1086, ., -118) world, about 1 090 units from where the car spawns
	//     and drives. The car sat entirely OUTSIDE the shadow frustum, so it
	//     cast no shadow, and the asphalt received none either. There were no
	//     sun shadows anywhere the player could go;
	//   • and the engine paid for that every single frame: `needsUpdate` is
	//     armed each frame (the car moves), so all 313 725 track triangles and
	//     324 640 car triangles — 5 + 29 draw calls — were re-rendered into the
	//     2048² map to produce nothing.
	//
	// So: THE CAR CASTS, THE WORLD RECEIVES (the car's half of the policy — its
	// CAR_NON_CASTERS list — is in TestGame.svelte), and the shadow pass draws
	// the car alone.
	//
	// THE CORRECTNESS HALF OF THAT ARGUMENT EXPIRED with three r186: `SkyLight`
	// is a `SunLight` now and its two cascades are fitted to the VIEW CAMERA
	// (core/skybox/CLAUDE.md), so an oversized caster can no longer drag the box
	// off the car — a 3 km track and a 4 m car are what cascades are for.
	//
	// THE COST HALF DID NOT. Flipping this on re-renders 313 725 track triangles
	// into the shadow map ONCE PER CASCADE, twice a frame, and this scene is
	// already fill-bound (DOCS/testperf.md). Do it as a measurement, with a
	// per-mesh caster list for the track the way the car has CAR_NON_CASTERS —
	// most of a track contributes nothing to a silhouette — not as a flag flip.
	const TRACK_CASTS_SHADOWS = false;
	/** Which track materials would cast, if they did. Ground/Asphalt are the flat
	 *  surfaces the shadows land ON, and Decals are painted onto them — 51 062
	 *  triangles that can only ever shadow themselves. */
	const TRACK_CASTERS = new Set(['Metal', 'Leafs_Mat']);

	const materialName = (mesh: Mesh): string =>
		(mesh.material as THREE.Material | undefined)?.name ?? '';

	$effect(() => {
		const root = $track?.scene;
		if (!root) return;
		root.traverse((obj) => {
			const mesh = obj as Mesh;
			if (!mesh.isMesh) return;
			mesh.castShadow = TRACK_CASTS_SHADOWS && TRACK_CASTERS.has(materialName(mesh));
			mesh.receiveShadow = true;
		});
	});

	$effect(() => {
		if ($track?.scene) logGltf.info('TestGame track loaded');
	});
</script>

{#if $track}
	<T.Group name="Track" scale={1.5} position={[0, 0, 0]} rotation={[0, -1.0472, 0]}>
		<!-- The track GLB: Asphalt and Metal barriers get trimesh colliders
		     (transforms baked); the Ground dirt plane becomes an analytical
		     cuboid FLOOR — two 460 m triangles were a contact-manifold jitter
		     factory; Decals (road paint) and foliage are excluded — see
		     trackColliders.ts. Bare <Collider>s attach to an implicit fixed body,
		     exactly like AutoColliders did. -->
		<T is={$track.scene} />
		{#each trackColliders as c (c.id)}
			{#if c.kind === 'trimesh'}
				<Collider shape="trimesh" args={c.args} />
			{:else}
				<T.Group position={c.center}>
					<Collider shape="cuboid" args={c.half} />
				</T.Group>
			{/if}
		{/each}
	</T.Group>
{/if}
