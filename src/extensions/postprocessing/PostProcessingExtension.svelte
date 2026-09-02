<script lang="ts">
	// Studio panel — rendered FROM the registry, not hand-written. Roles group the
	// folders, `ranges` drive the sliders, and resolveEnabledSet supplies the
	// conflict/quality verdicts, so an illegal combination is explained rather than
	// merely broken (DOCS/post-processing.md §3.4). UI only — no logic here.

	import { useStudio, ToolbarItem, DropDownPane } from '@threlte/studio/extend';
	import { Folder, Slider, Checkbox, Button, Separator, List } from 'svelte-tweakpane-ui';
	import type { Snippet } from 'svelte';
	import { settingsState } from '$extensions/settings';
	import { EFFECTS, resolveEnabledSet } from '$core/postprocessing/registry';
	import type { EffectDef, PassRole } from '$core/postprocessing/types';
	import { postprocessingState as s, postprocessingActions } from './postprocessing.svelte';
	import type { EffectId } from './types';

	const { createExtension } = useStudio();

	let { children }: { children?: Snippet } = $props();

	createExtension({
		scope: 'postprocessing',
		state: () => ({}),
		actions: {}
	});

	const quality = $derived(settingsState.graphics.quality);
	const enabledIds = $derived(
		EFFECTS.filter((def) => (s as any)[def.id]?.enabled).map((def) => def.id)
	);
	const resolution = $derived(resolveEnabledSet(enabledIds, quality));

	const SECTIONS: { title: string; role: PassRole }[] = [
		{ title: 'Base Pass', role: 'base' },
		{ title: 'Effects', role: 'chain' },
		{ title: 'Grade', role: 'grade' },
		{ title: 'Anti-Aliasing', role: 'resolve' }
	];

	const byRole = (role: PassRole): EffectDef<any>[] =>
		EFFECTS.filter((def) => def.role === role).sort((a, b) => a.order - b.order);

	/** Why an enabled effect will NOT run, or null. */
	const suppression = (id: string): string | null =>
		resolution.dropped.find((d) => d.id === id)?.reason ?? null;

	const noteStyle = 'font-size: 10px; color: rgba(255,255,255,0.45); display: block; margin: 2px 0 4px;';
</script>

<ToolbarItem position="left">
	<DropDownPane icon="mdiImageFilterHdr" title="Post Processing">
		<span class="pipeline-info">
			quality: {quality} · base: {resolution.basePassId}
			{#if resolution.mrt.length > 0}· mrt: {resolution.mrt.join(', ')}{/if}
		</span>
		<Separator />

		{#each SECTIONS as section (section.role)}
			<Folder title={section.title} expanded={section.role !== 'base'}>
				{#each byRole(section.role) as def (def.id)}
					{@const settings = (s as any)[def.id]}
					{@const suppressed = settings.enabled ? suppression(def.id) : null}
					{@const params = Object.keys(def.params())}
					{@const range = (key: string) => def.ranges?.[key] ?? { min: 0, max: 10, step: 0.1 }}
					<Folder title={def.label + (suppressed ? ' (off)' : '')} expanded={settings.enabled}>
						<Checkbox
							value={settings.enabled}
							on:change={() =>
								postprocessingActions.setEnabled(def.id as EffectId, !settings.enabled)}
							label="Enabled"
						/>
						{#if settings.enabled && params.length > 0}
							{#each params as key (key)}
								{#if def.options?.[key]}
									<!-- A choice, not a magnitude (the LUT selection) — a slider over
									     catalogue indices would be unreadable. -->
									<List bind:value={settings[key]} label={key} options={def.options[key]} />
								{:else}
									<Slider
										bind:value={settings[key]}
										label={key}
										min={range(key).min}
										max={range(key).max}
										step={range(key).step}
									/>
								{/if}
							{/each}
							<Button
								title="Reset"
								on:click={() => postprocessingActions.resetEffect(def.id as EffectId)}
							/>
						{/if}
						{#if suppressed}
							<span style={noteStyle}>{suppressed}</span>
						{:else if def.note}
							<span style={noteStyle}>{def.note}</span>
						{/if}
					</Folder>
				{/each}
			</Folder>
		{/each}

		<Separator />
		<Button title="Reset All" on:click={postprocessingActions.resetAll} />
	</DropDownPane>
</ToolbarItem>

{@render children?.()}

<style>
	.pipeline-info {
		font-size: 10px;
		color: rgba(255, 255, 255, 0.45);
		display: block;
		margin: 2px 0 4px;
	}
</style>
