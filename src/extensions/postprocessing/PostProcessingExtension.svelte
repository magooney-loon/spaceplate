<script lang="ts">
	import { useStudio, ToolbarItem, DropDownPane } from '@threlte/studio/extend';
	import { Folder, Slider, Checkbox, List, Button, Separator } from 'svelte-tweakpane-ui';
	import type { KernelSize, BlendFunction, ToneMappingMode } from 'postprocessing';
	import {
		postprocessingState as s,
		postprocessingPresetsState,
		postprocessingActions
	} from '$extensions/postprocessing/postprocessing.svelte';
	import { BUNDLED_PP_PRESETS } from './bundledPresets';

	import type { Snippet } from 'svelte';

	const { createExtension } = useStudio();

	let { children }: { children?: Snippet } = $props();

	const effectNames: Record<string, string> = {
		bloom: 'Bloom',
		smaa: 'SMAA',
		fxaa: 'FXAA',
		vignette: 'Vignette',
		pixelation: 'Pixelation',
		glitch: 'Glitch',
		noise: 'Noise',
		chromaticAberration: 'Chromatic',
		brightnessContrast: 'Brightness',
		hueSaturation: 'Hue/Sat',
		sepia: 'Sepia',
		dotScreen: 'DotScreen',
		scanline: 'Scanline',
		shockWave: 'ShockWave',
		ascii: 'ASCII',
		toneMapping: 'ToneMap',
		grid: 'Grid',
		tiltShift: 'TiltShift',
		lensDistortion: 'LensDist',
		colorDepth: 'ColorDepth',
		depthOfField: 'DOF',
		godRays: 'GodRays',
		ssao: 'SSAO',
		outline: 'Outline',
		depthEffect: 'Depth'
	};

	const getEnabledEffects = (preset: any): string => {
		const enabled = Object.entries(preset.settings)
			.filter(([, val]: [string, any]) => val?.enabled)
			.map(([key]) => effectNames[key] ?? key);
		return enabled.length > 0 ? enabled.join(', ') : 'none';
	};

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
		{ value: 7 as ToneMappingMode, text: 'ACES Filmic' },
		{ value: 8 as ToneMappingMode, text: 'AGX' },
		{ value: 9 as ToneMappingMode, text: 'Neutral' }
	];

	const blendFunctionOptions = [
		{ value: 0 as BlendFunction, text: 'Add' },
		{ value: 1 as BlendFunction, text: 'Alpha' },
		{ value: 2 as BlendFunction, text: 'Average' },
		{ value: 3 as BlendFunction, text: 'Color' },
		{ value: 4 as BlendFunction, text: 'Color Burn' },
		{ value: 5 as BlendFunction, text: 'Color Dodge' },
		{ value: 6 as BlendFunction, text: 'Darken' },
		{ value: 7 as BlendFunction, text: 'Difference' },
		{ value: 8 as BlendFunction, text: 'Divide' },
		{ value: 10 as BlendFunction, text: 'Exclusion' },
		{ value: 11 as BlendFunction, text: 'Hard Light' },
		{ value: 12 as BlendFunction, text: 'Hard Mix' },
		{ value: 13 as BlendFunction, text: 'Hue' },
		{ value: 14 as BlendFunction, text: 'Invert' },
		{ value: 15 as BlendFunction, text: 'Invert RGB' },
		{ value: 16 as BlendFunction, text: 'Lighten' },
		{ value: 17 as BlendFunction, text: 'Linear Burn' },
		{ value: 18 as BlendFunction, text: 'Linear Dodge' },
		{ value: 19 as BlendFunction, text: 'Linear Light' },
		{ value: 20 as BlendFunction, text: 'Luminosity' },
		{ value: 21 as BlendFunction, text: 'Multiply' },
		{ value: 22 as BlendFunction, text: 'Negation' },
		{ value: 23 as BlendFunction, text: 'Normal' },
		{ value: 24 as BlendFunction, text: 'Overlay' },
		{ value: 25 as BlendFunction, text: 'Pin Light' },
		{ value: 26 as BlendFunction, text: 'Reflect' },
		{ value: 27 as BlendFunction, text: 'Saturation' },
		{ value: 28 as BlendFunction, text: 'Screen' },
		{ value: 29 as BlendFunction, text: 'Soft Light' },
		{ value: 31 as BlendFunction, text: 'Subtract' },
		{ value: 32 as BlendFunction, text: 'Vivid Light' }
	];

	createExtension({
		scope: 'postprocessing',
		state: () => ({}),
		actions: {}
	});

	const saveAsPreset = () => {
		const name = prompt('Enter preset name:');
		if (name) {
			const result = postprocessingActions.savePreset(name);
			if (!result.success && result.error) {
				alert(result.error);
			}
		}
	};
</script>

<ToolbarItem position="left">
	<DropDownPane icon="mdiImageFilterHdr" title="Post Processing">
		<Folder title="Saved Presets" expanded={false}>
			{#each postprocessingPresetsState.presets as preset (preset.id)}
				{@const isBundled = BUNDLED_PP_PRESETS.find((b) => b.id === preset.id)}
				<Button
					title="{isBundled ? '📦 ' : ''}▶ {preset.name}"
					on:click={() => postprocessingActions.loadPreset(preset.id)}
				/>
				{#if !isBundled}
					<Button title="✕ Delete" on:click={() => postprocessingActions.deletePreset(preset.id)} />
				{/if}
				<span style="font-size: 10px; color: rgba(255,255,255,0.4); margin-left: 4px;">
					{getEnabledEffects(preset)}
				</span>
			{:else}
				<span style="font-size: 11px; color: rgba(255,255,255,0.4);">No presets saved</span>
			{/each}
			{#if postprocessingPresetsState.presets.length > 0}
				<Separator />
			{/if}
			<Button title="Save Current as Preset" on:click={saveAsPreset} />
		</Folder>

		<Separator />

		<Folder title="Bloom" expanded={false}>
			<Checkbox bind:value={s.bloom.enabled} label="Enabled" />
			{#if s.bloom.enabled}
				<Slider bind:value={s.bloom.intensity} label="Intensity" min={0} max={20} step={0.1} />
				<Slider
					bind:value={s.bloom.luminanceThreshold}
					label="Threshold"
					min={0}
					max={1}
					step={0.01}
				/>
				<Slider
					bind:value={s.bloom.luminanceSmoothing}
					label="Smoothing"
					min={0}
					max={1}
					step={0.01}
				/>
				<Slider bind:value={s.bloom.radius} label="Radius" min={0} max={2} step={0.05} />
				<Slider bind:value={s.bloom.levels} label="Levels" min={1} max={16} step={1} />
				<Slider
					bind:value={s.bloom.resolutionScale}
					label="Resolution Scale"
					min={0.1}
					max={1}
					step={0.1}
				/>
				<List bind:value={s.bloom.kernelSize} label="Kernel Size" options={kernelSizeOptions} />
				<Checkbox bind:value={s.bloom.mipmapBlur} label="Mipmap Blur" />
				<List
					bind:value={s.bloom.blendFunction}
					label="Blend Function"
					options={blendFunctionOptions}
				/>
				<Button title="Reset" on:click={() => postprocessingActions.resetEffect('bloom')} />
			{/if}
		</Folder>

		<Folder title="SMAA" expanded={false}>
			<Checkbox bind:value={s.smaa.enabled} label="Enabled" />
			{#if s.smaa.enabled}
				<List bind:value={s.smaa.preset} label="Preset" options={smaaPresetOptions} />
				<List
					bind:value={s.smaa.edgeDetectionMode}
					label="Edge Detection"
					options={smaaEdgeDetectionOptions}
				/>
				<List
					bind:value={s.smaa.predicationMode}
					label="Predication"
					options={smaaPredicationOptions}
				/>
				<Button title="Reset" on:click={() => postprocessingActions.resetEffect('smaa')} />
			{/if}
		</Folder>

		<Folder title="FXAA" expanded={false}>
			<Checkbox bind:value={s.fxaa.enabled} label="Enabled" />
			{#if s.fxaa.enabled}
				<Slider bind:value={s.fxaa.minEdgeThreshold} label="Min Edge" min={0} max={1} step={0.01} />
				<Slider bind:value={s.fxaa.maxEdgeThreshold} label="Max Edge" min={0} max={1} step={0.01} />
				<Slider
					bind:value={s.fxaa.subpixelQuality}
					label="Subpixel Quality"
					min={0}
					max={1}
					step={0.01}
				/>
				<Button title="Reset" on:click={() => postprocessingActions.resetEffect('fxaa')} />
			{/if}
		</Folder>

		<Folder title="Vignette" expanded={false}>
			<Checkbox bind:value={s.vignette.enabled} label="Enabled" />
			{#if s.vignette.enabled}
				<Slider bind:value={s.vignette.offset} label="Offset" min={0} max={2} step={0.01} />
				<Slider bind:value={s.vignette.darkness} label="Darkness" min={0} max={2} step={0.01} />
				<List
					bind:value={s.vignette.technique}
					label="Technique"
					options={vignetteTechniqueOptions}
				/>
				<Button title="Reset" on:click={() => postprocessingActions.resetEffect('vignette')} />
			{/if}
		</Folder>

		<Folder title="Pixelation" expanded={false}>
			<Checkbox bind:value={s.pixelation.enabled} label="Enabled" />
			{#if s.pixelation.enabled}
				<Slider
					bind:value={s.pixelation.granularity}
					label="Granularity"
					min={1}
					max={100}
					step={1}
				/>
				<Button title="Reset" on:click={() => postprocessingActions.resetEffect('pixelation')} />
			{/if}
		</Folder>

		<Folder title="Glitch" expanded={false}>
			<Checkbox bind:value={s.glitch.enabled} label="Enabled" />
			{#if s.glitch.enabled}
				<List bind:value={s.glitch.mode} label="Mode" options={glitchModeOptions} />
				<Slider bind:value={s.glitch.delay} label="Delay" min={0.1} max={10} step={0.1} />
				<Slider bind:value={s.glitch.duration} label="Duration" min={0.1} max={2} step={0.1} />
				<Slider bind:value={s.glitch.strength} label="Strength" min={0.1} max={2} step={0.05} />
				<Slider bind:value={s.glitch.ratio} label="Ratio" min={0} max={1} step={0.05} />
				<Slider bind:value={s.glitch.columns} label="Columns" min={0.01} max={0.5} step={0.01} />
				<Slider bind:value={s.glitch.dtSize} label="Noise Map Size" min={16} max={256} step={16} />
				<List
					bind:value={s.glitch.blendFunction}
					label="Blend Function"
					options={blendFunctionOptions}
				/>
				<Button title="Reset" on:click={() => postprocessingActions.resetEffect('glitch')} />
			{/if}
		</Folder>

		<Folder title="Noise" expanded={false}>
			<Checkbox bind:value={s.noise.enabled} label="Enabled" />
			{#if s.noise.enabled}
				<Checkbox bind:value={s.noise.premultiply} label="Premultiply" />
				<List
					bind:value={s.noise.blendFunction}
					label="Blend Function"
					options={blendFunctionOptions}
				/>
				<Button title="Reset" on:click={() => postprocessingActions.resetEffect('noise')} />
			{/if}
		</Folder>

		<Folder title="Chromatic Aberration" expanded={false}>
			<Checkbox bind:value={s.chromaticAberration.enabled} label="Enabled" />
			{#if s.chromaticAberration.enabled}
				<Slider
					bind:value={s.chromaticAberration.offsetX}
					label="Offset X"
					min={0}
					max={0.1}
					step={0.001}
				/>
				<Slider
					bind:value={s.chromaticAberration.offsetY}
					label="Offset Y"
					min={0}
					max={0.1}
					step={0.001}
				/>
				<Checkbox bind:value={s.chromaticAberration.radialModulation} label="Radial Modulation" />
				<Slider
					bind:value={s.chromaticAberration.modulationOffset}
					label="Modulation"
					min={0}
					max={1}
					step={0.01}
				/>
				<List
					bind:value={s.chromaticAberration.blendFunction}
					label="Blend Function"
					options={blendFunctionOptions}
				/>
				<Button
					title="Reset"
					on:click={() => postprocessingActions.resetEffect('chromaticAberration')}
				/>
			{/if}
		</Folder>

		<Folder title="Brightness & Contrast" expanded={false}>
			<Checkbox bind:value={s.brightnessContrast.enabled} label="Enabled" />
			{#if s.brightnessContrast.enabled}
				<Slider
					bind:value={s.brightnessContrast.brightness}
					label="Brightness"
					min={-1}
					max={1}
					step={0.01}
				/>
				<Slider
					bind:value={s.brightnessContrast.contrast}
					label="Contrast"
					min={-1}
					max={1}
					step={0.01}
				/>
				<List
					bind:value={s.brightnessContrast.blendFunction}
					label="Blend Function"
					options={blendFunctionOptions}
				/>
				<Button
					title="Reset"
					on:click={() => postprocessingActions.resetEffect('brightnessContrast')}
				/>
			{/if}
		</Folder>

		<Folder title="Hue & Saturation" expanded={false}>
			<Checkbox bind:value={s.hueSaturation.enabled} label="Enabled" />
			{#if s.hueSaturation.enabled}
				<Slider bind:value={s.hueSaturation.hue} label="Hue" min={-3.14} max={3.14} step={0.01} />
				<Slider
					bind:value={s.hueSaturation.saturation}
					label="Saturation"
					min={-1}
					max={1}
					step={0.01}
				/>
				<List
					bind:value={s.hueSaturation.blendFunction}
					label="Blend Function"
					options={blendFunctionOptions}
				/>
				<Button title="Reset" on:click={() => postprocessingActions.resetEffect('hueSaturation')} />
			{/if}
		</Folder>

		<Folder title="Sepia" expanded={false}>
			<Checkbox bind:value={s.sepia.enabled} label="Enabled" />
			{#if s.sepia.enabled}
				<Slider bind:value={s.sepia.intensity} label="Intensity" min={0} max={1} step={0.01} />
				<List
					bind:value={s.sepia.blendFunction}
					label="Blend Function"
					options={blendFunctionOptions}
				/>
				<Button title="Reset" on:click={() => postprocessingActions.resetEffect('sepia')} />
			{/if}
		</Folder>

		<Folder title="Dot Screen" expanded={false}>
			<Checkbox bind:value={s.dotScreen.enabled} label="Enabled" />
			{#if s.dotScreen.enabled}
				<Slider bind:value={s.dotScreen.angle} label="Angle" min={0} max={6.28} step={0.01} />
				<Slider bind:value={s.dotScreen.scale} label="Scale" min={0.1} max={10} step={0.1} />
				<List
					bind:value={s.dotScreen.blendFunction}
					label="Blend Function"
					options={blendFunctionOptions}
				/>
				<Button title="Reset" on:click={() => postprocessingActions.resetEffect('dotScreen')} />
			{/if}
		</Folder>

		<Folder title="Scanline" expanded={false}>
			<Checkbox bind:value={s.scanline.enabled} label="Enabled" />
			{#if s.scanline.enabled}
				<Slider bind:value={s.scanline.density} label="Density" min={0.5} max={5} step={0.1} />
				<Slider bind:value={s.scanline.opacity} label="Opacity" min={0} max={1} step={0.01} />
				<Slider
					bind:value={s.scanline.scrollSpeed}
					label="Scroll Speed"
					min={0}
					max={10}
					step={0.1}
				/>
				<List
					bind:value={s.scanline.blendFunction}
					label="Blend Function"
					options={blendFunctionOptions}
				/>
				<Button title="Reset" on:click={() => postprocessingActions.resetEffect('scanline')} />
			{/if}
		</Folder>

		<Folder title="Shock Wave" expanded={false}>
			<Checkbox bind:value={s.shockWave.enabled} label="Enabled" />
			{#if s.shockWave.enabled}
				<Slider bind:value={s.shockWave.speed} label="Speed" min={0} max={10} step={0.01} />
				<Slider
					bind:value={s.shockWave.maxRadius}
					label="Max Radius"
					min={0}
					max={10}
					step={0.01}
				/>
				<Slider bind:value={s.shockWave.waveSize} label="Wave Size" min={0} max={2} step={0.01} />
				<Slider
					bind:value={s.shockWave.amplitude}
					label="Amplitude"
					min={0}
					max={0.25}
					step={0.001}
				/>
				<Button title="Reset" on:click={() => postprocessingActions.resetEffect('shockWave')} />
			{/if}
		</Folder>

		<Folder title="ASCII" expanded={false}>
			<Checkbox bind:value={s.ascii.enabled} label="Enabled" />
			{#if s.ascii.enabled}
				<Slider bind:value={s.ascii.cellSize} label="Cell Size" min={4} max={64} step={1} />
				<Checkbox bind:value={s.ascii.inverted} label="Inverted" />
				<Button title="Reset" on:click={() => postprocessingActions.resetEffect('ascii')} />
			{/if}
		</Folder>

		<Folder title="Tone Mapping" expanded={false}>
			<Checkbox bind:value={s.toneMapping.enabled} label="Enabled" />
			{#if s.toneMapping.enabled}
				<List bind:value={s.toneMapping.mode} label="Mode" options={toneMappingOptions} />
				<Slider
					bind:value={s.toneMapping.whitePoint}
					label="White Point"
					min={0.1}
					max={16}
					step={0.1}
				/>
				<Slider
					bind:value={s.toneMapping.middleGrey}
					label="Middle Grey"
					min={0}
					max={2}
					step={0.01}
				/>
				<Slider
					bind:value={s.toneMapping.resolution}
					label="Resolution"
					min={64}
					max={1024}
					step={64}
				/>
				<Slider
					bind:value={s.toneMapping.minLuminance}
					label="Min Luminance"
					min={0}
					max={1}
					step={0.01}
				/>
				<Slider
					bind:value={s.toneMapping.averageLuminance}
					label="Average Luminance"
					min={0.1}
					max={10}
					step={0.1}
				/>
				<Slider
					bind:value={s.toneMapping.adaptationRate}
					label="Adaptation Rate"
					min={0.01}
					max={10}
					step={0.01}
				/>
				<List
					bind:value={s.toneMapping.blendFunction}
					label="Blend Function"
					options={blendFunctionOptions}
				/>
				<Button title="Reset" on:click={() => postprocessingActions.resetEffect('toneMapping')} />
			{/if}
		</Folder>

		<Folder title="Grid" expanded={false}>
			<Checkbox bind:value={s.grid.enabled} label="Enabled" />
			{#if s.grid.enabled}
				<Slider bind:value={s.grid.scale} label="Scale" min={0.1} max={10} step={0.1} />
				<Slider bind:value={s.grid.lineWidth} label="Line Width" min={0} max={1} step={0.01} />
				<List
					bind:value={s.grid.blendFunction}
					label="Blend Function"
					options={blendFunctionOptions}
				/>
				<Button title="Reset" on:click={() => postprocessingActions.resetEffect('grid')} />
			{/if}
		</Folder>

		<Folder title="Tilt Shift" expanded={false}>
			<Checkbox bind:value={s.tiltShift.enabled} label="Enabled" />
			{#if s.tiltShift.enabled}
				<Slider bind:value={s.tiltShift.offset} label="Offset" min={-1} max={1} step={0.01} />
				<Slider
					bind:value={s.tiltShift.rotation}
					label="Rotation"
					min={-3.14}
					max={3.14}
					step={0.01}
				/>
				<Slider bind:value={s.tiltShift.focusArea} label="Focus Area" min={0} max={1} step={0.01} />
				<Slider bind:value={s.tiltShift.feather} label="Feather" min={0} max={1} step={0.01} />
				<List bind:value={s.tiltShift.kernelSize} label="Kernel Size" options={kernelSizeOptions} />
				<List
					bind:value={s.tiltShift.blendFunction}
					label="Blend Function"
					options={blendFunctionOptions}
				/>
				<Button title="Reset" on:click={() => postprocessingActions.resetEffect('tiltShift')} />
			{/if}
		</Folder>

		<Folder title="Lens Distortion" expanded={false}>
			<Checkbox bind:value={s.lensDistortion.enabled} label="Enabled" />
			{#if s.lensDistortion.enabled}
				<Slider
					bind:value={s.lensDistortion.distortionX}
					label="Distortion X"
					min={-1}
					max={1}
					step={0.01}
				/>
				<Slider
					bind:value={s.lensDistortion.distortionY}
					label="Distortion Y"
					min={-1}
					max={1}
					step={0.01}
				/>
				<Slider
					bind:value={s.lensDistortion.principalX}
					label="Principal X"
					min={-1}
					max={1}
					step={0.01}
				/>
				<Slider
					bind:value={s.lensDistortion.principalY}
					label="Principal Y"
					min={-1}
					max={1}
					step={0.01}
				/>
				<Slider
					bind:value={s.lensDistortion.focalLengthX}
					label="Focal Length X"
					min={0.1}
					max={5}
					step={0.01}
				/>
				<Slider
					bind:value={s.lensDistortion.focalLengthY}
					label="Focal Length Y"
					min={0.1}
					max={5}
					step={0.01}
				/>
				<Slider bind:value={s.lensDistortion.skew} label="Skew" min={0} max={1} step={0.01} />
				<Button
					title="Reset"
					on:click={() => postprocessingActions.resetEffect('lensDistortion')}
				/>
			{/if}
		</Folder>

		<Folder title="Color Depth" expanded={false}>
			<Checkbox bind:value={s.colorDepth.enabled} label="Enabled" />
			{#if s.colorDepth.enabled}
				<Slider bind:value={s.colorDepth.bits} label="Bits" min={1} max={32} step={1} />
				<List
					bind:value={s.colorDepth.blendFunction}
					label="Blend Function"
					options={blendFunctionOptions}
				/>
				<Button title="Reset" on:click={() => postprocessingActions.resetEffect('colorDepth')} />
			{/if}
		</Folder>

		<Folder title="Depth of Field" expanded={false}>
			<Checkbox bind:value={s.depthOfField.enabled} label="Enabled" />
			{#if s.depthOfField.enabled}
				<Slider
					bind:value={s.depthOfField.focusDistance}
					label="Focus Distance"
					min={0.1}
					max={100}
					step={0.1}
				/>
				<Slider
					bind:value={s.depthOfField.focusRange}
					label="Focus Range"
					min={0.1}
					max={50}
					step={0.1}
				/>
				<Slider
					bind:value={s.depthOfField.bokehScale}
					label="Bokeh Scale"
					min={0.1}
					max={10}
					step={0.1}
				/>
				<Slider
					bind:value={s.depthOfField.resolutionScale}
					label="Resolution Scale"
					min={0.1}
					max={1}
					step={0.1}
				/>
				<List
					bind:value={s.depthOfField.blendFunction}
					label="Blend Function"
					options={blendFunctionOptions}
				/>
				<Button title="Reset" on:click={() => postprocessingActions.resetEffect('depthOfField')} />
			{/if}
		</Folder>

		<Folder title="God Rays" expanded={false}>
			<Checkbox bind:value={s.godRays.enabled} label="Enabled" />
			{#if s.godRays.enabled}
				<Slider bind:value={s.godRays.samples} label="Samples" min={1} max={120} step={1} />
				<Slider bind:value={s.godRays.density} label="Density" min={0} max={1} step={0.01} />
				<Slider bind:value={s.godRays.decay} label="Decay" min={0} max={1} step={0.01} />
				<Slider bind:value={s.godRays.weight} label="Weight" min={0} max={1} step={0.01} />
				<Slider bind:value={s.godRays.exposure} label="Exposure" min={0} max={1} step={0.01} />
				<Slider bind:value={s.godRays.clampMax} label="Clamp Max" min={0.1} max={5} step={0.01} />
				<Checkbox bind:value={s.godRays.blur} label="Blur" />
				<List bind:value={s.godRays.kernelSize} label="Kernel Size" options={kernelSizeOptions} />
				<List
					bind:value={s.godRays.blendFunction}
					label="Blend Function"
					options={blendFunctionOptions}
				/>
				<Slider
					bind:value={s.godRays.resolutionScale}
					label="Resolution Scale"
					min={0.1}
					max={1}
					step={0.1}
				/>
				<Separator />
				<Slider bind:value={s.godRays.sunX} label="Sun X" min={-50} max={50} step={0.1} />
				<Slider bind:value={s.godRays.sunY} label="Sun Y" min={-50} max={50} step={0.1} />
				<Slider bind:value={s.godRays.sunZ} label="Sun Z" min={-50} max={50} step={0.1} />
				<Slider bind:value={s.godRays.sunColor} label="Sun Color" min={0} max={0xffffff} step={1} />
				<Button title="Reset" on:click={() => postprocessingActions.resetEffect('godRays')} />
			{/if}
		</Folder>

		<Folder title="SSAO" expanded={false}>
			<Checkbox bind:value={s.ssao.enabled} label="Enabled" />
			{#if s.ssao.enabled}
				<Slider bind:value={s.ssao.samples} label="Samples" min={1} max={32} step={1} />
				<Slider bind:value={s.ssao.rings} label="Rings" min={1} max={16} step={1} />
				<Slider bind:value={s.ssao.radius} label="Radius" min={0} max={1} step={0.001} />
				<Slider bind:value={s.ssao.intensity} label="Intensity" min={0} max={5} step={0.1} />
				<Slider bind:value={s.ssao.bias} label="Bias" min={0} max={0.1} step={0.001} />
				<Slider bind:value={s.ssao.fade} label="Fade" min={0} max={1} step={0.01} />
				<Slider
					bind:value={s.ssao.luminanceInfluence}
					label="Luminance Influence"
					min={0}
					max={1}
					step={0.01}
				/>
				<List
					bind:value={s.ssao.blendFunction}
					label="Blend Function"
					options={blendFunctionOptions}
				/>
				<Slider
					bind:value={s.ssao.worldDistanceThreshold}
					label="World Distance Threshold"
					min={0}
					max={100}
					step={0.1}
				/>
				<Slider
					bind:value={s.ssao.worldDistanceFalloff}
					label="World Distance Falloff"
					min={0}
					max={10}
					step={0.01}
				/>
				<Slider
					bind:value={s.ssao.worldProximityThreshold}
					label="World Proximity Threshold"
					min={0}
					max={0.01}
					step={0.0001}
				/>
				<Slider
					bind:value={s.ssao.worldProximityFalloff}
					label="World Proximity Falloff"
					min={0}
					max={0.01}
					step={0.0001}
				/>
				<Slider
					bind:value={s.ssao.minRadiusScale}
					label="Min Radius Scale"
					min={0}
					max={1}
					step={0.01}
				/>
				<Checkbox bind:value={s.ssao.depthAwareUpsampling} label="Depth-Aware Upsampling" />
				<Slider bind:value={s.ssao.color} label="AO Color" min={0} max={0xffffff} step={1} />
				<Slider
					bind:value={s.ssao.resolutionScale}
					label="Resolution Scale"
					min={0.1}
					max={1}
					step={0.1}
				/>
				<Button title="Reset" on:click={() => postprocessingActions.resetEffect('ssao')} />
			{/if}
		</Folder>

		<Folder title="Outline" expanded={false}>
			<Checkbox bind:value={s.outline.enabled} label="Enabled" />
			{#if s.outline.enabled}
				<Slider
					bind:value={s.outline.edgeStrength}
					label="Edge Strength"
					min={0}
					max={10}
					step={0.1}
				/>
				<Slider bind:value={s.outline.pulseSpeed} label="Pulse Speed" min={0} max={10} step={0.1} />
				<Checkbox bind:value={s.outline.xRay} label="X-Ray" />
				<Checkbox bind:value={s.outline.blur} label="Blur" />
				<List bind:value={s.outline.kernelSize} label="Kernel Size" options={kernelSizeOptions} />
				<List
					bind:value={s.outline.blendFunction}
					label="Blend Function"
					options={blendFunctionOptions}
				/>
				<Slider
					bind:value={s.outline.patternScale}
					label="Pattern Scale"
					min={0.1}
					max={10}
					step={0.1}
				/>
				<Slider
					bind:value={s.outline.multisampling}
					label="Multisampling"
					min={0}
					max={8}
					step={1}
				/>
				<Slider
					bind:value={s.outline.resolutionScale}
					label="Resolution Scale"
					min={0.1}
					max={1}
					step={0.1}
				/>
				<Button title="Reset" on:click={() => postprocessingActions.resetEffect('outline')} />
			{/if}
		</Folder>

		<Folder title="Depth Effect" expanded={false}>
			<Checkbox bind:value={s.depthEffect.enabled} label="Enabled" />
			{#if s.depthEffect.enabled}
				<Checkbox bind:value={s.depthEffect.inverted} label="Inverted" />
				<List
					bind:value={s.depthEffect.blendFunction}
					label="Blend Function"
					options={blendFunctionOptions}
				/>
				<Button title="Reset" on:click={() => postprocessingActions.resetEffect('depthEffect')} />
			{/if}
		</Folder>
		<Separator />
		<Button title="Reset All" on:click={postprocessingActions.resetAll} />
	</DropDownPane>
</ToolbarItem>

{@render children?.()}
