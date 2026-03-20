<script lang="ts">
	import { T } from '@threlte/core';
	import { useGltf, useGltfAnimations } from '@threlte/extras';
	import { LoopRepeat, LoopOnce } from 'three';
	import { untrack } from 'svelte';
	import { gltfViewerActions } from './gltfViewer.svelte';
	import { logGltf } from '$extensions/logger/logger.svelte';
	import type { GltfViewerModel } from './types';

	let { model }: { model: GltfViewerModel } = $props();

	// untrack: URL is intentionally fixed per instance (keyed by model.id in parent {#each})
	const gltf = useGltf(untrack(() => model.url));
	const { actions } = useGltfAnimations(gltf);

	// Log when GLTF scene finishes loading
	$effect(() => {
		const scene = $gltf?.scene;
		if (scene) {
			logGltf.info('Loaded:', untrack(() => model.name), '— meshes:', scene.children.length);
		}
	});

	// Populate clip names into state once GLTF loads
	$effect(() => {
		const clips = $gltf?.animations;
		if (clips && clips.length > 0 && model.animationClips.length === 0) {
			gltfViewerActions.setModelClips(untrack(() => model.id), clips.map((c) => c.name));
		}
	});

	// Drive animation playback reactively from model state
	$effect(() => {
		const allActions = $actions;
		if (!allActions) return;

		// Stop any clip that is no longer the active one
		Object.entries(allActions).forEach(([name, a]) => {
			if (name !== model.activeAnimation) a?.stop();
		});

		if (model.activeAnimation) {
			const action = allActions[model.activeAnimation];
			if (action) {
				action.setLoop(model.loop ? LoopRepeat : LoopOnce, Infinity);
				action.setEffectiveTimeScale(model.animationSpeed);
				// Start the action if it isn't running yet, then use paused to freeze/resume
				// so that pause keeps the current frame rather than resetting
				if (!action.isRunning()) action.play();
				action.paused = !model.playing;
			}
		}
	});

	const deg2rad = (d: number) => (d * Math.PI) / 180;
</script>

{#if model.visible && $gltf}
	<T.Group
		position.x={model.position[0]}
		position.y={model.position[1]}
		position.z={model.position[2]}
		rotation.x={deg2rad(model.rotation[0])}
		rotation.y={deg2rad(model.rotation[1])}
		rotation.z={deg2rad(model.rotation[2])}
		scale={model.scale}
	>
		<T is={$gltf.scene} />
	</T.Group>
{/if}
