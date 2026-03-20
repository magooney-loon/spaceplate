<script lang="ts">
	import { useStudio, ToolbarItem, DropDownPane } from '@threlte/studio/extend';
	import { Folder, Button, List, Separator } from 'svelte-tweakpane-ui';
	import type { Snippet } from 'svelte';
	import { sceneActions, sceneState, SCENES } from '$extensions/scene/scene.svelte';
	import {
		postprocessingPresetsState,
		postprocessingActions
	} from '$extensions/postprocessing/postprocessing.svelte';
	import { BUNDLED_PP_PRESETS } from '$extensions/postprocessing/bundledPresets';
	import { skyboxPresetsState, skyboxActions } from '$extensions/skybox/skybox.svelte';
	import { BUNDLED_SKYBOX_PRESETS } from '$extensions/skybox/bundledPresets';

	const { createExtension } = useStudio();

	let { children }: { children?: Snippet } = $props();

	createExtension({
		scope: 'scene',
		state() {
			return {};
		},
		actions: {}
	});

	const noneOption = { value: null as string | null, text: '— None —' };

	const presetOptions = $derived([
		noneOption,
		...postprocessingPresetsState.presets.map((p) => ({
			value: p.id as string | null,
			text: p.name
		}))
	]);

	const skyboxPresetOptions = $derived([
		noneOption,
		...skyboxPresetsState.presets.map((p) => ({ value: p.id as string | null, text: p.name }))
	]);

	const currentScene = $derived(SCENES.find((s) => s.id === sceneState.currentScene));

	const copyPPPresetAsCode = (preset: (typeof postprocessingPresetsState.presets)[number]) => {
		const code = `  {\n    id: '${preset.id}',\n    name: '${preset.name}',\n    createdAt: ${preset.createdAt},\n    settings: ${JSON.stringify(preset.settings, null, 4).replace(/\n/g, '\n    ')}\n  }`;
		navigator.clipboard.writeText(code);
	};

	const copySkyboxPresetAsCode = (preset: (typeof skyboxPresetsState.presets)[number]) => {
		const code = `  {\n    id: '${preset.id}',\n    name: '${preset.name}',\n    createdAt: ${preset.createdAt},\n    snapshot: ${JSON.stringify(preset.snapshot, null, 4).replace(/\n/g, '\n    ')}\n  }`;
		navigator.clipboard.writeText(code);
	};
</script>

<ToolbarItem position="left">
	<DropDownPane icon="mdiMap" title="Scenes — {currentScene?.label ?? ''}">
		<Folder title="Global (all scenes)" expanded={true}>
			<List
				label="Post FX"
				options={presetOptions}
				value={postprocessingPresetsState.globalPresetId}
				on:change={(e) => postprocessingActions.setGlobalPreset(e.detail.value as string | null)}
			/>
			<List
				label="Skybox"
				options={skyboxPresetOptions}
				value={skyboxPresetsState.globalPresetId}
				on:change={(e) => skyboxActions.setGlobalPreset(e.detail.value as string | null)}
			/>
		</Folder>
		<Separator />
		{#each SCENES as scene}
			<Folder title={scene.label} expanded={sceneState.currentScene === scene.id}>
				<Button
					title={sceneState.currentScene === scene.id ? '✓ Current scene' : '→ Go to scene'}
					disabled={sceneState.currentScene === scene.id}
					on:click={() => sceneActions.setScene(scene.id)}
				/>
				<List
					label="Post FX"
					options={presetOptions}
					value={postprocessingPresetsState.scenePresets[scene.id] ?? null}
					on:change={(e) =>
						postprocessingActions.setScenePreset(scene.id, e.detail.value as string | null)}
				/>
				<List
					label="Skybox"
					options={skyboxPresetOptions}
					value={skyboxPresetsState.scenePresets[scene.id] ?? null}
					on:change={(e) => skyboxActions.setScenePreset(scene.id, e.detail.value as string | null)}
				/>
			</Folder>
		{/each}
		<Separator />
		<Folder title="Export Presets to Code" expanded={false}>
			<Folder title="Post FX" expanded={true}>
				{#each postprocessingPresetsState.presets as preset (preset.id)}
					{@const isBundled = BUNDLED_PP_PRESETS.find((b) => b.id === preset.id)}
					<Button
						title="{isBundled ? '📦 ' : ''}{preset.name} — Copy"
						on:click={() => copyPPPresetAsCode(preset)}
					/>
				{:else}
					<span style="font-size: 11px; color: rgba(255,255,255,0.4);">No presets saved</span>
				{/each}
			</Folder>
			<Folder title="Skybox" expanded={true}>
				{#each skyboxPresetsState.presets as preset (preset.id)}
					{@const isBundled = BUNDLED_SKYBOX_PRESETS.find((b) => b.id === preset.id)}
					<Button
						title="{isBundled ? '📦 ' : ''}{preset.name} — Copy"
						on:click={() => copySkyboxPresetAsCode(preset)}
					/>
				{:else}
					<span style="font-size: 11px; color: rgba(255,255,255,0.4);">No presets saved</span>
				{/each}
			</Folder>
		</Folder>
	</DropDownPane>
</ToolbarItem>

{@render children?.()}
