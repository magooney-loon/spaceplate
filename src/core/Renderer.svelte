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
		BlendFunction,
		ChromaticAberrationEffect,
		BrightnessContrastEffect,
		HueSaturationEffect,
		SepiaEffect,
		DotScreenEffect,
		ScanlineEffect,
		ASCIIEffect
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

		const s = postProcessingState;

		const mainEffects: any[] = [];

		if (s.bloom.enabled) {
			mainEffects.push(
				new BloomEffect({
					intensity: s.bloom.intensity,
					luminanceThreshold: s.bloom.luminanceThreshold,
					height: 1024,
					width: 1024,
					luminanceSmoothing: s.bloom.luminanceSmoothing,
					mipmapBlur: true,
					kernelSize: s.bloom.kernelSize
				})
			);
		}

		if (s.smaa.enabled) {
			mainEffects.push(new SMAAEffect({ preset: s.smaa.preset as SMAAPreset }));
		}

		if (s.vignette.enabled) {
			mainEffects.push(
				new VignetteEffect({
					eskil: false,
					offset: s.vignette.offset,
					darkness: s.vignette.darkness
				})
			);
		}

		if (s.chromaticAberration.enabled) {
			mainEffects.push(
				new ChromaticAberrationEffect({
					offset: new THREE.Vector2(s.chromaticAberration.offset, s.chromaticAberration.offset),
					radialModulation: false,
					modulationOffset: 0
				})
			);
		}

		if (s.brightnessContrast.enabled) {
			mainEffects.push(
				new BrightnessContrastEffect({
					brightness: s.brightnessContrast.brightness,
					contrast: s.brightnessContrast.contrast
				})
			);
		}

		if (s.hueSaturation.enabled) {
			mainEffects.push(
				new HueSaturationEffect({
					hue: s.hueSaturation.hue,
					saturation: s.hueSaturation.saturation
				})
			);
		}

		if (s.sepia.enabled) {
			mainEffects.push(new SepiaEffect({ intensity: s.sepia.intensity }));
		}

		if (mainEffects.length > 0) {
			const mainPass = new EffectPass($camera, ...mainEffects);
			composer.addPass(mainPass);
		}

		const secondaryEffects: any[] = [];

		if (s.pixelation.enabled) {
			secondaryEffects.push(new PixelationEffect(s.pixelation.granularity));
		}

		if (s.dotScreen.enabled) {
			secondaryEffects.push(
				new DotScreenEffect({
					angle: s.dotScreen.angle,
					scale: s.dotScreen.scale
				})
			);
		}

		if (s.scanline.enabled) {
			secondaryEffects.push(
				new ScanlineEffect({
					density: s.scanline.density
				})
			);
		}

		if (s.noise.enabled) {
			secondaryEffects.push(
				new NoiseEffect({
					premultiply: s.noise.premultiply,
					blendFunction: s.noise.blendFunction as BlendFunction
				})
			);
		}

		if (s.glitch.enabled) {
			glitchEffect = new GlitchEffect({
				delay: new THREE.Vector2(s.glitch.delay, s.glitch.delay * 2),
				duration: new THREE.Vector2(s.glitch.duration * 0.5, s.glitch.duration),
				strength: new THREE.Vector2(s.glitch.strength * 0.5, s.glitch.strength),
				ratio: s.glitch.ratio
			});
			glitchEffect.mode = GlitchMode.SPORADIC;
			secondaryEffects.push(glitchEffect);
		}

		if (s.ascii.enabled) {
			secondaryEffects.push(
				new ASCIIEffect({
					cellSize: s.ascii.cellSize,
					inverted: s.ascii.inverted
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
