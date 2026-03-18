<script lang="ts">
	import { Folder, Slider, Checkbox, Button } from 'svelte-tweakpane-ui';

	export let state: {
		enabled: boolean;
		speed: number;
		maxRadius: number;
		waveSize: number;
		amplitude: number;
		epicenterX: number;
		epicenterY: number;
		epicenterZ: number;
		triggered: boolean;
	};

	export let actions: Record<string, (...args: any[]) => void>;
</script>

<Folder title="Shock Wave" expanded={false}>
	<Checkbox value={state.enabled} label="Enabled" on:change={() => actions.toggleShockWave()} />
	{#if state.enabled}
		<Slider
			value={state.speed}
			label="Speed"
			min={0}
			max={10}
			step={0.01}
			on:change={(e) => actions.setShockWaveSpeed(e.detail.value)}
		/>
		<Slider
			value={state.maxRadius}
			label="Max Radius"
			min={0}
			max={10}
			step={0.01}
			on:change={(e) => actions.setShockWaveMaxRadius(e.detail.value)}
		/>
		<Slider
			value={state.waveSize}
			label="Wave Size"
			min={0}
			max={2}
			step={0.01}
			on:change={(e) => actions.setShockWaveWaveSize(e.detail.value)}
		/>
		<Slider
			value={state.amplitude}
			label="Amplitude"
			min={0}
			max={0.25}
			step={0.001}
			on:change={(e) => actions.setShockWaveAmplitude(e.detail.value)}
		/>
		<Button title="Explode!" on:click={() => actions.triggerShockWave()} />
		<Button title="Reset" on:click={actions.resetShockWave} />
	{/if}
</Folder>
