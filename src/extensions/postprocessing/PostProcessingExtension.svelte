<script lang="ts">
	// Studio panel — rendered FROM the registry, not hand-written. Sections group the
	// folders, `ranges` drive the sliders, and resolveEnabledSet supplies the
	// conflict/quality verdicts, so an illegal combination is explained rather than
	// merely broken. UI only — no logic here.

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
	// State doubles as the values record ({enabled, ...params} per id) so param-driven
	// requirements (bloom's material mode → emissive MRT) are reflected here too.
	const resolution = $derived(resolveEnabledSet(enabledIds, quality, s as any));

	const byRole = (role: PassRole): EffectDef<any>[] =>
		EFFECTS.filter((def) => def.role === role).sort((a, b) => a.order - b.order);

	/**
	 * Chain effects the WEATHER drives rather than the user. They are ordinary chain
	 * effects to the builder — this split is a panel concern only: their "enabled" flag
	 * means "let the weather decide", their params shape something you cannot see until
	 * it rains, and mixed in among bloom and vignette they read as controls that do
	 * nothing. Grouping them says which knobs answer to the sky.
	 */
	const WEATHER_IDS = new Set(['fogScatter', 'rainLens', 'snowLens']);

	interface Section {
		title: string;
		expanded: boolean;
		/** Which of the panel's two columns this section sits in — see the layout CSS. */
		column: 'left' | 'right';
		defs: EffectDef<any>[];
	}

	/**
	 * THE ORDER OF THIS LIST IS THE DOM ORDER, AND THE LAYOUT DEPENDS ON IT. Tweakpane
	 * blades cannot be wrapped in our own elements — a `Folder` attaches itself to the
	 * pane's container through Svelte context, so its DOM lands wherever tweakpane puts
	 * it, not where the component sits in our template. The two columns are therefore CSS
	 * grid over that container, and the right-hand column is addressed as `:last-child`.
	 *
	 * So the `right` section must be LAST here, and nothing may be authored after it —
	 * which is why the Reset All footer is rendered just before it rather than at the end.
	 */
	const SECTIONS: Section[] = [
		{ title: 'Base Pass', expanded: false, column: 'left', defs: byRole('base') },
		{
			title: 'Weather',
			expanded: true,
			column: 'left',
			defs: byRole('chain').filter((def) => WEATHER_IDS.has(def.id))
		},
		{ title: 'Grade', expanded: true, column: 'left', defs: byRole('grade') },
		{ title: 'Anti-Aliasing', expanded: true, column: 'left', defs: byRole('resolve') },
		{
			title: 'Effects',
			expanded: true,
			column: 'right',
			defs: byRole('chain').filter((def) => !WEATHER_IDS.has(def.id))
		}
	];

	/** Why an enabled effect will NOT run, or null. */
	const suppression = (id: string): string | null =>
		resolution.dropped.find((d) => d.id === id)?.reason ?? null;
</script>

<!-- `display: contents` — the wrapper exists only to scope the layout CSS below to THIS
     panel's pane, and must not become a box in the toolbar's own flex row. -->
<ToolbarItem position="left">
	<div class="pp-panel">
		<DropDownPane icon="mdiImageFilterHdr" title="Post Processing">
			<span class="pipeline-info">
				quality: {quality} · base: {resolution.basePassId}
				{#if resolution.mrt.length > 0}· mrt: {resolution.mrt.join(', ')}{/if}
			</span>

			{#each SECTIONS as section (section.title)}
				{#if section.column === 'right'}
					<!-- The left column's footer, authored HERE so the right column stays the
					     container's last child (see SECTIONS). -->
					<Separator />
					<Button title="Reset All" on:click={postprocessingActions.resetAll} />
				{/if}
				<Folder title={section.title} expanded={section.expanded}>
					{#each section.defs as def (def.id)}
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
										     catalogue indices would be unreadable. Routed through setParam
										     so a mode swap can re-seed its siblings (bloom Global/Material). -->
										<List
											value={settings[key]}
											label={key}
											options={def.options[key]}
											on:change={(e) =>
												postprocessingActions.setParam(
													def.id as EffectId,
													key,
													Number(e.detail.value)
												)}
										/>
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
						</Folder>
					{/each}
				</Folder>
			{/each}
		</DropDownPane>
	</div>
</ToolbarItem>

{@render children?.()}

<style>
	.pp-panel {
		display: contents;
	}

	.pipeline-info {
		font-size: 10px;
		color: rgba(255, 255, 255, 0.45);
		display: block;
		margin: 2px 0 4px;
	}

	/* ── The two-column layout ────────────────────────────────────────────────
	   Laid out in CSS rather than in the template because there is no template to
	   lay out: every blade above is attached to the pane's own container through
	   tweakpane's API, so wrapping the components in elements moves nothing. The
	   selectors are `:global` for the same reason (the DOM is tweakpane's, so it
	   carries no Svelte scope class) and are held inside `.pp-panel` so they cannot
	   reach another extension's pane.

	   `.tp-rotv` is the pane root and `.tp-rotv_c` its blade container; a folder's
	   own container is `.tp-fldv_c`, so this never recurses into one. */
	.pp-panel :global(.tp-rotv) {
		width: 520px;
	}

	.pp-panel :global(.tp-rotv_c) {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		column-gap: 6px;
		/* Zero, deliberately: tweakpane already spaces its blades with margin-top, and
		   the right-hand column spans far more rows than exist (below) — a row gap
		   would be multiplied by every one of the empty ones. */
		row-gap: 0;
		align-items: start;
	}

	.pp-panel :global(.tp-rotv_c > *) {
		grid-column: 1;
	}

	/* The right column: the Effects folder, which SECTIONS guarantees is authored last.
	   It has to span rows rather than sit in the first one, or row 1 would grow to its
	   height and push the whole left column down past it. The span is simply "more rows
	   than the left column will ever have"; the surplus rows are empty and zero-height. */
	.pp-panel :global(.tp-rotv_c > :last-child) {
		grid-column: 2;
		grid-row: 1 / span 99;
		margin-top: 0;
	}
</style>
