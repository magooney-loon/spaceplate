<script lang="ts">
	import { T, useTask } from '@threlte/core/webgpu';
	import type { Group } from 'three';
	import { audio, soundsReady } from '$core';
	import { detachCarAudio, initCarAudio, tickCarAudio } from './carAudio';

	// The engine's speakers, as ANCHORS: five groups the registry parents its voices
	// into (initCarAudio, below) — nothing is mounted here any more. The voices are
	// core/audio's, created through the scene's SCOPE so unmount stops them; every
	// mixing decision (rpm crossfade, pitch, tyre squeal, scrape) lives in carAudio.ts,
	// ticked by the task below, and the sound DATA lives in carSounds.ts. Positional
	// because the AudioListener rides the camera (core/Camera.svelte): the engine falls
	// behind with the car and panners HRTF around it. Tab-hide parking is the engine's
	// too (AudioRuntime parks loops) — no visibility listener here.

	let engineBay = $state.raw<Group | undefined>();
	let cabin = $state.raw<Group | undefined>();
	let body = $state.raw<Group | undefined>();
	let tyres = $state.raw<Group | undefined>();
	let sills = $state.raw<Group | undefined>();

	const scope = audio.scope();

	$effect(() => {
		let cancelled = false;
		void soundsReady().then(() => {
			if (cancelled || !engineBay || !cabin || !body || !tyres || !sills) return;
			initCarAudio(scope, { engineBay, cabin, body, tyres, sills });
		});
		return () => {
			cancelled = true;
			// Stops every voice the scope made — loops and one-shots alike — which is
			// the old parkCarAudio/detach pair's audio work in one call.
			scope.release();
			detachCarAudio();
		};
	});

	useTask(
		(delta) => {
			tickCarAudio(delta);
		},
		// autoInvalidate OFF, as everywhere — an audio tick must not force frames.
		{ autoInvalidate: false }
	);
</script>

<!-- Car-local model metres, nose -Z (CarHeadlights' sibling notes): the FA24 sits
     front-mid, so the bed speaks from the engine bay, not the cabin floor. -->
<T.Group
	position={[0, 0.5, -1]}
	userData={{ hideInTree: true, selectable: false }}
	bind:ref={engineBay}
/>

<!-- The handbrake pair: PULL on Space's rising edge, RELEASE on the fall — cabin,
     between the seats: the lever is the speaker, not the tyres it locks (the
     squeal already owns those). -->
<T.Group
	position={[0, 0.5, 0.5]}
	userData={{ hideInTree: true, selectable: false }}
	bind:ref={cabin}
/>

<!-- Pops + scrape HITS: at the car's ORIGIN, no offset of its own — per-play
     `position`s (the flames' TIP_L/TIP_R, the hull contact) land in this same
     model-metre space. -->
<T.Group userData={{ hideInTree: true, selectable: false }} bind:ref={body} />

<!-- The tyre-squeal loop: under the car, not the engine bay — tyres speak from the
     contact patches, so axle height between the axles (the CG). One voice for all
     four corners; level = the loosest of the six sources, slewed by the tick. -->
<T.Group
	position={[0, 0.3, 0]}
	userData={{ hideInTree: true, selectable: false }}
	bind:ref={tyres}
/>

<!-- The chassis-scrape LOOP under the sills, a shade lower than the squeal (bare
     metal drags lower than rubber). -->
<T.Group
	position={[0, 0.2, 0]}
	userData={{ hideInTree: true, selectable: false }}
	bind:ref={sills}
/>
