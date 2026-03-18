<script lang="ts">
	import { useStudio, ToolbarItem, DropDownPane } from '@threlte/studio/extend';
	import { Folder, Slider, Checkbox, List, Button, Separator } from 'svelte-tweakpane-ui';
	import type { KernelSize, BlendFunction, ToneMappingMode } from 'postprocessing';

	const { createExtension } = useStudio();

	const kernelSizeOptions = [
		{ value: 1 as KernelSize, text: 'Very Small' },
		{ value: 2 as KernelSize, text: 'Small' },
		{ value: 3 as KernelSize, text: 'Medium' },
		{ value: 4 as KernelSize, text: 'Large' },
		{ value: 5 as KernelSize, text: 'Very Large' },
		{ value: 6 as KernelSize, text: 'Huge' }
	];

	const smaaPresetOptions = [
		{ value: 0, text: 'Low' },
		{ value: 1, text: 'Medium' },
		{ value: 2, text: 'High' },
		{ value: 3, text: 'Ultra' }
	];

	const smaaEdgeDetectionOptions = [
		{ value: 0, text: 'Depth' },
		{ value: 1, text: 'Luma' },
		{ value: 2, text: 'Color' }
	];

	const smaaPredicationOptions = [
		{ value: 0, text: 'Disabled' },
		{ value: 1, text: 'Depth' },
		{ value: 2, text: 'Custom' }
	];

	const vignetteTechniqueOptions = [
		{ value: 0, text: 'Default' },
		{ value: 1, text: 'Eskil' }
	];

	const glitchModeOptions = [
		{ value: 0, text: 'Disabled' },
		{ value: 1, text: 'Sporadic' },
		{ value: 2, text: 'Constant Mild' },
		{ value: 3, text: 'Constant Wild' }
	];

	const toneMappingOptions = [
		{ value: 0 as ToneMappingMode, text: 'Linear' },
		{ value: 1 as ToneMappingMode, text: 'Reinhard' },
		{ value: 2 as ToneMappingMode, text: 'Reinhard2' },
		{ value: 3 as ToneMappingMode, text: 'Reinhard2 Adaptive' },
		{ value: 4 as ToneMappingMode, text: 'Uncharted2' },
		{ value: 5 as ToneMappingMode, text: 'Optimized Cineon' },
		{ value: 6 as ToneMappingMode, text: 'Cineon' },
		{ value: 11 as ToneMappingMode, text: 'ACES Filmic' },
		{ value: 12 as ToneMappingMode, text: 'AGX' },
		{ value: 13 as ToneMappingMode, text: 'Neutral' }
	];

	const blendFunctionOptions = [
		{ value: 0 as BlendFunction, text: 'Normal' },
		{ value: 1 as BlendFunction, text: 'Add' },
		{ value: 2 as BlendFunction, text: 'Alpha' },
		{ value: 3 as BlendFunction, text: 'Average' },
		{ value: 4 as BlendFunction, text: 'Color' },
		{ value: 5 as BlendFunction, text: 'Color Burn' },
		{ value: 6 as BlendFunction, text: 'Color Dodge' },
		{ value: 7 as BlendFunction, text: 'Darken' },
		{ value: 8 as BlendFunction, text: 'Difference' },
		{ value: 9 as BlendFunction, text: 'Divide' },
		{ value: 10 as BlendFunction, text: 'Dst' },
		{ value: 11 as BlendFunction, text: 'Exclusion' },
		{ value: 12 as BlendFunction, text: 'Hard Light' },
		{ value: 13 as BlendFunction, text: 'Hard Mix' },
		{ value: 14 as BlendFunction, text: 'Hue' },
		{ value: 15 as BlendFunction, text: 'Invert' },
		{ value: 16 as BlendFunction, text: 'Invert RGB' },
		{ value: 17 as BlendFunction, text: 'Lighten' },
		{ value: 18 as BlendFunction, text: 'Linear Burn' },
		{ value: 19 as BlendFunction, text: 'Linear Dodge' },
		{ value: 20 as BlendFunction, text: 'Linear Light' },
		{ value: 21 as BlendFunction, text: 'Luminosity' },
		{ value: 22 as BlendFunction, text: 'Multiply' },
		{ value: 23 as BlendFunction, text: 'Negation' },
		{ value: 24 as BlendFunction, text: 'Normal' },
		{ value: 25 as BlendFunction, text: 'Overlay' },
		{ value: 26 as BlendFunction, text: 'Pin Light' },
		{ value: 27 as BlendFunction, text: 'Reflect' },
		{ value: 28 as BlendFunction, text: 'Screen' },
		{ value: 29 as BlendFunction, text: 'Src' },
		{ value: 30 as BlendFunction, text: 'Saturation' },
		{ value: 31 as BlendFunction, text: 'Soft Light' },
		{ value: 32 as BlendFunction, text: 'Subtract' },
		{ value: 33 as BlendFunction, text: 'Vivid Light' }
	];

	const ext = createExtension({
		scope: 'postprocessing',
		state: () => ({
			bloom: {
				enabled: false,
				intensity: 1.0,
				luminanceThreshold: 1.0,
				luminanceSmoothing: 0.03,
				kernelSize: 4 as KernelSize,
				blendFunction: 28 as BlendFunction,
				mipmapBlur: true,
				radius: 0.85,
				levels: 8
			},
			smaa: {
				enabled: false,
				preset: 2,
				edgeDetectionMode: 2,
				predicationMode: 0
			},
			fxaa: {
				enabled: false,
				minEdgeThreshold: 0.05,
				maxEdgeThreshold: 0.12,
				subpixelQuality: 0.75
			},
			vignette: {
				enabled: false,
				offset: 0.5,
				darkness: 0.5,
				technique: 0
			},
			pixelation: {
				enabled: false,
				granularity: 30.0
			},
			glitch: {
				enabled: false,
				delay: 2.5,
				duration: 0.8,
				strength: 0.65,
				ratio: 0.85,
				columns: 0.05,
				mode: 1
			},
			noise: {
				enabled: false,
				premultiply: false,
				blendFunction: 28 as BlendFunction
			},
			chromaticAberration: {
				enabled: false,
				radialModulation: false,
				modulationOffset: 0.15,
				offsetX: 0.01,
				offsetY: 0.01,
				blendFunction: 0 as BlendFunction
			},
			brightnessContrast: {
				enabled: false,
				brightness: 0,
				contrast: 0,
				blendFunction: 0 as BlendFunction
			},
			hueSaturation: {
				enabled: false,
				hue: 0,
				saturation: 0,
				blendFunction: 0 as BlendFunction
			},
			sepia: {
				enabled: false,
				intensity: 1.0,
				blendFunction: 0 as BlendFunction
			},
			dotScreen: {
				enabled: false,
				angle: 1.57,
				scale: 1.0,
				blendFunction: 0 as BlendFunction
			},
			scanline: {
				enabled: false,
				density: 1.25,
				opacity: 0.5,
				scrollSpeed: 0,
				blendFunction: 25 as BlendFunction
			},
			shockWave: {
				enabled: false,
				speed: 1.25,
				maxRadius: 0.5,
				waveSize: 0.2,
				amplitude: 0.05,
				epicenterX: 0,
				epicenterY: 0,
				epicenterZ: 0,
				triggered: false
			},
			ascii: {
				enabled: false,
				cellSize: 16,
				inverted: false
			},
			toneMapping: {
				enabled: false,
				mode: 11 as ToneMappingMode,
				whitePoint: 4.0,
				middleGrey: 0.6,
				blendFunction: 0 as BlendFunction,
				resolution: 256,
				minLuminance: 0.01,
				averageLuminance: 1.0,
				adaptationRate: 1.0
			},
			grid: {
				enabled: false,
				scale: 1.0,
				lineWidth: 0.0,
				blendFunction: 25 as BlendFunction
			},
			tiltShift: {
				enabled: false,
				offset: 0.0,
				rotation: 0.0,
				focusArea: 0.4,
				feather: 0.3,
				kernelSize: 3 as KernelSize,
				blendFunction: 0 as BlendFunction
			},
			lensDistortion: {
				enabled: false,
				distortionX: 0.0,
				distortionY: 0.0,
				principalX: 0.0,
				principalY: 0.0,
				focalLengthX: 1.0,
				focalLengthY: 1.0,
				skew: 0.0
			},
			colorDepth: {
				enabled: false,
				bits: 16,
				blendFunction: 0 as BlendFunction
			},
			depthOfField: {
				enabled: false,
				focusDistance: 3.0,
				focusRange: 2.0,
				bokehScale: 1.0,
				blendFunction: 0 as BlendFunction
			},
			godRays: {
				enabled: false,
				samples: 60,
				density: 0.96,
				decay: 0.9,
				weight: 0.4,
				exposure: 0.6,
				clampMax: 1.0,
				blur: true,
				kernelSize: 2 as KernelSize,
				blendFunction: 28 as BlendFunction,
				sunX: 0,
				sunY: 5,
				sunZ: 0,
				sunColor: 0xffddaa
			},
			ssao: {
				enabled: false,
				samples: 9,
				rings: 7,
				radius: 0.1825,
				intensity: 1.0,
				bias: 0.025,
				fade: 0.01,
				luminanceInfluence: 0.7,
				blendFunction: 7 as BlendFunction
			},
			outline: {
				enabled: false,
				edgeStrength: 1.0,
				visibleEdgeColor: 0xffffff,
				hiddenEdgeColor: 0x22090a,
				pulseSpeed: 0.0,
				xRay: true,
				blur: false,
				kernelSize: 1 as KernelSize,
				blendFunction: 22 as BlendFunction
			},
			depthEffect: {
				enabled: false,
				inverted: false,
				blendFunction: 0 as BlendFunction
			}
		}),
		actions: {
			toggleBloom: ({ state }) => {
				state.bloom.enabled = !state.bloom.enabled;
			},
			setBloomIntensity: ({ state }, v) => {
				state.bloom.intensity = v;
			},
			setBloomThreshold: ({ state }, v) => {
				state.bloom.luminanceThreshold = v;
			},
			setBloomSmoothing: ({ state }, v) => {
				state.bloom.luminanceSmoothing = v;
			},
			setBloomKernelSize: ({ state }, v) => {
				state.bloom.kernelSize = v;
			},
			setBloomBlendFunction: ({ state }, v) => {
				state.bloom.blendFunction = v;
			},
			setBloomMipmapBlur: ({ state }, v) => {
				state.bloom.mipmapBlur = v;
			},
			setBloomRadius: ({ state }, v) => {
				state.bloom.radius = v;
			},
			setBloomLevels: ({ state }, v) => {
				state.bloom.levels = v;
			},
			toggleSMAA: ({ state }) => {
				state.smaa.enabled = !state.smaa.enabled;
			},
			setSMAAPreset: ({ state }, v) => {
				state.smaa.preset = v;
			},
			setSMAEEdgeDetectionMode: ({ state }, v) => {
				state.smaa.edgeDetectionMode = v;
			},
			setSMAAPredicationMode: ({ state }, v) => {
				state.smaa.predicationMode = v;
			},
			toggleFXAA: ({ state }) => {
				state.fxaa.enabled = !state.fxaa.enabled;
			},
			setFXAAEdgeThreshold: ({ state }, min, max, quality) => {
				state.fxaa.minEdgeThreshold = min;
				state.fxaa.maxEdgeThreshold = max;
				state.fxaa.subpixelQuality = quality;
			},
			toggleVignette: ({ state }) => {
				state.vignette.enabled = !state.vignette.enabled;
			},
			setVignetteOffset: ({ state }, v) => {
				state.vignette.offset = v;
			},
			setVignetteDarkness: ({ state }, v) => {
				state.vignette.darkness = v;
			},
			setVignetteTechnique: ({ state }, v) => {
				state.vignette.technique = v;
			},
			togglePixelation: ({ state }) => {
				state.pixelation.enabled = !state.pixelation.enabled;
			},
			setPixelationGranularity: ({ state }, v) => {
				state.pixelation.granularity = v;
			},
			toggleGlitch: ({ state }) => {
				state.glitch.enabled = !state.glitch.enabled;
			},
			setGlitchDelay: ({ state }, v) => {
				state.glitch.delay = v;
			},
			setGlitchDuration: ({ state }, v) => {
				state.glitch.duration = v;
			},
			setGlitchStrength: ({ state }, v) => {
				state.glitch.strength = v;
			},
			setGlitchRatio: ({ state }, v) => {
				state.glitch.ratio = v;
			},
			setGlitchColumns: ({ state }, v) => {
				state.glitch.columns = v;
			},
			setGlitchMode: ({ state }, v) => {
				state.glitch.mode = v;
			},
			toggleNoise: ({ state }) => {
				state.noise.enabled = !state.noise.enabled;
			},
			toggleChromaticAberration: ({ state }) => {
				state.chromaticAberration.enabled = !state.chromaticAberration.enabled;
			},
			setChromaticAberrationOffset: ({ state }, v) => {
				state.chromaticAberration.offsetX = v;
				state.chromaticAberration.offsetY = v;
			},
			setChromaticAberrationOffsetX: ({ state }, v) => {
				state.chromaticAberration.offsetX = v;
			},
			setChromaticAberrationOffsetY: ({ state }, v) => {
				state.chromaticAberration.offsetY = v;
			},
			setChromaticAberrationModulation: ({ state }, radial, offset) => {
				state.chromaticAberration.radialModulation = radial;
				state.chromaticAberration.modulationOffset = offset;
			},
			setChromaticAberrationBlendFunction: ({ state }, v) => {
				state.chromaticAberration.blendFunction = v;
			},
			toggleBrightnessContrast: ({ state }) => {
				state.brightnessContrast.enabled = !state.brightnessContrast.enabled;
			},
			setBrightness: ({ state }, v) => {
				state.brightnessContrast.brightness = v;
			},
			setContrast: ({ state }, v) => {
				state.brightnessContrast.contrast = v;
			},
			setBrightnessContrastBlendFunction: ({ state }, v) => {
				state.brightnessContrast.blendFunction = v;
			},
			toggleHueSaturation: ({ state }) => {
				state.hueSaturation.enabled = !state.hueSaturation.enabled;
			},
			setHue: ({ state }, v) => {
				state.hueSaturation.hue = v;
			},
			setSaturation: ({ state }, v) => {
				state.hueSaturation.saturation = v;
			},
			setHueSaturationBlendFunction: ({ state }, v) => {
				state.hueSaturation.blendFunction = v;
			},
			toggleSepia: ({ state }) => {
				state.sepia.enabled = !state.sepia.enabled;
			},
			setSepiaIntensity: ({ state }, v) => {
				state.sepia.intensity = v;
			},
			setSepiaBlendFunction: ({ state }, v) => {
				state.sepia.blendFunction = v;
			},
			toggleDotScreen: ({ state }) => {
				state.dotScreen.enabled = !state.dotScreen.enabled;
			},
			setDotScreenAngle: ({ state }, v) => {
				state.dotScreen.angle = v;
			},
			setDotScreenScale: ({ state }, v) => {
				state.dotScreen.scale = v;
			},
			setDotScreenBlendFunction: ({ state }, v) => {
				state.dotScreen.blendFunction = v;
			},
			toggleScanline: ({ state }) => {
				state.scanline.enabled = !state.scanline.enabled;
			},
			setScanlineDensity: ({ state }, v) => {
				state.scanline.density = v;
			},
			setScanlineOpacity: ({ state }, v) => {
				state.scanline.opacity = v;
			},
			setScanlineScrollSpeed: ({ state }, v) => {
				state.scanline.scrollSpeed = v;
			},
			setScanlineBlendFunction: ({ state }, v) => {
				state.scanline.blendFunction = v;
			},
			toggleShockWave: ({ state }) => {
				state.shockWave.enabled = !state.shockWave.enabled;
			},
			setShockWaveSpeed: ({ state }, v) => {
				state.shockWave.speed = v;
			},
			setShockWaveMaxRadius: ({ state }, v) => {
				state.shockWave.maxRadius = v;
			},
			setShockWaveWaveSize: ({ state }, v) => {
				state.shockWave.waveSize = v;
			},
			setShockWaveAmplitude: ({ state }, v) => {
				state.shockWave.amplitude = v;
			},
			setShockWaveEpicenter: ({ state }, x, y, z) => {
				state.shockWave.epicenterX = x;
				state.shockWave.epicenterY = y;
				state.shockWave.epicenterZ = z;
			},
			triggerShockWave: ({ state }) => {
				// This will be handled by the renderer
				state.shockWave.triggered = true;
			},
			toggleASCII: ({ state }) => {
				state.ascii.enabled = !state.ascii.enabled;
			},
			setASCIICellSize: ({ state }, v) => {
				state.ascii.cellSize = v;
			},
			setASCIIInverted: ({ state }, v) => {
				state.ascii.inverted = v;
			},
			toggleToneMapping: ({ state }) => {
				state.toneMapping.enabled = !state.toneMapping.enabled;
			},
			setToneMappingMode: ({ state }, v) => {
				state.toneMapping.mode = v;
			},
			setToneMappingWhitePoint: ({ state }, v) => {
				state.toneMapping.whitePoint = v;
			},
			setToneMappingMiddleGrey: ({ state }, v) => {
				state.toneMapping.middleGrey = v;
			},
			setToneMappingResolution: ({ state }, v) => {
				state.toneMapping.resolution = v;
			},
			setToneMappingMinLuminance: ({ state }, v) => {
				state.toneMapping.minLuminance = v;
			},
			setToneMappingAverageLuminance: ({ state }, v) => {
				state.toneMapping.averageLuminance = v;
			},
			setToneMappingAdaptationRate: ({ state }, v) => {
				state.toneMapping.adaptationRate = v;
			},
			setToneMappingBlendFunction: ({ state }, v) => {
				state.toneMapping.blendFunction = v;
			},
			toggleGrid: ({ state }) => {
				state.grid.enabled = !state.grid.enabled;
			},
			setGridScale: ({ state }, v) => {
				state.grid.scale = v;
			},
			setGridLineWidth: ({ state }, v) => {
				state.grid.lineWidth = v;
			},
			setGridBlendFunction: ({ state }, v) => {
				state.grid.blendFunction = v;
			},
			toggleTiltShift: ({ state }) => {
				state.tiltShift.enabled = !state.tiltShift.enabled;
			},
			setTiltShiftOffset: ({ state }, v) => {
				state.tiltShift.offset = v;
			},
			setTiltShiftFocusArea: ({ state }, v) => {
				state.tiltShift.focusArea = v;
			},
			setTiltShiftFeather: ({ state }, v) => {
				state.tiltShift.feather = v;
			},
			setTiltShiftKernelSize: ({ state }, v) => {
				state.tiltShift.kernelSize = v;
			},
			setTiltShiftBlendFunction: ({ state }, v) => {
				state.tiltShift.blendFunction = v;
			},
			toggleLensDistortion: ({ state }) => {
				state.lensDistortion.enabled = !state.lensDistortion.enabled;
			},
			setLensDistortionX: ({ state }, v) => {
				state.lensDistortion.distortionX = v;
			},
			setLensDistortionY: ({ state }, v) => {
				state.lensDistortion.distortionY = v;
			},
			setLensPrincipalX: ({ state }, v) => {
				state.lensDistortion.principalX = v;
			},
			setLensPrincipalY: ({ state }, v) => {
				state.lensDistortion.principalY = v;
			},
			setLensFocalLengthX: ({ state }, v) => {
				state.lensDistortion.focalLengthX = v;
			},
			setLensFocalLengthY: ({ state }, v) => {
				state.lensDistortion.focalLengthY = v;
			},
			setLensSkew: ({ state }, v) => {
				state.lensDistortion.skew = v;
			},
			toggleColorDepth: ({ state }) => {
				state.colorDepth.enabled = !state.colorDepth.enabled;
			},
			setColorDepthBits: ({ state }, v) => {
				state.colorDepth.bits = v;
			},
			setColorDepthBlendFunction: ({ state }, v) => {
				state.colorDepth.blendFunction = v;
			},
			toggleDepthOfField: ({ state }) => {
				state.depthOfField.enabled = !state.depthOfField.enabled;
			},
			setDepthOfFieldFocusDistance: ({ state }, v) => {
				state.depthOfField.focusDistance = v;
			},
			setDepthOfFieldFocusRange: ({ state }, v) => {
				state.depthOfField.focusRange = v;
			},
			setDepthOfFieldBokehScale: ({ state }, v) => {
				state.depthOfField.bokehScale = v;
			},
			setDepthOfFieldBlendFunction: ({ state }, v) => {
				state.depthOfField.blendFunction = v;
			},
			toggleGodRays: ({ state }) => {
				state.godRays.enabled = !state.godRays.enabled;
			},
			setGodRaysSamples: ({ state }, v) => {
				state.godRays.samples = v;
			},
			setGodRaysDensity: ({ state }, v) => {
				state.godRays.density = v;
			},
			setGodRaysDecay: ({ state }, v) => {
				state.godRays.decay = v;
			},
			setGodRaysWeight: ({ state }, v) => {
				state.godRays.weight = v;
			},
			setGodRaysExposure: ({ state }, v) => {
				state.godRays.exposure = v;
			},
			setGodRaysClampMax: ({ state }, v) => {
				state.godRays.clampMax = v;
			},
			setGodRaysBlur: ({ state }, v) => {
				state.godRays.blur = v;
			},
			setGodRaysKernelSize: ({ state }, v) => {
				state.godRays.kernelSize = v;
			},
			setGodRaysBlendFunction: ({ state }, v) => {
				state.godRays.blendFunction = v;
			},
			setGodRaysSunX: ({ state }, v) => {
				state.godRays.sunX = v;
			},
			setGodRaysSunY: ({ state }, v) => {
				state.godRays.sunY = v;
			},
			setGodRaysSunZ: ({ state }, v) => {
				state.godRays.sunZ = v;
			},
			setGodRaysSunColor: ({ state }, v) => {
				state.godRays.sunColor = v;
			},
			toggleSSAO: ({ state }) => {
				state.ssao.enabled = !state.ssao.enabled;
			},
			setSSAOSamples: ({ state }, v) => {
				state.ssao.samples = v;
			},
			setSSAORings: ({ state }, v) => {
				state.ssao.rings = v;
			},
			setSSAORadius: ({ state }, v) => {
				state.ssao.radius = v;
			},
			setSSAOIntensity: ({ state }, v) => {
				state.ssao.intensity = v;
			},
			setSSAOBias: ({ state }, v) => {
				state.ssao.bias = v;
			},
			setSSAOFade: ({ state }, v) => {
				state.ssao.fade = v;
			},
			setSSAOLuminanceInfluence: ({ state }, v) => {
				state.ssao.luminanceInfluence = v;
			},
			setSSAOBlendFunction: ({ state }, v) => {
				state.ssao.blendFunction = v;
			},
			toggleOutline: ({ state }) => {
				state.outline.enabled = !state.outline.enabled;
			},
			setOutlineEdgeStrength: ({ state }, v) => {
				state.outline.edgeStrength = v;
			},
			setOutlineVisibleEdgeColor: ({ state }, v) => {
				state.outline.visibleEdgeColor = v;
			},
			setOutlineHiddenEdgeColor: ({ state }, v) => {
				state.outline.hiddenEdgeColor = v;
			},
			setOutlinePulseSpeed: ({ state }, v) => {
				state.outline.pulseSpeed = v;
			},
			setOutlineXRay: ({ state }, v) => {
				state.outline.xRay = v;
			},
			setOutlineBlur: ({ state }, v) => {
				state.outline.blur = v;
			},
			setOutlineKernelSize: ({ state }, v) => {
				state.outline.kernelSize = v;
			},
			setOutlineBlendFunction: ({ state }, v) => {
				state.outline.blendFunction = v;
			},
			toggleDepthEffect: ({ state }) => {
				state.depthEffect.enabled = !state.depthEffect.enabled;
			},
			setDepthEffectInverted: ({ state }, v) => {
				state.depthEffect.inverted = v;
			},
			setDepthEffectBlendFunction: ({ state }, v) => {
				state.depthEffect.blendFunction = v;
			},
			resetBloom: ({ state }) => {
				state.bloom.intensity = 1.0;
				state.bloom.luminanceThreshold = 1.0;
				state.bloom.luminanceSmoothing = 0.03;
				state.bloom.kernelSize = 4 as KernelSize;
				state.bloom.blendFunction = 28 as BlendFunction;
				state.bloom.mipmapBlur = true;
				state.bloom.radius = 0.85;
				state.bloom.levels = 8;
			},
			resetSMAA: ({ state }) => {
				state.smaa.preset = 2;
				state.smaa.edgeDetectionMode = 2;
				state.smaa.predicationMode = 0;
			},
			resetFXAA: ({ state }) => {
				state.fxaa.minEdgeThreshold = 0.05;
				state.fxaa.maxEdgeThreshold = 0.12;
				state.fxaa.subpixelQuality = 0.75;
			},
			resetVignette: ({ state }) => {
				state.vignette.offset = 0.5;
				state.vignette.darkness = 0.5;
				state.vignette.technique = 0;
			},
			resetPixelation: ({ state }) => {
				state.pixelation.granularity = 30.0;
			},
			resetGlitch: ({ state }) => {
				state.glitch.delay = 2.5;
				state.glitch.duration = 0.8;
				state.glitch.strength = 0.65;
				state.glitch.ratio = 0.85;
				state.glitch.columns = 0.05;
				state.glitch.mode = 1;
			},
			resetNoise: ({ state }) => {
				state.noise.premultiply = false;
				state.noise.blendFunction = 28 as BlendFunction;
			},
			resetChromaticAberration: ({ state }) => {
				state.chromaticAberration.offsetX = 0.01;
				state.chromaticAberration.offsetY = 0.01;
				state.chromaticAberration.radialModulation = false;
				state.chromaticAberration.modulationOffset = 0.15;
				state.chromaticAberration.blendFunction = 0 as BlendFunction;
			},
			resetBrightnessContrast: ({ state }) => {
				state.brightnessContrast.brightness = 0;
				state.brightnessContrast.contrast = 0;
				state.brightnessContrast.blendFunction = 0 as BlendFunction;
			},
			resetHueSaturation: ({ state }) => {
				state.hueSaturation.hue = 0;
				state.hueSaturation.saturation = 0;
				state.hueSaturation.blendFunction = 0 as BlendFunction;
			},
			resetSepia: ({ state }) => {
				state.sepia.intensity = 1.0;
				state.sepia.blendFunction = 0 as BlendFunction;
			},
			resetDotScreen: ({ state }) => {
				state.dotScreen.angle = 1.57;
				state.dotScreen.scale = 1.0;
				state.dotScreen.blendFunction = 0 as BlendFunction;
			},
			resetScanline: ({ state }) => {
				state.scanline.density = 1.25;
				state.scanline.opacity = 0.5;
				state.scanline.scrollSpeed = 0;
				state.scanline.blendFunction = 25 as BlendFunction;
			},
			resetShockWave: ({ state }) => {
				state.shockWave.speed = 1.25;
				state.shockWave.maxRadius = 0.5;
				state.shockWave.waveSize = 0.2;
				state.shockWave.amplitude = 0.05;
				state.shockWave.epicenterX = 0;
				state.shockWave.epicenterY = 0;
				state.shockWave.epicenterZ = 0;
			},
			resetASCII: ({ state }) => {
				state.ascii.cellSize = 16;
				state.ascii.inverted = false;
			},
			resetToneMapping: ({ state }) => {
				state.toneMapping.mode = 11 as ToneMappingMode;
				state.toneMapping.whitePoint = 4.0;
				state.toneMapping.middleGrey = 0.6;
				state.toneMapping.blendFunction = 0 as BlendFunction;
				state.toneMapping.resolution = 256;
				state.toneMapping.minLuminance = 0.01;
				state.toneMapping.averageLuminance = 1.0;
				state.toneMapping.adaptationRate = 1.0;
			},
			resetGrid: ({ state }) => {
				state.grid.scale = 1.0;
				state.grid.lineWidth = 0.0;
				state.grid.blendFunction = 25 as BlendFunction;
			},
			resetTiltShift: ({ state }) => {
				state.tiltShift.offset = 0.0;
				state.tiltShift.rotation = 0.0;
				state.tiltShift.focusArea = 0.4;
				state.tiltShift.feather = 0.3;
				state.tiltShift.kernelSize = 3 as KernelSize;
				state.tiltShift.blendFunction = 0 as BlendFunction;
			},
			resetLensDistortion: ({ state }) => {
				state.lensDistortion.distortionX = 0.0;
				state.lensDistortion.distortionY = 0.0;
				state.lensDistortion.principalX = 0.0;
				state.lensDistortion.principalY = 0.0;
				state.lensDistortion.focalLengthX = 1.0;
				state.lensDistortion.focalLengthY = 1.0;
				state.lensDistortion.skew = 0.0;
			},
			resetColorDepth: ({ state }) => {
				state.colorDepth.bits = 16;
				state.colorDepth.blendFunction = 0 as BlendFunction;
			},
			resetDepthOfField: ({ state }) => {
				state.depthOfField.focusDistance = 3.0;
				state.depthOfField.focusRange = 2.0;
				state.depthOfField.bokehScale = 1.0;
				state.depthOfField.blendFunction = 0 as BlendFunction;
			},
			resetGodRays: ({ state }) => {
				state.godRays.samples = 60;
				state.godRays.density = 0.96;
				state.godRays.decay = 0.9;
				state.godRays.weight = 0.4;
				state.godRays.exposure = 0.6;
				state.godRays.clampMax = 1.0;
				state.godRays.blur = true;
				state.godRays.kernelSize = 2 as KernelSize;
				state.godRays.blendFunction = 28 as BlendFunction;
				state.godRays.sunX = 0;
				state.godRays.sunY = 5;
				state.godRays.sunZ = 0;
				state.godRays.sunColor = 0xffddaa;
			},
			resetSSAO: ({ state }) => {
				state.ssao.samples = 9;
				state.ssao.rings = 7;
				state.ssao.radius = 0.1825;
				state.ssao.intensity = 1.0;
				state.ssao.bias = 0.025;
				state.ssao.fade = 0.01;
				state.ssao.luminanceInfluence = 0.7;
				state.ssao.blendFunction = 7 as BlendFunction;
			},
			resetOutline: ({ state }) => {
				state.outline.edgeStrength = 1.0;
				state.outline.visibleEdgeColor = 0xffffff;
				state.outline.hiddenEdgeColor = 0x22090a;
				state.outline.pulseSpeed = 0.0;
				state.outline.xRay = true;
				state.outline.blur = false;
				state.outline.kernelSize = 1 as KernelSize;
				state.outline.blendFunction = 22 as BlendFunction;
			},
			resetDepthEffect: ({ state }) => {
				state.depthEffect.inverted = false;
				state.depthEffect.blendFunction = 0 as BlendFunction;
			},
			resetAll: ({ state }) => {
				state.bloom.intensity = 1.0;
				state.bloom.luminanceThreshold = 1.0;
				state.bloom.luminanceSmoothing = 0.03;
				state.bloom.kernelSize = 4 as KernelSize;
				state.bloom.blendFunction = 28 as BlendFunction;
				state.bloom.mipmapBlur = true;
				state.bloom.radius = 0.85;
				state.bloom.levels = 8;
				state.smaa.preset = 2;
				state.smaa.edgeDetectionMode = 2;
				state.smaa.predicationMode = 0;
				state.fxaa.minEdgeThreshold = 0.05;
				state.fxaa.maxEdgeThreshold = 0.12;
				state.fxaa.subpixelQuality = 0.75;
				state.vignette.offset = 0.5;
				state.vignette.darkness = 0.5;
				state.vignette.technique = 0;
				state.pixelation.granularity = 30.0;
				state.glitch.delay = 2.5;
				state.glitch.duration = 0.8;
				state.glitch.strength = 0.65;
				state.glitch.ratio = 0.85;
				state.glitch.columns = 0.05;
				state.glitch.mode = 1;
				state.noise.premultiply = false;
				state.noise.blendFunction = 28 as BlendFunction;
				state.chromaticAberration.radialModulation = false;
				state.chromaticAberration.modulationOffset = 0.15;
				state.chromaticAberration.offsetX = 0.01;
				state.chromaticAberration.offsetY = 0.01;
				state.chromaticAberration.blendFunction = 0 as BlendFunction;
				state.brightnessContrast.brightness = 0;
				state.brightnessContrast.contrast = 0;
				state.brightnessContrast.blendFunction = 0 as BlendFunction;
				state.hueSaturation.hue = 0;
				state.hueSaturation.saturation = 0;
				state.hueSaturation.blendFunction = 0 as BlendFunction;
				state.sepia.intensity = 1.0;
				state.sepia.blendFunction = 0 as BlendFunction;
				state.dotScreen.angle = 1.57;
				state.dotScreen.scale = 1.0;
				state.dotScreen.blendFunction = 0 as BlendFunction;
				state.scanline.density = 1.25;
				state.scanline.opacity = 0.5;
				state.scanline.scrollSpeed = 0;
				state.scanline.blendFunction = 25 as BlendFunction;
				state.shockWave.speed = 1.25;
				state.shockWave.maxRadius = 0.5;
				state.shockWave.waveSize = 0.2;
				state.shockWave.amplitude = 0.05;
				state.shockWave.epicenterX = 0;
				state.shockWave.epicenterY = 0;
				state.shockWave.epicenterZ = 0;
				state.ascii.cellSize = 16;
				state.ascii.inverted = false;
				state.toneMapping.mode = 11 as ToneMappingMode;
				state.toneMapping.whitePoint = 4.0;
				state.toneMapping.middleGrey = 0.6;
				state.toneMapping.blendFunction = 0 as BlendFunction;
				state.toneMapping.resolution = 256;
				state.toneMapping.minLuminance = 0.01;
				state.toneMapping.averageLuminance = 1.0;
				state.toneMapping.adaptationRate = 1.0;
				state.grid.scale = 1.0;
				state.grid.lineWidth = 0.0;
				state.grid.blendFunction = 25 as BlendFunction;
				state.tiltShift.offset = 0.0;
				state.tiltShift.rotation = 0.0;
				state.tiltShift.focusArea = 0.4;
				state.tiltShift.feather = 0.3;
				state.tiltShift.kernelSize = 3 as KernelSize;
				state.tiltShift.blendFunction = 0 as BlendFunction;
				state.lensDistortion.distortionX = 0.0;
				state.lensDistortion.distortionY = 0.0;
				state.lensDistortion.principalX = 0.0;
				state.lensDistortion.principalY = 0.0;
				state.lensDistortion.focalLengthX = 1.0;
				state.lensDistortion.focalLengthY = 1.0;
				state.lensDistortion.skew = 0.0;
				state.colorDepth.bits = 16;
				state.colorDepth.blendFunction = 0 as BlendFunction;
				state.depthOfField.focusDistance = 3.0;
				state.depthOfField.focusRange = 2.0;
				state.depthOfField.bokehScale = 1.0;
				state.depthOfField.blendFunction = 0 as BlendFunction;
				state.godRays.samples = 60;
				state.godRays.density = 0.96;
				state.godRays.decay = 0.9;
				state.godRays.weight = 0.4;
				state.godRays.exposure = 0.6;
				state.godRays.clampMax = 1.0;
				state.godRays.blur = true;
				state.godRays.kernelSize = 2 as KernelSize;
				state.godRays.blendFunction = 28 as BlendFunction;
				state.ssao.samples = 9;
				state.ssao.rings = 7;
				state.ssao.radius = 0.1825;
				state.ssao.intensity = 1.0;
				state.ssao.bias = 0.025;
				state.ssao.fade = 0.01;
				state.ssao.luminanceInfluence = 0.7;
				state.ssao.blendFunction = 7 as BlendFunction;
				state.outline.edgeStrength = 1.0;
				state.outline.visibleEdgeColor = 0xffffff;
				state.outline.hiddenEdgeColor = 0x22090a;
				state.outline.pulseSpeed = 0.0;
				state.outline.xRay = true;
				state.outline.blur = false;
				state.outline.kernelSize = 1 as KernelSize;
				state.outline.blendFunction = 22 as BlendFunction;
				state.depthEffect.inverted = false;
				state.depthEffect.blendFunction = 0 as BlendFunction;
			}
		}
	});
</script>

<ToolbarItem position="left">
	<DropDownPane icon="mdiImageFilterHdr" title="Post Processing">
		<Folder title="Bloom" expanded={true}>
			<Checkbox
				value={ext.state.bloom.enabled}
				label="Enabled"
				on:change={() => ext.toggleBloom()}
			/>
			{#if ext.state.bloom.enabled}
				<Slider
					value={ext.state.bloom.intensity}
					label="Intensity"
					min={0}
					max={20}
					step={0.1}
					on:change={(e) => ext.setBloomIntensity(e.detail.value)}
				/>
				<Slider
					value={ext.state.bloom.luminanceThreshold}
					label="Threshold"
					min={0}
					max={1}
					step={0.01}
					on:change={(e) => ext.setBloomThreshold(e.detail.value)}
				/>
				<Slider
					value={ext.state.bloom.luminanceSmoothing}
					label="Smoothing"
					min={0}
					max={1}
					step={0.01}
					on:change={(e) => ext.setBloomSmoothing(e.detail.value)}
				/>
				<Slider
					value={ext.state.bloom.radius}
					label="Radius"
					min={0}
					max={2}
					step={0.05}
					on:change={(e) => ext.setBloomRadius(e.detail.value)}
				/>
				<Slider
					value={ext.state.bloom.levels}
					label="Levels"
					min={1}
					max={16}
					step={1}
					on:change={(e) => ext.setBloomLevels(e.detail.value)}
				/>
				<List
					value={ext.state.bloom.kernelSize}
					label="Kernel Size"
					options={kernelSizeOptions}
					on:change={(e) => ext.setBloomKernelSize(e.detail.value)}
				/>
				<Checkbox value={ext.state.bloom.mipmapBlur} label="Mipmap Blur" />
				<List
					value={ext.state.bloom.blendFunction}
					label="Blend Function"
					options={blendFunctionOptions}
					on:change={(e) => ext.setBloomBlendFunction(e.detail.value)}
				/>
				<Button title="Reset" on:click={ext.resetBloom} />
			{/if}
		</Folder>

		<Folder title="SMAA" expanded={false}>
			<Checkbox value={ext.state.smaa.enabled} label="Enabled" on:change={() => ext.toggleSMAA()} />
			{#if ext.state.smaa.enabled}
				<List
					value={ext.state.smaa.preset}
					label="Preset"
					options={smaaPresetOptions}
					on:change={(e) => ext.setSMAAPreset(e.detail.value)}
				/>
				<List
					value={ext.state.smaa.edgeDetectionMode}
					label="Edge Detection"
					options={smaaEdgeDetectionOptions}
					on:change={(e) => ext.setSMAEEdgeDetectionMode(e.detail.value)}
				/>
				<List
					value={ext.state.smaa.predicationMode}
					label="Predication"
					options={smaaPredicationOptions}
					on:change={(e) => ext.setSMAAPredicationMode(e.detail.value)}
				/>
				<Button title="Reset" on:click={ext.resetSMAA} />
			{/if}
		</Folder>

		<Folder title="FXAA" expanded={false}>
			<Checkbox value={ext.state.fxaa.enabled} label="Enabled" on:change={() => ext.toggleFXAA()} />
			{#if ext.state.fxaa.enabled}
				<Slider
					value={ext.state.fxaa.minEdgeThreshold}
					label="Min Edge"
					min={0}
					max={1}
					step={0.01}
					on:change={(e) =>
						ext.setFXAAEdgeThreshold(
							e.detail.value,
							ext.state.fxaa.maxEdgeThreshold,
							ext.state.fxaa.subpixelQuality
						)}
				/>
				<Slider
					value={ext.state.fxaa.maxEdgeThreshold}
					label="Max Edge"
					min={0}
					max={1}
					step={0.01}
					on:change={(e) =>
						ext.setFXAAEdgeThreshold(
							ext.state.fxaa.minEdgeThreshold,
							e.detail.value,
							ext.state.fxaa.subpixelQuality
						)}
				/>
				<Slider
					value={ext.state.fxaa.subpixelQuality}
					label="Subpixel Quality"
					min={0}
					max={1}
					step={0.01}
					on:change={(e) =>
						ext.setFXAAEdgeThreshold(
							ext.state.fxaa.minEdgeThreshold,
							ext.state.fxaa.maxEdgeThreshold,
							e.detail.value
						)}
				/>
				<Button title="Reset" on:click={ext.resetFXAA} />
			{/if}
		</Folder>

		<Folder title="Vignette" expanded={false}>
			<Checkbox
				value={ext.state.vignette.enabled}
				label="Enabled"
				on:change={() => ext.toggleVignette()}
			/>
			{#if ext.state.vignette.enabled}
				<Slider
					value={ext.state.vignette.offset}
					label="Offset"
					min={0}
					max={2}
					step={0.01}
					on:change={(e) => ext.setVignetteOffset(e.detail.value)}
				/>
				<Slider
					value={ext.state.vignette.darkness}
					label="Darkness"
					min={0}
					max={2}
					step={0.01}
					on:change={(e) => ext.setVignetteDarkness(e.detail.value)}
				/>
				<List
					value={ext.state.vignette.technique}
					label="Technique"
					options={vignetteTechniqueOptions}
					on:change={(e) => ext.setVignetteTechnique(e.detail.value)}
				/>
				<Button title="Reset" on:click={ext.resetVignette} />
			{/if}
		</Folder>

		<Folder title="Pixelation" expanded={false}>
			<Checkbox
				value={ext.state.pixelation.enabled}
				label="Enabled"
				on:change={() => ext.togglePixelation()}
			/>
			{#if ext.state.pixelation.enabled}
				<Slider
					value={ext.state.pixelation.granularity}
					label="Granularity"
					min={1}
					max={100}
					step={1}
					on:change={(e) => ext.setPixelationGranularity(e.detail.value)}
				/>
				<Button title="Reset" on:click={ext.resetPixelation} />
			{/if}
		</Folder>

		<Folder title="Glitch" expanded={false}>
			<Checkbox
				value={ext.state.glitch.enabled}
				label="Enabled"
				on:change={() => ext.toggleGlitch()}
			/>
			{#if ext.state.glitch.enabled}
				<List
					value={ext.state.glitch.mode}
					label="Mode"
					options={glitchModeOptions}
					on:change={(e) => ext.setGlitchMode(e.detail.value)}
				/>
				<Slider
					value={ext.state.glitch.delay}
					label="Delay"
					min={0.1}
					max={10}
					step={0.1}
					on:change={(e) => ext.setGlitchDelay(e.detail.value)}
				/>
				<Slider
					value={ext.state.glitch.duration}
					label="Duration"
					min={0.1}
					max={2}
					step={0.1}
					on:change={(e) => ext.setGlitchDuration(e.detail.value)}
				/>
				<Slider
					value={ext.state.glitch.strength}
					label="Strength"
					min={0.1}
					max={2}
					step={0.05}
					on:change={(e) => ext.setGlitchStrength(e.detail.value)}
				/>
				<Slider
					value={ext.state.glitch.ratio}
					label="Ratio"
					min={0}
					max={1}
					step={0.05}
					on:change={(e) => ext.setGlitchRatio(e.detail.value)}
				/>
				<Slider
					value={ext.state.glitch.columns}
					label="Columns"
					min={0.01}
					max={0.5}
					step={0.01}
					on:change={(e) => ext.setGlitchColumns(e.detail.value)}
				/>
				<Button title="Reset" on:click={ext.resetGlitch} />
			{/if}
		</Folder>

		<Folder title="Noise" expanded={false}>
			<Checkbox
				value={ext.state.noise.enabled}
				label="Enabled"
				on:change={() => ext.toggleNoise()}
			/>
			{#if ext.state.noise.enabled}
				<Checkbox value={ext.state.noise.premultiply} label="Premultiply" />
				<List
					value={ext.state.noise.blendFunction}
					label="Blend Function"
					options={blendFunctionOptions}
					on:change={(e) => ext.setNoiseBlendFunction(e.detail.value)}
				/>
				<Button title="Reset" on:click={ext.resetNoise} />
			{/if}
		</Folder>

		<Folder title="Chromatic Aberration" expanded={false}>
			<Checkbox
				value={ext.state.chromaticAberration.enabled}
				label="Enabled"
				on:change={() => ext.toggleChromaticAberration()}
			/>
			{#if ext.state.chromaticAberration.enabled}
				<Slider
					value={ext.state.chromaticAberration.offsetX}
					label="Offset X"
					min={0}
					max={0.1}
					step={0.001}
					on:change={(e) => ext.setChromaticAberrationOffsetX(e.detail.value)}
				/>
				<Slider
					value={ext.state.chromaticAberration.offsetY}
					label="Offset Y"
					min={0}
					max={0.1}
					step={0.001}
					on:change={(e) => ext.setChromaticAberrationOffsetY(e.detail.value)}
				/>
				<Checkbox
					value={ext.state.chromaticAberration.radialModulation}
					label="Radial Modulation"
				/>
				<Slider
					value={ext.state.chromaticAberration.modulationOffset}
					label="Modulation"
					min={0}
					max={1}
					step={0.01}
					on:change={(e) =>
						ext.setChromaticAberrationModulation(
							ext.state.chromaticAberration.radialModulation,
							e.detail.value
						)}
				/>
				<List
					value={ext.state.chromaticAberration.blendFunction}
					label="Blend Function"
					options={blendFunctionOptions}
					on:change={(e) => ext.setChromaticAberrationBlendFunction(e.detail.value)}
				/>
				<Button title="Reset" on:click={ext.resetChromaticAberration} />
			{/if}
		</Folder>

		<Folder title="Brightness & Contrast" expanded={false}>
			<Checkbox
				value={ext.state.brightnessContrast.enabled}
				label="Enabled"
				on:change={() => ext.toggleBrightnessContrast()}
			/>
			{#if ext.state.brightnessContrast.enabled}
				<Slider
					value={ext.state.brightnessContrast.brightness}
					label="Brightness"
					min={-1}
					max={1}
					step={0.01}
					on:change={(e) => ext.setBrightness(e.detail.value)}
				/>
				<Slider
					value={ext.state.brightnessContrast.contrast}
					label="Contrast"
					min={-1}
					max={1}
					step={0.01}
					on:change={(e) => ext.setContrast(e.detail.value)}
				/>
				<List
					value={ext.state.brightnessContrast.blendFunction}
					label="Blend Function"
					options={blendFunctionOptions}
					on:change={(e) => ext.setBrightnessContrastBlendFunction(e.detail.value)}
				/>
				<Button title="Reset" on:click={ext.resetBrightnessContrast} />
			{/if}
		</Folder>

		<Folder title="Hue & Saturation" expanded={false}>
			<Checkbox
				value={ext.state.hueSaturation.enabled}
				label="Enabled"
				on:change={() => ext.toggleHueSaturation()}
			/>
			{#if ext.state.hueSaturation.enabled}
				<Slider
					value={ext.state.hueSaturation.hue}
					label="Hue"
					min={-3.14}
					max={3.14}
					step={0.01}
					on:change={(e) => ext.setHue(e.detail.value)}
				/>
				<Slider
					value={ext.state.hueSaturation.saturation}
					label="Saturation"
					min={-1}
					max={1}
					step={0.01}
					on:change={(e) => ext.setSaturation(e.detail.value)}
				/>
				<List
					value={ext.state.hueSaturation.blendFunction}
					label="Blend Function"
					options={blendFunctionOptions}
					on:change={(e) => ext.setHueSaturationBlendFunction(e.detail.value)}
				/>
				<Button title="Reset" on:click={ext.resetHueSaturation} />
			{/if}
		</Folder>

		<Folder title="Sepia" expanded={false}>
			<Checkbox
				value={ext.state.sepia.enabled}
				label="Enabled"
				on:change={() => ext.toggleSepia()}
			/>
			{#if ext.state.sepia.enabled}
				<Slider
					value={ext.state.sepia.intensity}
					label="Intensity"
					min={0}
					max={1}
					step={0.01}
					on:change={(e) => ext.setSepiaIntensity(e.detail.value)}
				/>
				<List
					value={ext.state.sepia.blendFunction}
					label="Blend Function"
					options={blendFunctionOptions}
					on:change={(e) => ext.setSepiaBlendFunction(e.detail.value)}
				/>
				<Button title="Reset" on:click={ext.resetSepia} />
			{/if}
		</Folder>

		<Folder title="Dot Screen" expanded={false}>
			<Checkbox
				value={ext.state.dotScreen.enabled}
				label="Enabled"
				on:change={() => ext.toggleDotScreen()}
			/>
			{#if ext.state.dotScreen.enabled}
				<Slider
					value={ext.state.dotScreen.angle}
					label="Angle"
					min={0}
					max={6.28}
					step={0.01}
					on:change={(e) => ext.setDotScreenAngle(e.detail.value)}
				/>
				<Slider
					value={ext.state.dotScreen.scale}
					label="Scale"
					min={0.1}
					max={10}
					step={0.1}
					on:change={(e) => ext.setDotScreenScale(e.detail.value)}
				/>
				<List
					value={ext.state.dotScreen.blendFunction}
					label="Blend Function"
					options={blendFunctionOptions}
					on:change={(e) => ext.setDotScreenBlendFunction(e.detail.value)}
				/>
				<Button title="Reset" on:click={ext.resetDotScreen} />
			{/if}
		</Folder>

		<Folder title="Scanline" expanded={false}>
			<Checkbox
				value={ext.state.scanline.enabled}
				label="Enabled"
				on:change={() => ext.toggleScanline()}
			/>
			{#if ext.state.scanline.enabled}
				<Slider
					value={ext.state.scanline.density}
					label="Density"
					min={0.5}
					max={5}
					step={0.1}
					on:change={(e) => ext.setScanlineDensity(e.detail.value)}
				/>
				<Slider
					value={ext.state.scanline.opacity}
					label="Opacity"
					min={0}
					max={1}
					step={0.01}
					on:change={(e) => ext.setScanlineOpacity(e.detail.value)}
				/>
				<Slider
					value={ext.state.scanline.scrollSpeed}
					label="Scroll Speed"
					min={0}
					max={10}
					step={0.1}
					on:change={(e) => ext.setScanlineScrollSpeed(e.detail.value)}
				/>
				<List
					value={ext.state.scanline.blendFunction}
					label="Blend Function"
					options={blendFunctionOptions}
					on:change={(e) => ext.setScanlineBlendFunction(e.detail.value)}
				/>
				<Button title="Reset" on:click={ext.resetScanline} />
			{/if}
		</Folder>

		<Folder title="Shock Wave" expanded={false}>
			<Checkbox
				value={ext.state.shockWave.enabled}
				label="Enabled"
				on:change={() => ext.toggleShockWave()}
			/>
			{#if ext.state.shockWave.enabled}
				<Slider
					value={ext.state.shockWave.speed}
					label="Speed"
					min={0}
					max={10}
					step={0.01}
					on:change={(e) => ext.setShockWaveSpeed(e.detail.value)}
				/>
				<Slider
					value={ext.state.shockWave.maxRadius}
					label="Max Radius"
					min={0}
					max={10}
					step={0.01}
					on:change={(e) => ext.setShockWaveMaxRadius(e.detail.value)}
				/>
				<Slider
					value={ext.state.shockWave.waveSize}
					label="Wave Size"
					min={0}
					max={2}
					step={0.01}
					on:change={(e) => ext.setShockWaveWaveSize(e.detail.value)}
				/>
				<Slider
					value={ext.state.shockWave.amplitude}
					label="Amplitude"
					min={0}
					max={0.25}
					step={0.001}
					on:change={(e) => ext.setShockWaveAmplitude(e.detail.value)}
				/>
				<Button title="Explode!" on:click={() => ext.triggerShockWave()} />
				<Button title="Reset" on:click={ext.resetShockWave} />
			{/if}
		</Folder>

		<Folder title="ASCII" expanded={false}>
			<Checkbox
				value={ext.state.ascii.enabled}
				label="Enabled"
				on:change={() => ext.toggleASCII()}
			/>
			{#if ext.state.ascii.enabled}
				<Slider
					value={ext.state.ascii.cellSize}
					label="Cell Size"
					min={4}
					max={64}
					step={1}
					on:change={(e) => ext.setASCIICellSize(e.detail.value)}
				/>
				<Checkbox value={ext.state.ascii.inverted} label="Inverted" />
				<Button title="Reset" on:click={ext.resetASCII} />
			{/if}
		</Folder>

		<Folder title="Tone Mapping" expanded={false}>
			<Checkbox
				value={ext.state.toneMapping.enabled}
				label="Enabled"
				on:change={() => ext.toggleToneMapping()}
			/>
			{#if ext.state.toneMapping.enabled}
				<List
					value={ext.state.toneMapping.mode}
					label="Mode"
					options={toneMappingOptions}
					on:change={(e) => ext.setToneMappingMode(e.detail.value)}
				/>
				<Slider
					value={ext.state.toneMapping.whitePoint}
					label="White Point"
					min={0.1}
					max={16}
					step={0.1}
					on:change={(e) => ext.setToneMappingWhitePoint(e.detail.value)}
				/>
				<Slider
					value={ext.state.toneMapping.middleGrey}
					label="Middle Grey"
					min={0}
					max={2}
					step={0.01}
					on:change={(e) => ext.setToneMappingMiddleGrey(e.detail.value)}
				/>
				<Slider
					value={ext.state.toneMapping.resolution}
					label="Resolution"
					min={64}
					max={1024}
					step={64}
					on:change={(e) => ext.setToneMappingResolution(e.detail.value)}
				/>
				<Slider
					value={ext.state.toneMapping.minLuminance}
					label="Min Luminance"
					min={0}
					max={1}
					step={0.01}
					on:change={(e) => ext.setToneMappingMinLuminance(e.detail.value)}
				/>
				<Slider
					value={ext.state.toneMapping.averageLuminance}
					label="Average Luminance"
					min={0.1}
					max={10}
					step={0.1}
					on:change={(e) => ext.setToneMappingAverageLuminance(e.detail.value)}
				/>
				<Slider
					value={ext.state.toneMapping.adaptationRate}
					label="Adaptation Rate"
					min={0.01}
					max={10}
					step={0.01}
					on:change={(e) => ext.setToneMappingAdaptationRate(e.detail.value)}
				/>
				<List
					value={ext.state.toneMapping.blendFunction}
					label="Blend Function"
					options={blendFunctionOptions}
					on:change={(e) => ext.setToneMappingBlendFunction(e.detail.value)}
				/>
				<Button title="Reset" on:click={ext.resetToneMapping} />
			{/if}
		</Folder>

		<Folder title="Grid" expanded={false}>
			<Checkbox value={ext.state.grid.enabled} label="Enabled" on:change={() => ext.toggleGrid()} />
			{#if ext.state.grid.enabled}
				<Slider
					value={ext.state.grid.scale}
					label="Scale"
					min={0.1}
					max={10}
					step={0.1}
					on:change={(e) => ext.setGridScale(e.detail.value)}
				/>
				<Slider
					value={ext.state.grid.lineWidth}
					label="Line Width"
					min={0}
					max={1}
					step={0.01}
					on:change={(e) => ext.setGridLineWidth(e.detail.value)}
				/>
				<List
					value={ext.state.grid.blendFunction}
					label="Blend Function"
					options={blendFunctionOptions}
					on:change={(e) => ext.setGridBlendFunction(e.detail.value)}
				/>
				<Button title="Reset" on:click={ext.resetGrid} />
			{/if}
		</Folder>

		<Folder title="Tilt Shift" expanded={false}>
			<Checkbox
				value={ext.state.tiltShift.enabled}
				label="Enabled"
				on:change={() => ext.toggleTiltShift()}
			/>
			{#if ext.state.tiltShift.enabled}
				<Slider
					value={ext.state.tiltShift.offset}
					label="Offset"
					min={-1}
					max={1}
					step={0.01}
					on:change={(e) => ext.setTiltShiftOffset(e.detail.value)}
				/>
				<Slider
					value={ext.state.tiltShift.rotation}
					label="Rotation"
					min={-3.14}
					max={3.14}
					step={0.01}
					on:change={(e) => {
						ext.state.tiltShift.rotation = e.detail.value;
					}}
				/>
				<Slider
					value={ext.state.tiltShift.focusArea}
					label="Focus Area"
					min={0}
					max={1}
					step={0.01}
					on:change={(e) => ext.setTiltShiftFocusArea(e.detail.value)}
				/>
				<Slider
					value={ext.state.tiltShift.feather}
					label="Feather"
					min={0}
					max={1}
					step={0.01}
					on:change={(e) => ext.setTiltShiftFeather(e.detail.value)}
				/>
				<List
					value={ext.state.tiltShift.kernelSize}
					label="Kernel Size"
					options={kernelSizeOptions}
					on:change={(e) => ext.setTiltShiftKernelSize(e.detail.value)}
				/>
				<List
					value={ext.state.tiltShift.blendFunction}
					label="Blend Function"
					options={blendFunctionOptions}
					on:change={(e) => ext.setTiltShiftBlendFunction(e.detail.value)}
				/>
				<Button title="Reset" on:click={ext.resetTiltShift} />
			{/if}
		</Folder>

		<Folder title="Lens Distortion" expanded={false}>
			<Checkbox
				value={ext.state.lensDistortion.enabled}
				label="Enabled"
				on:change={() => ext.toggleLensDistortion()}
			/>
			{#if ext.state.lensDistortion.enabled}
				<Slider
					value={ext.state.lensDistortion.distortionX}
					label="Distortion X"
					min={-1}
					max={1}
					step={0.01}
					on:change={(e) => ext.setLensDistortionX(e.detail.value)}
				/>
				<Slider
					value={ext.state.lensDistortion.distortionY}
					label="Distortion Y"
					min={-1}
					max={1}
					step={0.01}
					on:change={(e) => ext.setLensDistortionY(e.detail.value)}
				/>
				<Slider
					value={ext.state.lensDistortion.principalX}
					label="Principal X"
					min={-1}
					max={1}
					step={0.01}
					on:change={(e) => ext.setLensPrincipalX(e.detail.value)}
				/>
				<Slider
					value={ext.state.lensDistortion.principalY}
					label="Principal Y"
					min={-1}
					max={1}
					step={0.01}
					on:change={(e) => ext.setLensPrincipalY(e.detail.value)}
				/>
				<Slider
					value={ext.state.lensDistortion.focalLengthX}
					label="Focal Length X"
					min={0.1}
					max={5}
					step={0.01}
					on:change={(e) => ext.setLensFocalLengthX(e.detail.value)}
				/>
				<Slider
					value={ext.state.lensDistortion.focalLengthY}
					label="Focal Length Y"
					min={0.1}
					max={5}
					step={0.01}
					on:change={(e) => ext.setLensFocalLengthY(e.detail.value)}
				/>
				<Slider
					value={ext.state.lensDistortion.skew}
					label="Skew"
					min={0}
					max={1}
					step={0.01}
					on:change={(e) => ext.setLensSkew(e.detail.value)}
				/>
				<Button title="Reset" on:click={ext.resetLensDistortion} />
			{/if}
		</Folder>

		<Folder title="Color Depth" expanded={false}>
			<Checkbox
				value={ext.state.colorDepth.enabled}
				label="Enabled"
				on:change={() => ext.toggleColorDepth()}
			/>
			{#if ext.state.colorDepth.enabled}
				<Slider
					value={ext.state.colorDepth.bits}
					label="Bits"
					min={1}
					max={32}
					step={1}
					on:change={(e) => ext.setColorDepthBits(e.detail.value)}
				/>
				<List
					value={ext.state.colorDepth.blendFunction}
					label="Blend Function"
					options={blendFunctionOptions}
					on:change={(e) => ext.setColorDepthBlendFunction(e.detail.value)}
				/>
				<Button title="Reset" on:click={ext.resetColorDepth} />
			{/if}
		</Folder>

		<Folder title="Depth of Field" expanded={false}>
			<Checkbox
				value={ext.state.depthOfField.enabled}
				label="Enabled"
				on:change={() => ext.toggleDepthOfField()}
			/>
			{#if ext.state.depthOfField.enabled}
				<Slider
					value={ext.state.depthOfField.focusDistance}
					label="Focus Distance"
					min={0.1}
					max={100}
					step={0.1}
					on:change={(e) => ext.setDepthOfFieldFocusDistance(e.detail.value)}
				/>
				<Slider
					value={ext.state.depthOfField.focusRange}
					label="Focus Range"
					min={0.1}
					max={50}
					step={0.1}
					on:change={(e) => ext.setDepthOfFieldFocusRange(e.detail.value)}
				/>
				<Slider
					value={ext.state.depthOfField.bokehScale}
					label="Bokeh Scale"
					min={0.1}
					max={10}
					step={0.1}
					on:change={(e) => ext.setDepthOfFieldBokehScale(e.detail.value)}
				/>
				<List
					value={ext.state.depthOfField.blendFunction}
					label="Blend Function"
					options={blendFunctionOptions}
					on:change={(e) => ext.setDepthOfFieldBlendFunction(e.detail.value)}
				/>
				<Button title="Reset" on:click={ext.resetDepthOfField} />
			{/if}
		</Folder>

		<Folder title="God Rays" expanded={false}>
			<Checkbox
				value={ext.state.godRays.enabled}
				label="Enabled"
				on:change={() => ext.toggleGodRays()}
			/>
			{#if ext.state.godRays.enabled}
				<Slider
					value={ext.state.godRays.samples}
					label="Samples"
					min={1}
					max={120}
					step={1}
					on:change={(e) => ext.setGodRaysSamples(e.detail.value)}
				/>
				<Slider
					value={ext.state.godRays.density}
					label="Density"
					min={0}
					max={1}
					step={0.01}
					on:change={(e) => ext.setGodRaysDensity(e.detail.value)}
				/>
				<Slider
					value={ext.state.godRays.decay}
					label="Decay"
					min={0}
					max={1}
					step={0.01}
					on:change={(e) => ext.setGodRaysDecay(e.detail.value)}
				/>
				<Slider
					value={ext.state.godRays.weight}
					label="Weight"
					min={0}
					max={1}
					step={0.01}
					on:change={(e) => ext.setGodRaysWeight(e.detail.value)}
				/>
				<Slider
					value={ext.state.godRays.exposure}
					label="Exposure"
					min={0}
					max={1}
					step={0.01}
					on:change={(e) => ext.setGodRaysExposure(e.detail.value)}
				/>
				<Slider
					value={ext.state.godRays.clampMax}
					label="Clamp Max"
					min={0.1}
					max={5}
					step={0.01}
					on:change={(e) => ext.setGodRaysClampMax(e.detail.value)}
				/>
				<Checkbox value={ext.state.godRays.blur} label="Blur" />
				<List
					value={ext.state.godRays.kernelSize}
					label="Kernel Size"
					options={kernelSizeOptions}
					on:change={(e) => ext.setGodRaysKernelSize(e.detail.value)}
				/>
				<List
					value={ext.state.godRays.blendFunction}
					label="Blend Function"
					options={blendFunctionOptions}
					on:change={(e) => ext.setGodRaysBlendFunction(e.detail.value)}
				/>
				<Separator />
				<Slider
					value={ext.state.godRays.sunX}
					label="Sun X"
					min={-50}
					max={50}
					step={0.1}
					on:change={(e) => ext.setGodRaysSunX(e.detail.value)}
				/>
				<Slider
					value={ext.state.godRays.sunY}
					label="Sun Y"
					min={-50}
					max={50}
					step={0.1}
					on:change={(e) => ext.setGodRaysSunY(e.detail.value)}
				/>
				<Slider
					value={ext.state.godRays.sunZ}
					label="Sun Z"
					min={-50}
					max={50}
					step={0.1}
					on:change={(e) => ext.setGodRaysSunZ(e.detail.value)}
				/>
				<Slider
					value={ext.state.godRays.sunColor}
					label="Sun Color"
					min={0}
					max={0xffffff}
					step={1}
					on:change={(e) => ext.setGodRaysSunColor(Math.floor(e.detail.value))}
				/>
				<Button title="Reset" on:click={ext.resetGodRays} />
			{/if}
		</Folder>

		<Folder title="SSAO" expanded={false}>
			<Checkbox value={ext.state.ssao.enabled} label="Enabled" on:change={() => ext.toggleSSAO()} />
			{#if ext.state.ssao.enabled}
				<Slider
					value={ext.state.ssao.samples}
					label="Samples"
					min={1}
					max={32}
					step={1}
					on:change={(e) => ext.setSSAOSamples(e.detail.value)}
				/>
				<Slider
					value={ext.state.ssao.rings}
					label="Rings"
					min={1}
					max={16}
					step={1}
					on:change={(e) => ext.setSSAORings(e.detail.value)}
				/>
				<Slider
					value={ext.state.ssao.radius}
					label="Radius"
					min={0}
					max={1}
					step={0.001}
					on:change={(e) => ext.setSSAORadius(e.detail.value)}
				/>
				<Slider
					value={ext.state.ssao.intensity}
					label="Intensity"
					min={0}
					max={5}
					step={0.1}
					on:change={(e) => ext.setSSAOIntensity(e.detail.value)}
				/>
				<Slider
					value={ext.state.ssao.bias}
					label="Bias"
					min={0}
					max={0.1}
					step={0.001}
					on:change={(e) => ext.setSSAOBias(e.detail.value)}
				/>
				<Slider
					value={ext.state.ssao.fade}
					label="Fade"
					min={0}
					max={1}
					step={0.01}
					on:change={(e) => ext.setSSAOFade(e.detail.value)}
				/>
				<Slider
					value={ext.state.ssao.luminanceInfluence}
					label="Luminance Influence"
					min={0}
					max={1}
					step={0.01}
					on:change={(e) => ext.setSSAOLuminanceInfluence(e.detail.value)}
				/>
				<List
					value={ext.state.ssao.blendFunction}
					label="Blend Function"
					options={blendFunctionOptions}
					on:change={(e) => ext.setSSAOBlendFunction(e.detail.value)}
				/>
				<Button title="Reset" on:click={ext.resetSSAO} />
			{/if}
		</Folder>

		<Folder title="Outline" expanded={false}>
			<Checkbox
				value={ext.state.outline.enabled}
				label="Enabled"
				on:change={() => ext.toggleOutline()}
			/>
			{#if ext.state.outline.enabled}
				<Slider
					value={ext.state.outline.edgeStrength}
					label="Edge Strength"
					min={0}
					max={10}
					step={0.1}
					on:change={(e) => ext.setOutlineEdgeStrength(e.detail.value)}
				/>
				<Slider
					value={ext.state.outline.pulseSpeed}
					label="Pulse Speed"
					min={0}
					max={10}
					step={0.1}
					on:change={(e) => ext.setOutlinePulseSpeed(e.detail.value)}
				/>
				<Checkbox value={ext.state.outline.xRay} label="X-Ray" />
				<Checkbox value={ext.state.outline.blur} label="Blur" />
				<List
					value={ext.state.outline.kernelSize}
					label="Kernel Size"
					options={kernelSizeOptions}
					on:change={(e) => ext.setOutlineKernelSize(e.detail.value)}
				/>
				<List
					value={ext.state.outline.blendFunction}
					label="Blend Function"
					options={blendFunctionOptions}
					on:change={(e) => ext.setOutlineBlendFunction(e.detail.value)}
				/>
				<Button title="Reset" on:click={ext.resetOutline} />
			{/if}
		</Folder>

		<Folder title="Depth Effect" expanded={false}>
			<Checkbox
				value={ext.state.depthEffect.enabled}
				label="Enabled"
				on:change={() => ext.toggleDepthEffect()}
			/>
			{#if ext.state.depthEffect.enabled}
				<Checkbox value={ext.state.depthEffect.inverted} label="Inverted" />
				<List
					value={ext.state.depthEffect.blendFunction}
					label="Blend Function"
					options={blendFunctionOptions}
					on:change={(e) => ext.setDepthEffectBlendFunction(e.detail.value)}
				/>
				<Button title="Reset" on:click={ext.resetDepthEffect} />
			{/if}
		</Folder>

		<Separator />

		<Button title="Reset All" on:click={ext.resetAll} />
	</DropDownPane>
</ToolbarItem>

<slot />
