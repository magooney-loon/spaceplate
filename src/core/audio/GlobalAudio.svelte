<script module>
	export { soundTriggers, soundActions } from './globalAudio.svelte';
</script>

<script lang="ts">
	import { useTask } from '@threlte/core/webgpu';
	import { Audio, useAudioListener } from '@threlte/extras';
	import { Audio as ThreeAudio, type AudioListener as ThreeAudioListener } from 'three';
	import { settingsState, BASE_URL } from '$extensions/settings';
	import { logSound } from '$extensions/logger';
	import { soundTriggers } from './globalAudio.svelte';
	import {
		installMixer,
		routeToBus,
		syncMixerFromSettings,
		uninstallMixer,
		type BusId
	} from './mixer';
	import { attachRainAudio, attachThunderAudio, tickWeatherAudio } from './weatherAudio';

	// The bus graph hangs off Camera.svelte's <AudioListener/>, which mounts one line
	// earlier in App.svelte — so the listener is already registered when this script runs.
	// Typed by hand rather than via `ReturnType<typeof useAudioListener>`: that hook is
	// overloaded and `ReturnType` resolves to the LAST signature, not the no-arg one
	// (the same trap Capture.svelte documents).
	let audioContext: { listener: ThreeAudioListener; context: AudioContext } | null = null;
	try {
		audioContext = useAudioListener();
	} catch (error) {
		logSound.error('GlobalAudio: no AudioListener — audio will be unrouted', error);
	}
	if (audioContext) installMixer(audioContext.listener);

	/** Every voice goes to a bus on creation. Clones too — see routeToBus's header. */
	const onVoice = (bus: BusId, then?: (a: ThreeAudio) => void) => (a: ThreeAudio) => {
		routeToBus(a, bus);
		then?.(a);
	};

	const OST_URL = `${BASE_URL}sounds/ost.mp3`;
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

	const playPolyphonic = (audio: ThreeAudio | undefined, bus: BusId) => {
		if (!audio?.buffer) return;
		const clone = audio.clone() as ThreeAudio;
		// Before play(): a clone is built by `new Audio(listener)`, so it arrives wired
		// straight to the master, past every bus. Volume is the voice's own now — the
		// bus carries the setting.
		routeToBus(clone, bus);
		clone.setVolume(audio.getVolume());
		clone.play();
	};

	// THE ONE PLACE SETTINGS MEET THE GRAPH, replacing six per-voice volume effects.
	// `syncMixerFromSettings()` reads `settingsState.audio` synchronously, and Svelte 5
	// tracks reads at any call depth, so this is reactive without naming the fields here.
	// It only ever writes gain nodes, so there is no read-and-write-one-object loop.
	$effect(() => {
		syncMixerFromSettings();
	});

	// Audibility for the two loops is derived from SETTINGS, not from `busAudible()`:
	// the mixer's buses are plain objects (a bus changes on a settings write, not per
	// frame), so a `$derived` over them would never re-run — and even as state it would
	// race the sync effect above. `busAudible()` is for the task-driven consumers
	// (weatherAudio), which run after the graph is already in step.
	const masterAudible = $derived(settingsState.audio.masterVolume > 0);
	const musicAudible = $derived(
		masterAudible && settingsState.audio.musicEnabled && settingsState.audio.musicVolume > 0
	);
	const ambienceAudible = $derived(
		masterAudible && settingsState.audio.ambienceEnabled && settingsState.audio.ambienceVolume > 0
	);

	// Loops still gate on audibility, and that is a COST decision, not a correctness one
	// — the bus has already silenced them. A bed nobody can hear should not be decoding.
	$effect(() => {
		if (!ostAudio) return;
		if (musicAudible) ostAudio.play();
		else ostAudio.pause();
	});

	$effect(() => {
		if (!ambienceAudio) return;
		if (ambienceAudible) ambienceAudio.play();
		else ambienceAudio.pause();
	});

	// No `enabled` guard: a muted bus is silent anyway, and guarding here is what left
	// the counter above zero so an enable replayed a click from minutes ago.
	$effect(() => {
		if (soundTriggers.click > 0) {
			playOneShot(clickAudio);
			soundTriggers.click = 0;
		}
	});

	$effect(() => {
		if (soundTriggers.swoosh > 0) {
			playPolyphonic(swooshAudio, 'ui');
			soundTriggers.swoosh = 0;
		}
	});

	// Weather: rain bed + thunder claps live in ./weatherAudio.ts; this just ticks it.
	useTask(
		(delta) => {
			tickWeatherAudio(delta);
		},
		{ autoInvalidate: false }
	);

	// This component never unmounts in practice; the teardown is for HMR, which would
	// otherwise stack a second bus graph on the same listener.
	$effect(() => () => uninstallMixer());
</script>

<Audio
	src={OST_URL}
	loop
	oncreate={onVoice('music', (a) => {
		ostAudio = a;
	})}
	onload={() => trackAudioLoad()}
	onerror={() => trackAudioError('OST')}
	userData={{ hideInTree: true, selectable: false }}
/>

<Audio
	src={AMBIENCE_URL}
	loop
	oncreate={onVoice('ambience', (a) => {
		ambienceAudio = a;
	})}
	onload={() => trackAudioLoad()}
	onerror={() => trackAudioError('Ambience')}
	userData={{ hideInTree: true, selectable: false }}
/>

<Audio
	src={CLICK_URL}
	oncreate={onVoice('ui', (a) => {
		clickAudio = a;
	})}
	onload={() => trackAudioLoad()}
	onerror={() => trackAudioError('Click')}
	userData={{ hideInTree: true, selectable: false }}
/>

<Audio
	src={SWOOSH_URL}
	oncreate={onVoice('ui', (a) => {
		swooshAudio = a;
	})}
	onload={() => trackAudioLoad()}
	onerror={() => trackAudioError('Swoosh')}
	userData={{ hideInTree: true, selectable: false }}
/>

<!-- Rain bed loops forever, faded by volume; thunder is one-shots, cloned so strikes overlap. -->
<Audio
	src={RAIN_URL}
	loop
	autoplay={false}
	volume={0}
	oncreate={onVoice('ambience', attachRainAudio)}
	onload={() => trackAudioLoad()}
	onerror={() => trackAudioError('Rain')}
	userData={{ hideInTree: true, selectable: false }}
/>

{#each THUNDER_URLS as url, i (url)}
	<Audio
		src={url}
		autoplay={false}
		oncreate={onVoice('sfx', attachThunderAudio)}
		onload={() => trackAudioLoad()}
		onerror={() => trackAudioError(`Thunder take ${i + 1}`)}
		userData={{ hideInTree: true, selectable: false }}
	/>
{/each}
