<script lang="ts">
	import { useThrelte, useTask } from '@threlte/core';
	import { onMount } from 'svelte';
	import * as THREE from 'three';
	import {
		EffectComposer,
		EffectPass,
		RenderPass,
		SMAAEffect,
		SMAAPreset,
		BloomEffect,
		VignetteEffect,
		PixelationEffect,
		GlitchEffect,
		GlitchMode,
		NoiseEffect,
		BlendFunction
	} from 'postprocessing';
	import { settingsState, log } from '$core/settings.svelte.js';
	import { postProcessingState } from '$core/postprocessing.svelte.js';

	const { scene, renderer, camera, size, autoRender, renderStage } = useThrelte();

	const composer = new EffectComposer(renderer);

	let glitchEffect: GlitchEffect | null = null;

	const setupEffectComposer = () => {
		composer.removeAllPasses();
		glitchEffect = null;

		const renderPass = new RenderPass(scene, $camera);
		composer.addPass(renderPass);

		if (settingsState.graphics.quality === 'low') {
			log.info('Graphics quality: LOW - Post-processing disabled');
			return;
		}

		const { bloom, smaa, vignette, pixelation, glitch, noise } = postProcessingState;

		const mainEffects: any[] = [];

		if (bloom.enabled) {
			mainEffects.push(
				new BloomEffect({
					intensity: bloom.intensity,
					luminanceThreshold: bloom.luminanceThreshold,
					height: 1024,
					width: 1024,
					luminanceSmoothing: bloom.luminanceSmoothing,
					mipmapBlur: true,
					kernelSize: bloom.kernelSize
				})
			);
		}

		if (smaa.enabled) {
			mainEffects.push(new SMAAEffect({ preset: smaa.preset as SMAAPreset }));
		}

		if (vignette.enabled) {
			mainEffects.push(
				new VignetteEffect({
					eskil: false,
					offset: vignette.offset,
					darkness: vignette.darkness
				})
			);
		}

		if (mainEffects.length > 0) {
			const mainPass = new EffectPass($camera, ...mainEffects);
			composer.addPass(mainPass);
		}

		const secondaryEffects: any[] = [];

		if (pixelation.enabled) {
			secondaryEffects.push(new PixelationEffect(pixelation.granularity));
		}

		if (glitch.enabled) {
			glitchEffect = new GlitchEffect({
				delay: new THREE.Vector2(glitch.delay, glitch.delay * 2),
				duration: new THREE.Vector2(glitch.duration * 0.5, glitch.duration),
				strength: new THREE.Vector2(glitch.strength * 0.5, glitch.strength),
				ratio: glitch.ratio
			});
			glitchEffect.mode = GlitchMode.SPORADIC;
			secondaryEffects.push(glitchEffect);
		}

		if (noise.enabled) {
			secondaryEffects.push(
				new NoiseEffect({
					premultiply: noise.premultiply,
					blendFunction: noise.blendFunction as BlendFunction
				})
			);
		}

		if (secondaryEffects.length > 0) {
			const secondaryPass = new EffectPass($camera, ...secondaryEffects);
			composer.addPass(secondaryPass);
		}

		log.info('Post-processing:', mainEffects.length + secondaryEffects.length, 'effects active');
	};

	$effect(() => {
		postProcessingState.bloom.enabled;
		postProcessingState.bloom.intensity;
		postProcessingState.bloom.luminanceThreshold;
		postProcessingState.bloom.luminanceSmoothing;
		postProcessingState.bloom.kernelSize;
		postProcessingState.smaa.enabled;
		postProcessingState.smaa.preset;
		postProcessingState.vignette.enabled;
		postProcessingState.vignette.offset;
		postProcessingState.vignette.darkness;
		postProcessingState.pixelation.enabled;
		postProcessingState.pixelation.granularity;
		postProcessingState.glitch.enabled;
		postProcessingState.glitch.delay;
		postProcessingState.glitch.duration;
		postProcessingState.glitch.strength;
		postProcessingState.glitch.ratio;
		postProcessingState.noise.enabled;
		postProcessingState.noise.premultiply;
		postProcessingState.noise.blendFunction;
		setupEffectComposer();
	});

	$effect(() => {
		composer.setSize($size.width, $size.height);
	});

	onMount(() => {
		const before = autoRender.current;
		autoRender.set(false);
		return () => autoRender.set(before);
	});

	useTask(
		(delta) => {
			composer.render(delta);
		},
		{ stage: renderStage, autoInvalidate: false }
	);

	$effect(() => {
		return () => {
			composer.removeAllPasses();
			composer.dispose();
		};
	});
</script>
