<script lang="ts">
	import { Folder, Slider, Checkbox, Button } from 'svelte-tweakpane-ui';

	export let state: {
		enabled: boolean;
		granularity: number;
	};

	export let actions: Record<string, (...args: any[]) => void>;
</script>

<Folder title="Pixelation" expanded={false}>
	<Checkbox value={state.enabled} label="Enabled" on:change={() => actions.togglePixelation()} />
	{#if state.enabled}
		<Slider
			value={state.granularity}
			label="Granularity"
			min={1}
			max={100}
			step={1}
			on:change={(e) => actions.setPixelationGranularity(e.detail.value)}
		/>
		<Button title="Reset" on:click={actions.resetPixelation} />
	{/if}
</Folder>
