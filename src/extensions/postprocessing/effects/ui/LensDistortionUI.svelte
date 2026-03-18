<script lang="ts">
	import { Folder, Slider, Checkbox, Button } from 'svelte-tweakpane-ui';

	export let state: {
		enabled: boolean;
		distortionX: number;
		distortionY: number;
		principalX: number;
		principalY: number;
		focalLengthX: number;
		focalLengthY: number;
		skew: number;
	};

	export let actions: Record<string, (...args: any[]) => void>;
</script>

<Folder title="Lens Distortion" expanded={false}>
	<Checkbox
		value={state.enabled}
		label="Enabled"
		on:change={() => actions.toggleLensDistortion()}
	/>
	{#if state.enabled}
		<Slider
			value={state.distortionX}
			label="Distortion X"
			min={-1}
			max={1}
			step={0.01}
			on:change={(e) => actions.setLensDistortionX(e.detail.value)}
		/>
		<Slider
			value={state.distortionY}
			label="Distortion Y"
			min={-1}
			max={1}
			step={0.01}
			on:change={(e) => actions.setLensDistortionY(e.detail.value)}
		/>
		<Slider
			value={state.principalX}
			label="Principal X"
			min={-1}
			max={1}
			step={0.01}
			on:change={(e) => actions.setLensPrincipalX(e.detail.value)}
		/>
		<Slider
			value={state.principalY}
			label="Principal Y"
			min={-1}
			max={1}
			step={0.01}
			on:change={(e) => actions.setLensPrincipalY(e.detail.value)}
		/>
		<Slider
			value={state.focalLengthX}
			label="Focal Length X"
			min={0.1}
			max={5}
			step={0.01}
			on:change={(e) => actions.setLensFocalLengthX(e.detail.value)}
		/>
		<Slider
			value={state.focalLengthY}
			label="Focal Length Y"
			min={0.1}
			max={5}
			step={0.01}
			on:change={(e) => actions.setLensFocalLengthY(e.detail.value)}
		/>
		<Slider
			value={state.skew}
			label="Skew"
			min={0}
			max={1}
			step={0.01}
			on:change={(e) => actions.setLensSkew(e.detail.value)}
		/>
		<Button title="Reset" on:click={actions.resetLensDistortion} />
	{/if}
</Folder>
