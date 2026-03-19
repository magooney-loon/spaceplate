<script lang="ts">
	import {
		useStudio,
		ToolbarItem,
		HorizontalButtonGroup,
		ToolbarButton
	} from '@threlte/studio/extend';
	import { sceneActions, sceneState, SCENES } from '$core/SceneManager.svelte.ts';

	const { createExtension } = useStudio();

	createExtension({
		scope: 'scene-manager',
		state() {
			return {};
		},
		actions: {}
	});
</script>

<ToolbarItem position="left">
	<HorizontalButtonGroup>
		{#each SCENES as scene}
			<ToolbarButton
				label={scene.label}
				icon={scene.icon as any}
				onclick={() => sceneActions.setScene(scene.id)}
				tooltip="Go to {scene.label}"
				active={sceneState.currentScene === scene.id}
			/>
		{/each}
	</HorizontalButtonGroup>
</ToolbarItem>

<slot />
