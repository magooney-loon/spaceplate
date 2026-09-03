<script lang="ts">
	import { useStudio, ToolbarItem, DropDownPane } from '@threlte/studio/extend';
	import { Folder, Button } from 'svelte-tweakpane-ui';
	import type { Snippet } from 'svelte';
	import { sceneActions, sceneState, SCENES } from './scene.svelte';

	// This panel used to also assign post-processing / skybox presets per scene and
	// globally, warn about effect conflicts between the two, and copy the result to the
	// clipboard for pasting into bundledPresets.ts. All of it is gone: it managed a
	// preset layer that resolved to null for every input and held zero presets.
	//
	// Its replacement is a declarative `environment` block on each SCENES entry, edited
	// here and written straight to the committed config by the dev-server endpoint --
	// no copy-paste step. See DOCS/scene-environment.md §6.
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
