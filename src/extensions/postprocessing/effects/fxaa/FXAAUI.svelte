<script lang="ts">
	import { Folder, Slider, Checkbox, Button } from 'svelte-tweakpane-ui';

	export let state: {
		enabled: boolean;
		minEdgeThreshold: number;
		maxEdgeThreshold: number;
		subpixelQuality: number;
	};

	export let actions: Record<string, (...args: any[]) => void>;
</script>

<Folder title="FXAA" expanded={false}>
	<Checkbox value={state.enabled} label="Enabled" on:change={() => actions.toggleFXAA()} />
	{#if state.enabled}
		<Slider
			value={state.minEdgeThreshold}
			label="Min Edge"
			min={0}
			max={1}
			step={0.01}
			on:change={(e) =>
				actions.setFXAAEdgeThreshold(e.detail.value, state.maxEdgeThreshold, state.subpixelQuality)}
		/>
		<Slider
			value={state.maxEdgeThreshold}
			label="Max Edge"
			min={0}
			max={1}
			step={0.01}
			on:change={(e) =>
				actions.setFXAAEdgeThreshold(state.minEdgeThreshold, e.detail.value, state.subpixelQuality)}
		/>
		<Slider
			value={state.subpixelQuality}
			label="Subpixel Quality"
			min={0}
			max={1}
			step={0.01}
			on:change={(e) =>
				actions.setFXAAEdgeThreshold(
					state.minEdgeThreshold,
					state.maxEdgeThreshold,
					e.detail.value
				)}
		/>
		<Button title="Reset" on:click={actions.resetFXAA} />
	{/if}
</Folder>
