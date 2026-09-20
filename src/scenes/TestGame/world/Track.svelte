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
	import { applyWetness } from '$core';
	import { logGltf } from '$extensions/logger';
	import { buildTrackColliders } from './trackColliders';
	import { buildTrackMap } from './trackMap';
	import { clearTrackMap, setTrackMap } from './trackMapState.svelte';

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

	// ── The map's POSE, hoisted out of the markup ─────────────────────────────
	// The track group's scale and yaw used to be literals on the <T.Group> below.
	// They are named now because the MINIMAP needs them as a matrix: the outline
	// has to come out in the same world frame `carSim.bodyX/bodyZ` is published
	// in, or the car marker drives across a map rotated 60° off its own
	// coordinates. Reading them off `$track.scene.matrixWorld` instead would make
	// that correctness depend on whether the child <T is={...}> has attached by
	// the time the effect below runs — a mount-ordering question with a silent
	// wrong answer. See trackMap.ts's `toWorld` note.
	const TRACK_SCALE = 1.5;
	const TRACK_YAW = -1.0472; // −60°

	const trackToWorld = new THREE.Matrix4().compose(
		new THREE.Vector3(0, 0, 0),
		new THREE.Quaternion().setFromEuler(new THREE.Euler(0, TRACK_YAW, 0)),
		new THREE.Vector3(TRACK_SCALE, TRACK_SCALE, TRACK_SCALE)
	);

	// The HUD minimap's outline — the Asphalt meshes rasterized and contoured
	// ONCE, when the GLB lands (trackMap.ts). Published to a module because the
	// HUD is an HTML sibling outside the Canvas, and dropped on unmount so a
	// re-entry rebuilds from its own load rather than showing the last track.
	$effect(() => {
		const root = $track?.scene;
		if (!root) return;
		setTrackMap(buildTrackMap(root, trackToWorld));
		return clearTrackMap;
	});

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
	// So the fix (`1.1` in testperf.md) was: THE CAR CASTS, THE WORLD RECEIVES —
	// the car's half of the policy (its CAR_NON_CASTERS list) is in
	// PlayerCar.svelte, and for a while the shadow pass drew the car alone.
	//
	// THE CORRECTNESS HALF OF THAT ARGUMENT EXPIRED with three r186: `SkyLight`
	// is a `SunLight` now and its two cascades are fitted to the VIEW CAMERA
	// (core/skybox/CLAUDE.md), so an oversized caster can no longer drag the box
	// off the car — a 3 km track and a 4 m car are what cascades are for.
	//
	// THE COST HALF DID NOT. This renders Metal + Leafs_Mat -- 262 663 of the
	// track's 313 725 triangles (Ground/Asphalt/Decals stay excluded, see
	// TRACK_CASTERS below) -- into the shadow map ONCE PER CASCADE, twice a
	// frame, and this scene is already fill-bound (DOCS/testperf.md §1.1). Watch
	// the Stats HUD (triangles/programs/frame time) if the car judders under
	// barriers or trees; the escape hatch is trimming TRACK_CASTERS further
	// (Metal alone is the highest-value caster -- it is what actually throws
	// shade across the car passing barriers; Leafs_Mat is the cheaper one to
	// drop first).
	const TRACK_CASTS_SHADOWS = true;
	/** Which track materials cast. Ground/Asphalt are the flat surfaces the
	 *  shadows land ON, and Decals are painted onto them — 51 062 triangles
	 *  that can only ever shadow themselves, so all three stay excluded. */
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

			// WET TRACK. Here rather than at the engine, because which surfaces get wet is
			// scene content — and here rather than in a list, because the puddle mask sorts
			// it out for free: it gates on the GEOMETRIC normal pointing up, so the asphalt
			// and the dirt pool and the barriers and the foliage (vertical, near enough)
			// only take the water FILM. Run inside the traverse that already exists rather
			// than as a second walk of 300k triangles' worth of nodes.
			//
			// Before the first render, which is the one hard constraint on a non-node
			// material — see `applyWetness`'s header. This effect runs on the frame the GLB
			// resolves, ahead of it being drawn. Re-patching a shared material (or the same
			// cached GLB on a scene re-entry) is `applyWetness`'s own problem, not ours.
			for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
				if (m) applyWetness(m);
			}
		});
	});

	$effect(() => {
		if ($track?.scene) logGltf.info('TestGame track loaded');
	});
</script>

{#if $track}
	<T.Group name="Track" scale={TRACK_SCALE} position={[0, 0, 0]} rotation={[0, TRACK_YAW, 0]}>
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
