<script lang="ts">
	import { Folder, Slider, Checkbox, List, Button } from 'svelte-tweakpane-ui';
	import type { KernelSize, BlendFunction } from 'postprocessing';

	export let state: {
		enabled: boolean;
		intensity: number;
		luminanceThreshold: number;
		luminanceSmoothing: number;
		kernelSize: KernelSize;
		blendFunction: BlendFunction;
		mipmapBlur: boolean;
		radius: number;
		levels: number;
	};

	export let actions: Record<string, (...args: any[]) => void>;

	const kernelSizeOptions = [
		{ value: 0 as KernelSize, text: 'Very Small' },
		{ value: 1 as KernelSize, text: 'Small' },
		{ value: 2 as KernelSize, text: 'Medium' },
		{ value: 3 as KernelSize, text: 'Large' },
		{ value: 4 as KernelSize, text: 'Very Large' },
		{ value: 5 as KernelSize, text: 'Huge' }
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

<Folder title="Bloom" expanded={true}>
	<Checkbox value={state.enabled} label="Enabled" on:change={() => actions.toggleBloom()} />
	{#if state.enabled}
		<Slider
			value={state.intensity}
			label="Intensity"
			min={0}
			max={20}
			step={0.1}
			on:change={(e) => actions.setBloomIntensity(e.detail.value)}
		/>
		<Slider
			value={state.luminanceThreshold}
			label="Threshold"
			min={0}
			max={1}
			step={0.01}
			on:change={(e) => actions.setBloomThreshold(e.detail.value)}
		/>
		<Slider
			value={state.luminanceSmoothing}
			label="Smoothing"
			min={0}
			max={1}
			step={0.01}
			on:change={(e) => actions.setBloomSmoothing(e.detail.value)}
		/>
		<Slider
			value={state.radius}
			label="Radius"
			min={0}
			max={2}
			step={0.05}
			on:change={(e) => actions.setBloomRadius(e.detail.value)}
		/>
		<Slider
			value={state.levels}
			label="Levels"
			min={1}
			max={16}
			step={1}
			on:change={(e) => actions.setBloomLevels(e.detail.value)}
		/>
		<List
			value={state.kernelSize}
			label="Kernel Size"
			options={kernelSizeOptions}
			on:change={(e) => actions.setBloomKernelSize(e.detail.value as KernelSize)}
		/>
		<Checkbox value={state.mipmapBlur} label="Mipmap Blur" />
		<List
			value={state.blendFunction}
			label="Blend Function"
			options={blendFunctionOptions}
			on:change={(e) => actions.setBloomBlendFunction(e.detail.value as BlendFunction)}
		/>
		<Button title="Reset" on:click={actions.resetBloom} />
	{/if}
</Folder>
