<script lang="ts">
	import { useStudio, ToolbarItem, DropDownPane } from '@threlte/studio/extend';
	import { Folder, Button } from 'svelte-tweakpane-ui';
	import type { Snippet } from 'svelte';
	import { sceneActions, sceneState, SCENES } from './scene.svelte';

	// Scene switching only. The old preset-assignment UI is gone with the preset layer;
	// its replacement (a declarative `environment` block per scene, edited here and
	// written straight to the committed config by the dev-server endpoint) is planned —
	// see src/extensions/scene/CLAUDE.md.
	const { createExtension } = useStudio();

	let { children }: { children?: Snippet } = $props();

	createExtension({
		scope: 'scene',
		state() {
			return {};
		},
		actions: {}
	});

	const currentScene = $derived(SCENES.find((s) => s.id === sceneState.currentScene));
</script>

<ToolbarItem position="center">
	<DropDownPane icon="mdiMap" title="Scenes — {currentScene?.label ?? ''}">
		{#each SCENES as scene (scene.id)}
			<Folder title={scene.label} expanded={sceneState.currentScene === scene.id}>
				<Button
					title={sceneState.currentScene === scene.id ? '✓ Current scene' : '→ Go to scene'}
					disabled={sceneState.currentScene === scene.id}
					on:click={() => sceneActions.setScene(scene.id)}
				/>
			</Folder>
		{/each}
	</DropDownPane>
</ToolbarItem>

{@render children?.()}
