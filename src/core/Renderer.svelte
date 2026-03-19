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
		EdgeDetectionMode,
		PredicationMode,
		FXAAEffect,
		BloomEffect,
		VignetteEffect,
		VignetteTechnique,
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
		LensDistortionEffect,
		ColorDepthEffect,
		DepthOfFieldEffect,
		GodRaysEffect,
		SSAOEffect,
		OutlineEffect,
		DepthEffect,
		ShockWaveEffect
	} from 'postprocessing';
	import { settingsState, log } from '$core/settings.svelte.js';
	import { usePostProcessing } from '$extensions/postprocessing/usePostProcessing';

	const { state: postProcessingState } = usePostProcessing();

	const { scene, renderer, camera, size, autoRender, renderStage } = useThrelte();

	const composer = new EffectComposer(renderer);

	let smaaPass: EffectPass | null = null;
	let fxaaEffect: FXAAEffect | null = null;
	let mainPass: EffectPass | null = null;
	let secondaryPass: EffectPass | null = null;
	let bloomEffect: BloomEffect | null = null;
	let toneMappingEffect: ToneMappingEffect | null = null;
	let vignetteEffect: VignetteEffect | null = null;
	let chromaticAberrationEffect: ChromaticAberrationEffect | null = null;
	let brightnessContrastEffect: BrightnessContrastEffect | null = null;
	let hueSaturationEffect: HueSaturationEffect | null = null;
	let sepiaEffect: SepiaEffect | null = null;
	let pixelationEffect: PixelationEffect | null = null;
	let dotScreenEffect: DotScreenEffect | null = null;
	let scanlineEffect: ScanlineEffect | null = null;
	let noiseEffect: NoiseEffect | null = null;
	let glitchEffect: GlitchEffect | null = null;
	let gridEffect: GridEffect | null = null;
	let tiltShiftEffect: TiltShiftEffect | null = null;
	let lensDistortionEffect: LensDistortionEffect | null = null;
	let asciiEffect: ASCIIEffect | null = null;
	let colorDepthEffect: ColorDepthEffect | null = null;
	let depthOfFieldEffect: DepthOfFieldEffect | null = null;
	let godRaysEffect: GodRaysEffect | null = null;
	let ssaoEffect: SSAOEffect | null = null;
	let outlineEffect: OutlineEffect | null = null;
	let depthEffect: DepthEffect | null = null;
	let shockWaveEffect: ShockWaveEffect | null = null;
	let godRaysSun: THREE.Mesh | null = null;
	let isUpdatingEffects = false;

	const disposeEffect = (effect: any) => {
		if (effect && effect.dispose) {
			effect.dispose();
		}
	};

	const removeAllEffects = () => {
		isUpdatingEffects = true;
		composer.removeAllPasses();
		disposeEffect(smaaPass);
		disposeEffect(mainPass);
		disposeEffect(secondaryPass);
		smaaPass = null;
		mainPass = null;
		secondaryPass = null;
		disposeEffect(fxaaEffect);
		disposeEffect(bloomEffect);
		disposeEffect(toneMappingEffect);
		disposeEffect(vignetteEffect);
		disposeEffect(chromaticAberrationEffect);
		disposeEffect(brightnessContrastEffect);
		disposeEffect(hueSaturationEffect);
		disposeEffect(sepiaEffect);
		disposeEffect(pixelationEffect);
		disposeEffect(dotScreenEffect);
		disposeEffect(scanlineEffect);
		disposeEffect(noiseEffect);
		disposeEffect(glitchEffect);
		disposeEffect(gridEffect);
		disposeEffect(tiltShiftEffect);
		disposeEffect(lensDistortionEffect);
		disposeEffect(asciiEffect);
		disposeEffect(colorDepthEffect);
		disposeEffect(depthOfFieldEffect);
		disposeEffect(godRaysEffect);
		disposeEffect(ssaoEffect);
		disposeEffect(outlineEffect);
		disposeEffect(depthEffect);
		disposeEffect(shockWaveEffect);
		if (godRaysSun) {
			scene.remove(godRaysSun);
			godRaysSun.geometry.dispose();
			(godRaysSun.material as THREE.Material).dispose();
			godRaysSun = null;
		}
		outlineEffect = null;
		depthEffect = null;
		shockWaveEffect = null;
	};

	const s = postProcessingState;

	$effect(() => {
		if (settingsState.graphics.quality === 'low') {
			removeAllEffects();
			const renderPass = new RenderPass(scene, $camera);
			composer.addPass(renderPass);
			return;
		}

		removeAllEffects();

		const renderPass = new RenderPass(scene, $camera);
		composer.addPass(renderPass);

		const mainEffects: any[] = [];
		const secondaryEffects: any[] = [];

		if (s.smaa.enabled) {
			smaaPass = new EffectPass(
				$camera,
				new SMAAEffect({
					preset: s.smaa.preset as SMAAPreset,
					edgeDetectionMode: s.smaa.edgeDetectionMode as EdgeDetectionMode,
					predicationMode: s.smaa.predicationMode as PredicationMode
				})
			);
			composer.addPass(smaaPass);
		}

		if (s.fxaa.enabled) {
			fxaaEffect = new FXAAEffect();
			fxaaEffect.minEdgeThreshold = s.fxaa.minEdgeThreshold;
			fxaaEffect.maxEdgeThreshold = s.fxaa.maxEdgeThreshold;
			fxaaEffect.subpixelQuality = s.fxaa.subpixelQuality;
			mainEffects.push(fxaaEffect);
		}

		if (s.bloom.enabled) {
			bloomEffect = new BloomEffect({
				intensity: s.bloom.intensity,
				luminanceThreshold: s.bloom.luminanceThreshold,
				luminanceSmoothing: s.bloom.luminanceSmoothing,
				mipmapBlur: s.bloom.mipmapBlur,
				kernelSize: s.bloom.kernelSize,
				radius: s.bloom.radius,
				levels: s.bloom.levels,
				resolutionScale: s.bloom.resolutionScale,
				blendFunction: s.bloom.blendFunction as BlendFunction
			});
			mainEffects.push(bloomEffect);
		}

		if (s.toneMapping.enabled) {
			toneMappingEffect = new ToneMappingEffect({
				mode: s.toneMapping.mode,
				whitePoint: s.toneMapping.whitePoint,
				middleGrey: s.toneMapping.middleGrey,
				blendFunction: s.toneMapping.blendFunction as BlendFunction,
				resolution: s.toneMapping.resolution,
				minLuminance: s.toneMapping.minLuminance,
				averageLuminance: s.toneMapping.averageLuminance,
				adaptationRate: s.toneMapping.adaptationRate
			});
			mainEffects.push(toneMappingEffect);
		}

		if (s.vignette.enabled) {
			vignetteEffect = new VignetteEffect({
				technique: s.vignette.technique as VignetteTechnique,
				offset: s.vignette.offset,
				darkness: s.vignette.darkness
			});
			mainEffects.push(vignetteEffect);
		}

		if (s.chromaticAberration.enabled) {
			chromaticAberrationEffect = new ChromaticAberrationEffect({
				offset: new THREE.Vector2(s.chromaticAberration.offsetX, s.chromaticAberration.offsetY),
				radialModulation: s.chromaticAberration.radialModulation,
				modulationOffset: s.chromaticAberration.modulationOffset,
				blendFunction: s.chromaticAberration.blendFunction as BlendFunction
			});
			mainEffects.push(chromaticAberrationEffect);
		}

		if (s.brightnessContrast.enabled) {
			brightnessContrastEffect = new BrightnessContrastEffect({
				brightness: s.brightnessContrast.brightness,
				contrast: s.brightnessContrast.contrast,
				blendFunction: s.brightnessContrast.blendFunction as BlendFunction
			});
			mainEffects.push(brightnessContrastEffect);
		}

		if (s.hueSaturation.enabled) {
			hueSaturationEffect = new HueSaturationEffect({
				hue: s.hueSaturation.hue,
				saturation: s.hueSaturation.saturation,
				blendFunction: s.hueSaturation.blendFunction as BlendFunction
			});
			mainEffects.push(hueSaturationEffect);
		}

		if (s.sepia.enabled) {
			sepiaEffect = new SepiaEffect({
				intensity: s.sepia.intensity,
				blendFunction: s.sepia.blendFunction as BlendFunction
			});
			mainEffects.push(sepiaEffect);
		}

		if (s.colorDepth.enabled) {
			colorDepthEffect = new ColorDepthEffect({
				bits: s.colorDepth.bits,
				blendFunction: s.colorDepth.blendFunction as BlendFunction
			});
			mainEffects.push(colorDepthEffect);
		}

		if (s.depthOfField.enabled) {
			depthOfFieldEffect = new DepthOfFieldEffect($camera, {
				focusDistance: s.depthOfField.focusDistance,
				focusRange: s.depthOfField.focusRange,
				bokehScale: s.depthOfField.bokehScale,
				resolutionScale: s.depthOfField.resolutionScale,
				blendFunction: s.depthOfField.blendFunction as BlendFunction
			});
			mainEffects.push(depthOfFieldEffect);
		}

		if (s.godRays.enabled) {
			if (!godRaysSun) {
				const sunGeometry = new THREE.SphereGeometry(0.75, 32, 32);
				const sunMaterial = new THREE.MeshBasicMaterial({
					color: s.godRays.sunColor,
					transparent: true,
					fog: false
				});
				godRaysSun = new THREE.Mesh(sunGeometry, sunMaterial);
				scene.add(godRaysSun);
			}
			godRaysSun.position.set(s.godRays.sunX, s.godRays.sunY, s.godRays.sunZ);
			(godRaysSun.material as THREE.MeshBasicMaterial).color.setHex(s.godRays.sunColor);
			godRaysEffect = new GodRaysEffect($camera, godRaysSun, {
				samples: s.godRays.samples,
				density: s.godRays.density,
				decay: s.godRays.decay,
				weight: s.godRays.weight,
				exposure: s.godRays.exposure,
				clampMax: s.godRays.clampMax,
				kernelSize: s.godRays.kernelSize,
				resolutionScale: s.godRays.resolutionScale,
				blendFunction: s.godRays.blendFunction as BlendFunction
			});
			godRaysEffect.blur = s.godRays.blur;
			mainEffects.push(godRaysEffect);
		}

		if (s.ssao.enabled) {
			ssaoEffect = new SSAOEffect($camera, undefined, {
				samples: s.ssao.samples,
				rings: s.ssao.rings,
				radius: s.ssao.radius,
				intensity: s.ssao.intensity,
				bias: s.ssao.bias,
				fade: s.ssao.fade,
				luminanceInfluence: s.ssao.luminanceInfluence,
				blendFunction: s.ssao.blendFunction as BlendFunction,
				worldDistanceThreshold: s.ssao.worldDistanceThreshold,
				worldDistanceFalloff: s.ssao.worldDistanceFalloff,
				worldProximityThreshold: s.ssao.worldProximityThreshold,
				worldProximityFalloff: s.ssao.worldProximityFalloff,
				minRadiusScale: s.ssao.minRadiusScale,
				color: new THREE.Color(s.ssao.color),
				depthAwareUpsampling: s.ssao.depthAwareUpsampling,
				resolutionScale: s.ssao.resolutionScale
			});
			mainEffects.push(ssaoEffect);
		}

		if (s.outline.enabled) {
			outlineEffect = new OutlineEffect(scene, $camera, {
				edgeStrength: s.outline.edgeStrength,
				visibleEdgeColor: s.outline.visibleEdgeColor,
				hiddenEdgeColor: s.outline.hiddenEdgeColor,
				pulseSpeed: s.outline.pulseSpeed,
				xRay: s.outline.xRay,
				blur: s.outline.blur,
				kernelSize: s.outline.kernelSize,
				patternScale: s.outline.patternScale,
				multisampling: s.outline.multisampling,
				resolutionScale: s.outline.resolutionScale,
				blendFunction: s.outline.blendFunction as BlendFunction
			});
			mainEffects.push(outlineEffect);
		}

		if (s.depthEffect.enabled) {
			depthEffect = new DepthEffect({
				inverted: s.depthEffect.inverted,
				blendFunction: s.depthEffect.blendFunction as BlendFunction
			});
			mainEffects.push(depthEffect);
		}

		if (s.shockWave.enabled) {
			const epicenter = new THREE.Vector3(
				s.shockWave.epicenterX,
				s.shockWave.epicenterY,
				s.shockWave.epicenterZ
			);
			shockWaveEffect = new ShockWaveEffect($camera, epicenter, {
				speed: s.shockWave.speed,
				maxRadius: s.shockWave.maxRadius,
				waveSize: s.shockWave.waveSize,
				amplitude: s.shockWave.amplitude
			});
			mainEffects.push(shockWaveEffect);
		}

		if (mainEffects.length > 0) {
			mainPass = new EffectPass($camera, ...mainEffects);
			composer.addPass(mainPass);
		}

		if (s.pixelation.enabled) {
			pixelationEffect = new PixelationEffect(s.pixelation.granularity);
			secondaryEffects.push(pixelationEffect);
		}

		if (s.dotScreen.enabled) {
			dotScreenEffect = new DotScreenEffect({
				angle: s.dotScreen.angle,
				scale: s.dotScreen.scale,
				blendFunction: s.dotScreen.blendFunction as BlendFunction
			});
			secondaryEffects.push(dotScreenEffect);
		}

		if (s.scanline.enabled) {
			scanlineEffect = new ScanlineEffect({
				density: s.scanline.density,
				blendFunction: s.scanline.blendFunction as BlendFunction
			});
			scanlineEffect.scrollSpeed = s.scanline.scrollSpeed;
			secondaryEffects.push(scanlineEffect);
		}

		if (s.noise.enabled) {
			noiseEffect = new NoiseEffect({
				premultiply: s.noise.premultiply,
				blendFunction: s.noise.blendFunction as BlendFunction
			});
			secondaryEffects.push(noiseEffect);
		}

		if (s.glitch.enabled) {
			glitchEffect = new GlitchEffect({
				delay: new THREE.Vector2(s.glitch.delay, s.glitch.delay * 2),
				duration: new THREE.Vector2(s.glitch.duration * 0.5, s.glitch.duration),
				strength: new THREE.Vector2(s.glitch.strength * 0.5, s.glitch.strength),
				ratio: s.glitch.ratio,
				columns: s.glitch.columns,
				blendFunction: s.glitch.blendFunction as BlendFunction,
				dtSize: s.glitch.dtSize
			});
			glitchEffect.mode = s.glitch.mode as GlitchMode;
			secondaryEffects.push(glitchEffect);
		}

		if (s.grid.enabled) {
			gridEffect = new GridEffect({
				scale: s.grid.scale,
				lineWidth: s.grid.lineWidth,
				blendFunction: s.grid.blendFunction as BlendFunction
			});
			secondaryEffects.push(gridEffect);
		}

		if (s.tiltShift.enabled) {
			tiltShiftEffect = new TiltShiftEffect({
				offset: s.tiltShift.offset,
				rotation: s.tiltShift.rotation,
				focusArea: s.tiltShift.focusArea,
				feather: s.tiltShift.feather,
				kernelSize: s.tiltShift.kernelSize,
				blendFunction: s.tiltShift.blendFunction as BlendFunction
			});
			secondaryEffects.push(tiltShiftEffect);
		}

		if (s.lensDistortion.enabled) {
			lensDistortionEffect = new LensDistortionEffect({
				distortion: new THREE.Vector2(s.lensDistortion.distortionX, s.lensDistortion.distortionY),
				principalPoint: new THREE.Vector2(s.lensDistortion.principalX, s.lensDistortion.principalY),
				focalLength: new THREE.Vector2(
					s.lensDistortion.focalLengthX,
					s.lensDistortion.focalLengthY
				),
				skew: s.lensDistortion.skew
			});
			secondaryEffects.push(lensDistortionEffect);
		}

		if (s.ascii.enabled) {
			asciiEffect = new ASCIIEffect({
				cellSize: s.ascii.cellSize,
				inverted: s.ascii.inverted
			});
			secondaryEffects.push(asciiEffect);
		}

		if (secondaryEffects.length > 0) {
			secondaryPass = new EffectPass($camera, ...secondaryEffects);
			composer.addPass(secondaryPass);
		}

		const passCount =
			(s.smaa.enabled ? 1 : 0) +
			(mainEffects.length > 0 ? 1 : 0) +
			(secondaryEffects.length > 0 ? 1 : 0);
		log.info(
			'Post-processing:',
			passCount,
			'pass(es) with',
			mainEffects.length + secondaryEffects.length,
			'effects'
		);
		isUpdatingEffects = false;
	});

	$effect(() => {
		composer.setSize($size.width, $size.height);
	});

	$effect(() => {
		const triggered = s.shockWave.triggered;
		const effect = shockWaveEffect;
		if (effect && triggered) {
			effect.explode();
			s.shockWave.triggered = false;
		}
	});

	$effect(() => {
		const effect = shockWaveEffect;
		if (effect) {
			effect.speed = s.shockWave.speed;
			effect.maxRadius = s.shockWave.maxRadius;
			effect.waveSize = s.shockWave.waveSize;
			effect.amplitude = s.shockWave.amplitude;
			effect.position.set(s.shockWave.epicenterX, s.shockWave.epicenterY, s.shockWave.epicenterZ);
		}
	});

	$effect(() => {
		const sun = godRaysSun;
		if (sun) {
			sun.position.set(s.godRays.sunX, s.godRays.sunY, s.godRays.sunZ);
			(sun.material as THREE.MeshBasicMaterial).color.setHex(s.godRays.sunColor);
		}
	});

	onMount(() => {
		const before = autoRender.current;
		autoRender.set(false);
		return () => autoRender.set(before);
	});

	useTask(
		(delta) => {
			if (composer && !isUpdatingEffects) {
				composer.render(delta);
			}
		},
		{ stage: renderStage, autoInvalidate: false }
	);

	$effect(() => {
		return () => {
			removeAllEffects();
			composer.dispose();
		};
	});
</script>
