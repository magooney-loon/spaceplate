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
		{ value: 2, text: 'Ultra' }
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
				intensity: 6,
				luminanceThreshold: 0.01,
				luminanceSmoothing: 0.08,
				kernelSize: 4 as KernelSize
			},
			smaa: {
				enabled: false,
				preset: 2
			},
			fxaa: {
				enabled: false,
				minEdgeThreshold: 0.05,
				maxEdgeThreshold: 0.12,
				subpixelQuality: 0.75
			},
			vignette: {
				enabled: false,
				offset: 0.2,
				darkness: 0.75
			},
			pixelation: {
				enabled: false,
				granularity: 4.5
			},
			glitch: {
				enabled: false,
				delay: 2.5,
				duration: 0.8,
				strength: 0.65,
				ratio: 0.85
			},
			noise: {
				enabled: false,
				premultiply: true,
				blendFunction: 28 as BlendFunction
			},
			chromaticAberration: {
				enabled: false,
				radialModulation: false,
				modulationOffset: 0.5,
				offset: 0.005
			},
			brightnessContrast: {
				enabled: false,
				brightness: 0,
				contrast: 0
			},
			hueSaturation: {
				enabled: false,
				hue: 0,
				saturation: 0
			},
			sepia: {
				enabled: false,
				intensity: 1
			},
			dotScreen: {
				enabled: false,
				angle: 1.57,
				scale: 1
			},
			scanline: {
				enabled: false,
				density: 1.5,
				opacity: 0.5
			},
			shockWave: {
				enabled: false,
				speed: 5,
				maxStrength: 1.5,
				distortion: 0.5,
				size: 0.5
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
				middleGrey: 0.6
			},
			grid: {
				enabled: false,
				scale: 1.0,
				lineWidth: 0.0
			},
			tiltShift: {
				enabled: false,
				offset: 0.0,
				rotation: 0.0,
				focusArea: 0.4,
				feather: 0.3,
				kernelSize: 3 as KernelSize
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
			toggleSMAA: ({ state }) => {
				state.smaa.enabled = !state.smaa.enabled;
			},
			setSMAAPreset: ({ state }, v) => {
				state.smaa.preset = v;
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
			toggleNoise: ({ state }) => {
				state.noise.enabled = !state.noise.enabled;
			},
			toggleChromaticAberration: ({ state }) => {
				state.chromaticAberration.enabled = !state.chromaticAberration.enabled;
			},
			setChromaticAberrationOffset: ({ state }, v) => {
				state.chromaticAberration.offset = v;
			},
			setChromaticAberrationModulation: ({ state }, radial, offset) => {
				state.chromaticAberration.radialModulation = radial;
				state.chromaticAberration.modulationOffset = offset;
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
			toggleHueSaturation: ({ state }) => {
				state.hueSaturation.enabled = !state.hueSaturation.enabled;
			},
			setHue: ({ state }, v) => {
				state.hueSaturation.hue = v;
			},
			setSaturation: ({ state }, v) => {
				state.hueSaturation.saturation = v;
			},
			toggleSepia: ({ state }) => {
				state.sepia.enabled = !state.sepia.enabled;
			},
			setSepiaIntensity: ({ state }, v) => {
				state.sepia.intensity = v;
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
			toggleScanline: ({ state }) => {
				state.scanline.enabled = !state.scanline.enabled;
			},
			setScanlineDensity: ({ state }, v) => {
				state.scanline.density = v;
			},
			setScanlineOpacity: ({ state }, v) => {
				state.scanline.opacity = v;
			},
			toggleShockWave: ({ state }) => {
				state.shockWave.enabled = !state.shockWave.enabled;
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
			toggleGrid: ({ state }) => {
				state.grid.enabled = !state.grid.enabled;
			},
			setGridScale: ({ state }, v) => {
				state.grid.scale = v;
			},
			setGridLineWidth: ({ state }, v) => {
				state.grid.lineWidth = v;
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
			toggleLensDistortion: ({ state }) => {
				state.lensDistortion.enabled = !state.lensDistortion.enabled;
			},
			setLensDistortionX: ({ state }, v) => {
				state.lensDistortion.distortionX = v;
			},
			setLensDistortionY: ({ state }, v) => {
				state.lensDistortion.distortionY = v;
			},
			resetAll: ({ state }) => {
				state.bloom.intensity = 6;
				state.bloom.luminanceThreshold = 0.01;
				state.bloom.luminanceSmoothing = 0.08;
				state.bloom.kernelSize = 4 as KernelSize;
				state.smaa.preset = 2;
				state.fxaa.minEdgeThreshold = 0.05;
				state.fxaa.maxEdgeThreshold = 0.12;
				state.fxaa.subpixelQuality = 0.75;
				state.vignette.offset = 0.2;
				state.vignette.darkness = 0.75;
				state.pixelation.granularity = 4.5;
				state.glitch.delay = 2.5;
				state.glitch.duration = 0.8;
				state.glitch.strength = 0.65;
				state.glitch.ratio = 0.85;
				state.noise.premultiply = true;
				state.noise.blendFunction = 28 as BlendFunction;
				state.chromaticAberration.radialModulation = false;
				state.chromaticAberration.modulationOffset = 0.5;
				state.chromaticAberration.offset = 0.005;
				state.brightnessContrast.brightness = 0;
				state.brightnessContrast.contrast = 0;
				state.hueSaturation.hue = 0;
				state.hueSaturation.saturation = 0;
				state.sepia.intensity = 1;
				state.dotScreen.angle = 1.57;
				state.dotScreen.scale = 1;
				state.scanline.density = 1.5;
				state.scanline.opacity = 0.5;
				state.ascii.cellSize = 16;
				state.ascii.inverted = false;
				state.toneMapping.mode = 11 as ToneMappingMode;
				state.toneMapping.whitePoint = 4.0;
				state.toneMapping.middleGrey = 0.6;
				state.grid.scale = 1.0;
				state.grid.lineWidth = 0.0;
				state.tiltShift.offset = 0.0;
				state.tiltShift.rotation = 0.0;
				state.tiltShift.focusArea = 0.4;
				state.tiltShift.feather = 0.3;
				state.tiltShift.kernelSize = 3 as KernelSize;
				state.lensDistortion.distortionX = 0.0;
				state.lensDistortion.distortionY = 0.0;
				state.lensDistortion.principalX = 0.0;
				state.lensDistortion.principalY = 0.0;
				state.lensDistortion.focalLengthX = 1.0;
				state.lensDistortion.focalLengthY = 1.0;
				state.lensDistortion.skew = 0.0;
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
				<List
					value={ext.state.bloom.kernelSize}
					label="Kernel Size"
					options={kernelSizeOptions}
					on:change={(e) => ext.setBloomKernelSize(e.detail)}
				/>
				<Button
					title="Reset"
					on:click={() => {
						ext.state.bloom.intensity = 6;
						ext.state.bloom.luminanceThreshold = 0.01;
						ext.state.bloom.luminanceSmoothing = 0.08;
						ext.state.bloom.kernelSize = 4 as KernelSize;
					}}
				/>
			{/if}
		</Folder>

		<Folder title="SMAA" expanded={false}>
			<Checkbox value={ext.state.smaa.enabled} label="Enabled" on:change={() => ext.toggleSMAA()} />
			{#if ext.state.smaa.enabled}
				<List
					value={ext.state.smaa.preset}
					label="Preset"
					options={smaaPresetOptions}
					on:change={(e) => ext.setSMAAPreset(e.detail)}
				/>
				<Button
					title="Reset"
					on:click={() => {
						ext.state.smaa.preset = 2;
					}}
				/>
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
					max={1}
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
					max={16}
					step={0.5}
					on:change={(e) => ext.setPixelationGranularity(e.detail.value)}
				/>
				<Button
					title="Reset"
					on:click={() => {
						ext.state.pixelation.granularity = 4.5;
					}}
				/>
			{/if}
		</Folder>

		<Folder title="Glitch" expanded={false}>
			<Checkbox
				value={ext.state.glitch.enabled}
				label="Enabled"
				on:change={() => ext.toggleGlitch()}
			/>
			{#if ext.state.glitch.enabled}
				<Slider
					value={ext.state.glitch.delay}
					label="Delay"
					min={0.5}
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
				<Button
					title="Reset"
					on:click={() => {
						ext.state.glitch.delay = 2.5;
						ext.state.glitch.duration = 0.8;
						ext.state.glitch.strength = 0.65;
						ext.state.glitch.ratio = 0.85;
					}}
				/>
			{/if}
		</Folder>

		<Folder title="Noise" expanded={false}>
			<Checkbox value={ext.state.noise.enabled} label="Enabled" />
			{#if ext.state.noise.enabled}
				<Checkbox value={ext.state.noise.premultiply} label="Premultiply" />
				<List value={ext.state.noise.blendFunction} label="Blend" options={blendFunctionOptions} />
				<Button
					title="Reset"
					on:click={() => {
						ext.state.noise.premultiply = true;
						ext.state.noise.blendFunction = 28 as BlendFunction;
					}}
				/>
			{/if}
		</Folder>

		<Folder title="Chromatic Aberration" expanded={false}>
			<Checkbox value={ext.state.chromaticAberration.enabled} label="Enabled" />
			{#if ext.state.chromaticAberration.enabled}
				<Slider
					value={ext.state.chromaticAberration.offset}
					label="Offset"
					min={0}
					max={0.05}
					step={0.001}
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
				/>
				<Button
					title="Reset"
					on:click={() => {
						ext.state.chromaticAberration.radialModulation = false;
						ext.state.chromaticAberration.modulationOffset = 0.5;
						ext.state.chromaticAberration.offset = 0.005;
					}}
				/>
			{/if}
		</Folder>

		<Folder title="Tone Mapping" expanded={false}>
			<Checkbox value={ext.state.toneMapping.enabled} label="Enabled" />
			{#if ext.state.toneMapping.enabled}
				<List value={ext.state.toneMapping.mode} label="Mode" options={toneMappingOptions} />
				<Slider
					value={ext.state.toneMapping.whitePoint}
					label="White Point"
					min={0.1}
					max={10}
					step={0.1}
				/>
				<Slider
					value={ext.state.toneMapping.middleGrey}
					label="Middle Grey"
					min={0}
					max={2}
					step={0.01}
				/>
				<Button
					title="Reset"
					on:click={() => {
						ext.state.toneMapping.mode = 11 as ToneMappingMode;
						ext.state.toneMapping.whitePoint = 4.0;
						ext.state.toneMapping.middleGrey = 0.6;
					}}
				/>
			{/if}
		</Folder>

		<Folder title="FXAA" expanded={false}>
			<Checkbox value={ext.state.fxaa.enabled} label="Enabled" />
			{#if ext.state.fxaa.enabled}
				<Slider
					value={ext.state.fxaa.minEdgeThreshold}
					label="Min Edge"
					min={0}
					max={1}
					step={0.01}
				/>
				<Slider
					value={ext.state.fxaa.maxEdgeThreshold}
					label="Max Edge"
					min={0}
					max={1}
					step={0.01}
				/>
				<Slider
					value={ext.state.fxaa.subpixelQuality}
					label="Subpixel Quality"
					min={0}
					max={1}
					step={0.01}
				/>
				<Button
					title="Reset"
					on:click={() => {
						ext.state.fxaa.minEdgeThreshold = 0.05;
						ext.state.fxaa.maxEdgeThreshold = 0.12;
						ext.state.fxaa.subpixelQuality = 0.75;
					}}
				/>
			{/if}
		</Folder>

		<Folder title="Grid" expanded={false}>
			<Checkbox value={ext.state.grid.enabled} label="Enabled" />
			{#if ext.state.grid.enabled}
				<Slider value={ext.state.grid.scale} label="Scale" min={0.1} max={10} step={0.1} />
				<Slider value={ext.state.grid.lineWidth} label="Line Width" min={0} max={1} step={0.01} />
				<Button
					title="Reset"
					on:click={() => {
						ext.state.grid.scale = 1.0;
						ext.state.grid.lineWidth = 0.0;
					}}
				/>
			{/if}
		</Folder>

		<Folder title="Tilt Shift" expanded={false}>
			<Checkbox value={ext.state.tiltShift.enabled} label="Enabled" />
			{#if ext.state.tiltShift.enabled}
				<Slider value={ext.state.tiltShift.offset} label="Offset" min={-1} max={1} step={0.01} />
				<Slider
					value={ext.state.tiltShift.rotation}
					label="Rotation"
					min={-3.14}
					max={3.14}
					step={0.01}
				/>
				<Slider
					value={ext.state.tiltShift.focusArea}
					label="Focus Area"
					min={0}
					max={1}
					step={0.01}
				/>
				<Slider value={ext.state.tiltShift.feather} label="Feather" min={0} max={1} step={0.01} />
				<List
					value={ext.state.tiltShift.kernelSize}
					label="Kernel Size"
					options={kernelSizeOptions}
				/>
				<Button
					title="Reset"
					on:click={() => {
						ext.state.tiltShift.offset = 0.0;
						ext.state.tiltShift.rotation = 0.0;
						ext.state.tiltShift.focusArea = 0.4;
						ext.state.tiltShift.feather = 0.3;
						ext.state.tiltShift.kernelSize = 3 as KernelSize;
					}}
				/>
			{/if}
		</Folder>

		<Folder title="Lens Distortion" expanded={false}>
			<Checkbox value={ext.state.lensDistortion.enabled} label="Enabled" />
			{#if ext.state.lensDistortion.enabled}
				<Slider
					value={ext.state.lensDistortion.distortionX}
					label="Distortion X"
					min={-1}
					max={1}
					step={0.01}
				/>
				<Slider
					value={ext.state.lensDistortion.distortionY}
					label="Distortion Y"
					min={-1}
					max={1}
					step={0.01}
				/>
				<Slider
					value={ext.state.lensDistortion.principalX}
					label="Principal X"
					min={-1}
					max={1}
					step={0.01}
				/>
				<Slider
					value={ext.state.lensDistortion.principalY}
					label="Principal Y"
					min={-1}
					max={1}
					step={0.01}
				/>
				<Slider value={ext.state.lensDistortion.skew} label="Skew" min={0} max={1} step={0.01} />
				<Button
					title="Reset"
					on:click={() => {
						ext.state.lensDistortion.distortionX = 0.0;
						ext.state.lensDistortion.distortionY = 0.0;
						ext.state.lensDistortion.principalX = 0.0;
						ext.state.lensDistortion.principalY = 0.0;
						ext.state.lensDistortion.focalLengthX = 1.0;
						ext.state.lensDistortion.focalLengthY = 1.0;
						ext.state.lensDistortion.skew = 0.0;
					}}
				/>
			{/if}
		</Folder>

		<Separator />

		<Button title="Reset All" on:click={ext.resetAll} />
	</DropDownPane>
</ToolbarItem>

<slot />
