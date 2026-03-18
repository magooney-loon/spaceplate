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
		FXAAEffect,
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
		ASCIIEffect,
		ToneMappingEffect,
		GridEffect,
		TiltShiftEffect,
		LensDistortionEffect
	} from 'postprocessing';
	import { settingsState, log } from '$core/settings.svelte.js';
	import { usePostProcessing } from '$extensions/postprocessing/usePostProcessing';

	const { state: postProcessingState } = usePostProcessing();

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

		if (s.smaa.enabled) {
			composer.addPass(
				new EffectPass($camera, new SMAAEffect({ preset: s.smaa.preset as SMAAPreset }))
			);
		}

		const mainEffects: any[] = [];

		if (s.fxaa.enabled) {
			const fxaa = new FXAAEffect();
			fxaa.minEdgeThreshold = s.fxaa.minEdgeThreshold;
			fxaa.maxEdgeThreshold = s.fxaa.maxEdgeThreshold;
			fxaa.subpixelQuality = s.fxaa.subpixelQuality;
			mainEffects.push(fxaa);
		}

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

		if (s.toneMapping.enabled) {
			mainEffects.push(
				new ToneMappingEffect({
					mode: s.toneMapping.mode,
					whitePoint: s.toneMapping.whitePoint,
					middleGrey: s.toneMapping.middleGrey
				})
			);
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
					radialModulation: s.chromaticAberration.radialModulation,
					modulationOffset: s.chromaticAberration.modulationOffset
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

		if (s.grid.enabled) {
			secondaryEffects.push(
				new GridEffect({
					scale: s.grid.scale,
					lineWidth: s.grid.lineWidth
				})
			);
		}

		if (s.tiltShift.enabled) {
			secondaryEffects.push(
				new TiltShiftEffect({
					offset: s.tiltShift.offset,
					rotation: s.tiltShift.rotation,
					focusArea: s.tiltShift.focusArea,
					feather: s.tiltShift.feather,
					kernelSize: s.tiltShift.kernelSize
				})
			);
		}

		if (s.lensDistortion.enabled) {
			secondaryEffects.push(
				new LensDistortionEffect({
					distortion: new THREE.Vector2(s.lensDistortion.distortionX, s.lensDistortion.distortionY),
					principalPoint: new THREE.Vector2(
						s.lensDistortion.principalX,
						s.lensDistortion.principalY
					),
					focalLength: new THREE.Vector2(
						s.lensDistortion.focalLengthX,
						s.lensDistortion.focalLengthY
					),
					skew: s.lensDistortion.skew
				})
			);
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

		const passCount =
			(s.smaa.enabled ? 1 : 0) +
			(mainEffects.length > 0 ? 1 : 0) +
			(secondaryEffects.length > 0 ? 1 : 0);
		log.info('Post-processing:', passCount, 'pass(es) with effects');
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
