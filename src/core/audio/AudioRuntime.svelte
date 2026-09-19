<script lang="ts">
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

	// Typed by hand: `ReturnType<typeof useAudioListener>` resolves to the overload's
	// last signature, not the no-arg one.
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

	$effect(() => {
		syncMixerFromSettings();
	});

	// Derived from settings, not `busAudible()`: buses are plain objects, so a
	// `$derived` over them would never re-run. `busAudible()` is for task-driven consumers.
	const masterAudible = $derived(settingsState.audio.masterVolume > 0);
	const musicAudible = $derived(
		masterAudible && settingsState.audio.musicEnabled && settingsState.audio.musicVolume > 0
	);
	const ambienceAudible = $derived(
		masterAudible && settingsState.audio.ambienceEnabled && settingsState.audio.ambienceVolume > 0
	);

	// Created paused; the effects below gate when they're actually heard.
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

	$effect(() => {
		if (musicAudible) ostBed?.resume();
		else ostBed?.pause();
	});

	$effect(() => {
		if (ambienceAudible) ambienceBed?.resume();
		else ambienceBed?.pause();
	});

	// tickScheduler must run first, before anything schedules a voice this frame.
	// tickRecording must run last, to sample values consumers just wrote this frame.
	useTask(
		(delta) => {
			tickScheduler();
			tickWeatherAudio(delta);
			reapVoices();
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
			// Teardown is for HMR — this component never unmounts in practice.
			stopAllVoices();
			uninstallMixer();
		};
	});
</script>
