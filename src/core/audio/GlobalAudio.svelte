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
	import { descriptor, rainAmount, snowAmount } from '$core/skybox/model';
	import { flashState } from '$core/skybox/flashState';

	const OST_URL = `${BASE_URL}sounds/ost.ogg`;
	const AMBIENCE_URL = `${BASE_URL}sounds/ambience.ogg`;
	const CLICK_URL = `${BASE_URL}sounds/click.mp3`;
	const SWOOSH_URL = `${BASE_URL}sounds/swoosh.mp3`;
	const RAIN_URL = `${BASE_URL}sounds/skybox/rain.mp3`;
	const THUNDER_URL = `${BASE_URL}sounds/skybox/thunder.wav`;

	let ostAudio = $state.raw<ThreeAudio>();
	let ambienceAudio = $state.raw<ThreeAudio>();
	let clickAudio = $state.raw<ThreeAudio>();
	let swooshAudio = $state.raw<ThreeAudio>();
	let rainAudio = $state.raw<ThreeAudio>();
	let thunderAudio = $state.raw<ThreeAudio>();

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
	// Driven from a TASK, not an effect. The sky descriptor is a plain mutable object that
	// one writer updates every frame (DOCS/weather-system.md §14.1) -- nothing about it is
	// tracked, so an `$effect` reading `descriptor.weather.precipitation` would run once at
	// mount and never again. The rest of the subsystem reads it from tasks for the same
	// reason; this is the audio consumer of the same contract.
	//
	// The `<Audio>` elements still live here rather than in a skybox component, because
	// this one never unmounts (see src/CLAUDE.md) -- a looping bed torn down and rebuilt on
	// a scene change is exactly the race that rule exists to prevent.

	/** Rain is an ambience bed, so it rides the ambience settings, not sfx. */
	let rainLevel = 0;
	/** Seconds for the rain bed to fade in and out. Slow: weather does not switch on. */
	const RAIN_FADE = 1.6;
	/** Snow is nearly silent, but not silent -- a whiteout has a hiss to it. */
	const SNOW_SHARE = 0.18;

	/**
	 * Metres per second. Real thunder is the same event as the flash arriving late, and
	 * that delay is most of what gives a storm a sense of scale -- a bolt overhead cracks
	 * within a second, one on the horizon rumbles ten seconds after you saw it.
	 */
	const SPEED_OF_SOUND = 343;
	/** Distance at which a strike is inaudible. Beyond this no thunder is scheduled. */
	const THUNDER_RANGE = 4200;

	let lastStrikeId = flashState.strikeId;
	/** Thunder claps waiting on their travel time. Small and short-lived; rarely over 3. */
	const pendingThunder: { atMs: number; volume: number }[] = [];

	useTask((delta) => {
		const w = descriptor.weather;

		// One bed for both, weighted: rain is loud, snow is a faint hiss. Using the shared
		// split means the bed follows sleet across the blend instead of cutting out.
		const target = rainAmount(w) + snowAmount(w) * SNOW_SHARE;

		// Framerate-independent one-pole, as the sky layers use. A hard cut here would
		// click, and worse, would make a 20 s weather blend arrive instantly in the audio
		// while it was still ramping visually.
		rainLevel += (target - rainLevel) * (1 - Math.exp(-delta / RAIN_FADE));

		// The buffer guard is not paranoia: `src` is fetched asynchronously, so there are
		// real frames after mount where the Audio object exists with nothing in it, and
		// `play()` on an empty buffer starts a silent source that then refuses the real one.
		if (rainAudio?.buffer) {
			const audible = rainLevel > 0.004 && settingsState.audio.ambienceEnabled;
			// Volume first, then play -- otherwise the frame a shower starts on gets one
			// buffer's worth of rain at whatever level was left over.
			rainAudio.setVolume(rainLevel * settingsState.audio.ambienceVolume);
			if (audible && !rainAudio.isPlaying) rainAudio.play();
			else if (!audible && rainAudio.isPlaying) rainAudio.pause();
		}

		// A new strike: schedule its thunder for when the sound would actually arrive.
		if (flashState.strikeId !== lastStrikeId) {
			lastStrikeId = flashState.strikeId;
			const distance = flashState.strikeDistance;
			if (distance < THUNDER_RANGE && settingsState.audio.sfxEnabled) {
				pendingThunder.push({
					atMs: performance.now() + (distance / SPEED_OF_SOUND) * 1000,
					// Inverse falloff rather than inverse-square: thunder carries far better
					// than the point-source law suggests, and squared attenuation makes
					// anything past a few hundred metres inaudible.
					volume: Math.max(0.08, 1 - distance / THUNDER_RANGE)
				});
			}
		}

		if (pendingThunder.length > 0) {
			const now = performance.now();
			for (let i = pendingThunder.length - 1; i >= 0; i--) {
				if (pendingThunder[i].atMs > now) continue;
				const { volume } = pendingThunder[i];
				pendingThunder.splice(i, 1);
				// Polyphonic: a storm can easily put a second strike in the air before the
				// first has finished rolling, and cutting one off to start the next is the
				// one thing that would make it read as a sound effect rather than weather.
				if (settingsState.audio.sfxEnabled && thunderAudio?.buffer) {
					const clone = thunderAudio.clone() as ThreeAudio;
					clone.setVolume(volume * settingsState.audio.sfxVolume);
					clone.play();
				}
			}
		}
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
     stopped per shower; thunder is a one-shot, cloned per clap so strikes can overlap.
     Both are driven by the task above, never by an effect -- the descriptor is not
     reactive by design. -->
<Audio
	src={RAIN_URL}
	loop
	autoplay={false}
	volume={0}
	oncreate={(a: ThreeAudio) => {
		rainAudio = a;
		logSound.info('Audio loaded: Rain');
	}}
	userData={{ hideInTree: true, selectable: false }}
/>

<Audio
	src={THUNDER_URL}
	autoplay={false}
	oncreate={(a: ThreeAudio) => {
		thunderAudio = a;
		logSound.info('Audio loaded: Thunder');
	}}
	userData={{ hideInTree: true, selectable: false }}
/>
