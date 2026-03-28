<script lang="ts">
	import { T } from '@threlte/core';
	import { useGltf, useGltfAnimations } from '@threlte/extras';
	import { AutoColliders } from '@threlte/rapier';
	import { LoopRepeat, LoopOnce } from 'three';
	import { untrack } from 'svelte';
	import { gltfViewerActions } from './gltfViewer.svelte';
	import { logGltf } from '$extensions/logger/logger.svelte';
	import type { GltfViewerModel } from './types';

	let { model }: { model: GltfViewerModel } = $props();

	// untrack: URL is intentionally fixed per instance (keyed by model.id in parent {#each})
	const gltf = useGltf(untrack(() => model.url));
	const { actions } = useGltfAnimations(gltf);

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
