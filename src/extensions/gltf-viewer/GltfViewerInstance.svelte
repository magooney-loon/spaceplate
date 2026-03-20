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

		// Stop any clip not in activeAnimations
		Object.entries(allActions).forEach(([name, a]) => {
			if (!model.activeAnimations.includes(name)) a?.stop();
		});

		for (const clipName of model.activeAnimations) {
			const action = allActions[clipName];
			if (!action) continue;
			action.setLoop(model.loop ? LoopRepeat : LoopOnce, Infinity);
			action.setEffectiveTimeScale(model.animationSpeed);

			if (model.playState === 'stopped') {
				action.stop(); // resets time to frame 0
			} else {
				// reset().play() handles: first start, replay after LoopOnce finished, and resume from stop
				if (!action.isRunning()) action.reset().play();
				action.paused = model.playState === 'paused';
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
