<script lang="ts">
	import { useStudio, ToolbarItem, DropDownPane } from '@threlte/studio/extend';
	import { Folder, Slider, Checkbox, Button, Separator } from 'svelte-tweakpane-ui';
	import type { Snippet } from 'svelte';
	import {
		skyboxState,
		starsState,
		transitionState,
		skyboxActions,
		SKY_PRESETS,
		STAR_PRESETS,
		TRANSITION_DURATIONS
	} from '$extensions/skybox/skybox.svelte';

	interface Props {
		children?: Snippet;
	}

	let { children }: Props = $props();

	const { createExtension } = useStudio();

	createExtension({
		scope: 'skybox',
		state: () => ({}),
		actions: {}
	});

	const presetCategories = {
		daytime: ['dawn', 'day', 'dusk'],
		nighttime: ['night', 'aurora'],
		atmosphere: ['sunset', 'sunrise', 'cloudy', 'overcast'],
		special: ['vacuum']
	};

	const presetCategoryNames: Record<string, string> = {
		daytime: 'Daytime',
		nighttime: 'Nighttime',
		atmosphere: 'Atmosphere',
		special: 'Special'
	};

	const starPresetCategories = {
		density: ['dense', 'sparse', 'milkyway'],
		effects: ['twinkle', 'nebula']
	};

	const starPresetCategoryNames: Record<string, string> = {
		density: 'Density',
		effects: 'Effects'
	};

	const isDurationSelected = (value: number) => transitionState.transitionDuration === value;
</script>

<ToolbarItem position="left">
	<DropDownPane icon="mdiWeatherSunny" title="Sky">
		<Folder title="Sky Presets" expanded={true}>
			{#each Object.entries(presetCategories) as [category, presetIds]}
				<Folder title={presetCategoryNames[category]} expanded={false}>
					{#each presetIds as presetId}
						{@const preset = SKY_PRESETS[presetId]}
						{#if preset}
							<Button title={preset.name} on:click={() => skyboxActions.applyPreset(presetId)} />
						{/if}
					{/each}
				</Folder>
			{/each}
		</Folder>

		<Separator />

		<Folder title="Transition" expanded={false}>
			{#each TRANSITION_DURATIONS as opt}
				<Button
					title={isDurationSelected(opt.value) ? `✓ ${opt.text}` : opt.text}
					on:click={() => skyboxActions.setTransitionDuration(opt.value)}
				/>
			{/each}
			{#if transitionState.isTransitioning}
				<span style="font-size: 10px; color: #56b6c2; margin-top: 4px;">
					Transitioning... {Math.round(transitionState.progress * 100)}%
				</span>
			{/if}
		</Folder>

		<Separator />

		<Folder title="Star Presets" expanded={false}>
			{#each Object.entries(starPresetCategories) as [category, presetIds]}
				<Folder title={starPresetCategoryNames[category]} expanded={false}>
					{#each presetIds as presetId}
						{@const preset = STAR_PRESETS[presetId]}
						{#if preset}
							<Button
								title={preset.name}
								on:click={() => skyboxActions.applyStarPreset(presetId)}
							/>
						{/if}
					{/each}
				</Folder>
			{/each}
		</Folder>

		<Folder title="Stars" expanded={false}>
			<Checkbox bind:value={starsState.enabled} label="Enabled" />
			{#if starsState.enabled}
				<Slider bind:value={starsState.count} label="Count" min={0} max={15000} step={100} />
				<Slider bind:value={starsState.speed} label="Twinkle Speed" min={0} max={3} step={0.1} />
				<Slider bind:value={starsState.lightness} label="Lightness" min={0} max={1} step={0.05} />
				<Slider bind:value={starsState.opacity} label="Opacity" min={0} max={1} step={0.05} />
				<Slider bind:value={starsState.saturation} label="Saturation" min={0} max={1} step={0.05} />
				<Checkbox bind:value={starsState.fade} label="Fade" />
				<Slider bind:value={starsState.factor} label="Factor" min={1} max={10} step={0.5} />
				<Slider bind:value={starsState.depth} label="Depth" min={10} max={100} step={5} />
			{/if}
		</Folder>

		<Separator />

		<Folder title="Sun Position" expanded={false}>
			<Slider bind:value={skyboxState.azimuth} label="Azimuth" min={-180} max={180} step={1} />
			<Slider bind:value={skyboxState.elevation} label="Elevation" min={-5} max={90} step={1} />
		</Folder>

		<Folder title="Atmosphere" expanded={false}>
			<Slider bind:value={skyboxState.turbidity} label="Turbidity" min={0} max={20} step={0.1} />
			<Slider bind:value={skyboxState.rayleigh} label="Rayleigh" min={0} max={4} step={0.1} />
		</Folder>

		<Folder title="Scattering" expanded={false}>
			<Slider
				bind:value={skyboxState.mieCoefficient}
				label="Mie Coefficient"
				min={0}
				max={0.1}
				step={0.001}
			/>
			<Slider
				bind:value={skyboxState.mieDirectionalG}
				label="Mie Directional G"
				min={0}
				max={1}
				step={0.01}
			/>
		</Folder>

		<Folder title="Rendering" expanded={false}>
			<Slider bind:value={skyboxState.exposure} label="Exposure" min={0} max={2} step={0.05} />
			<Checkbox bind:value={skyboxState.setEnvironment} label="Set Environment" />
		</Folder>

		<Separator />

		<Button title="Reset to Default" on:click={skyboxActions.reset} />
	</DropDownPane>
</ToolbarItem>

{@render children?.()}
