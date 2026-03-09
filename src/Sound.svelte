<script lang="ts">
	import { Audio } from '@threlte/extras';
	import { Audio as ThreeAudio } from 'three';
	import { settingsState } from './settings.svelte.js';
	import { soundTriggers } from './sound.svelte.js';

	// Place your audio files in /public/sounds/
	const OST_URL      = '/sounds/ost.ogg';
	const AMBIENCE_URL = '/sounds/ambience.ogg';
	const CLICK_URL  = '/sounds/click.mp3';
	const SWOOSH_URL = '/sounds/swoosh.mp3';

	// $state.raw — prevents Svelte 5 from wrapping class instances in a Proxy
	let ostAudio      = $state.raw<ThreeAudio>();
	let ambienceAudio = $state.raw<ThreeAudio>();
	let clickAudio  = $state.raw<ThreeAudio>();
	let swooshAudio = $state.raw<ThreeAudio>();

	// Stop + replay a one-shot so it can fire multiple times in a row
	const playOneShot = (audio: ThreeAudio | undefined) => {
		if (!audio) return;
		if (audio.isPlaying) audio.stop();
		audio.play();
	};

	// ─── Looping tracks ───────────────────────────────────────────────────────

	$effect(() => {
		if (!ostAudio) return;
		if (settingsState.audio.musicEnabled) ostAudio.play();
		else ostAudio.pause();
	});

	$effect(() => {
		if (!ambienceAudio) return;
		if (settingsState.audio.ambienceEnabled) ambienceAudio.play();
		else ambienceAudio.pause();
	});

	// ─── One-shot SFX ────────────────────────────────────────────────────────

	$effect(() => {
		if (soundTriggers.click > 0 && settingsState.audio.effectsEnabled) playOneShot(clickAudio);
	});

	$effect(() => {
		if (soundTriggers.swoosh > 0 && settingsState.audio.effectsEnabled) playOneShot(swooshAudio);
	});
</script>

<!-- Audio track 1: OST / background music -->
<Audio src={OST_URL} loop volume={0.69} oncreate={(a) => { ostAudio = a; }} />

<!-- Audio track 2: Ambience -->
<Audio src={AMBIENCE_URL} loop volume={0.5} oncreate={(a) => { ambienceAudio = a; }} />

<!-- SFX 1: Click -->
<Audio src={CLICK_URL} oncreate={(a) => { clickAudio = a; }} />

<!-- SFX 2: Swoosh (stage transitions) -->
<Audio src={SWOOSH_URL} oncreate={(a) => { swooshAudio = a; }} />
