<script lang="ts">
	import { useStudio, ToolbarItem, DropDownPane } from '@threlte/studio/extend';
	import { Folder, Slider, Checkbox, List, Button, Separator } from 'svelte-tweakpane-ui';
	import { postProcessingState } from '$core/postprocessing.svelte.js';
	import type { KernelSize, BlendFunction } from 'postprocessing';

	const { createExtension } = useStudio();

	createExtension({
		scope: 'postprocessing',
		state() {
			return {};
		},
		actions: {}
	});

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
</script>

<ToolbarItem position="right">
	<DropDownPane icon="mdiImageFilterHdr" title="Post Processing">
		<Folder title="Bloom" expanded={true}>
			<Checkbox bind:value={postProcessingState.bloom.enabled} label="Enabled" />
			{#if postProcessingState.bloom.enabled}
				<Slider
					bind:value={postProcessingState.bloom.intensity}
					label="Intensity"
					min={0}
					max={20}
					step={0.1}
				/>
				<Slider
					bind:value={postProcessingState.bloom.luminanceThreshold}
					label="Threshold"
					min={0}
					max={1}
					step={0.01}
				/>
				<Slider
					bind:value={postProcessingState.bloom.luminanceSmoothing}
					label="Smoothing"
					min={0}
					max={1}
					step={0.01}
				/>
				<List
					bind:value={postProcessingState.bloom.kernelSize}
					label="Kernel Size"
					options={kernelSizeOptions}
				/>
				<Button
					title="Reset"
					on:click={() => {
						postProcessingState.bloom = {
							enabled: true,
							intensity: 6,
							luminanceThreshold: 0.01,
							luminanceSmoothing: 0.08,
							kernelSize: 4 as KernelSize
						};
					}}
				/>
			{/if}
		</Folder>

		<Folder title="SMAA" expanded={false}>
			<Checkbox bind:value={postProcessingState.smaa.enabled} label="Enabled" />
			{#if postProcessingState.smaa.enabled}
				<List
					bind:value={postProcessingState.smaa.preset}
					label="Preset"
					options={smaaPresetOptions}
				/>
				<Button
					title="Reset"
					on:click={() => {
						postProcessingState.smaa = { enabled: true, preset: 2 };
					}}
				/>
			{/if}
		</Folder>

		<Folder title="Vignette" expanded={false}>
			<Checkbox bind:value={postProcessingState.vignette.enabled} label="Enabled" />
			{#if postProcessingState.vignette.enabled}
				<Slider
					bind:value={postProcessingState.vignette.offset}
					label="Offset"
					min={0}
					max={1}
					step={0.01}
				/>
				<Slider
					bind:value={postProcessingState.vignette.darkness}
					label="Darkness"
					min={0}
					max={2}
					step={0.01}
				/>
				<Button
					title="Reset"
					on:click={() => {
						postProcessingState.vignette = { enabled: true, offset: 0.2, darkness: 0.75 };
					}}
				/>
			{/if}
		</Folder>

		<Folder title="Pixelation" expanded={false}>
			<Checkbox bind:value={postProcessingState.pixelation.enabled} label="Enabled" />
			{#if postProcessingState.pixelation.enabled}
				<Slider
					bind:value={postProcessingState.pixelation.granularity}
					label="Granularity"
					min={1}
					max={16}
					step={0.5}
				/>
				<Button
					title="Reset"
					on:click={() => {
						postProcessingState.pixelation = { enabled: false, granularity: 4.5 };
					}}
				/>
			{/if}
		</Folder>

		<Folder title="Glitch" expanded={false}>
			<Checkbox bind:value={postProcessingState.glitch.enabled} label="Enabled" />
			{#if postProcessingState.glitch.enabled}
				<Slider
					bind:value={postProcessingState.glitch.delay}
					label="Delay"
					min={0.5}
					max={10}
					step={0.1}
				/>
				<Slider
					bind:value={postProcessingState.glitch.duration}
					label="Duration"
					min={0.1}
					max={2}
					step={0.1}
				/>
				<Slider
					bind:value={postProcessingState.glitch.strength}
					label="Strength"
					min={0.1}
					max={2}
					step={0.05}
				/>
				<Slider
					bind:value={postProcessingState.glitch.ratio}
					label="Ratio"
					min={0}
					max={1}
					step={0.05}
				/>
				<Button
					title="Reset"
					on:click={() => {
						postProcessingState.glitch = {
							enabled: false,
							delay: 2.5,
							duration: 0.8,
							strength: 0.65,
							ratio: 0.85
						};
					}}
				/>
			{/if}
		</Folder>

		<Folder title="Noise" expanded={false}>
			<Checkbox bind:value={postProcessingState.noise.enabled} label="Enabled" />
			{#if postProcessingState.noise.enabled}
				<Checkbox bind:value={postProcessingState.noise.premultiply} label="Premultiply" />
				<List
					bind:value={postProcessingState.noise.blendFunction}
					label="Blend"
					options={blendFunctionOptions}
				/>
				<Button
					title="Reset"
					on:click={() => {
						postProcessingState.noise = {
							enabled: false,
							premultiply: true,
							blendFunction: 28 as BlendFunction
						};
					}}
				/>
			{/if}
		</Folder>

		<Separator />

		<Button
			title="Reset All"
			on:click={() => {
				postProcessingState.bloom = {
					enabled: true,
					intensity: 6,
					luminanceThreshold: 0.01,
					luminanceSmoothing: 0.08,
					kernelSize: 4 as KernelSize
				};
				postProcessingState.smaa = { enabled: true, preset: 2 };
				postProcessingState.vignette = { enabled: true, offset: 0.2, darkness: 0.75 };
				postProcessingState.pixelation = { enabled: false, granularity: 4.5 };
				postProcessingState.glitch = {
					enabled: false,
					delay: 2.5,
					duration: 0.8,
					strength: 0.65,
					ratio: 0.85
				};
				postProcessingState.noise = {
					enabled: false,
					premultiply: true,
					blendFunction: 28 as BlendFunction
				};
			}}
		/>
	</DropDownPane>
</ToolbarItem>

<slot />
