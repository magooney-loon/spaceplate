<script lang="ts">
	import { T, useThrelte } from '@threlte/core/webgpu';
	import { useGltf, useGltfAnimations, useDraco, useMeshopt, useKtx2 } from '@threlte/extras';
	import { AutoColliders } from '@threlte/rapier';
	import { LoopRepeat, LoopOnce } from 'three';
	  import { SkeletonHelper, REVISION, BufferAttribute, type Mesh, type Material, type BufferGeometry, type Object3D } from 'three/webgpu';
	import { untrack } from 'svelte';
	import { gltfViewerActions } from './gltfViewer.svelte';
	import { logGltf } from '$extensions/logger';
	import type { GltfViewerModel } from './types';

	let { model }: { model: GltfViewerModel } = $props();

	// Decoders so the viewer opens compressed GLTFs too. DRACO and KTX2 fetch their
	// decoder binaries on demand from a CDN pinned to the installed three version
	// (jsdelivr resolves the 0.<REVISION> range; the decoders must match the
	// GLTFLoader). Meshopt ships inside three — no download. Loaders are cached
	// module-side by threlte, so N instances cost one decoder fetch. Uncompressed
	// models never touch the decoders — GLTFLoader only invokes them when the file
	// actually uses those extensions.
	const threeCdn = `https://cdn.jsdelivr.net/npm/three@0.${REVISION}`;
	const dracoLoader = useDraco(`${threeCdn}/examples/jsm/libs/draco/gltf/`);
	const meshoptDecoder = useMeshopt();
	const ktx2Loader = useKtx2(`${threeCdn}/examples/jsm/libs/basis/`);

	// untrack: URL is intentionally fixed per instance (keyed by model.id in parent {#each})
	const gltf = useGltf(untrack(() => model.url), {
		dracoLoader,
		meshoptDecoder,
		ktx2Loader
	});
	const { actions } = useGltfAnimations(gltf);
	const { scene } = useThrelte();

	// Track which clips were active on the previous effect run so we can diff for fade in/out
	let prevActive = new Set<string>();

	    // Log when GLTF scene finishes loading
	    $effect(() => {
	        const scene = $gltf?.scene;
	        if (scene) {
	            logGltf.info(
	                'Loaded:',
	                untrack(() => model.name),
	                '— meshes:',
	                scene.children.length
	            );
	        }
	    });

	    // Fill in UVs where a material references them but the geometry has none. Common
	    // with meshopt/DRACO-optimized or generated models: the material carries textures,
	    // the primitive lost its TEXCOORD_0. Three's AttributeNode then warns
	    // 'Vertex attribute "uv" not found on geometry' on every compile — rendering falls
	    // back to sampling one texel, which is exactly what a zeroed UV does, minus the
	    // console spam. Runs once per loaded scene, before the first render sees it.
	    const uvDependentMaps = [
	        'map',
	        'normalMap',
	        'roughnessMap',
	        'metalnessMap',
	        'aoMap',
	        'emissiveMap',
	        'alphaMap',
	        'bumpMap',
	        'displacementMap',
	        'clearcoatMap',
	        'clearcoatNormalMap',
	        'clearcoatRoughnessMap',
	        'sheenColorMap',
	        'sheenRoughnessMap',
	        'specularMap',
	        'specularColorMap',
	        'specularIntensityMap',
	        'iridescenceMap',
	        'iridescenceThicknessMap',
	        'transmissionMap',
	        'thicknessMap',
	        'lightMap'
	    ] as const;
	    const materialWantsUv = (material: Material | Material[]): boolean => {
	        const materials = Array.isArray(material) ? material : [material];
	        return materials.some((mat) =>
	            uvDependentMaps.some((slot) => (mat as unknown as Record<string, unknown>)[slot] != null)
	        );
	    };
	    const fillMissingUvs = (root: Object3D) => {
	        root.traverse((obj) => {
	            const mesh = obj as Mesh;
	            if (!mesh.isMesh || !mesh.geometry) return;
	            const geometry = mesh.geometry as BufferGeometry;
	            if (geometry.getAttribute('uv') || !materialWantsUv(mesh.material)) return;
	            geometry.setAttribute(
	                'uv',
	                new BufferAttribute(
	                    new Float32Array(geometry.getAttribute('position').count * 2),
	                    2
	                )
	            );
	        });
	    };

	    // Populate clip names into state once GLTF loads
	    $effect(() => {
	        const gltfScene = $gltf?.scene;
	        if (gltfScene) fillMissingUvs(gltfScene);

	        const clips = $gltf?.animations;
	        if (clips && clips.length > 0 && model.animationClips.length === 0) {
	            gltfViewerActions.setModelClips(
	                untrack(() => model.id),
	                clips.map((c) => c.name)
	            );
	        }
	    });

	// Rig (skeleton) overlay. Parented to the root scene and gated on model.visible —
	// when the mesh is hidden the GLTF scene detaches from the graph, bones stop
	// updating and a still-visible helper would freeze at the last pose. Helpers of
	// bone-less (static) meshes render nothing, so they are skipped entirely.
	$effect(() => {
		const gltfScene = $gltf?.scene;
		if (!gltfScene || !model.showRig || !model.visible) return;

		const helper = new SkeletonHelper(gltfScene);
		if (helper.bones.length === 0) {
			helper.dispose();
			return;
		}
		helper.userData = { selectable: false, hideInTree: true };
		scene.add(helper);

		return () => {
			helper.removeFromParent();
			helper.dispose();
		};
	});

	// Shadow casting — flips castShadow on every mesh of the loaded scene
	$effect(() => {
		const gltfScene = $gltf?.scene;
		if (!gltfScene) return;

		const cast = model.castShadows;
		gltfScene.traverse((obj) => {
			const mesh = obj as Mesh;
			if (mesh.isMesh) mesh.castShadow = cast;
		});
	});

	// Drive animation playback reactively from model state
	$effect(() => {
		const allActions = $actions;
		if (!allActions) return;

		const currentActive = new Set(model.activeAnimations);
		const dur = model.crossfadeDuration;

		// Fade out (or stop instantly) clips that were just disabled
		for (const name of prevActive) {
			if (!currentActive.has(name)) {
				const a = allActions[name];
				if (a) {
					if (dur > 0) a.fadeOut(dur);
					else a.stop();
				}
			}
		}

		for (const clipName of model.activeAnimations) {
			const action = allActions[clipName];
			if (!action) continue;
			action.setLoop(model.loop ? LoopRepeat : LoopOnce, Infinity);
			action.setEffectiveTimeScale(model.animationSpeed);

			if (model.playState === 'stopped') {
				action.stop(); // resets time to frame 0
			} else {
				if (!action.isRunning()) {
					// New clip, replay after LoopOnce ended, or resume after stop
					if (dur > 0) action.reset().fadeIn(dur).play();
					else action.reset().play();
				} else if (!prevActive.has(clipName)) {
					// Was fading out and re-enabled — reverse the fade
					if (dur > 0) action.fadeIn(dur);
				}
				action.paused = model.playState === 'paused';
			}
		}

		prevActive = currentActive;
	});
</script>

{#if model.visible && $gltf}
	<T.Group name={model.name}>
		{#if model.colliderEnabled}
			<AutoColliders shape={model.colliderShape}>
				<T is={$gltf.scene} />
			</AutoColliders>
		{:else}
			<T is={$gltf.scene} />
		{/if}
	</T.Group>
{/if}
