<script lang="ts">
	import { useStudio, ToolbarItem, DropDownPane } from '@threlte/studio/extend';
	import { Folder, Slider, Checkbox, Button, Separator, List } from 'svelte-tweakpane-ui';
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

	// Hidden file input
	let fileInput: HTMLInputElement;

	const triggerFileInput = () => fileInput?.click();

	const handleFileChange = (e: Event) => {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (file) {
			gltfViewerActions.loadFromFile(file);
			// Reset so the same file can be re-selected
			(e.target as HTMLInputElement).value = '';
		}
	};

	const loadFromPath = () => {
		const path = prompt('Enter public asset path (e.g. /models/mychar.glb):');
		if (path?.trim()) gltfViewerActions.loadFromPath(path.trim());
	};

	const isInDemoScene = $derived(sceneState.currentScene === 'demoScene');

	// Per-model helpers — need plain values for on:change handlers
	const getClipOptions = (clips: string[]) => [
		{ value: null as string | null, text: '— None —' },
		...clips.map((c) => ({ value: c as string | null, text: c }))
	];
</script>

<!-- Hidden file input lives outside the tweakpane portal -->
<input
	bind:this={fileInput}
	type="file"
	accept=".gltf,.glb"
	style="display:none"
	onchange={handleFileChange}
/>

<ToolbarItem position="left">
	<DropDownPane icon="mdiCubeOutline" title="GLTF Viewer">
		{#if !isInDemoScene}
			<span
				style="display:block; font-size:11px; color:#ffcc44; background:rgba(255,200,0,0.08); border:1px solid rgba(255,200,0,0.25); border-radius:4px; padding:6px 8px; margin-bottom:4px; line-height:1.6; white-space:normal;"
			>
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

					<Folder title="Transform" expanded={false}>
						<Slider
							label="Pos X"
							value={model.position[0]}
							min={-50}
							max={50}
							step={0.1}
							on:change={(e) =>
								gltfViewerActions.setPosition(
									model.id,
									e.detail.value,
									model.position[1],
									model.position[2]
								)}
						/>
						<Slider
							label="Pos Y"
							value={model.position[1]}
							min={-50}
							max={50}
							step={0.1}
							on:change={(e) =>
								gltfViewerActions.setPosition(
									model.id,
									model.position[0],
									e.detail.value,
									model.position[2]
								)}
						/>
						<Slider
							label="Pos Z"
							value={model.position[2]}
							min={-50}
							max={50}
							step={0.1}
							on:change={(e) =>
								gltfViewerActions.setPosition(
									model.id,
									model.position[0],
									model.position[1],
									e.detail.value
								)}
						/>
						<Separator />
						<Slider
							label="Rot X°"
							value={model.rotation[0]}
							min={-180}
							max={180}
							step={1}
							on:change={(e) =>
								gltfViewerActions.setRotation(
									model.id,
									e.detail.value,
									model.rotation[1],
									model.rotation[2]
								)}
						/>
						<Slider
							label="Rot Y°"
							value={model.rotation[1]}
							min={-180}
							max={180}
							step={1}
							on:change={(e) =>
								gltfViewerActions.setRotation(
									model.id,
									model.rotation[0],
									e.detail.value,
									model.rotation[2]
								)}
						/>
						<Slider
							label="Rot Z°"
							value={model.rotation[2]}
							min={-180}
							max={180}
							step={1}
							on:change={(e) =>
								gltfViewerActions.setRotation(
									model.id,
									model.rotation[0],
									model.rotation[1],
									e.detail.value
								)}
						/>
						<Separator />
						<Slider
							label="Scale"
							value={model.scale}
							min={0.01}
							max={10}
							step={0.01}
							on:change={(e) => gltfViewerActions.setScale(model.id, e.detail.value)}
						/>
						<Button
							title="Reset Transform"
							on:click={() => {
								gltfViewerActions.setPosition(model.id, 0, 0, 0);
								gltfViewerActions.setRotation(model.id, 0, 0, 0);
								gltfViewerActions.setScale(model.id, 1);
							}}
						/>
					</Folder>

					{#if model.animationClips.length > 0}
						<Folder title="Animations ({model.animationClips.length})" expanded={false}>
							<List
								label="Clip"
								options={getClipOptions(model.animationClips)}
								value={model.activeAnimation}
								on:change={(e) => gltfViewerActions.setAnimation(model.id, e.detail.value as string | null)}
							/>
							{#if model.activeAnimation}
								<Button
									title={model.playing ? '⏸ Pause' : '▶ Play'}
									on:click={() => gltfViewerActions.setPlaying(model.id, !model.playing)}
								/>
								<Button
									title="⏹ Stop"
									on:click={() => gltfViewerActions.setPlaying(model.id, false)}
								/>
								<Slider
									label="Speed"
									value={model.animationSpeed}
									min={0.1}
									max={3}
									step={0.05}
									on:change={(e) => gltfViewerActions.setSpeed(model.id, e.detail.value)}
								/>
								<Checkbox
									label="Loop"
									value={model.loop}
									on:change={() => gltfViewerActions.setLoop(model.id, !model.loop)}
								/>
							{/if}
						</Folder>
					{:else}
						<span style="font-size:11px; color:rgba(255,255,255,0.35);">
							No animations — loading…
						</span>
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
