<script lang="ts">
	import { useStudio, ToolbarItem, DropDownPane } from '@threlte/studio/extend';
	import { Folder, Slider, Checkbox, Button, Separator } from 'svelte-tweakpane-ui';
	import { skyboxState, skyboxActions, SKY_PRESETS } from '$extensions/skybox/skybox.svelte';

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
</script>

<ToolbarItem position="left">
	<DropDownPane icon="mdiWeatherSunny" title="Sky">
		<Folder title="Presets" expanded={true}>
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

<slot />
