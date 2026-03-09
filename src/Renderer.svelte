<script lang="ts">
	import { useThrelte, useTask } from '@threlte/core';
	import { onMount } from 'svelte';
	import {
		EffectComposer,
		EffectPass,
		RenderPass,
		SMAAEffect,
		SMAAPreset,
		BloomEffect,
		KernelSize,
		VignetteEffect
	} from 'postprocessing';
	import { settingsState, log } from './settings.svelte.js';

	const { scene, renderer, camera, size, autoRender, renderStage } = useThrelte();

	// Adapt the default WebGLRenderer for postprocessing
	// Note: Default WebGL anti-aliasing is disabled in Canvas for performance,
	// we use SMAA post-processing anti-aliasing instead for better control
	const composer = new EffectComposer(renderer);

	const setupEffectComposer = () => {
		// Remove all existing passes to prevent duplicates
		composer.removeAllPasses();

		// Add the render pass
		const renderPass = new RenderPass(scene, $camera);
		composer.addPass(renderPass);

		// Skip effects for low quality - only basic rendering (no anti-aliasing)
		if (settingsState.graphics.quality === 'low') {
			log.info('Graphics quality: LOW - Post-processing and anti-aliasing disabled');
			return;
		}

		const isHighQuality = settingsState.graphics.quality === 'high';
		log.info(
			`Graphics quality: ${settingsState.graphics.quality.toUpperCase()} - Post-processing and SMAA anti-aliasing enabled`
		);

		const bloomEffect = new BloomEffect({
			intensity: isHighQuality ? 6 : 4,
			luminanceThreshold: isHighQuality ? 0.01 : 0.005,
			height: isHighQuality ? 1024 : 512,
			width: isHighQuality ? 1024 : 512,
			luminanceSmoothing: isHighQuality ? 0.08 : 0.06,
			mipmapBlur: true,
			kernelSize: isHighQuality ? KernelSize.HUGE : KernelSize.MEDIUM
		});

		// SMAA anti-aliasing (replaces default WebGL anti-aliasing for better performance)
		const smaaEffect = new SMAAEffect({
			preset: isHighQuality ? SMAAPreset.ULTRA : SMAAPreset.MEDIUM
		});

		const vignetteEffect = new VignetteEffect({
			eskil: false,
			offset: 0.2,
			darkness: 0.75
		});

		const effectPass = new EffectPass($camera, bloomEffect, smaaEffect, vignetteEffect);
		composer.addPass(effectPass);
	};

	$effect(() => {
		setupEffectComposer();
	});

	$effect(() => {
		composer.setSize($size.width, $size.height);
	});

	// We need to disable auto rendering as soon as this component is
	// mounted and restore the previous state when it is unmounted.
	onMount(() => {
		const before = autoRender.current;
		autoRender.set(false);
		return () => autoRender.set(before);
	});

	// Use the render task to render with the composer
	useTask(
		(delta) => {
			composer.render(delta);
		},
		{ stage: renderStage, autoInvalidate: false }
	);

	// Clean up resources when the component is unmounted
	$effect(() => {
		return () => {
			composer.removeAllPasses();
			composer.dispose();
		};
	});
</script>
