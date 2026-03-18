<script lang="ts">
	import { Folder, Slider, Checkbox, List, Button } from 'svelte-tweakpane-ui';
	import type { BlendFunction } from 'postprocessing';

	export let state: {
		enabled: boolean;
		angle: number;
		scale: number;
		blendFunction: BlendFunction;
	};

	export let actions: Record<string, (...args: any[]) => void>;

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

<Folder title="Dot Screen" expanded={false}>
	<Checkbox value={state.enabled} label="Enabled" on:change={() => actions.toggleDotScreen()} />
	{#if state.enabled}
		<Slider
			value={state.angle}
			label="Angle"
			min={0}
			max={6.28}
			step={0.01}
			on:change={(e) => actions.setDotScreenAngle(e.detail.value)}
		/>
		<Slider
			value={state.scale}
			label="Scale"
			min={0.1}
			max={10}
			step={0.1}
			on:change={(e) => actions.setDotScreenScale(e.detail.value)}
		/>
		<List
			value={state.blendFunction}
			label="Blend Function"
			options={blendFunctionOptions}
			on:change={(e) => actions.setDotScreenBlendFunction(e.detail.value as BlendFunction)}
		/>
		<Button title="Reset" on:click={actions.resetDotScreen} />
	{/if}
</Folder>
