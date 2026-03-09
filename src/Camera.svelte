<script lang="ts">
	import { T } from '@threlte/core';
	import { AudioListener, Audio } from '@threlte/extras';
	import { CameraControls, type CameraControlsRef } from '@threlte/extras';
	import ost from '$lib/assets/sound/ost.ogg';
	import ambience from '$lib/assets/sound/ambience.ogg';
	import { settingsState } from './settings.svelte.js';
	import { cameraActions, getCurrentStage } from './stage.svelte.js';
	import { profileGetters } from '$lib/game/profile.svelte.js';
	import { Audio as ThreeAudio, type PerspectiveCamera } from 'three';

	let audioRef = $state.raw<ThreeAudio>();
	let ambienceAudioRef = $state.raw<ThreeAudio>();
	let started = $state(false);
	let ambienceStarted = $state(false);
	let controls = $state<CameraControlsRef>();

	const resumeAudioContext = async () => {
		if (audioRef && !started) {
			await audioRef.context.resume();
			started = true;
		}
	};

	const resumeAmbienceAudioContext = async () => {
		if (ambienceAudioRef && !ambienceStarted) {
			await ambienceAudioRef.context.resume();
			ambienceStarted = true;
		}
	};

	$effect(() => {
		if (audioRef) {
			if (settingsState.audio.musicEnabled) {
				resumeAudioContext();
				audioRef.play();
			} else {
				audioRef.pause();
			}
		}
	});

	$effect(() => {
		if (ambienceAudioRef) {
			if (settingsState.audio.ambienceEnabled) {
				resumeAmbienceAudioContext();
				ambienceAudioRef.play();
			} else {
				ambienceAudioRef.pause();
			}
		}
	});

	const handleCameraCreate = (camera: PerspectiveCamera) => {
		camera.lookAt(0, 0, 0);

		return () => {
			console.log('Camera disposed');
		};
	};

	const handleControlsCreate = (controlsRef: CameraControlsRef) => {
		controls = controlsRef;
		cameraActions.setCameraControls(controlsRef);

		return () => {
			cameraActions.setCameraControls(undefined);
			controls = undefined;
		};
	};

	$effect(() => {
		if (!controls) return;

		const stage = getCurrentStage();

		// If going to home stage and viewing a moon, use moon camera
		if (stage === 'home') {
			const selectedPlanet = profileGetters.selectedPlanet;
			if (selectedPlanet?.celestialBodyType === 'Moon') {
				cameraActions.applyCameraForMoon();
				return;
			}
		}

		cameraActions.applyCameraForStage(stage);
	});

	const handleAudioCreate = (audio: ThreeAudio) => {
		audioRef = audio;

		return () => {
			if (audio.isPlaying) {
				audio.stop();
			}
			audioRef = undefined;
			started = false;
		};
	};

	const handleAmbienceAudioCreate = (audio: ThreeAudio) => {
		ambienceAudioRef = audio;

		return () => {
			if (audio.isPlaying) {
				audio.stop();
			}
			ambienceAudioRef = undefined;
			ambienceStarted = false;
		};
	};
</script>

<T.PerspectiveCamera
	position={[0, 0, 10]}
	fov={60}
	near={0.001}
	far={144}
	makeDefault
	oncreate={handleCameraCreate}
>
	<AudioListener />

	<CameraControls enabled={false} bind:ref={controls} oncreate={handleControlsCreate} />

	<Audio
		src={ost}
		loop
		volume={0.69}
		autoplay={settingsState.audio.musicEnabled}
		oncreate={handleAudioCreate}
	/>

	<Audio
		src={ambience}
		loop
		volume={0.5}
		autoplay={settingsState.audio.ambienceEnabled}
		oncreate={handleAmbienceAudioCreate}
	/>
</T.PerspectiveCamera>
