<script module>
	// Module-level: shared across all imports, not per-instance
	export const soundTriggers = $state({ swoosh: 0, click: 0 });

	export const soundActions = {
		playSwoosh() {
			soundTriggers.swoosh++;
		},
		playClick() {
			soundTriggers.click++;
		}
	};
</script>

<script lang="ts">
	import { Audio } from '@threlte/extras';
	import { Audio as ThreeAudio } from 'three';
	import { settingsState, log } from './settings.svelte.js';

	// Place your audio files in /public/sounds/
	const OST_URL = '/sounds/ost.ogg';
	const AMBIENCE_URL = '/sounds/ambience.ogg';
	const CLICK_URL = '/sounds/click.mp3';
	const SWOOSH_URL = '/sounds/swoosh.mp3';

	// $state.raw — prevents Svelte 5 from wrapping class instances in a Proxy
	let ostAudio = $state.raw<ThreeAudio>();
	let ambienceAudio = $state.raw<ThreeAudio>();
	let clickAudio = $state.raw<ThreeAudio>();
	let swooshAudio = $state.raw<ThreeAudio>();

	// ─── Playback helpers ─────────────────────────────────────────────────────

	// Stop + replay — restarts the sound each call (good for clicks)
	const playOneShot = (audio: ThreeAudio | undefined) => {
		if (!audio) return;
		if (audio.isPlaying) audio.stop();
		audio.play();
	};

	// Clone + play — allows multiple overlapping instances (good for swoosh)
	const playPolyphonic = (audio: ThreeAudio | undefined) => {
		if (!audio?.buffer) return;
		const clone = audio.clone() as ThreeAudio;
		clone.setVolume(audio.getVolume());
		clone.play();
	};

	// ─── Looping tracks ───────────────────────────────────────────────────────

	$effect(() => {
		if (!ostAudio) return;
		if (settingsState.audio.musicEnabled) ostAudio.play();
		else ostAudio.pause();
	});

	$effect(() => {
		if (!ostAudio) return;
		ostAudio.setVolume(settingsState.audio.musicVolume);
	});

	$effect(() => {
		if (!ambienceAudio) return;
		if (settingsState.audio.ambienceEnabled) ambienceAudio.play();
		else ambienceAudio.pause();
	});

	$effect(() => {
		if (!ambienceAudio) return;
		ambienceAudio.setVolume(settingsState.audio.ambienceVolume);
	});

	$effect(() => {
		if (!clickAudio) return;
		clickAudio.setVolume(settingsState.audio.effectsVolume);
	});

	$effect(() => {
		if (!swooshAudio) return;
		swooshAudio.setVolume(settingsState.audio.effectsVolume);
	});

	// ─── One-shot SFX ────────────────────────────────────────────────────────

	$effect(() => {
		if (soundTriggers.click > 0 && settingsState.audio.effectsEnabled) playOneShot(clickAudio);
	});

	$effect(() => {
		if (soundTriggers.swoosh > 0 && settingsState.audio.effectsEnabled) playPolyphonic(swooshAudio);
	});
</script>

<!-- Audio track 1: OST / background music -->
<Audio
	src={OST_URL}
	loop
	oncreate={(a) => {
		ostAudio = a;
		log.info('Audio loaded: OST');
	}}
/>

<!-- Audio track 2: Ambience -->
<Audio
	src={AMBIENCE_URL}
	loop
	oncreate={(a) => {
		ambienceAudio = a;
		log.info('Audio loaded: Ambience');
	}}
/>

<!-- SFX 1: Click -->
<Audio
	src={CLICK_URL}
	oncreate={(a) => {
		clickAudio = a;
		log.info('Audio loaded: Click SFX');
	}}
/>

<!-- SFX 2: Swoosh (stage transitions) -->
<Audio
	src={SWOOSH_URL}
	oncreate={(a) => {
		swooshAudio = a;
		log.info('Audio loaded: Swoosh SFX');
	}}
/>
