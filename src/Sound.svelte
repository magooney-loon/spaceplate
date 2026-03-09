<script lang="ts">
	import { Audio } from '@threlte/extras';
	import { settingsState } from './settings.svelte.js';
	import { soundTriggers } from './sound.svelte.js';

	// Place your audio files in /public/sounds/
	// Looping tracks (music / ambience)
	const OST_URL      = '/sounds/ost.ogg';
	const AMBIENCE_URL = '/sounds/ambience.ogg';
	// One-shot SFX
	const CLICK_URL    = '/sounds/click.mp3';
	const SCAN_URL     = '/sounds/scan.mp3';

	// Refs to the Threlte Audio component instances
	let ostRef      = $state<{ play: () => Promise<unknown>; pause: () => unknown }>();
	let ambienceRef = $state<{ play: () => Promise<unknown>; pause: () => unknown }>();
	let clickRef    = $state<{ play: () => Promise<unknown> }>();
	let scanRef     = $state<{ play: () => Promise<unknown>; stop: () => unknown }>();

	// ─── Looping tracks ───────────────────────────────────────────────────────

	$effect(() => {
		if (!ostRef) return;
		if (settingsState.audio.musicEnabled) ostRef.play();
		else ostRef.pause();
	});

	$effect(() => {
		if (!ambienceRef) return;
		if (settingsState.audio.ambienceEnabled) ambienceRef.play();
		else ambienceRef.pause();
	});

	// ─── One-shot SFX ────────────────────────────────────────────────────────

	$effect(() => {
		if (soundTriggers.click > 0 && settingsState.audio.effectsEnabled) clickRef?.play();
	});

	$effect(() => {
		if (soundTriggers.scan > 0 && settingsState.audio.effectsEnabled) scanRef?.play();
	});

</script>

<!-- Audio track 1: OST / background music -->
<Audio src={OST_URL} loop volume={0.69} bind:this={ostRef} />

<!-- Audio track 2: Ambience -->
<Audio src={AMBIENCE_URL} loop volume={0.5} bind:this={ambienceRef} />

<!-- SFX 1: Click (also used for swoosh) -->
<Audio src={CLICK_URL} bind:this={clickRef} />

<!-- SFX 2: Scan -->
<Audio src={SCAN_URL} bind:this={scanRef} />
