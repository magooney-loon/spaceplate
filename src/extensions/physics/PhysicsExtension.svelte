<script lang="ts">
	import { useStudio, ToolbarItem, DropDownPane } from '@threlte/studio/extend';
	import { Folder, Slider, Checkbox, Button, Separator } from 'svelte-tweakpane-ui';
	import { extensionScope } from './types';
	import { physicsState, physicsActions } from './physics.svelte';
	import { sceneState } from '$extensions/scene/scene.svelte';
	import type { Snippet } from 'svelte';

	interface Props {
		children?: Snippet;
	}
	let { children }: Props = $props();

	const { createExtension } = useStudio();
	createExtension({ scope: extensionScope, state: () => ({}), actions: {} });

	const isInDemoScene = $derived(sceneState.currentScene === 'demoScene');
</script>

<ToolbarItem position="left">
	<DropDownPane icon="mdiAtom" title="Physics">
		{#if !isInDemoScene}
			<span
				style="display:block; font-size:11px; color:#ffcc44; background:rgba(255,200,0,0.08); border:1px solid rgba(255,200,0,0.25); border-radius:4px; padding:6px 8px; margin-bottom:4px; line-height:1.6; white-space:normal;"
			>
				⚠️ Physics runs in <strong>Demo Scene</strong>.<br />Spawning will switch automatically.
			</span>
		{/if}
		<Folder title="World" expanded={true}>
			<Slider
				label="Gravity"
				value={physicsState.gravity}
				min={-30}
				max={0}
				step={0.1}
				on:change={(e) => physicsActions.setGravity(e.detail.value)}
			/>
			<Checkbox
				label="Debug Colliders"
				value={physicsState.debug}
				on:change={() => physicsActions.toggleDebug()}
			/>
		</Folder>
		<Separator />
		<Folder title="Spawn ({physicsState.bodies.length} bodies)" expanded={true}>
			<Button title="Spawn Ball" on:click={() => physicsActions.spawnBall()} />
			<Button title="Spawn Box" on:click={() => physicsActions.spawnBox()} />
			<Button title="Clear All" on:click={() => physicsActions.clearBodies()} />
		</Folder>
	</DropDownPane>
</ToolbarItem>

{@render children?.()}
