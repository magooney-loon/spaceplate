<script lang="ts">
	import { useStudio, ToolbarItem, DropDownPane } from '@threlte/studio/extend';
	import { Folder, Button, List, Separator } from 'svelte-tweakpane-ui';
	import type { Snippet } from 'svelte';
	import {
		sceneActions,
		sceneState,
		SCENES,
		resolveScenePreset,
		resolveGlobalPreset
	} from '$extensions/scene/scene.svelte';
	import { postprocessingPresetsState } from '$extensions/postprocessing/postprocessing.svelte';
	import { BUNDLED_PP_PRESETS } from '$extensions/postprocessing/bundledPresets';
	import { skyboxPresetsState } from '$extensions/skybox/skybox.svelte';
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

	// Resolved global IDs (reactive — reads $state via plain function)
	const resolvedGlobalPP = $derived(resolveGlobalPreset('postprocessing'));
	const resolvedGlobalSky = $derived(resolveGlobalPreset('skybox'));

	// Check which PP effects conflict between a scene preset and the global preset
	const getPPConflicts = (
		scenePresetId: string | null,
		globalPresetId: string | null
	): string[] => {
		if (!scenePresetId || !globalPresetId || scenePresetId === globalPresetId) return [];
		const scenePr = postprocessingPresetsState.presets.find((p) => p.id === scenePresetId);
		const globalPr = postprocessingPresetsState.presets.find((p) => p.id === globalPresetId);
		if (!scenePr || !globalPr) return [];
		return Object.keys(scenePr.settings).filter(
			(k) => (scenePr.settings as any)[k]?.enabled && (globalPr.settings as any)[k]?.enabled
		);
	};

	const warnIfPPConflict = (sceneId: string, newScenePresetId: string | null) => {
		const conflicts = getPPConflicts(newScenePresetId, resolvedGlobalPP);
		if (conflicts.length > 0) {
			const sceneName = SCENES.find((s) => s.id === sceneId)?.label ?? sceneId;
			const globalName =
				postprocessingPresetsState.presets.find((p) => p.id === resolvedGlobalPP)?.name ?? 'global';
			alert(
				`⚠️ Conflict in "${sceneName}":\n\nBoth "${globalName}" (global) and the scene preset enable:\n${conflicts.map((k) => `  • ${k}`).join('\n')}\n\nScene preset wins, but this is likely unintentional. Remove the conflicting effect from one of the two presets.`
			);
		}
	};

	const warnIfGlobalPPConflict = (newGlobalPresetId: string | null) => {
		const allConflicts: string[] = [];
		for (const scene of SCENES) {
			const sceneId = resolveScenePreset(scene.id, 'postprocessing');
			const conflicts = getPPConflicts(sceneId, newGlobalPresetId);
			if (conflicts.length > 0) {
				allConflicts.push(`  ${scene.label}: ${conflicts.join(', ')}`);
			}
		}
		if (allConflicts.length > 0) {
			alert(
				`⚠️ Global preset conflicts with existing scene presets:\n\n${allConflicts.join('\n')}\n\nScene presets win on conflict, but consider removing the overlapping effects.`
			);
		}
	};

	// --- Copy helpers ---

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
		const ppId = resolveScenePreset(scene.id, 'postprocessing');
		const skyId = resolveScenePreset(scene.id, 'skybox');
		const ppName = ppId
			? (postprocessingPresetsState.presets.find((p) => p.id === ppId)?.name ?? ppId)
			: 'none';
		const skyName = skyId
			? (skyboxPresetsState.presets.find((p) => p.id === skyId)?.name ?? skyId)
			: 'none';
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
		const ppId = resolvedGlobalPP;
		const skyId = resolvedGlobalSky;
		const ppName = ppId
			? (postprocessingPresetsState.presets.find((p) => p.id === ppId)?.name ?? ppId)
			: 'none';
		const skyName = skyId
			? (skyboxPresetsState.presets.find((p) => p.id === skyId)?.name ?? skyId)
			: 'none';
		const lines = [
			ppId ? `\tpostprocessing: '${ppId}', // ${ppName}` : null,
			skyId ? `\tskybox: '${skyId}', // ${skyName}` : null
		]
			.filter(Boolean)
			.join('\n');
		const code = `export const GLOBAL_PRESETS: ScenePresets = {\n${lines || '\t// No global presets assigned'}\n};`;
		navigator.clipboard.writeText(code);
		alert('Global presets copied! Paste into GLOBAL_PRESETS in scene.svelte.ts.');
	};
</script>

<ToolbarItem position="left">
	<DropDownPane icon="mdiMap" title="Scenes — {currentScene?.label ?? ''}">
		<Folder title="Global (all scenes)" expanded={true}>
			<List
				label="Post FX"
				options={presetOptions}
				value={resolvedGlobalPP}
				on:change={(e) => {
					const newId = e.detail.value as string | null;
					warnIfGlobalPPConflict(newId);
					sceneActions.setGlobalPreset('postprocessing', newId);
				}}
			/>
			<List
				label="Skybox"
				options={skyboxPresetOptions}
				value={resolvedGlobalSky}
				on:change={(e) => sceneActions.setGlobalPreset('skybox', e.detail.value as string | null)}
			/>
			<Button title="Copy Global to Code" on:click={copyGlobalAssignments} />
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
					value={resolveScenePreset(scene.id, 'postprocessing')}
					on:change={(e) => {
						const newId = e.detail.value as string | null;
						warnIfPPConflict(scene.id, newId);
						sceneActions.setScenePreset(scene.id, 'postprocessing', newId);
					}}
				/>
				<List
					label="Skybox"
					options={skyboxPresetOptions}
					value={resolveScenePreset(scene.id, 'skybox')}
					on:change={(e) =>
						sceneActions.setScenePreset(scene.id, 'skybox', e.detail.value as string | null)}
				/>
				<Button title="Copy Scene to Code" on:click={() => copySceneEntry(scene)} />
			</Folder>
		{/each}
		<Separator />
		<Button title="Copy All Scenes to Code" on:click={copyAllSceneAssignments} />
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
