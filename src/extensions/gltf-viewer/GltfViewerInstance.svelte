<script lang="ts">
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import { useGltf, useGltfAnimations, useDraco, useMeshopt, useKtx2 } from '@threlte/extras';
	import { AutoColliders } from '@threlte/rapier';
	import { LoopRepeat, LoopOnce } from 'three';
	import { SkeletonHelper, REVISION, type Group, type Mesh } from 'three/webgpu';
	import { untrack } from 'svelte';
	import { sceneState } from '$extensions/scene';
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
	const { scene, invalidate } = useThrelte();

	let group = $state.raw<Group>();

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

	// Populate clip names into state once GLTF loads
	$effect(() => {
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

	// Slowly spins the loaded scene around Y while enabled — driven off the group so
	// it never fights the animation mixer's own transforms on the GLTF scene root.
	//
	// This is the one task in the app that invalidates unconditionally per frame (the
	// group genuinely moved, so it has to), which pins Threlte's 'on-demand' renderMode
	// at full rate for as long as it runs. Hence the keep-alive guard: Scene.svelte never
	// unmounts a visited scene, it only toggles group `visible`, so without this the
	// rotation would keep forcing full-rate frames of whatever scene IS current — same
	// reason the cube captures in DemoPhysicsBodies guard on it.
	useTask(
		(delta) => {
			if (!group || !model.autoRotate) return;
			if (sceneState.currentScene !== 'demoScene') return;
			group.rotation.y += model.autoRotateSpeed * delta;
			invalidate();
		},
		{ autoInvalidate: false }
	);
</script>

{#if model.visible && $gltf}
	<T.Group name={model.name} bind:ref={group}>
		{#if model.colliderEnabled}
			<AutoColliders shape={model.colliderShape}>
				<T is={$gltf.scene} />
			</AutoColliders>
		{:else}
			<T is={$gltf.scene} />
		{/if}
	</T.Group>
{/if}
