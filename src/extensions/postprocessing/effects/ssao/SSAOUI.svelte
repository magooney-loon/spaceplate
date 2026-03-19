<script lang="ts">
	import { Folder, Slider, Checkbox, List, Button, Separator } from 'svelte-tweakpane-ui';
	import type { BlendFunction } from 'postprocessing';

	export let state: {
		enabled: boolean;
		samples: number;
		rings: number;
		radius: number;
		intensity: number;
		bias: number;
		fade: number;
		luminanceInfluence: number;
		blendFunction: BlendFunction;
		worldDistanceThreshold: number;
		worldDistanceFalloff: number;
		worldProximityThreshold: number;
		worldProximityFalloff: number;
		minRadiusScale: number;
		color: number;
		depthAwareUpsampling: boolean;
		resolutionScale: number;
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

<Folder title="SSAO" expanded={false}>
	<Checkbox value={state.enabled} label="Enabled" on:change={() => actions.toggleSSAO()} />
	{#if state.enabled}
		<Slider
			value={state.resolutionScale}
			label="Resolution Scale"
			min={0.1}
			max={1}
			step={0.1}
			on:change={(e) => actions.setSSAOResolutionScale(e.detail.value)}
		/>
		<Slider
			value={state.samples}
			label="Samples"
			min={1}
			max={32}
			step={1}
			on:change={(e) => actions.setSSAOSamples(e.detail.value)}
		/>
		<Slider
			value={state.rings}
			label="Rings"
			min={1}
			max={16}
			step={1}
			on:change={(e) => actions.setSSAORings(e.detail.value)}
		/>
		<Slider
			value={state.radius}
			label="Radius"
			min={0}
			max={1}
			step={0.001}
			on:change={(e) => actions.setSSAORadius(e.detail.value)}
		/>
		<Slider
			value={state.intensity}
			label="Intensity"
			min={0}
			max={5}
			step={0.1}
			on:change={(e) => actions.setSSAOIntensity(e.detail.value)}
		/>
		<Slider
			value={state.bias}
			label="Bias"
			min={0}
			max={0.1}
			step={0.001}
			on:change={(e) => actions.setSSAOBias(e.detail.value)}
		/>
		<Slider
			value={state.fade}
			label="Fade"
			min={0}
			max={1}
			step={0.01}
			on:change={(e) => actions.setSSAOFade(e.detail.value)}
		/>
		<Slider
			value={state.luminanceInfluence}
			label="Luminance Influence"
			min={0}
			max={1}
			step={0.01}
			on:change={(e) => actions.setSSAOLuminanceInfluence(e.detail.value)}
		/>
		<Separator />
		<Slider
			value={state.worldDistanceThreshold}
			label="World Distance Threshold"
			min={0}
			max={100}
			step={0.1}
			on:change={(e) => actions.setSSAOWorldDistanceThreshold(e.detail.value)}
		/>
		<Slider
			value={state.worldDistanceFalloff}
			label="World Distance Falloff"
			min={0}
			max={10}
			step={0.01}
			on:change={(e) => actions.setSSAOWorldDistanceFalloff(e.detail.value)}
		/>
		<Slider
			value={state.worldProximityThreshold}
			label="World Proximity Threshold"
			min={0}
			max={0.01}
			step={0.0001}
			on:change={(e) => actions.setSSAOWorldProximityThreshold(e.detail.value)}
		/>
		<Slider
			value={state.worldProximityFalloff}
			label="World Proximity Falloff"
			min={0}
			max={0.01}
			step={0.0001}
			on:change={(e) => actions.setSSAOWorldProximityFalloff(e.detail.value)}
		/>
		<Slider
			value={state.minRadiusScale}
			label="Min Radius Scale"
			min={0}
			max={1}
			step={0.01}
			on:change={(e) => actions.setSSAOMinRadiusScale(e.detail.value)}
		/>
		<Checkbox
			value={state.depthAwareUpsampling}
			label="Depth-Aware Upsampling"
			on:change={(e) => actions.setSSAODepthAwareUpsampling(e.detail.value)}
		/>
		<Slider
			value={state.color}
			label="AO Color"
			min={0}
			max={0xffffff}
			step={1}
			on:change={(e) => actions.setSSAOColor(Math.floor(e.detail.value))}
		/>
		<Separator />
		<List
			value={state.blendFunction}
			label="Blend Function"
			options={blendFunctionOptions}
			on:change={(e) => actions.setSSAOBlendFunction(e.detail.value as BlendFunction)}
		/>
		<Button title="Reset" on:click={actions.resetSSAO} />
	{/if}
</Folder>
