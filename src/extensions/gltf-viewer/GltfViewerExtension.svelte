<script lang="ts">
	import { useStudio, ToolbarItem, DropDownPane } from '@threlte/studio/extend';
	import { Folder, Slider, Checkbox, Button, Separator } from 'svelte-tweakpane-ui';
	import type { Snippet } from 'svelte';
	import { gltfViewerState, gltfViewerActions } from './gltfViewer.svelte';
	import { extensionScope } from './types';
	import { sceneState } from '$extensions/scene/scene.svelte';

	interface Props {
		children?: Snippet;
	}
	let { children }: Props = $props();

	const { createExtension } = useStudio();
	createExtension({ scope: extensionScope, state: () => ({}), actions: {} });

	let fileInput: HTMLInputElement;
	const triggerFileInput = () => fileInput?.click();

	const handleFileChange = (e: Event) => {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (file) {
			gltfViewerActions.loadFromFile(file);
			(e.target as HTMLInputElement).value = '';
		}
	};

	const loadFromPath = () => {
		const path = prompt('Enter public asset path (e.g. /models/mychar.glb):');
		if (path?.trim()) gltfViewerActions.loadFromPath(path.trim());
	};

	const isInDemoScene = $derived(sceneState.currentScene === 'demoScene');
</script>

<input bind:this={fileInput} type="file" accept=".gltf,.glb" style="display:none" onchange={handleFileChange} />

<ToolbarItem position="left">
	<DropDownPane icon="mdiCubeOutline" title="GLTF Viewer">
		{#if !isInDemoScene}
			<span style="display:block; font-size:11px; color:#ffcc44; background:rgba(255,200,0,0.08); border:1px solid rgba(255,200,0,0.25); border-radius:4px; padding:6px 8px; margin-bottom:4px; line-height:1.6; white-space:normal;">
				⚠️ Models render in <strong>Demo Scene</strong>.<br />Loading will switch automatically.
			</span>
		{/if}

		<Button title="📂 Load from File" on:click={triggerFileInput} />
		<Button title="🔗 Load from Path" on:click={loadFromPath} />

		{#if gltfViewerState.models.length > 0}
			<Separator />

			{#each gltfViewerState.models as model (model.id)}
				<Folder
					title="{model.visible ? '' : '🚫 '}{model.name}"
					expanded={gltfViewerState.selectedId === model.id}
				>
					<Button
						title={gltfViewerState.selectedId === model.id ? '✓ Selected' : '→ Select'}
						on:click={() => gltfViewerActions.selectModel(model.id)}
					/>
					<Button
						title={model.visible ? '👁 Hide' : '👁 Show'}
						on:click={() => gltfViewerActions.setVisible(model.id, !model.visible)}
					/>

					<Separator />

					{#if model.animationClips.length > 0}
						<Folder title="Animations ({model.animationClips.length})" expanded={false}>
							{#each model.animationClips as clip (clip)}
								<Checkbox
									label={clip}
									value={model.activeAnimations.includes(clip)}
									on:change={() => gltfViewerActions.toggleAnimation(model.id, clip)}
								/>
							{/each}
							{#if model.activeAnimations.length > 0}
								<Separator />
								<Button
									title={model.playState === 'playing' ? '⏸ Pause' : '▶ Play'}
									on:click={() => gltfViewerActions.setPlayState(model.id, model.playState === 'playing' ? 'paused' : 'playing')}
								/>
								<Button title="⏹ Stop" on:click={() => gltfViewerActions.setPlayState(model.id, 'stopped')} />
								<Slider label="Speed" value={model.animationSpeed} min={0.1} max={3} step={0.05}
									on:change={(e) => gltfViewerActions.setSpeed(model.id, e.detail.value)} />
								<Slider label="Crossfade" value={model.crossfadeDuration} min={0} max={2} step={0.05}
									on:change={(e) => gltfViewerActions.setCrossfadeDuration(model.id, e.detail.value)} />
								<Checkbox label="Loop" value={model.loop}
									on:change={() => gltfViewerActions.setLoop(model.id, !model.loop)} />
							{/if}
						</Folder>
					{:else}
						<span style="font-size:11px; color:rgba(255,255,255,0.35);">No animations — loading…</span>
					{/if}

					<Separator />
					<Button title="✕ Remove" on:click={() => gltfViewerActions.removeModel(model.id)} />
				</Folder>
			{/each}

			<Separator />
			<Button title="Clear All" on:click={gltfViewerActions.clearAll} />
		{/if}
	</DropDownPane>
</ToolbarItem>

{@render children?.()}
