<script lang="ts">
	import { Folder, Slider, Checkbox, List, Button } from 'svelte-tweakpane-ui';
	import type { BlendFunction } from 'postprocessing';

	export let state: {
		enabled: boolean;
		radialModulation: boolean;
		modulationOffset: number;
		offsetX: number;
		offsetY: number;
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

<Folder title="Chromatic Aberration" expanded={false}>
	<Checkbox
		value={state.enabled}
		label="Enabled"
		on:change={() => actions.toggleChromaticAberration()}
	/>
	{#if state.enabled}
		<Slider
			value={state.offsetX}
			label="Offset X"
			min={0}
			max={0.1}
			step={0.001}
			on:change={(e) => actions.setChromaticAberrationOffsetX(e.detail.value)}
		/>
		<Slider
			value={state.offsetY}
			label="Offset Y"
			min={0}
			max={0.1}
			step={0.001}
			on:change={(e) => actions.setChromaticAberrationOffsetY(e.detail.value)}
		/>
		<Checkbox value={state.radialModulation} label="Radial Modulation" />
		<Slider
			value={state.modulationOffset}
			label="Modulation"
			min={0}
			max={1}
			step={0.01}
			on:change={(e) =>
				actions.setChromaticAberrationModulation(state.radialModulation, e.detail.value)}
		/>
		<List
			value={state.blendFunction}
			label="Blend Function"
			options={blendFunctionOptions}
			on:change={(e) =>
				actions.setChromaticAberrationBlendFunction(e.detail.value as BlendFunction)}
		/>
		<Button title="Reset" on:click={actions.resetChromaticAberration} />
	{/if}
</Folder>
