<script lang="ts">
	import { useStudio, ToolbarItem, DropDownPane } from '@threlte/studio/extend';
	import { Folder, Button, List, Separator } from 'svelte-tweakpane-ui';
	import type { Snippet } from 'svelte';
	import {
		sceneActions,
		sceneState,
		scenePresetsOverrides,
		SCENES
	} from '$extensions/scene/scene.svelte';
	import { postprocessingPresetsState, postprocessingActions } from '$extensions/postprocessing/postprocessing.svelte';
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

	// Resolve effective preset ID for a scene: override → SCENES config → null
	const resolvedPPId = (sceneId: string): string | null => {
		const ov = scenePresetsOverrides[sceneId as keyof typeof scenePresetsOverrides];
		if (ov && 'postprocessing' in ov) return ov.postprocessing ?? null;
		return SCENES.find((s) => s.id === sceneId)?.presets?.postprocessing ?? null;
	};

	const resolvedSkyboxId = (sceneId: string): string | null => {
		const ov = scenePresetsOverrides[sceneId as keyof typeof scenePresetsOverrides];
		if (ov && 'skybox' in ov) return ov.skybox ?? null;
		return SCENES.find((s) => s.id === sceneId)?.presets?.skybox ?? null;
	};

	const copyPPPresetAsCode = (preset: (typeof postprocessingPresetsState.presets)[number]) => {
		const code = `  {\n    id: '${preset.id}',\n    name: '${preset.name}',\n    createdAt: ${preset.createdAt},\n    settings: ${JSON.stringify(preset.settings, null, 4).replace(/\n/g, '\n    ')}\n  }`;
		navigator.clipboard.writeText(code);
		alert(`"${preset.name}" copied! Paste into BUNDLED_PP_PRESETS in bundledPresets.ts.`);
	};

	const copySkyboxPresetAsCode = (preset: (typeof skyboxPresetsState.presets)[number]) => {
		const code = `  {\n    id: '${preset.id}',\n    name: '${preset.name}',\n    createdAt: ${preset.createdAt},\n    snapshot: ${JSON.stringify(preset.snapshot, null, 4).replace(/\n/g, '\n    ')}\n  }`;
		navigator.clipboard.writeText(code);
		alert(`"${preset.name}" copied! Paste into BUNDLED_SKYBOX_PRESETS in bundledPresets.ts.`);
	};

	const buildSceneEntry = (scene: (typeof SCENES)[number]): string => {
		const ppId = resolvedPPId(scene.id);
		const skyId = resolvedSkyboxId(scene.id);
		const ppName = ppId ? (postprocessingPresetsState.presets.find((p) => p.id === ppId)?.name ?? ppId) : 'none';
		const skyName = skyId ? (skyboxPresetsState.presets.find((p) => p.id === skyId)?.name ?? skyId) : 'none';
		const presetsLine =
			ppId || skyId
				? `,\n\t\tpresets: {${ppId ? `\n\t\t\tpostprocessing: '${ppId}', // ${ppName}` : ''}${skyId ? `\n\t\t\tskybox: '${skyId}', // ${skyName}` : ''}\n\t\t}`
				: '';
		return `\t{\n\t\tid: '${scene.id}',\n\t\tlabel: '${scene.label}',\n\t\ticon: '${scene.icon}'${presetsLine}\n\t}`;
	};

	const copySceneEntry = (scene: (typeof SCENES)[number]) => {
		navigator.clipboard.writeText(buildSceneEntry(scene));
		alert(`"${scene.label}" config copied! Paste into SCENES in scene.svelte.ts.`);
	};

	const copyAllSceneAssignments = () => {
		const code = `export const SCENES: SceneConfig[] = [\n${SCENES.map(buildSceneEntry).join(',\n')}\n];`;
		navigator.clipboard.writeText(code);
		alert('All scene assignments copied! Paste into scene.svelte.ts.');
	};

	const copyGlobalAssignments = () => {
		const ppId = postprocessingPresetsState.globalPresetId;
		const skyId = skyboxPresetsState.globalPresetId;
		const ppName = ppId ? (postprocessingPresetsState.presets.find((p) => p.id === ppId)?.name ?? ppId) : 'none';
		const skyName = skyId ? (skyboxPresetsState.presets.find((p) => p.id === skyId)?.name ?? skyId) : 'none';
		const lines = [
			ppId ? `postprocessingActions.setGlobalPreset('${ppId}'); // ${ppName}` : null,
			skyId ? `skyboxActions.setGlobalPreset('${skyId}'); // ${skyName}` : null
		].filter(Boolean).join('\n');
		navigator.clipboard.writeText(lines || '// No global presets assigned');
		alert('Global assignments copied!');
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
			<Button title="Copy Global Assignments" on:click={copyGlobalAssignments} />
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
					value={resolvedPPId(scene.id)}
					on:change={(e) =>
						sceneActions.setScenePreset(scene.id, 'postprocessing', e.detail.value as string | null)}
				/>
				<List
					label="Skybox"
					options={skyboxPresetOptions}
					value={resolvedSkyboxId(scene.id)}
					on:change={(e) =>
						sceneActions.setScenePreset(scene.id, 'skybox', e.detail.value as string | null)}
				/>
				<Button title="Copy Scene Config" on:click={() => copySceneEntry(scene)} />
			</Folder>
		{/each}
		<Separator />
		<Button title="Copy All Scene Assignments" on:click={copyAllSceneAssignments} />
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
