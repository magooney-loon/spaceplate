<script module>
	export const soundTriggers = $state({
		click: 0
	});

	export const soundActions = {
		playClick() {
			soundTriggers.click++;
		}
	};
</script>

<script lang="ts">
	import { Audio } from '@threlte/extras';
	import { Audio as ThreeAudio } from 'three';
	import { settingsState, BASE_URL } from './settings.svelte.js';
	import { logSound } from './logger.svelte.js';

	const OST_URL = `${BASE_URL}sounds/ost.ogg`;
	const AMBIENCE_URL = `${BASE_URL}sounds/ambience.ogg`;
	const CLICK_URL = `${BASE_URL}sounds/click.mp3`;

	let ostAudio = $state.raw<ThreeAudio>();
	let ambienceAudio = $state.raw<ThreeAudio>();
	let clickAudio = $state.raw<ThreeAudio>();

	const playOneShot = (audio: ThreeAudio | undefined) => {
		if (!audio) return;
		if (audio.isPlaying) audio.stop();
		audio.play();
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
		if (soundTriggers.click > 0 && settingsState.audio.sfxEnabled) playOneShot(clickAudio);
	});
</script>

<Audio
	src={OST_URL}
	loop
	oncreate={(a) => {
		ostAudio = a;
		logSound.info('Audio loaded: OST');
	}}
	userData={{ hideInTree: true, selectable: false }}
/>

<Audio
	src={AMBIENCE_URL}
	loop
	oncreate={(a) => {
		ambienceAudio = a;
		logSound.info('Audio loaded: Ambience');
	}}
	userData={{ hideInTree: true, selectable: false }}
/>

<Audio
	src={CLICK_URL}
	oncreate={(a) => {
		clickAudio = a;
		logSound.info('Audio loaded: Click');
	}}
	userData={{ hideInTree: true, selectable: false }}
/>
