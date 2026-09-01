<script module>
	export { soundTriggers, soundActions } from './globalAudio.svelte';
</script>

<script lang="ts">
	import { useTask } from '@threlte/core/webgpu';
	import { Audio } from '@threlte/extras';
	import { Audio as ThreeAudio } from 'three';
	import { settingsState, BASE_URL } from '$extensions/settings';
	import { logSound } from '$extensions/logger';
	import { soundTriggers } from './globalAudio.svelte';
	import { attachRainAudio, attachThunderAudio, tickWeatherAudio } from './weatherAudio';

	const OST_URL = `${BASE_URL}sounds/ost.ogg`;
	// Stereo 48 kbps Opus, loudness-matched to the previous bed (-21.5 LUFS integrated).
	const AMBIENCE_URL = `${BASE_URL}sounds/skybox/ambience.opus`;
	const CLICK_URL = `${BASE_URL}sounds/click.mp3`;
	const SWOOSH_URL = `${BASE_URL}sounds/swoosh.mp3`;
	// Stereo 64 kbps Opus: the always-on bed keeps its width, at just over half the mp3.
	const RAIN_URL = `${BASE_URL}sounds/skybox/rain.opus`;
	// The thunder takes, one per recording. Adding a take is one path here -- the picker
	// in weatherAudio.ts scales by itself. Kept as mono 48 kbps Opus: the claps are
	// low-frequency rumble through a non-positional bed, and the whole set is ~220 KB.
	const THUNDER_URLS = [
		`${BASE_URL}sounds/skybox/thunder-1.opus`,
		`${BASE_URL}sounds/skybox/thunder-2.opus`,
		`${BASE_URL}sounds/skybox/thunder-3.opus`,
		`${BASE_URL}sounds/skybox/thunder-4.opus`
	];

	let ostAudio = $state.raw<ThreeAudio>();
	let ambienceAudio = $state.raw<ThreeAudio>();
	let clickAudio = $state.raw<ThreeAudio>();
	let swooshAudio = $state.raw<ThreeAudio>();

	const playOneShot = (audio: ThreeAudio | undefined) => {
		if (!audio) return;
		if (audio.isPlaying) audio.stop();
		audio.play();
	};

	const playPolyphonic = (audio: ThreeAudio | undefined) => {
		if (!audio?.buffer) return;
		const clone = audio.clone() as ThreeAudio;
		clone.setVolume(audio.getVolume());
		clone.play();
	};

	$effect(() => {
		if (!ostAudio) return;
		if (settingsState.audio.musicEnabled) ostAudio.play();
		else ostAudio.pause();
	});

	$effect(() => {
		if (ostAudio) ostAudio.setVolume(settingsState.audio.musicVolume);
	});

	$effect(() => {
		if (!ambienceAudio) return;
		if (settingsState.audio.ambienceEnabled) ambienceAudio.play();
		else ambienceAudio.pause();
	});

	$effect(() => {
		if (ambienceAudio) ambienceAudio.setVolume(settingsState.audio.ambienceVolume);
	});

	$effect(() => {
		if (clickAudio) clickAudio.setVolume(settingsState.audio.sfxVolume);
	});

	$effect(() => {
		if (swooshAudio) swooshAudio.setVolume(settingsState.audio.sfxVolume);
	});

	$effect(() => {
		if (soundTriggers.click > 0 && settingsState.audio.sfxEnabled) {
			playOneShot(clickAudio);
			soundTriggers.click = 0;
		}
	});

	$effect(() => {
		if (soundTriggers.swoosh > 0 && settingsState.audio.sfxEnabled) {
			playPolyphonic(swooshAudio);
			soundTriggers.swoosh = 0;
		}
	});

	// ── Weather ────────────────────────────────────────────────────────────────────
	//
	// The rain bed and thunder claps live in ./weatherAudio.ts — the audio consumer of
	// the sky's plain state (descriptor + flashState), deliberately NOT in the render
	// layers, which unmount with the environment mode. This component only registers
	// the sound files and ticks the module; the full rationale is documented there.
	useTask((delta) => {
		tickWeatherAudio(delta);
	});
</script>

<Audio
	src={OST_URL}
	loop
	oncreate={(a: ThreeAudio) => {
		ostAudio = a;
		logSound.info('Audio loaded: OST');
	}}
	userData={{ hideInTree: true, selectable: false }}
/>

<Audio
	src={AMBIENCE_URL}
	loop
	oncreate={(a: ThreeAudio) => {
		ambienceAudio = a;
		logSound.info('Audio loaded: Ambience');
	}}
	userData={{ hideInTree: true, selectable: false }}
/>

<Audio
	src={CLICK_URL}
	oncreate={(a: ThreeAudio) => {
		clickAudio = a;
		logSound.info('Audio loaded: Click');
	}}
	userData={{ hideInTree: true, selectable: false }}
/>

<Audio
	src={SWOOSH_URL}
	oncreate={(a: ThreeAudio) => {
		swooshAudio = a;
		logSound.info('Audio loaded: Swoosh');
	}}
	userData={{ hideInTree: true, selectable: false }}
/>

<!-- Weather. The rain bed loops forever and is faded by volume rather than started and
     stopped per shower; thunder is one-shots — the takes above, one drawn at random per
     clap and cloned so strikes can overlap. All are played by ./weatherAudio.ts (ticked
     from the task above, never by an effect — the descriptor is not reactive by design). -->
<Audio
	src={RAIN_URL}
	loop
	autoplay={false}
	volume={0}
	oncreate={(a: ThreeAudio) => {
		attachRainAudio(a);
		logSound.info('Audio loaded: Rain');
	}}
	userData={{ hideInTree: true, selectable: false }}
/>

{#each THUNDER_URLS as url, i (url)}
	<Audio
		src={url}
		autoplay={false}
		oncreate={(a: ThreeAudio) => {
			attachThunderAudio(a);
			logSound.info(`Audio loaded: Thunder take ${i + 1}/${THUNDER_URLS.length}`);
		}}
		userData={{ hideInTree: true, selectable: false }}
	/>
{/each}
