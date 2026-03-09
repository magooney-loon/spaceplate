<script module>
	// Module-level: shared across all imports, not per-instance
	export const soundTriggers = $state({
		swoosh: 0,
		click: 0,
		currentAnimSound: '' as string
	});

	export const soundActions = {
		playSwoosh() {
			soundTriggers.swoosh++;
		},
		playClick() {
			soundTriggers.click++;
		},
		playAnimSound(action: string) {
			soundTriggers.currentAnimSound = action;
		},
		stopAnimSounds() {
			soundTriggers.currentAnimSound = '';
		}
	};
</script>

<script lang="ts">
	import { Audio } from '@threlte/extras';
	import { Audio as ThreeAudio } from 'three';
	import { settingsState, log } from './settings.svelte.js';

	// Place your audio files in /public/sounds/
	const base = import.meta.env.BASE_URL;
	const OST_URL = `${base}sounds/ost.ogg`;
	const AMBIENCE_URL = `${base}sounds/ambience.ogg`;
	const CLICK_URL = `${base}sounds/click.mp3`;
	const SWOOSH_URL = `${base}sounds/swoosh.mp3`;
	const ANIM_IDLE_URL = `${base}sounds/anim_idle.mp3`;
	const ANIM_WALK_URL = `${base}sounds/anim_walk.mp3`;
	const ANIM_RUN_URL = `${base}sounds/anim_run.mp3`;
	const ANIM_AGREE_URL = `${base}sounds/anim_agree.ogg`;
	const ANIM_HEAD_SHAKE_URL = `${base}sounds/anim_headshake.ogg`;

	// $state.raw — prevents Svelte 5 from wrapping class instances in a Proxy
	let ostAudio = $state.raw<ThreeAudio>();
	let ambienceAudio = $state.raw<ThreeAudio>();
	let clickAudio = $state.raw<ThreeAudio>();
	let swooshAudio = $state.raw<ThreeAudio>();
	let animIdleAudio = $state.raw<ThreeAudio>();
	let animWalkAudio = $state.raw<ThreeAudio>();
	let animRunAudio = $state.raw<ThreeAudio>();
	let animAgreeAudio = $state.raw<ThreeAudio>();
	let animHeadShakeAudio = $state.raw<ThreeAudio>();

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

	// ─── Animation sounds — single effect handles stop-then-play atomically ──

	$effect(() => {
		const animAudios = [animIdleAudio, animWalkAudio, animRunAudio, animAgreeAudio, animHeadShakeAudio];
		const vol = settingsState.audio.effectsVolume;

		// Keep volumes in sync
		for (const audio of animAudios) {
			if (audio) audio.setVolume(vol);
		}

		// Stop all, then play the active one
		for (const audio of animAudios) {
			if (audio?.isPlaying) audio.stop();
		}

		if (!soundTriggers.currentAnimSound || !settingsState.audio.effectsEnabled) return;

		const animAudioMap: Record<string, ThreeAudio | undefined> = {
			idle: animIdleAudio,
			walk: animWalkAudio,
			run: animRunAudio,
			agree: animAgreeAudio,
			headShake: animHeadShakeAudio
		};
		const target = animAudioMap[soundTriggers.currentAnimSound];
		if (target) playOneShot(target);
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
	userData={{ hideInTree: true, selectable: false }}
/>

<!-- Audio track 2: Ambience -->
<Audio
	src={AMBIENCE_URL}
	loop
	oncreate={(a) => {
		ambienceAudio = a;
		log.info('Audio loaded: Ambience');
	}}
	userData={{ hideInTree: true, selectable: false }}
/>

<!-- SFX 1: Click -->
<Audio
	src={CLICK_URL}
	oncreate={(a) => {
		clickAudio = a;
		log.info('Audio loaded: Click SFX');
	}}
	userData={{ hideInTree: true, selectable: false }}
/>

<!-- SFX 2: Swoosh (stage transitions) -->
<Audio
	src={SWOOSH_URL}
	oncreate={(a) => {
		swooshAudio = a;
		log.info('Audio loaded: Swoosh SFX');
	}}
	userData={{ hideInTree: true, selectable: false }}
/>

<!-- SFX 3–7: Character animation sounds — drop files in /public/sounds/ -->
<Audio
	src={ANIM_IDLE_URL}
	loop
	oncreate={(a) => {
		animIdleAudio = a;
		log.info('Audio loaded: Anim Idle SFX');
	}}
	userData={{ hideInTree: true, selectable: false }}
/>

<Audio
	src={ANIM_WALK_URL}
	loop
	oncreate={(a) => {
		animWalkAudio = a;
		log.info('Audio loaded: Anim Walk SFX');
	}}
	userData={{ hideInTree: true, selectable: false }}
/>

<Audio
	src={ANIM_RUN_URL}
	loop
	oncreate={(a) => {
		animRunAudio = a;
		log.info('Audio loaded: Anim Run SFX');
	}}
	userData={{ hideInTree: true, selectable: false }}
/>

<Audio
	src={ANIM_AGREE_URL}
	oncreate={(a) => {
		animAgreeAudio = a;
		log.info('Audio loaded: Anim Agree SFX');
	}}
	userData={{ hideInTree: true, selectable: false }}
/>

<Audio
	src={ANIM_HEAD_SHAKE_URL}
	oncreate={(a) => {
		animHeadShakeAudio = a;
		log.info('Audio loaded: Anim Head Shake SFX');
	}}
	userData={{ hideInTree: true, selectable: false }}
/>
