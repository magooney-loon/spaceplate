<script lang="ts">
	import { useStudio, ToolbarItem, DropDownPane } from '@threlte/studio/extend';
	import { Separator, Button } from 'svelte-tweakpane-ui';
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

	// Import UI components
	import { BloomUI } from './effects/bloom';
	import { SMAAUI } from './effects/smaa';
	import { FXAAUI } from './effects/fxaa';
	import { VignetteUI } from './effects/vignette';
	import { PixelationUI } from './effects/pixelation';
	import { GlitchUI } from './effects/glitch';
	import { NoiseUI } from './effects/noise';
	import { ChromaticAberrationUI } from './effects/chromaticAberration';
	import { BrightnessContrastUI } from './effects/brightnessContrast';
	import { HueSaturationUI } from './effects/hueSaturation';
	import { SepiaUI } from './effects/sepia';
	import { DotScreenUI } from './effects/dotScreen';
	import { ScanlineUI } from './effects/scanline';
	import { ShockWaveUI } from './effects/shockWave';
	import { ASCIIUI } from './effects/ascii';
	import { ToneMappingUI } from './effects/toneMapping';
	import { GridUI } from './effects/grid';
	import { TiltShiftUI } from './effects/tiltShift';
	import { LensDistortionUI } from './effects/lensDistortion';
	import { ColorDepthUI } from './effects/colorDepth';
	import { DepthOfFieldUI } from './effects/depthOfField';
	import { GodRaysUI } from './effects/godRays';
	import { SSAOUI } from './effects/ssao';
	import { OutlineUI } from './effects/outline';
	import { DepthEffectUI } from './effects/depthEffect';

	const { createExtension } = useStudio();

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
		<BloomUI state={ext.state.bloom} actions={ext} />
		<SMAAUI state={ext.state.smaa} actions={ext} />
		<FXAAUI state={ext.state.fxaa} actions={ext} />
		<VignetteUI state={ext.state.vignette} actions={ext} />
		<PixelationUI state={ext.state.pixelation} actions={ext} />
		<GlitchUI state={ext.state.glitch} actions={ext} />
		<NoiseUI state={ext.state.noise} actions={ext} />
		<ChromaticAberrationUI state={ext.state.chromaticAberration} actions={ext} />
		<BrightnessContrastUI state={ext.state.brightnessContrast} actions={ext} />
		<HueSaturationUI state={ext.state.hueSaturation} actions={ext} />
		<SepiaUI state={ext.state.sepia} actions={ext} />
		<DotScreenUI state={ext.state.dotScreen} actions={ext} />
		<ScanlineUI state={ext.state.scanline} actions={ext} />
		<ShockWaveUI state={ext.state.shockWave} actions={ext} />
		<ASCIIUI state={ext.state.ascii} actions={ext} />
		<ToneMappingUI state={ext.state.toneMapping} actions={ext} />
		<GridUI state={ext.state.grid} actions={ext} />
		<TiltShiftUI state={ext.state.tiltShift} actions={ext} />
		<LensDistortionUI state={ext.state.lensDistortion} actions={ext} />
		<ColorDepthUI state={ext.state.colorDepth} actions={ext} />
		<DepthOfFieldUI state={ext.state.depthOfField} actions={ext} />
		<GodRaysUI state={ext.state.godRays} actions={ext} />
		<SSAOUI state={ext.state.ssao} actions={ext} />
		<OutlineUI state={ext.state.outline} actions={ext} />
		<DepthEffectUI state={ext.state.depthEffect} actions={ext} />

		<Separator />

		<Button title="Reset All" on:click={ext.resetAll} />
	</DropDownPane>
</ToolbarItem>

<slot />
