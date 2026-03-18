<script lang="ts">
	import { useStudio, ToolbarItem, DropDownPane } from '@threlte/studio/extend';
	import { Folder, Slider, Checkbox, List, Button, Separator } from 'svelte-tweakpane-ui';
	import type { KernelSize, BlendFunction, ToneMappingMode } from 'postprocessing';
	import {
		// Bloom
		defaultBloomState,
		// SMAA
		defaultSMAAState,
		// FXAA
		defaultFXAAState,
		// Vignette
		defaultVignetteState,
		// Pixelation
		defaultPixelationState,
		// Glitch
		defaultGlitchState,
		// Noise
		defaultNoiseState,
		// Chromatic Aberration
		defaultChromaticAberrationState,
		// Brightness Contrast
		defaultBrightnessContrastState,
		// Hue Saturation
		defaultHueSaturationState,
		// Sepia
		defaultSepiaState,
		// Dot Screen
		defaultDotScreenState,
		// Scanline
		defaultScanlineState,
		// Shock Wave
		defaultShockWaveState,
		// ASCII
		defaultASCIIState,
		// Tone Mapping
		defaultToneMappingState,
		// Grid
		defaultGridState,
		// Tilt Shift
		defaultTiltShiftState,
		// Lens Distortion
		defaultLensDistortionState,
		// Color Depth
		defaultColorDepthState,
		// Depth of Field
		defaultDepthOfFieldState,
		// God Rays
		defaultGodRaysState,
		// SSAO
		defaultSSAOState,
		// Outline
		defaultOutlineState,
		// Depth Effect
		defaultDepthEffectState
	} from './effects';

	const { createExtension } = useStudio();

	// Option dropdowns
	const kernelSizeOptions = [
		{ value: 0 as KernelSize, text: 'Very Small' },
		{ value: 1 as KernelSize, text: 'Small' },
		{ value: 2 as KernelSize, text: 'Medium' },
		{ value: 3 as KernelSize, text: 'Large' },
		{ value: 4 as KernelSize, text: 'Very Large' },
		{ value: 5 as KernelSize, text: 'Huge' }
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
			bloom: structuredClone(defaultBloomState),
			smaa: structuredClone(defaultSMAAState),
			fxaa: structuredClone(defaultFXAAState),
			vignette: structuredClone(defaultVignetteState),
			pixelation: structuredClone(defaultPixelationState),
			glitch: structuredClone(defaultGlitchState),
			noise: structuredClone(defaultNoiseState),
			chromaticAberration: structuredClone(defaultChromaticAberrationState),
			brightnessContrast: structuredClone(defaultBrightnessContrastState),
			hueSaturation: structuredClone(defaultHueSaturationState),
			sepia: structuredClone(defaultSepiaState),
			dotScreen: structuredClone(defaultDotScreenState),
			scanline: structuredClone(defaultScanlineState),
			shockWave: structuredClone(defaultShockWaveState),
			ascii: structuredClone(defaultASCIIState),
			toneMapping: structuredClone(defaultToneMappingState),
			grid: structuredClone(defaultGridState),
			tiltShift: structuredClone(defaultTiltShiftState),
			lensDistortion: structuredClone(defaultLensDistortionState),
			colorDepth: structuredClone(defaultColorDepthState),
			depthOfField: structuredClone(defaultDepthOfFieldState),
			godRays: structuredClone(defaultGodRaysState),
			ssao: structuredClone(defaultSSAOState),
			outline: structuredClone(defaultOutlineState),
			depthEffect: structuredClone(defaultDepthEffectState)
		}),
		actions: {
			// Bloom actions
			toggleBloom: ({ state }) => {
				state.bloom.enabled = !state.bloom.enabled;
			},
			setBloomIntensity: ({ state }, value: number) => {
				state.bloom.intensity = value;
			},
			setBloomThreshold: ({ state }, value: number) => {
				state.bloom.luminanceThreshold = value;
			},
			setBloomSmoothing: ({ state }, value: number) => {
				state.bloom.luminanceSmoothing = value;
			},
			setBloomKernelSize: ({ state }, value: KernelSize) => {
				state.bloom.kernelSize = value;
			},
			setBloomBlendFunction: ({ state }, value: BlendFunction) => {
				state.bloom.blendFunction = value;
			},
			setBloomMipmapBlur: ({ state }, value: boolean) => {
				state.bloom.mipmapBlur = value;
			},
			setBloomRadius: ({ state }, value: number) => {
				state.bloom.radius = value;
			},
			setBloomLevels: ({ state }, value: number) => {
				state.bloom.levels = value;
			},
			resetBloom: ({ state }) => {
				state.bloom = structuredClone(defaultBloomState);
			},
			// SMAA actions
			toggleSMAA: ({ state }) => {
				state.smaa.enabled = !state.smaa.enabled;
			},
			setSMAAPreset: ({ state }, value: 0 | 1 | 2 | 3) => {
				state.smaa.preset = value;
			},
			setSMAEEdgeDetectionMode: ({ state }, value: 0 | 1 | 2) => {
				state.smaa.edgeDetectionMode = value;
			},
			setSMAAPredicationMode: ({ state }, value: 0 | 1 | 2) => {
				state.smaa.predicationMode = value;
			},
			resetSMAA: ({ state }) => {
				state.smaa = structuredClone(defaultSMAAState);
			},
			// FXAA actions
			toggleFXAA: ({ state }) => {
				state.fxaa.enabled = !state.fxaa.enabled;
			},
			setFXAAEdgeThreshold: ({ state }, min: number, max: number, quality: number) => {
				state.fxaa.minEdgeThreshold = min;
				state.fxaa.maxEdgeThreshold = max;
				state.fxaa.subpixelQuality = quality;
			},
			resetFXAA: ({ state }) => {
				state.fxaa = structuredClone(defaultFXAAState);
			},
			// Vignette actions
			toggleVignette: ({ state }) => {
				state.vignette.enabled = !state.vignette.enabled;
			},
			setVignetteOffset: ({ state }, value: number) => {
				state.vignette.offset = value;
			},
			setVignetteDarkness: ({ state }, value: number) => {
				state.vignette.darkness = value;
			},
			setVignetteTechnique: ({ state }, value: 0 | 1) => {
				state.vignette.technique = value;
			},
			resetVignette: ({ state }) => {
				state.vignette = structuredClone(defaultVignetteState);
			},
			// Pixelation actions
			togglePixelation: ({ state }) => {
				state.pixelation.enabled = !state.pixelation.enabled;
			},
			setPixelationGranularity: ({ state }, value: number) => {
				state.pixelation.granularity = value;
			},
			resetPixelation: ({ state }) => {
				state.pixelation = structuredClone(defaultPixelationState);
			},
			// Glitch actions
			toggleGlitch: ({ state }) => {
				state.glitch.enabled = !state.glitch.enabled;
			},
			setGlitchDelay: ({ state }, value: number) => {
				state.glitch.delay = value;
			},
			setGlitchDuration: ({ state }, value: number) => {
				state.glitch.duration = value;
			},
			setGlitchStrength: ({ state }, value: number) => {
				state.glitch.strength = value;
			},
			setGlitchRatio: ({ state }, value: number) => {
				state.glitch.ratio = value;
			},
			setGlitchColumns: ({ state }, value: number) => {
				state.glitch.columns = value;
			},
			setGlitchMode: ({ state }, value: 0 | 1 | 2 | 3) => {
				state.glitch.mode = value;
			},
			resetGlitch: ({ state }) => {
				state.glitch = structuredClone(defaultGlitchState);
			},
			// Noise actions
			toggleNoise: ({ state }) => {
				state.noise.enabled = !state.noise.enabled;
			},
			setNoiseBlendFunction: ({ state }, value: BlendFunction) => {
				state.noise.blendFunction = value;
			},
			resetNoise: ({ state }) => {
				state.noise = structuredClone(defaultNoiseState);
			},
			// Chromatic Aberration actions
			toggleChromaticAberration: ({ state }) => {
				state.chromaticAberration.enabled = !state.chromaticAberration.enabled;
			},
			setChromaticAberrationOffsetX: ({ state }, value: number) => {
				state.chromaticAberration.offsetX = value;
			},
			setChromaticAberrationOffsetY: ({ state }, value: number) => {
				state.chromaticAberration.offsetY = value;
			},
			setChromaticAberrationModulation: ({ state }, radial: boolean, offset: number) => {
				state.chromaticAberration.radialModulation = radial;
				state.chromaticAberration.modulationOffset = offset;
			},
			setChromaticAberrationBlendFunction: ({ state }, value: BlendFunction) => {
				state.chromaticAberration.blendFunction = value;
			},
			resetChromaticAberration: ({ state }) => {
				state.chromaticAberration = structuredClone(defaultChromaticAberrationState);
			},
			// Brightness Contrast actions
			toggleBrightnessContrast: ({ state }) => {
				state.brightnessContrast.enabled = !state.brightnessContrast.enabled;
			},
			setBrightness: ({ state }, value: number) => {
				state.brightnessContrast.brightness = value;
			},
			setContrast: ({ state }, value: number) => {
				state.brightnessContrast.contrast = value;
			},
			setBrightnessContrastBlendFunction: ({ state }, value: BlendFunction) => {
				state.brightnessContrast.blendFunction = value;
			},
			resetBrightnessContrast: ({ state }) => {
				state.brightnessContrast = structuredClone(defaultBrightnessContrastState);
			},
			// Hue Saturation actions
			toggleHueSaturation: ({ state }) => {
				state.hueSaturation.enabled = !state.hueSaturation.enabled;
			},
			setHue: ({ state }, value: number) => {
				state.hueSaturation.hue = value;
			},
			setSaturation: ({ state }, value: number) => {
				state.hueSaturation.saturation = value;
			},
			setHueSaturationBlendFunction: ({ state }, value: BlendFunction) => {
				state.hueSaturation.blendFunction = value;
			},
			resetHueSaturation: ({ state }) => {
				state.hueSaturation = structuredClone(defaultHueSaturationState);
			},
			// Sepia actions
			toggleSepia: ({ state }) => {
				state.sepia.enabled = !state.sepia.enabled;
			},
			setSepiaIntensity: ({ state }, value: number) => {
				state.sepia.intensity = value;
			},
			setSepiaBlendFunction: ({ state }, value: BlendFunction) => {
				state.sepia.blendFunction = value;
			},
			resetSepia: ({ state }) => {
				state.sepia = structuredClone(defaultSepiaState);
			},
			// Dot Screen actions
			toggleDotScreen: ({ state }) => {
				state.dotScreen.enabled = !state.dotScreen.enabled;
			},
			setDotScreenAngle: ({ state }, value: number) => {
				state.dotScreen.angle = value;
			},
			setDotScreenScale: ({ state }, value: number) => {
				state.dotScreen.scale = value;
			},
			setDotScreenBlendFunction: ({ state }, value: BlendFunction) => {
				state.dotScreen.blendFunction = value;
			},
			resetDotScreen: ({ state }) => {
				state.dotScreen = structuredClone(defaultDotScreenState);
			},
			// Scanline actions
			toggleScanline: ({ state }) => {
				state.scanline.enabled = !state.scanline.enabled;
			},
			setScanlineDensity: ({ state }, value: number) => {
				state.scanline.density = value;
			},
			setScanlineOpacity: ({ state }, value: number) => {
				state.scanline.opacity = value;
			},
			setScanlineScrollSpeed: ({ state }, value: number) => {
				state.scanline.scrollSpeed = value;
			},
			setScanlineBlendFunction: ({ state }, value: BlendFunction) => {
				state.scanline.blendFunction = value;
			},
			resetScanline: ({ state }) => {
				state.scanline = structuredClone(defaultScanlineState);
			},
			// Shock Wave actions
			toggleShockWave: ({ state }) => {
				state.shockWave.enabled = !state.shockWave.enabled;
			},
			setShockWaveSpeed: ({ state }, value: number) => {
				state.shockWave.speed = value;
			},
			setShockWaveMaxRadius: ({ state }, value: number) => {
				state.shockWave.maxRadius = value;
			},
			setShockWaveWaveSize: ({ state }, value: number) => {
				state.shockWave.waveSize = value;
			},
			setShockWaveAmplitude: ({ state }, value: number) => {
				state.shockWave.amplitude = value;
			},
			setShockWaveEpicenter: ({ state }, x: number, y: number, z: number) => {
				state.shockWave.epicenterX = x;
				state.shockWave.epicenterY = y;
				state.shockWave.epicenterZ = z;
			},
			triggerShockWave: ({ state }) => {
				state.shockWave.triggered = true;
			},
			resetShockWave: ({ state }) => {
				state.shockWave = structuredClone(defaultShockWaveState);
			},
			// ASCII actions
			toggleASCII: ({ state }) => {
				state.ascii.enabled = !state.ascii.enabled;
			},
			setASCIICellSize: ({ state }, value: number) => {
				state.ascii.cellSize = value;
			},
			setASCIIInverted: ({ state }, value: boolean) => {
				state.ascii.inverted = value;
			},
			resetASCII: ({ state }) => {
				state.ascii = structuredClone(defaultASCIIState);
			},
			// Tone Mapping actions
			toggleToneMapping: ({ state }) => {
				state.toneMapping.enabled = !state.toneMapping.enabled;
			},
			setToneMappingMode: ({ state }, value: ToneMappingMode) => {
				state.toneMapping.mode = value;
			},
			setToneMappingWhitePoint: ({ state }, value: number) => {
				state.toneMapping.whitePoint = value;
			},
			setToneMappingMiddleGrey: ({ state }, value: number) => {
				state.toneMapping.middleGrey = value;
			},
			setToneMappingResolution: ({ state }, value: number) => {
				state.toneMapping.resolution = value;
			},
			setToneMappingMinLuminance: ({ state }, value: number) => {
				state.toneMapping.minLuminance = value;
			},
			setToneMappingAverageLuminance: ({ state }, value: number) => {
				state.toneMapping.averageLuminance = value;
			},
			setToneMappingAdaptationRate: ({ state }, value: number) => {
				state.toneMapping.adaptationRate = value;
			},
			setToneMappingBlendFunction: ({ state }, value: BlendFunction) => {
				state.toneMapping.blendFunction = value;
			},
			resetToneMapping: ({ state }) => {
				state.toneMapping = structuredClone(defaultToneMappingState);
			},
			// Grid actions
			toggleGrid: ({ state }) => {
				state.grid.enabled = !state.grid.enabled;
			},
			setGridScale: ({ state }, value: number) => {
				state.grid.scale = value;
			},
			setGridLineWidth: ({ state }, value: number) => {
				state.grid.lineWidth = value;
			},
			setGridBlendFunction: ({ state }, value: BlendFunction) => {
				state.grid.blendFunction = value;
			},
			resetGrid: ({ state }) => {
				state.grid = structuredClone(defaultGridState);
			},
			// Tilt Shift actions
			toggleTiltShift: ({ state }) => {
				state.tiltShift.enabled = !state.tiltShift.enabled;
			},
			setTiltShiftOffset: ({ state }, value: number) => {
				state.tiltShift.offset = value;
			},
			setTiltShiftFocusArea: ({ state }, value: number) => {
				state.tiltShift.focusArea = value;
			},
			setTiltShiftFeather: ({ state }, value: number) => {
				state.tiltShift.feather = value;
			},
			setTiltShiftKernelSize: ({ state }, value: KernelSize) => {
				state.tiltShift.kernelSize = value;
			},
			setTiltShiftBlendFunction: ({ state }, value: BlendFunction) => {
				state.tiltShift.blendFunction = value;
			},
			resetTiltShift: ({ state }) => {
				state.tiltShift = structuredClone(defaultTiltShiftState);
			},
			// Lens Distortion actions
			toggleLensDistortion: ({ state }) => {
				state.lensDistortion.enabled = !state.lensDistortion.enabled;
			},
			setLensDistortionX: ({ state }, value: number) => {
				state.lensDistortion.distortionX = value;
			},
			setLensDistortionY: ({ state }, value: number) => {
				state.lensDistortion.distortionY = value;
			},
			setLensPrincipalX: ({ state }, value: number) => {
				state.lensDistortion.principalX = value;
			},
			setLensPrincipalY: ({ state }, value: number) => {
				state.lensDistortion.principalY = value;
			},
			setLensFocalLengthX: ({ state }, value: number) => {
				state.lensDistortion.focalLengthX = value;
			},
			setLensFocalLengthY: ({ state }, value: number) => {
				state.lensDistortion.focalLengthY = value;
			},
			setLensSkew: ({ state }, value: number) => {
				state.lensDistortion.skew = value;
			},
			resetLensDistortion: ({ state }) => {
				state.lensDistortion = structuredClone(defaultLensDistortionState);
			},
			// Color Depth actions
			toggleColorDepth: ({ state }) => {
				state.colorDepth.enabled = !state.colorDepth.enabled;
			},
			setColorDepthBits: ({ state }, value: number) => {
				state.colorDepth.bits = value;
			},
			setColorDepthBlendFunction: ({ state }, value: BlendFunction) => {
				state.colorDepth.blendFunction = value;
			},
			resetColorDepth: ({ state }) => {
				state.colorDepth = structuredClone(defaultColorDepthState);
			},
			// Depth of Field actions
			toggleDepthOfField: ({ state }) => {
				state.depthOfField.enabled = !state.depthOfField.enabled;
			},
			setDepthOfFieldFocusDistance: ({ state }, value: number) => {
				state.depthOfField.focusDistance = value;
			},
			setDepthOfFieldFocusRange: ({ state }, value: number) => {
				state.depthOfField.focusRange = value;
			},
			setDepthOfFieldBokehScale: ({ state }, value: number) => {
				state.depthOfField.bokehScale = value;
			},
			setDepthOfFieldBlendFunction: ({ state }, value: BlendFunction) => {
				state.depthOfField.blendFunction = value;
			},
			resetDepthOfField: ({ state }) => {
				state.depthOfField = structuredClone(defaultDepthOfFieldState);
			},
			// God Rays actions
			toggleGodRays: ({ state }) => {
				state.godRays.enabled = !state.godRays.enabled;
			},
			setGodRaysSamples: ({ state }, value: number) => {
				state.godRays.samples = value;
			},
			setGodRaysDensity: ({ state }, value: number) => {
				state.godRays.density = value;
			},
			setGodRaysDecay: ({ state }, value: number) => {
				state.godRays.decay = value;
			},
			setGodRaysWeight: ({ state }, value: number) => {
				state.godRays.weight = value;
			},
			setGodRaysExposure: ({ state }, value: number) => {
				state.godRays.exposure = value;
			},
			setGodRaysClampMax: ({ state }, value: number) => {
				state.godRays.clampMax = value;
			},
			setGodRaysBlur: ({ state }, value: boolean) => {
				state.godRays.blur = value;
			},
			setGodRaysKernelSize: ({ state }, value: KernelSize) => {
				state.godRays.kernelSize = value;
			},
			setGodRaysBlendFunction: ({ state }, value: BlendFunction) => {
				state.godRays.blendFunction = value;
			},
			setGodRaysSunX: ({ state }, value: number) => {
				state.godRays.sunX = value;
			},
			setGodRaysSunY: ({ state }, value: number) => {
				state.godRays.sunY = value;
			},
			setGodRaysSunZ: ({ state }, value: number) => {
				state.godRays.sunZ = value;
			},
			setGodRaysSunColor: ({ state }, value: number) => {
				state.godRays.sunColor = value;
			},
			resetGodRays: ({ state }) => {
				state.godRays = structuredClone(defaultGodRaysState);
			},
			// SSAO actions
			toggleSSAO: ({ state }) => {
				state.ssao.enabled = !state.ssao.enabled;
			},
			setSSAOSamples: ({ state }, value: number) => {
				state.ssao.samples = value;
			},
			setSSAORings: ({ state }, value: number) => {
				state.ssao.rings = value;
			},
			setSSAORadius: ({ state }, value: number) => {
				state.ssao.radius = value;
			},
			setSSAOIntensity: ({ state }, value: number) => {
				state.ssao.intensity = value;
			},
			setSSAOBias: ({ state }, value: number) => {
				state.ssao.bias = value;
			},
			setSSAOFade: ({ state }, value: number) => {
				state.ssao.fade = value;
			},
			setSSAOLuminanceInfluence: ({ state }, value: number) => {
				state.ssao.luminanceInfluence = value;
			},
			setSSAOBlendFunction: ({ state }, value: BlendFunction) => {
				state.ssao.blendFunction = value;
			},
			resetSSAO: ({ state }) => {
				state.ssao = structuredClone(defaultSSAOState);
			},
			// Outline actions
			toggleOutline: ({ state }) => {
				state.outline.enabled = !state.outline.enabled;
			},
			setOutlineEdgeStrength: ({ state }, value: number) => {
				state.outline.edgeStrength = value;
			},
			setOutlineVisibleEdgeColor: ({ state }, value: number) => {
				state.outline.visibleEdgeColor = value;
			},
			setOutlineHiddenEdgeColor: ({ state }, value: number) => {
				state.outline.hiddenEdgeColor = value;
			},
			setOutlinePulseSpeed: ({ state }, value: number) => {
				state.outline.pulseSpeed = value;
			},
			setOutlineXRay: ({ state }, value: boolean) => {
				state.outline.xRay = value;
			},
			setOutlineBlur: ({ state }, value: boolean) => {
				state.outline.blur = value;
			},
			setOutlineKernelSize: ({ state }, value: KernelSize) => {
				state.outline.kernelSize = value;
			},
			setOutlineBlendFunction: ({ state }, value: BlendFunction) => {
				state.outline.blendFunction = value;
			},
			resetOutline: ({ state }) => {
				state.outline = structuredClone(defaultOutlineState);
			},
			// Depth Effect actions
			toggleDepthEffect: ({ state }) => {
				state.depthEffect.enabled = !state.depthEffect.enabled;
			},
			setDepthEffectInverted: ({ state }, value: boolean) => {
				state.depthEffect.inverted = value;
			},
			setDepthEffectBlendFunction: ({ state }, value: BlendFunction) => {
				state.depthEffect.blendFunction = value;
			},
			resetDepthEffect: ({ state }) => {
				state.depthEffect = structuredClone(defaultDepthEffectState);
			},
			// Global reset
			resetAll: ({ state }) => {
				state.bloom = structuredClone(defaultBloomState);
				state.smaa = structuredClone(defaultSMAAState);
				state.fxaa = structuredClone(defaultFXAAState);
				state.vignette = structuredClone(defaultVignetteState);
				state.pixelation = structuredClone(defaultPixelationState);
				state.glitch = structuredClone(defaultGlitchState);
				state.noise = structuredClone(defaultNoiseState);
				state.chromaticAberration = structuredClone(defaultChromaticAberrationState);
				state.brightnessContrast = structuredClone(defaultBrightnessContrastState);
				state.hueSaturation = structuredClone(defaultHueSaturationState);
				state.sepia = structuredClone(defaultSepiaState);
				state.dotScreen = structuredClone(defaultDotScreenState);
				state.scanline = structuredClone(defaultScanlineState);
				state.shockWave = structuredClone(defaultShockWaveState);
				state.ascii = structuredClone(defaultASCIIState);
				state.toneMapping = structuredClone(defaultToneMappingState);
				state.grid = structuredClone(defaultGridState);
				state.tiltShift = structuredClone(defaultTiltShiftState);
				state.lensDistortion = structuredClone(defaultLensDistortionState);
				state.colorDepth = structuredClone(defaultColorDepthState);
				state.depthOfField = structuredClone(defaultDepthOfFieldState);
				state.godRays = structuredClone(defaultGodRaysState);
				state.ssao = structuredClone(defaultSSAOState);
				state.outline = structuredClone(defaultOutlineState);
				state.depthEffect = structuredClone(defaultDepthEffectState);
			}
		}
	});
</script>

<ToolbarItem position="left">
	<DropDownPane icon="mdiImageFilterHdr" title="Post Processing">
		<!-- Bloom -->
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

		<!-- SMAA -->
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

		<!-- FXAA -->
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

		<!-- Vignette -->
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

		<!-- Pixelation -->
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

		<!-- Glitch -->
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

		<!-- Noise -->
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

		<!-- Chromatic Aberration -->
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

		<!-- Brightness & Contrast -->
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

		<!-- Hue & Saturation -->
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

		<!-- Sepia -->
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

		<!-- Dot Screen -->
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

		<!-- Scanline -->
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

		<!-- Shock Wave -->
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

		<!-- ASCII -->
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

		<!-- Tone Mapping -->
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

		<!-- Grid -->
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

		<!-- Tilt Shift -->
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

		<!-- Lens Distortion -->
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

		<!-- Color Depth -->
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

		<!-- Depth of Field -->
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

		<!-- God Rays -->
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

		<!-- SSAO -->
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

		<!-- Outline -->
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

		<!-- Depth Effect -->
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
