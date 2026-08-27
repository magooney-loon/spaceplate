<script lang="ts">
	import { useStudio, ToolbarItem, DropDownPane } from '@threlte/studio/extend';
	import { Folder, Slider, Checkbox, List, Button, Separator } from 'svelte-tweakpane-ui';
	import {
		postprocessingState as s,
		postprocessingPresetsState,
		postprocessingActions
	} from './postprocessing.svelte';
	import { BUNDLED_PP_PRESETS } from './bundledPresets';
	import { resolveScenePreset, resolveGlobalPreset, sceneState, SCENES } from '$extensions/scene';

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
		ssao: 'AO',
		outline: 'Outline',
		depthEffect: 'Depth'
	};

	const getEnabledEffects = (preset: any): string => {
		const enabled = Object.entries(preset.settings)
			.filter(([, val]: [string, any]) => val?.enabled)
			.map(([key]) => effectNames[key] ?? key);
		return enabled.length > 0 ? enabled.join(', ') : 'none';
	};

	const glitchModeOptions = [
		{ value: 0, text: 'Disabled' },
		{ value: 1, text: 'Sporadic' },
		{ value: 2, text: 'Constant Mild' },
		{ value: 3, text: 'Constant Wild' }
	];

	const toneMappingOptions = [
		{ value: 1, text: 'Linear' },
		{ value: 2, text: 'Reinhard' },
		{ value: 3, text: 'Cineon' },
		{ value: 4, text: 'ACES Filmic' },
		{ value: 6, text: 'AgX' },
		{ value: 7, text: 'Neutral' }
	];

	createExtension({
		scope: 'postprocessing',
		state: () => ({}),
		actions: {}
	});

	// Only remount effect folders when a preset is *loaded* (non-null id), not when reset clears it
	let foldersKey = $state(postprocessingPresetsState.currentPresetId ?? '');
	$effect(() => {
		if (postprocessingPresetsState.currentPresetId !== null) {
			foldersKey = postprocessingPresetsState.currentPresetId;
		}
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

	// Active scene/global preset warning
	const activePPPresetId = $derived(
		resolveScenePreset(sceneState.currentScene, 'postprocessing') ??
			resolveGlobalPreset('postprocessing')
	);
	const activePPPreset = $derived(
		activePPPresetId
			? (postprocessingPresetsState.presets.find((p) => p.id === activePPPresetId) ?? null)
			: null
	);
	const activePPSource = $derived(
		activePPPresetId
			? resolveScenePreset(sceneState.currentScene, 'postprocessing') === activePPPresetId
				? (SCENES.find((s) => s.id === sceneState.currentScene)?.label ?? sceneState.currentScene)
				: 'Global'
			: null
	);

	// Delete guard — block if preset is assigned in Scene Manager
	const deletePPPreset = (presetId: string) => {
		const usages: string[] = [];
		if (resolveGlobalPreset('postprocessing') === presetId) usages.push('Global');
		for (const scene of SCENES) {
			if (resolveScenePreset(scene.id, 'postprocessing') === presetId) usages.push(scene.label);
		}
		if (usages.length > 0) {
			alert(
				`Cannot delete: this preset is assigned in the Scene Manager:\n${usages.map((u) => `  • ${u}`).join('\n')}\n\nRemove it from Scene Manager first.`
			);
			return;
		}
		postprocessingActions.deletePreset(presetId);
	};
</script>

<ToolbarItem position="left">
	<DropDownPane icon="mdiImageFilterHdr" title="Post Processing">
		{#if activePPPreset}
			<span
				style="display:block; font-size:11px; color:#ffcc44; background:rgba(255,200,0,0.08); border:1px solid rgba(255,200,0,0.25); border-radius:4px; padding:6px 8px; margin-bottom:4px; line-height:1.6; word-break:break-word; white-space:normal;"
			>
				⚠️ <strong>{activePPPreset.name}</strong> ({activePPSource}) is active.<br />
				Manual changes are overridden. Clear in <em>Scenes</em> first.
			</span>
		{/if}
		<Folder title="Saved Presets" expanded={false}>
			{#each postprocessingPresetsState.presets as preset (preset.id)}
				{@const isBundled = BUNDLED_PP_PRESETS.find((b) => b.id === preset.id)}
				{@const isActive = postprocessingPresetsState.currentPresetId === preset.id}
				<Button
					title="{isActive ? '✓ ' : ''}{isBundled ? '📦 ' : ''}▶ {preset.name}"
					on:click={() => postprocessingActions.loadPreset(preset.id)}
				/>
				{#if !isBundled}
					<Button title="✕ Delete" on:click={() => deletePPPreset(preset.id)} />
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
			{#if postprocessingPresetsState.currentPresetId && !BUNDLED_PP_PRESETS.find((b) => b.id === postprocessingPresetsState.currentPresetId)}
				<Button
					title="Update Preset"
					on:click={() => {
						const result = postprocessingActions.updatePreset(
							postprocessingPresetsState.currentPresetId!
						);
						if (!result.success && result.error) alert(result.error);
					}}
				/>
				<Separator />
			{/if}
			<Button title="Save Current as Preset" on:click={saveAsPreset} />
		</Folder>

		<Separator />

		{#key foldersKey}
			<Folder title="Bloom" expanded={s.bloom.enabled}>
				<Checkbox bind:value={s.bloom.enabled} label="Enabled" />
				{#if s.bloom.enabled}
					<Slider bind:value={s.bloom.strength} label="Strength" min={0} max={10} step={0.1} />
					<Slider bind:value={s.bloom.radius} label="Radius" min={0} max={1} step={0.01} />
					<Slider bind:value={s.bloom.threshold} label="Threshold" min={0} max={2} step={0.01} />
					<Button title="Reset" on:click={() => postprocessingActions.resetEffect('bloom')} />
				{/if}
			</Folder>

			<Folder title="SMAA" expanded={s.smaa.enabled}>
				<Checkbox bind:value={s.smaa.enabled} label="Enabled" />
			</Folder>

			<Folder title="FXAA" expanded={s.fxaa.enabled}>
				<Checkbox bind:value={s.fxaa.enabled} label="Enabled" />
			</Folder>

			<Folder title="Vignette" expanded={s.vignette.enabled}>
				<Checkbox bind:value={s.vignette.enabled} label="Enabled" />
				{#if s.vignette.enabled}
					<Slider bind:value={s.vignette.intensity} label="Intensity" min={0} max={2} step={0.01} />
					<Slider
						bind:value={s.vignette.smoothness}
						label="Smoothness"
						min={0}
						max={2}
						step={0.01}
					/>
					<Button title="Reset" on:click={() => postprocessingActions.resetEffect('vignette')} />
				{/if}
			</Folder>

			<Folder title="Pixelation" expanded={s.pixelation.enabled}>
				<Checkbox bind:value={s.pixelation.enabled} label="Enabled" />
				{#if s.pixelation.enabled}
					<Slider
						bind:value={s.pixelation.pixelSize}
						label="Pixel Size"
						min={1}
						max={64}
						step={1}
					/>
					<Slider
						bind:value={s.pixelation.normalEdgeStrength}
						label="Normal Edge"
						min={0}
						max={2}
						step={0.01}
					/>
					<Slider
						bind:value={s.pixelation.depthEdgeStrength}
						label="Depth Edge"
						min={0}
						max={2}
						step={0.01}
					/>
					<Button title="Reset" on:click={() => postprocessingActions.resetEffect('pixelation')} />
				{/if}
			</Folder>

			<Folder title="Glitch (not yet wired)" expanded={false}>
				<Checkbox bind:value={s.glitch.enabled} label="Enabled" />
				{#if s.glitch.enabled}
					<List bind:value={s.glitch.mode} label="Mode" options={glitchModeOptions} />
					<Slider bind:value={s.glitch.delay} label="Delay" min={0.1} max={10} step={0.1} />
					<Slider bind:value={s.glitch.duration} label="Duration" min={0.1} max={2} step={0.1} />
					<Slider bind:value={s.glitch.strength} label="Strength" min={0.1} max={2} step={0.05} />
					<Slider bind:value={s.glitch.ratio} label="Ratio" min={0} max={1} step={0.05} />
					<Slider bind:value={s.glitch.columns} label="Columns" min={0.01} max={0.5} step={0.01} />
					<Slider
						bind:value={s.glitch.dtSize}
						label="Noise Map Size"
						min={16}
						max={256}
						step={16}
					/>
					<Button title="Reset" on:click={() => postprocessingActions.resetEffect('glitch')} />
				{/if}
			</Folder>

			<Folder title="Noise" expanded={s.noise.enabled}>
				<Checkbox bind:value={s.noise.enabled} label="Enabled" />
				{#if s.noise.enabled}
					<Slider bind:value={s.noise.intensity} label="Intensity" min={0} max={2} step={0.01} />
					<Button title="Reset" on:click={() => postprocessingActions.resetEffect('noise')} />
				{/if}
			</Folder>

			<Folder title="Chromatic Aberration" expanded={s.chromaticAberration.enabled}>
				<Checkbox bind:value={s.chromaticAberration.enabled} label="Enabled" />
				{#if s.chromaticAberration.enabled}
					<Slider
						bind:value={s.chromaticAberration.strength}
						label="Strength"
						min={0}
						max={3}
						step={0.01}
					/>
					<Slider
						bind:value={s.chromaticAberration.scale}
						label="Scale"
						min={0.1}
						max={3}
						step={0.01}
					/>
					<Button
						title="Reset"
						on:click={() => postprocessingActions.resetEffect('chromaticAberration')}
					/>
				{/if}
			</Folder>

			<Folder title="Brightness & Contrast" expanded={s.brightnessContrast.enabled}>
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
					<Button
						title="Reset"
						on:click={() => postprocessingActions.resetEffect('brightnessContrast')}
					/>
				{/if}
			</Folder>

			<Folder title="Hue & Saturation" expanded={s.hueSaturation.enabled}>
				<Checkbox bind:value={s.hueSaturation.enabled} label="Enabled" />
				{#if s.hueSaturation.enabled}
					<Slider bind:value={s.hueSaturation.hue} label="Hue" min={-3.14} max={3.14} step={0.01} />
					<Slider
						bind:value={s.hueSaturation.saturation}
						label="Saturation"
						min={0}
						max={2}
						step={0.01}
					/>
					<Button
						title="Reset"
						on:click={() => postprocessingActions.resetEffect('hueSaturation')}
					/>
				{/if}
			</Folder>

			<Folder title="Sepia" expanded={s.sepia.enabled}>
				<Checkbox bind:value={s.sepia.enabled} label="Enabled" />
				{#if s.sepia.enabled}
					<Slider bind:value={s.sepia.intensity} label="Intensity" min={0} max={1} step={0.01} />
					<Button title="Reset" on:click={() => postprocessingActions.resetEffect('sepia')} />
				{/if}
			</Folder>

			<Folder title="Dot Screen" expanded={s.dotScreen.enabled}>
				<Checkbox bind:value={s.dotScreen.enabled} label="Enabled" />
				{#if s.dotScreen.enabled}
					<Slider bind:value={s.dotScreen.angle} label="Angle" min={0} max={6.28} step={0.01} />
					<Slider bind:value={s.dotScreen.scale} label="Scale" min={0.1} max={10} step={0.1} />
					<Button title="Reset" on:click={() => postprocessingActions.resetEffect('dotScreen')} />
				{/if}
			</Folder>

			<Folder title="Scanline" expanded={s.scanline.enabled}>
				<Checkbox bind:value={s.scanline.enabled} label="Enabled" />
				{#if s.scanline.enabled}
					<Slider bind:value={s.scanline.intensity} label="Intensity" min={0} max={1} step={0.01} />
					<Slider bind:value={s.scanline.count} label="Line Count" min={10} max={1000} step={10} />
					<Slider
						bind:value={s.scanline.speed}
						label="Scroll Speed"
						min={0}
						max={10}
						step={0.1}
					/>
					<Button title="Reset" on:click={() => postprocessingActions.resetEffect('scanline')} />
				{/if}
			</Folder>

			<Folder title="Shock Wave (not yet wired)" expanded={false}>
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
					<Button title="Explode" on:click={() => postprocessingActions.explodeShockWave()} />
					<Button title="Reset" on:click={() => postprocessingActions.resetEffect('shockWave')} />
				{/if}
			</Folder>

			<Folder title="ASCII (not yet wired)" expanded={false}>
				<Checkbox bind:value={s.ascii.enabled} label="Enabled" />
				{#if s.ascii.enabled}
					<Slider bind:value={s.ascii.cellSize} label="Cell Size" min={4} max={64} step={1} />
					<Checkbox bind:value={s.ascii.inverted} label="Inverted" />
					<Button title="Reset" on:click={() => postprocessingActions.resetEffect('ascii')} />
				{/if}
			</Folder>

			<Folder title="Tone Mapping" expanded={s.toneMapping.enabled}>
				<Checkbox bind:value={s.toneMapping.enabled} label="Enabled" />
				{#if s.toneMapping.enabled}
					<List bind:value={s.toneMapping.mode} label="Mode" options={toneMappingOptions} />
					<Slider
						bind:value={s.toneMapping.exposure}
						label="Exposure"
						min={0.1}
						max={4}
						step={0.01}
					/>
					<Button title="Reset" on:click={() => postprocessingActions.resetEffect('toneMapping')} />
				{/if}
			</Folder>

			<Folder title="Grid" expanded={s.grid.enabled}>
				<Checkbox bind:value={s.grid.enabled} label="Enabled" />
				{#if s.grid.enabled}
					<Slider bind:value={s.grid.scale} label="Scale" min={0.1} max={10} step={0.1} />
					<Slider bind:value={s.grid.lineWidth} label="Line Width" min={0} max={0.5} step={0.01} />
					<Button title="Reset" on:click={() => postprocessingActions.resetEffect('grid')} />
				{/if}
			</Folder>

			<Folder title="Tilt Shift (not yet wired)" expanded={false}>
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
					<Slider
						bind:value={s.tiltShift.focusArea}
						label="Focus Area"
						min={0}
						max={1}
						step={0.01}
					/>
					<Slider bind:value={s.tiltShift.feather} label="Feather" min={0} max={1} step={0.01} />
					<Button title="Reset" on:click={() => postprocessingActions.resetEffect('tiltShift')} />
				{/if}
			</Folder>

			<Folder title="Lens Distortion" expanded={s.lensDistortion.enabled}>
				<Checkbox bind:value={s.lensDistortion.enabled} label="Enabled" />
				{#if s.lensDistortion.enabled}
					<Slider
						bind:value={s.lensDistortion.curvature}
						label="Curvature"
						min={-1}
						max={1}
						step={0.01}
					/>
					<Button
						title="Reset"
						on:click={() => postprocessingActions.resetEffect('lensDistortion')}
					/>
				{/if}
			</Folder>

			<Folder title="Color Depth" expanded={s.colorDepth.enabled}>
				<Checkbox bind:value={s.colorDepth.enabled} label="Enabled" />
				{#if s.colorDepth.enabled}
					<Slider bind:value={s.colorDepth.steps} label="Steps" min={1} max={64} step={1} />
					<Button title="Reset" on:click={() => postprocessingActions.resetEffect('colorDepth')} />
				{/if}
			</Folder>

			<Folder title="Depth of Field" expanded={s.depthOfField.enabled}>
				<Checkbox bind:value={s.depthOfField.enabled} label="Enabled" />
				{#if s.depthOfField.enabled}
					<Slider
						bind:value={s.depthOfField.focusDistance}
						label="Focus Distance"
						min={0}
						max={10}
						step={0.01}
					/>
					<Slider
						bind:value={s.depthOfField.focalLength}
						label="Focal Length"
						min={0}
						max={10}
						step={0.01}
					/>
					<Slider
						bind:value={s.depthOfField.bokehScale}
						label="Bokeh Scale"
						min={0}
						max={10}
						step={0.1}
					/>
					<Button
						title="Reset"
						on:click={() => postprocessingActions.resetEffect('depthOfField')}
					/>
				{/if}
			</Folder>

			<Folder title="God Rays" expanded={s.godRays.enabled}>
				<Checkbox bind:value={s.godRays.enabled} label="Enabled" />
				{#if s.godRays.enabled}
					<Slider bind:value={s.godRays.samples} label="Raymarch Steps" min={1} max={120} step={1} />
					<Slider bind:value={s.godRays.density} label="Density" min={0} max={1} step={0.01} />
					<Slider
						bind:value={s.godRays.maxDensity}
						label="Max Density"
						min={0}
						max={1}
						step={0.01}
					/>
					<Slider
						bind:value={s.godRays.distanceAttenuation}
						label="Distance Attenuation"
						min={0}
						max={10}
						step={0.1}
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
					<Slider
						bind:value={s.godRays.sunColor}
						label="Sun Color"
						min={0}
						max={0xffffff}
						step={1}
					/>
					<Button title="Reset" on:click={() => postprocessingActions.resetEffect('godRays')} />
				{/if}
			</Folder>

			<Folder title="Ambient Occlusion" expanded={s.ssao.enabled}>
				<Checkbox bind:value={s.ssao.enabled} label="Enabled" />
				{#if s.ssao.enabled}
					<Slider bind:value={s.ssao.radius} label="Radius" min={0} max={2} step={0.01} />
					<Slider bind:value={s.ssao.thickness} label="Thickness" min={0} max={5} step={0.01} />
					<Slider bind:value={s.ssao.scale} label="Scale" min={0} max={5} step={0.01} />
					<Slider bind:value={s.ssao.samples} label="Samples" min={1} max={64} step={1} />
					<Button title="Reset" on:click={() => postprocessingActions.resetEffect('ssao')} />
				{/if}
			</Folder>

			<Folder title="Outline" expanded={s.outline.enabled}>
				<Checkbox bind:value={s.outline.enabled} label="Enabled" />
				{#if s.outline.enabled}
					<Slider
						bind:value={s.outline.edgeStrength}
						label="Edge Strength"
						min={0}
						max={10}
						step={0.1}
					/>
					<Slider bind:value={s.outline.edgeGlow} label="Edge Glow" min={0} max={2} step={0.01} />
					<Slider
						bind:value={s.outline.edgeThickness}
						label="Edge Thickness"
						min={0}
						max={5}
						step={0.1}
					/>
					<Slider
						bind:value={s.outline.pulseSpeed}
						label="Pulse Speed"
						min={0}
						max={10}
						step={0.1}
					/>
					<Slider
						bind:value={s.outline.visibleEdgeColor}
						label="Visible Edge Color"
						min={0}
						max={0xffffff}
						step={1}
					/>
					<Slider
						bind:value={s.outline.hiddenEdgeColor}
						label="Hidden Edge Color"
						min={0}
						max={0xffffff}
						step={1}
					/>
					<Button title="Reset" on:click={() => postprocessingActions.resetEffect('outline')} />
				{/if}
			</Folder>

			<Folder title="Depth Effect" expanded={s.depthEffect.enabled}>
				<Checkbox bind:value={s.depthEffect.enabled} label="Enabled" />
				{#if s.depthEffect.enabled}
					<Checkbox bind:value={s.depthEffect.inverted} label="Inverted" />
					<Button title="Reset" on:click={() => postprocessingActions.resetEffect('depthEffect')} />
				{/if}
			</Folder>
		{/key}
		<Separator />
		<Button title="Reset All" on:click={postprocessingActions.resetAll} />
	</DropDownPane>
</ToolbarItem>

{@render children?.()}
