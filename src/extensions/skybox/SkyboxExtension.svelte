<script lang="ts">
	import { useStudio, ToolbarItem, DropDownPane } from '@threlte/studio/extend';
	import { Folder, Slider, Checkbox, Button, Separator, List, Monitor } from 'svelte-tweakpane-ui';
	import type { Snippet } from 'svelte';
	import { environmentState, skyboxActions, ENV_TEXTURES, CUBE_TEXTURES } from './skybox.svelte';
	import { skyActions, skyMeta, sunAt } from '$core/skybox/model';
	import type { ClockKind } from '$core/skybox/model';

	// The preset machine this panel used to drive (sky scalars, stars, transition
	// lerps, localStorage presets) is gone -- the sky is time-driven and lives in
	// $core/skybox/model. Per weather-system.md §8, Studio is just another caller: this panel
	// reads skyMeta and calls skyActions. It never writes sky parameters directly.
	// Weather buttons arrive with the phase-2 mixer; keyframe editing + save-to-file
	// remain phase 5.

	interface Props {
		children?: Snippet;
	}
	let { children }: Props = $props();

	const { createExtension } = useStudio();

	createExtension({
		scope: 'skybox',
		state: () => ({}),
		actions: {}
	});

	// Panel-local mirror of the clock kind. The engine deliberately does not expose
	// clock getters (§8) -- the panel is the only clock writer in dev, so it can trust
	// its own bookkeeping. A game taking over the clock (external, phase 3) owns it
	// then, not this pane.
	// Initial values mirror the engine default (manual at sunset, frozen).
	let clockKind: ClockKind = 'manual';
	let speed = $state('frozen');

	const SPEED_OPTIONS = [
		{ value: 'frozen', text: 'Frozen' },
		{ value: 'realtime', text: 'Realtime (wall clock)' },
		{ value: '60', text: '60x — 24 min/day' },
		{ value: '240', text: '240x — 6 min/day' },
		{ value: '720', text: '720x — 2 min/day' }
	];

	const fmtClock = (t: number) => {
		const hours = Math.floor(t * 24);
		const minutes = Math.floor((t * 24 - hours) * 60);
		return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
	};

	// Quantized to whole game-minutes, so these strings (and everything derived from
	// them) update a few times per second at dev speeds rather than every frame.
	// Split into two monitors: one line does not fit the pane width.
	const clockReadout = $derived(`${fmtClock(skyMeta.t)} · day ${skyMeta.day}`);
	const skyReadout = $derived.by(() => {
		const sunElevation = sunAt(skyMeta.t).elevation;
		return `${skyMeta.phase} · sun ${sunElevation.toFixed(0)}°`;
	});

	// Scrubbing always lands on the manual clock: the realtime one re-syncs to the
	// wall clock every tick at scale 1 and would fight the drag. A fresh manual clock
	// is created frozen; an already-running one is frozen first for the same reason.
	const scrubTime = (t: number) => {
		if (clockKind !== 'manual') {
			skyActions.setClock('manual', { t });
			clockKind = 'manual';
		} else {
			skyActions.setTimeScale(0);
			skyActions.setTime(t);
		}
		speed = 'frozen';
	};

	const setSpeed = (value: string) => {
		speed = value;
		if (value === 'realtime') {
			// Explicit scale 1: setClock preserves the current scale unless told otherwise.
			skyActions.setClock('realtime', { timeScale: 1 });
			clockKind = 'realtime';
		} else if (value === 'frozen') {
			skyActions.setTimeScale(0);
		} else {
			skyActions.setTimeScale(Number(value));
		}
	};

	const envTextureOptions = $derived([
		{ value: null as string | null, text: '— None —' },
		...ENV_TEXTURES.map((t) => ({ value: t.id as string | null, text: t.name }))
	]);

	const cubeTextureOptions = $derived([
		{ value: null as string | null, text: '— None —' },
		...CUBE_TEXTURES.map((t) => ({ value: t.id as string | null, text: t.name }))
	]);
</script>

<ToolbarItem position="left">
	<DropDownPane icon="mdiWeatherSunny" title="Sky">
		<Folder title="Mode" expanded={true}>
			<Button
				title={environmentState.mode === 'sky' ? '✓ Procedural Sky' : 'Procedural Sky'}
				on:click={() => skyboxActions.setMode('sky')}
			/>
			<Button
				title={environmentState.mode === 'environment'
					? '✓ HDR / EXR Environment'
					: 'HDR / EXR Environment'}
				on:click={() => skyboxActions.setMode('environment')}
			/>
			<Button
				title={environmentState.mode === 'cube' ? '✓ Cube Map' : 'Cube Map'}
				on:click={() => skyboxActions.setMode('cube')}
			/>
		</Folder>

		<Separator />

		{#if environmentState.mode === 'sky'}
			<!-- Time drives the procedural sky; an HDR/cubemap environment ignores it, so
		         the folder only makes sense in this mode. -->
			<Folder title="Time" expanded={true}>
				<Monitor label="Clock" value={clockReadout} />
				<Monitor label="Sky" value={skyReadout} />
				<Slider
					label="Scrub"
					value={skyMeta.t}
					min={0}
					max={1}
					step={1 / 1440}
					on:change={(e) => {
						// svelte-tweakpane-ui dispatches 'change' for programmatic value updates
						// too (origin: 'external'). Without this guard, every running frame
						// re-enters here and instantly re-freezes whatever speed was just picked.
						if (e.detail.origin === 'internal') scrubTime(e.detail.value as number);
					}}
				/>
				<List
					label="Speed"
					options={SPEED_OPTIONS}
					value={speed}
					on:change={(e) => {
						// Same origin guard: scrubbing writes speed = 'frozen' programmatically,
						// which would otherwise re-run setSpeed through the external event.
						if (e.detail.origin === 'internal') setSpeed(e.detail.value as string);
					}}
				/>
				<Button title="Midnight" on:click={() => scrubTime(0)} />
				<Button title="Sunrise" on:click={() => scrubTime(0.25)} />
				<Button title="Noon" on:click={() => scrubTime(0.5)} />
				<Button title="Sunset" on:click={() => scrubTime(0.75)} />
			</Folder>
		{/if}

		{#if environmentState.mode === 'environment'}
			<Folder title="Environment Texture" expanded={true}>
				{#if ENV_TEXTURES.length === 0}
					<span style="font-size: 11px; color: rgba(255,255,255,0.4);">
						No textures — add HDR/EXR files to<br />public/textures/skybox/ and register in
						envTextures.ts
					</span>
				{:else}
					<List
						label="Texture"
						options={envTextureOptions}
						value={environmentState.envTextureId}
						on:change={(e) => skyboxActions.setEnvTexture(e.detail.value as string | null)}
					/>
				{/if}
				<Checkbox label="Use as Background" bind:value={environmentState.envIsBackground} />
				<Checkbox label="Ground Projection" bind:value={environmentState.envGround} />
			</Folder>
		{/if}

		{#if environmentState.mode === 'cube'}
			<Folder title="Cube Map Texture" expanded={true}>
				{#if CUBE_TEXTURES.length === 0}
					<span style="font-size: 11px; color: rgba(255,255,255,0.4);">
						No cube maps — add 6-face sets to<br />public/textures/skybox/cube/ and register in
						envTextures.ts
					</span>
				{:else}
					<List
						label="Cube Map"
						options={cubeTextureOptions}
						value={environmentState.cubeTextureId}
						on:change={(e) => skyboxActions.setCubeTexture(e.detail.value as string | null)}
					/>
				{/if}
				<Checkbox label="Use as Background" bind:value={environmentState.cubeIsBackground} />
			</Folder>
		{/if}
	</DropDownPane>
</ToolbarItem>

{@render children?.()}
