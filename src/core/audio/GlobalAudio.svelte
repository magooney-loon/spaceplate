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

	// One summary line once every file has settled. onload/onerror (not oncreate) are
	// the hooks, so this counts decoded buffers, not mounted components; a failure
	// logs per-file immediately and downgrades the summary to x/y.
	const AUDIO_TOTAL = 5 + THUNDER_URLS.length;
	let settled = 0;
	let failed = 0;
	const summarize = () => {
		if (settled < AUDIO_TOTAL) return;
		if (failed > 0) {
			logSound.error(`Audio files loaded (${AUDIO_TOTAL - failed}/${AUDIO_TOTAL})`);
		} else {
			logSound.info(`All audio files loaded (${AUDIO_TOTAL})`);
		}
	};
	const trackAudioLoad = () => {
		settled++;
		summarize();
	};
	const trackAudioError = (label: string) => {
		settled++;
		failed++;
		logSound.error(`Audio failed to load: ${label}`);
		summarize();
	};

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

	// ── Weather ──────────────────────────────────────────────────────────────────
	//
	// The rain bed and thunder claps live in ./weatherAudio.ts (rationale in its
	// header and audio/CLAUDE.md). This component only registers the sound files and
	// ticks the module — never an $effect; the descriptor is plain state.
	useTask(
		(delta) => {
			tickWeatherAudio(delta);
		},
		// autoInvalidate OFF, as everywhere else — an audio tick must not force frames.
		// The main stage runs every rAF regardless of draws, so the tick is unaffected.
		{ autoInvalidate: false }
	);
</script>

<Audio
	src={OST_URL}
	loop
	oncreate={(a: ThreeAudio) => {
		ostAudio = a;
	}}
	onload={() => trackAudioLoad()}
	onerror={() => trackAudioError('OST')}
	userData={{ hideInTree: true, selectable: false }}
/>

<Audio
	src={AMBIENCE_URL}
	loop
	oncreate={(a: ThreeAudio) => {
		ambienceAudio = a;
	}}
	onload={() => trackAudioLoad()}
	onerror={() => trackAudioError('Ambience')}
	userData={{ hideInTree: true, selectable: false }}
/>

<Audio
	src={CLICK_URL}
	oncreate={(a: ThreeAudio) => {
		clickAudio = a;
	}}
	onload={() => trackAudioLoad()}
	onerror={() => trackAudioError('Click')}
	userData={{ hideInTree: true, selectable: false }}
/>

<Audio
	src={SWOOSH_URL}
	oncreate={(a: ThreeAudio) => {
		swooshAudio = a;
	}}
	onload={() => trackAudioLoad()}
	onerror={() => trackAudioError('Swoosh')}
	userData={{ hideInTree: true, selectable: false }}
/>

<!-- Weather. The rain bed loops forever, faded by volume rather than started/stopped
     per shower; thunder is one-shots, cloned so strikes overlap. All are played by
     ./weatherAudio.ts via the task above, never by an effect. -->
<Audio
	src={RAIN_URL}
	loop
	autoplay={false}
	volume={0}
	oncreate={(a: ThreeAudio) => {
		attachRainAudio(a);
	}}
	onload={() => trackAudioLoad()}
	onerror={() => trackAudioError('Rain')}
	userData={{ hideInTree: true, selectable: false }}
/>

{#each THUNDER_URLS as url, i (url)}
	<Audio
		src={url}
		autoplay={false}
		oncreate={(a: ThreeAudio) => {
			attachThunderAudio(a);
		}}
		onload={() => trackAudioLoad()}
		onerror={() => trackAudioError(`Thunder take ${i + 1}`)}
		userData={{ hideInTree: true, selectable: false }}
	/>
{/each}
