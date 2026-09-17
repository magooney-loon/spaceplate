<script lang="ts">
	// THE AUDIO RUNTIME — renders nothing. Owns the listener hookup, the bus graph, the
	// two engine beds, tab-hide parking and the weather tick.
	//
	// Replaces GlobalAudio.svelte, which mounted nine <Audio> tags in markup. Voices are
	// the registry's now (core/audio/voices.ts), so there is nothing left to render.

	import { useTask } from '@threlte/core/webgpu';
	import { useAudioListener } from '@threlte/extras';
	import type { AudioListener as ThreeAudioListener } from 'three';
	import { settingsState } from '$extensions/settings';
	import { logSound } from '$extensions/logger';
	import { installMixer, syncMixerFromSettings, uninstallMixer } from './mixer';
	import { attachAudioContext, soundsReady } from './registry';
	import {
		attachListener,
		parkVoices,
		reapVoices,
		stopAllVoices,
		tickRecording,
		unparkVoices
	} from './voices';
	import { sceneNow, tickScheduler } from './scheduler';
	import { engineSounds } from './engineSounds';
	import type { VoiceHandle } from './types';
	import { tickWeatherAudio } from './weatherAudio';

	// Camera.svelte's <AudioListener/> mounts one line earlier in App.svelte, so the
	// listener is already registered when this script runs. Typed by hand rather than via
	// `ReturnType<typeof useAudioListener>`: that hook is overloaded and `ReturnType`
	// resolves to the LAST signature, not the no-arg one (Capture.svelte's own note).
	let audioApi: { listener: ThreeAudioListener; context: AudioContext } | null = null;
	try {
		audioApi = useAudioListener();
	} catch (error) {
		logSound.error('AudioRuntime: no AudioListener — the audio layer is inert', error);
	}

	if (audioApi) {
		installMixer(audioApi.listener);
		attachListener(audioApi.listener);
		attachAudioContext(audioApi.context);
	}

	// THE ONE PLACE SETTINGS MEET THE GRAPH. `syncMixerFromSettings()` reads
	// `settingsState.audio` synchronously and Svelte 5 tracks reads at any call depth, so
	// this is reactive without naming the fields. It only writes gain nodes — no loop.
	$effect(() => {
		syncMixerFromSettings();
	});

	// Audibility is derived from SETTINGS, not from `busAudible()`: buses are plain
	// objects, so a `$derived` over them would never re-run, and reading the graph here
	// would race the sync effect above. `busAudible()` is for the task-driven consumers.
	const masterAudible = $derived(settingsState.audio.masterVolume > 0);
	const musicAudible = $derived(
		masterAudible && settingsState.audio.musicEnabled && settingsState.audio.musicVolume > 0
	);
	const ambienceAudible = $derived(
		masterAudible && settingsState.audio.ambienceEnabled && settingsState.audio.ambienceVolume > 0
	);

	// The two engine beds. Created paused once their buffers land — the effects below own
	// when they are heard, so nothing sounds before the autoplay unlock has happened.
	let ostBed = $state.raw<VoiceHandle | null>(null);
	let ambienceBed = $state.raw<VoiceHandle | null>(null);

	$effect(() => {
		let cancelled = false;
		void soundsReady().then(() => {
			if (cancelled) return;
			ostBed = engineSounds.ost.loop({ paused: true });
			ambienceBed = engineSounds.ambience.loop({ paused: true });
		});
		return () => {
			cancelled = true;
		};
	});

	// Gating a bed on audibility is a COST decision, not a correctness one — the bus has
	// already silenced it. A bed nobody can hear should not be decoding.
	$effect(() => {
		if (musicAudible) ostBed?.resume();
		else ostBed?.pause();
	});

	$effect(() => {
		if (ambienceAudible) ambienceBed?.resume();
		else ambienceBed?.pause();
	});

	// The scheduler re-anchors scene time against the AudioContext clock, and must run
	// before anything that schedules a voice this frame — hence first in this task, and
	// hence this task existing at all rather than weatherAudio owning its own.
	useTask(
		(delta) => {
			tickScheduler();
			tickWeatherAudio(delta);
			reapVoices();
			// LAST: samples the frame's automation for a capture take, so it records the
			// values consumers have just written rather than the previous frame's. Inert
			// unless a take is armed.
			tickRecording(sceneNow());
		},
		{ autoInvalidate: false }
	);

	// rAF stops when the tab hides; the AudioContext does not.
	const onVisibility = () => {
		if (document.hidden) parkVoices();
		else unparkVoices();
	};

	$effect(() => {
		document.addEventListener('visibilitychange', onVisibility);
		return () => {
			document.removeEventListener('visibilitychange', onVisibility);
			// This component never unmounts in practice; the teardown is for HMR, which
			// would otherwise stack a second bus graph on the same listener.
			stopAllVoices();
			uninstallMixer();
		};
	});
</script>
