<script lang="ts">
	import { Folder, Slider, Checkbox, List, Button } from 'svelte-tweakpane-ui';

	export let state: {
		enabled: boolean;
		offset: number;
		darkness: number;
		technique: 0 | 1;
	};

	export let actions: Record<string, (...args: any[]) => void>;

	const vignetteTechniqueOptions = [
		{ value: 0, text: 'Default' },
		{ value: 1, text: 'Eskil' }
	];
</script>

<Folder title="Vignette" expanded={false}>
	<Checkbox value={state.enabled} label="Enabled" on:change={() => actions.toggleVignette()} />
	{#if state.enabled}
		<Slider
			value={state.offset}
			label="Offset"
			min={0}
			max={2}
			step={0.01}
			on:change={(e) => actions.setVignetteOffset(e.detail.value)}
		/>
		<Slider
			value={state.darkness}
			label="Darkness"
			min={0}
			max={2}
			step={0.01}
			on:change={(e) => actions.setVignetteDarkness(e.detail.value)}
		/>
		<List
			value={state.technique}
			label="Technique"
			options={vignetteTechniqueOptions}
			on:change={(e) => actions.setVignetteTechnique(e.detail.value as 0 | 1)}
		/>
		<Button title="Reset" on:click={actions.resetVignette} />
	{/if}
</Folder>
