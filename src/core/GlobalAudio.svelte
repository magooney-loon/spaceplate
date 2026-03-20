<script module>
	export const soundTriggers = $state({
		click: 0,
		swoosh: 0
	});

	export const soundActions = {
		playClick() {
			soundTriggers.click++;
		},
		playSwoosh() {
			soundTriggers.swoosh++;
		}
	};
</script>

<script lang="ts">
	import { Audio } from '@threlte/extras';
	import { Audio as ThreeAudio } from 'three';
	import { settingsState, BASE_URL } from '$extensions/settings/settings.svelte';
	import { logSound } from '$extensions/logger/logger.svelte';

	const OST_URL = `${BASE_URL}sounds/ost.ogg`;
	const AMBIENCE_URL = `${BASE_URL}sounds/ambience.ogg`;
	const CLICK_URL = `${BASE_URL}sounds/click.mp3`;
	const SWOOSH_URL = `${BASE_URL}sounds/swoosh.mp3`;

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

<Audio
	src={SWOOSH_URL}
	oncreate={(a) => {
		swooshAudio = a;
		logSound.info('Audio loaded: Swoosh');
	}}
	userData={{ hideInTree: true, selectable: false }}
/>
