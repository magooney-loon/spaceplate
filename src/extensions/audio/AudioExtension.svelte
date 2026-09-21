<script lang="ts">
	// Studio panel for the audio layer — UI ONLY. Everything it touches lives in
	// core/audio/ (the mixer, the registry, the positional fallbacks) or in
	// settingsState.audio; this extension owns no state of its own, exactly like
	// extensions/skybox/.

	import { useStudio, ToolbarItem, DropDownPane } from '@threlte/studio/extend';
	import { Folder, Slider, Checkbox, Button, List, Separator } from 'svelte-tweakpane-ui';
	import type { Snippet } from 'svelte';
	import { settingsState, audioActions } from '$extensions/settings';
	import { logSound } from '$extensions/logger';
	import { positionalDefaults, refreshPositional, voiceSnapshot } from '$core/audio/voices';
	import { mixerSnapshot } from '$core/audio/mixer';
	import { schedulerDrift } from '$core/audio/scheduler';
	import { extensionScope } from './types';

	interface Props {
		children?: Snippet;
	}

	let { children }: Props = $props();

	const { createExtension } = useStudio();

	// Registered so Studio has a scope for this toolbar item; the state is empty on
	// purpose — see the header.
	createExtension({ scope: extensionScope, state: () => ({}), actions: {} });

	const panningOptions = [
		{ value: 'HRTF', text: 'HRTF (3D)' },
		{ value: 'equalpower', text: 'Equal Power (cheap)' }
	];

	// The widgets hold their own values for the positional block: `positionalDefaults` is
	// deliberately plain (core/audio/voices.ts explains why), and this panel is its only
	// writer, so there is nothing to stay in sync with.
	let ref = $state(positionalDefaults.ref);
	let rolloff = $state(positionalDefaults.rolloff);
	let max = $state(positionalDefaults.max);
	let panningModel = $state<PanningModelType>(positionalDefaults.panningModel);

	const applyPositional = () => {
		positionalDefaults.ref = ref;
		positionalDefaults.rolloff = rolloff;
		positionalDefaults.max = max;
		positionalDefaults.panningModel = panningModel;
		// A tuning slider you cannot hear is not a tuning slider.
		refreshPositional();
	};

	const resetPositional = () => {
		ref = 5;
		rolloff = 1.5;
		max = 80;
		panningModel = 'HRTF';
		applyPositional();
	};

	// Dumped on demand rather than mirrored into $state per frame: a reactive write
	// nobody is looking at is still an invalidation, and a live readout would be one per
	// voice per frame for something that gets glanced at.
	const inspect = () => {
		const drift = schedulerDrift();
		logSound.info('Buses:', mixerSnapshot());
		logSound.info(`Voices (${voiceSnapshot().length}):`, voiceSnapshot());
		// Non-zero only while a capture take owns the engine clock — how far the LIVE MONITOR
		// has run ahead of the take's scene time, i.e. how far the renderer is behind. The
		// take's output no longer depends on it (core/audio/render.ts replays scene stamps).
		if (drift !== 0) logSound.warn(`Capture audio drift: ${drift.toFixed(3)}s ahead of scene time`);
	};
</script>

<ToolbarItem position="right">
	<DropDownPane icon="mdiVolumeHigh" title="Audio">
		<!-- Real gain nodes: these write settingsState.audio, which AudioRuntime's one
		     sync effect pushes into the bus graph. `on:change`, never `bind:` — bind
		     bypasses the actions that persist to localStorage.

		     EVERY HANDLER IS GUARDED ON `origin === 'internal'`, and the checkboxes cannot
		     work without it: svelte-tweakpane-ui dispatches `change` for PROGRAMMATIC
		     value updates too (core/Binding.svelte), so `Loader.svelte` enabling audio
		     fires these. A `toggle` is not idempotent, so an unguarded handler flips the
		     value straight back and oscillates until Svelte throws
		     effect_update_depth_exceeded. -->
		<Folder title="Buses" expanded={true}>
			<Slider
				label="Master"
				value={settingsState.audio.masterVolume}
				min={0}
				max={1}
				step={0.01}
				on:change={(e) => {
					if (e.detail.origin === 'internal') audioActions.setMasterVolume(e.detail.value);
				}}
			/>

			<Folder title="SFX" expanded={true}>
				<Checkbox
					label="Enabled"
					value={settingsState.audio.sfxEnabled}
					on:change={(e) => {
						if (e.detail.origin === 'internal') audioActions.toggleSfx();
					}}
				/>
				<Slider
					label="Volume"
					value={settingsState.audio.sfxVolume}
					min={0}
					max={1}
					step={0.01}
					on:change={(e) => {
						if (e.detail.origin === 'internal') audioActions.setSfxVolume(e.detail.value);
					}}
				/>
			</Folder>

			<Folder title="Music" expanded={true}>
				<Checkbox
					label="Enabled"
					value={settingsState.audio.musicEnabled}
					on:change={(e) => {
						if (e.detail.origin === 'internal') audioActions.toggleMusic();
					}}
				/>
				<Slider
					label="Volume"
					value={settingsState.audio.musicVolume}
					min={0}
					max={1}
					step={0.01}
					on:change={(e) => {
						if (e.detail.origin === 'internal') audioActions.setMusicVolume(e.detail.value);
					}}
				/>
			</Folder>

			<Folder title="Ambient" expanded={true}>
				<Checkbox
					label="Enabled"
					value={settingsState.audio.ambienceEnabled}
					on:change={(e) => {
						if (e.detail.origin === 'internal') audioActions.toggleAmbience();
					}}
				/>
				<Slider
					label="Volume"
					value={settingsState.audio.ambienceVolume}
					min={0}
					max={1}
					step={0.01}
					on:change={(e) => {
						if (e.detail.origin === 'internal') audioActions.setAmbienceVolume(e.detail.value);
					}}
				/>
			</Folder>
		</Folder>

		<Separator />

		<!-- Engine-wide FALLBACKS. A sound that declares its own ref/rolloff/max is
		     unaffected by these — see core/audio/CLAUDE.md. -->
		<Folder title="Positional Defaults" expanded={true}>
			<!-- Guarded for the same reason as the buses above: `resetPositional()` writes
			     these values, which dispatches `change` back with origin 'external'. -->
			<List
				label="Panning Model"
				value={panningModel}
				options={panningOptions}
				on:change={(e) => {
					if (e.detail.origin !== 'internal') return;
					panningModel = e.detail.value as PanningModelType;
					applyPositional();
				}}
			/>
			<Slider
				label="Ref Distance"
				value={ref}
				min={0.1}
				max={20}
				step={0.1}
				on:change={(e) => {
					if (e.detail.origin !== 'internal') return;
					ref = e.detail.value;
					applyPositional();
				}}
			/>
			<Slider
				label="Max Distance"
				value={max}
				min={10}
				max={500}
				step={1}
				on:change={(e) => {
					if (e.detail.origin !== 'internal') return;
					max = e.detail.value;
					applyPositional();
				}}
			/>
			<Slider
				label="Rolloff Factor"
				value={rolloff}
				min={0}
				max={5}
				step={0.01}
				on:change={(e) => {
					if (e.detail.origin !== 'internal') return;
					rolloff = e.detail.value;
					applyPositional();
				}}
			/>
			<Button title="Reset to Default" on:click={() => resetPositional()} />
		</Folder>

		<Separator />

		<Folder title="Inspector" expanded={false}>
			<Button title="Log buses + voices" on:click={() => inspect()} />
		</Folder>
	</DropDownPane>
</ToolbarItem>

{@render children?.()}
