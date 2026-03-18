<script lang="ts">
	import { Folder, Slider, Checkbox, List, Button } from 'svelte-tweakpane-ui';

	export let state: {
		enabled: boolean;
		delay: number;
		duration: number;
		strength: number;
		ratio: number;
		columns: number;
		mode: 0 | 1 | 2 | 3;
	};

	export let actions: Record<string, (...args: any[]) => void>;

	const glitchModeOptions = [
		{ value: 0, text: 'Disabled' },
		{ value: 1, text: 'Sporadic' },
		{ value: 2, text: 'Constant Mild' },
		{ value: 3, text: 'Constant Wild' }
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
		<Button title="Reset" on:click={actions.resetGlitch} />
	{/if}
</Folder>
