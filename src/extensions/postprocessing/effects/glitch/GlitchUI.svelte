<script lang="ts">
	import { Folder, Slider, Checkbox, List, Button } from 'svelte-tweakpane-ui';
	import type { BlendFunction } from 'postprocessing';

	export let state: {
		enabled: boolean;
		delay: number;
		duration: number;
		strength: number;
		ratio: number;
		columns: number;
		mode: 0 | 1 | 2 | 3;
		blendFunction: BlendFunction;
		dtSize: number;
	};

	export let actions: Record<string, (...args: any[]) => void>;

	const glitchModeOptions = [
		{ value: 0, text: 'Disabled' },
		{ value: 1, text: 'Sporadic' },
		{ value: 2, text: 'Constant Mild' },
		{ value: 3, text: 'Constant Wild' }
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

<Folder title="Glitch" expanded={false}>
	<Checkbox value={state.enabled} label="Enabled" on:change={() => actions.toggleGlitch()} />
	{#if state.enabled}
		<List
			value={state.mode}
			label="Mode"
			options={glitchModeOptions}
			on:change={(e) => actions.setGlitchMode(e.detail.value as 0 | 1 | 2 | 3)}
		/>
		<Slider
			value={state.delay}
			label="Delay"
			min={0.1}
			max={10}
			step={0.1}
			on:change={(e) => actions.setGlitchDelay(e.detail.value)}
		/>
		<Slider
			value={state.duration}
			label="Duration"
			min={0.1}
			max={2}
			step={0.1}
			on:change={(e) => actions.setGlitchDuration(e.detail.value)}
		/>
		<Slider
			value={state.strength}
			label="Strength"
			min={0.1}
			max={2}
			step={0.05}
			on:change={(e) => actions.setGlitchStrength(e.detail.value)}
		/>
		<Slider
			value={state.ratio}
			label="Ratio"
			min={0}
			max={1}
			step={0.05}
			on:change={(e) => actions.setGlitchRatio(e.detail.value)}
		/>
		<Slider
			value={state.columns}
			label="Columns"
			min={0.01}
			max={0.5}
			step={0.01}
			on:change={(e) => actions.setGlitchColumns(e.detail.value)}
		/>
		<Slider
			value={state.dtSize}
			label="Noise Map Size"
			min={16}
			max={256}
			step={16}
			on:change={(e) => actions.setGlitchDtSize(e.detail.value)}
		/>
		<List
			value={state.blendFunction}
			label="Blend Function"
			options={blendFunctionOptions}
			on:change={(e) => actions.setGlitchBlendFunction(e.detail.value as BlendFunction)}
		/>
		<Button title="Reset" on:click={actions.resetGlitch} />
	{/if}
</Folder>
