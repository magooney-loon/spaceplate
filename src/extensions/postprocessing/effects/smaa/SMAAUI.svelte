<script lang="ts">
	import { Folder, Checkbox, List, Button } from 'svelte-tweakpane-ui';

	export let state: {
		enabled: boolean;
		preset: 0 | 1 | 2 | 3;
		edgeDetectionMode: 0 | 1 | 2;
		predicationMode: 0 | 1 | 2;
	};

	export let actions: Record<string, (...args: any[]) => void>;

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
</script>

<Folder title="SMAA" expanded={false}>
	<Checkbox value={state.enabled} label="Enabled" on:change={() => actions.toggleSMAA()} />
	{#if state.enabled}
		<List
			value={state.preset}
			label="Preset"
			options={smaaPresetOptions}
			on:change={(e) => actions.setSMAAPreset(e.detail.value as 0 | 1 | 2 | 3)}
		/>
		<List
			value={state.edgeDetectionMode}
			label="Edge Detection"
			options={smaaEdgeDetectionOptions}
			on:change={(e) => actions.setSMAEEdgeDetectionMode(e.detail.value as 0 | 1 | 2)}
		/>
		<List
			value={state.predicationMode}
			label="Predication"
			options={smaaPredicationOptions}
			on:change={(e) => actions.setSMAAPredicationMode(e.detail.value as 0 | 1 | 2)}
		/>
		<Button title="Reset" on:click={actions.resetSMAA} />
	{/if}
</Folder>
