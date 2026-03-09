<script lang="ts">
	import { T } from '@threlte/core';
	import { AudioListener, Audio } from '@threlte/extras';
	import { CameraControls, type CameraControlsRef } from '@threlte/extras';
	import { settingsState } from './settings.svelte.js';
	import { cameraActions, getCurrentStage } from './stage.svelte.js';
	import { Audio as ThreeAudio, type PerspectiveCamera } from 'three';

	// Place your audio files in /public/sounds/ and update these paths
	const OST_URL = '/sounds/ost.ogg';
	const AMBIENCE_URL = '/sounds/ambience.ogg';

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
		cameraActions.applyCameraForStage(getCurrentStage());
	});

	const handleAudioCreate = (audio: ThreeAudio) => {
		audioRef = audio;

		return () => {
			if (audio.isPlaying) audio.stop();
			audioRef = undefined;
			started = false;
		};
	};

	const handleAmbienceAudioCreate = (audio: ThreeAudio) => {
		ambienceAudioRef = audio;

		return () => {
			if (audio.isPlaying) audio.stop();
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

	<!-- Audio track 1: OST / background music -->
	<Audio
		src={OST_URL}
		loop
		volume={0.69}
		autoplay={settingsState.audio.musicEnabled}
		oncreate={handleAudioCreate}
	/>

	<!-- Audio track 2: Ambience -->
	<Audio
		src={AMBIENCE_URL}
		loop
		volume={0.5}
		autoplay={settingsState.audio.ambienceEnabled}
		oncreate={handleAmbienceAudioCreate}
	/>
</T.PerspectiveCamera>
