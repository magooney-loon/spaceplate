<script lang="ts">
	import { useStudio, ToolbarItem, DropDownPane } from '@threlte/studio/extend';
	import { Folder, Slider, Checkbox, Button, Separator, List, Monitor } from 'svelte-tweakpane-ui';
	import type { Snippet } from 'svelte';
	import { environmentState, skyboxActions, ENV_TEXTURES, CUBE_TEXTURES } from './skybox.svelte';
	import { skyActions, skyMeta, sunAt, WEATHERS } from '$core/skybox/model';
	import type { ChannelName, ClockKind } from '$core/skybox/model';
	import { requestStrike } from '$core/skybox/flashState';

	// The preset machine this panel used to drive (sky scalars, stars, transition
	// lerps, localStorage presets) is gone -- the sky is time-driven and lives in
	// $core/skybox/model. Per weather-system.md §8, Studio is just another caller: this
	// panel reads skyMeta and calls skyActions. It never writes sky parameters directly.
	// Keyframe editing + save-to-file remain phase 5. The one deliberate exception is
	// `requestStrike`: a dev trigger, not an authored-sky control, flowing through the
	// same shared state the flash already uses (see flashState.ts).

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

	// ── Weather ────────────────────────────────────────────────────────────────
	// Studio is just another caller (§8): these buttons run the same setWeather a game
	// or a server subscription would, and the sliders send raw channel targets, which
	// the API treats as equally valid. There is no privileged panel path, so nothing
	// here can drift away from the real behaviour.

	const WEATHER_NAMES = Object.keys(WEATHERS);

	/** Blend duration in seconds, so the pane reads in units a human picks. */
	let blendSeconds = $state(20);

	const applyWeather = (name: string) => skyActions.setWeather(name, { over: blendSeconds * 1000 });

	/**
	 * A raw channel edit. Snapped (`over: 0`) on purpose: a slider drag is a direct
	 * manipulation and has to track the handle, not chase it over twenty seconds.
	 */
	const setChannel = (channel: ChannelName, value: number) =>
		skyActions.setWeather({ [channel]: value }, { over: 0 });

	const weatherReadout = $derived(`${skyMeta.weather}${skyMeta.blending ? ' · blending' : ''}`);

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

			<!-- Weather modulates the day curve; like time, it only means anything while
			     the procedural sky is the one being rendered. -->
			<Folder title="Weather" expanded={true}>
				<Monitor label="Active" value={weatherReadout} />
				<Slider label="Blend (s)" bind:value={blendSeconds} min={0} max={60} step={1} />
				{#each WEATHER_NAMES as name (name)}
					<Button
						title={skyMeta.weather === name ? `✓ ${name}` : name}
						on:click={() => applyWeather(name)}
					/>
				{/each}
				<Separator />
				<!-- Raw channel targets. The sliders track the live mixer values, so they
				     also read as a progress display while a named weather blends in. All six
				     channels are here: `cloudType` leans the deck toward storm towers AND picks
				     rain vs snow; `lightning` arms the strike scheduler. -->
				<Slider
					label="Cloud"
					value={skyMeta.cloudCover}
					min={0}
					max={1}
					step={0.01}
					on:change={(e) => {
						if (e.detail.origin === 'internal') setChannel('cloudCover', e.detail.value as number);
					}}
				/>
				<Slider
					label="Cloud Type"
					value={skyMeta.cloudType}
					min={0}
					max={1}
					step={0.01}
					on:change={(e) => {
						if (e.detail.origin === 'internal') setChannel('cloudType', e.detail.value as number);
					}}
				/>
				<Slider
					label="Fog"
					value={skyMeta.fog}
					min={0}
					max={1}
					step={0.01}
					on:change={(e) => {
						if (e.detail.origin === 'internal') setChannel('fog', e.detail.value as number);
					}}
				/>
				<Slider
					label="Precipitation"
					value={skyMeta.precipitation}
					min={0}
					max={1}
					step={0.01}
					on:change={(e) => {
						if (e.detail.origin === 'internal')
							setChannel('precipitation', e.detail.value as number);
					}}
				/>
				<!-- Not an intensity: 0 is snow, 1 is rain, and the middle is sleet. -->
				<Slider
					label="Precip Type (snow-rain)"
					value={skyMeta.precipitationType}
					min={0}
					max={1}
					step={0.01}
					on:change={(e) => {
						if (e.detail.origin === 'internal')
							setChannel('precipitationType', e.detail.value as number);
					}}
				/>
				<Slider
					label="Wind"
					value={skyMeta.wind}
					min={0}
					max={1}
					step={0.01}
					on:change={(e) => {
						if (e.detail.origin === 'internal') setChannel('wind', e.detail.value as number);
					}}
				/>
				<!-- Also not an intensity: a compass bearing, one full turn over 0..1. It
				     wraps, so the mixer blends it the short way round. -->
				<Slider
					label="Wind Bearing"
					value={skyMeta.windDirection}
					min={0}
					max={1}
					step={0.01}
					on:change={(e) => {
						if (e.detail.origin === 'internal')
							setChannel('windDirection', e.detail.value as number);
					}}
				/>
				<Slider
					label="Lightning"
					value={skyMeta.lightning}
					min={0}
					max={1}
					step={0.01}
					on:change={(e) => {
						if (e.detail.origin === 'internal') setChannel('lightning', e.detail.value as number);
					}}
				/>
				<!-- Fires one bolt immediately, even with the channel at zero -- tuning the
				     bolt/deck-flash look must not mean waiting for the next random strike. -->
				<Button title="⚡ Strike Now" on:click={requestStrike} />
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
