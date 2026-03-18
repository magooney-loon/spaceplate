<script lang="ts">
	import { Folder, Slider, Checkbox, Button } from 'svelte-tweakpane-ui';

	export let state: {
		enabled: boolean;
		cellSize: number;
		inverted: boolean;
	};

	export let actions: Record<string, (...args: any[]) => void>;
</script>

<Folder title="ASCII" expanded={false}>
	<Checkbox value={state.enabled} label="Enabled" on:change={() => actions.toggleASCII()} />
	{#if state.enabled}
		<Slider
			value={state.cellSize}
			label="Cell Size"
			min={4}
			max={64}
			step={1}
			on:change={(e) => actions.setASCIICellSize(e.detail.value)}
		/>
		<Checkbox value={state.inverted} label="Inverted" />
		<Button title="Reset" on:click={actions.resetASCII} />
	{/if}
</Folder>
