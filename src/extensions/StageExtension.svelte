<script lang="ts">
	import { useStudio, ToolbarItem, HorizontalButtonGroup, ToolbarButton } from '@threlte/studio/extend';
	import { stageActions, stageState, STAGES } from '../stage.svelte.js';

	const { createExtension } = useStudio();

	createExtension({
		scope: 'stage',
		state() {
			return {};
		},
		actions: {}
	});
</script>

<ToolbarItem position="left">
	<HorizontalButtonGroup>
		{#each STAGES as stage}
			<ToolbarButton
				label={stage.label}
				icon={stage.icon as any}
				onclick={() => stageActions.setStage(stage.id)}
				tooltip="Go to {stage.label} stage"
				active={stageState.currentStage === stage.id}
			/>
		{/each}
	</HorizontalButtonGroup>
</ToolbarItem>

<slot />
