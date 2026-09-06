<script lang="ts">
	import { T, useTask } from '@threlte/core/webgpu';
	import { PositionalAudio } from '@threlte/extras';
	import type { PositionalAudio as ThreePositionalAudio } from 'three';
	import { BASE_URL } from '$extensions/settings';
	import { sceneState } from '$extensions/scene';
	import {
		LAYER_FILES,
		attachEngineLayer,
		detachCarAudio,
		parkCarAudio,
		tickCarAudio
	} from './carAudio';

	// The engine's speakers. Mounts the positional rpm bed inside the car and
	// nothing else — every mixing decision (rpm crossfade, pitch, throttle load)
	// lives in carAudio.ts, ticked by the task below. Positional because the
	// AudioListener rides the camera (core/Camera.svelte): the engine falls behind
	// with the car and panners HRTF around it. Same <PositionalAudio> component
	// DemoScene's orbiting mirror sphere uses.

	const ENGINE_URL = `${BASE_URL}sounds/engine/`;

	// World units (2.5/m): the chase cam trails ~8–15 u off the tail, so
	// refDistance 10 keeps the engine at full presence at normal framing and lets
	// it fall off across a city block. Scene-local numbers on purpose — when the
	// engine's audio layer grows per-scene needs these move to the sound extension.
	const REF_DISTANCE = 10;
	const ROLLOFF = 1.4;
	const MAX_DISTANCE = 300;

	useTask(
		(delta) => {
			tickCarAudio(delta);
		},
		// autoInvalidate OFF, as everywhere — an audio tick must not force frames.
		{ autoInvalidate: false }
	);

	// Keep-alive: this component stays mounted while other scenes are current —
	// park the engine then (NitrousAfterimage pattern). Re-entry resumes the loops
	// from their paused positions, no seam.
	$effect(() => {
		if (sceneState.currentScene !== 'testGame') return;
		return () => parkCarAudio();
	});

	// rAF stops when the tab hides but the AudioContext doesn't — without this the
	// engine drones at its last pitch behind a hidden tab. Re-showing hands control
	// straight back to the tick, which resumes the paused loops where they were.
	const onVisibility = () => {
		if (document.hidden) parkCarAudio();
	};
	$effect(() => {
		document.addEventListener('visibilitychange', onVisibility);
		return () => {
			document.removeEventListener('visibilitychange', onVisibility);
			parkCarAudio();
		};
	});

	// The scene is keep-alive, so this runs on real teardown only — still, the
	// module must not keep pointing at dead instances.
	$effect(() => () => detachCarAudio());
</script>

<!-- Car-local model metres, nose -Z (CarHeadlights' sibling notes): the FA24 sits
     front-mid, so the bed speaks from the engine bay, not the cabin floor. -->
<T.Group position={[0, 0.5, -1]} userData={{ hideInTree: true, selectable: false }}>
	<!-- The rpm bed: idle + rpm1..5, crossfaded and pitch-tracked in carAudio.ts.
	     loop + volume 0 + autoplay false — the tick owns when these are heard, so
	     nothing sounds before the settings say so (autoplay policy + sfx toggle). -->
	{#each LAYER_FILES as file, i (file)}
		<PositionalAudio
			src={ENGINE_URL + file}
			loop
			autoplay={false}
			volume={0}
			refDistance={REF_DISTANCE}
			rolloffFactor={ROLLOFF}
			maxDistance={MAX_DISTANCE}
			oncreate={(a: ThreePositionalAudio) => attachEngineLayer(i, a)}
		/>
	{/each}
</T.Group>
