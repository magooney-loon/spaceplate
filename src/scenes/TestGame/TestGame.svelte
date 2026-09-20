<script lang="ts">
	import { onDestroy } from 'svelte';
	import { useDraco, useKtx2, useMeshopt } from '@threlte/extras';
	import * as THREE from 'three/webgpu';
	import { useInputMap } from '$extensions/input';
	import { CAR_TOGGLE_SLOTS, carControls } from './sim/carControls';
	import { applyCarToggle } from './sim/carSwitches.svelte';
	import { carGarage } from './cars';
	import Track from './world/Track.svelte';
	import PlayerCar from './PlayerCar.svelte';

	// Test Game 3D scene — the COMPOSITION layer, and only that: the world
	// (world/Track.svelte — the GLB, its colliders, its shadow policy; adding a
	// map is a sibling there), the player's car (PlayerCar.svelte — everything
	// car-shaped, mounted only once a car has been CHOSEN, see below) and the
	// scene's shared decoders and input map.
	//
	// Everything else is one directory down: the driving model in sim/
	// (controller.ts owns the physics task's brain, drivetrain.ts the
	// engine/gearbox, handling.ts the tune contract), and the car's facts as
	// DATA in cars/ (see cars/types.ts — adding a car is a spec file + a
	// registry entry, not component edits).
	//
	// Controls are DECLARED, not hand-rolled: sim/carControls.ts is this scene's
	// input map and the engine owns the rest (keys, rebinding in Settings ▸
	// Controls, persistence, gamepad, blur release). Defaults are unchanged —
	// arrows drive, Space handbrake, Q/E shift down/up, either Shift nitrous, L
	// lights, K main beam — because they are still chosen to dodge Studio's
	// bare-letter binds (w a s z t r c v m; Shift is a modifier, invisible to
	// them). What LATCHES is still this scene's (sim/carSwitches.svelte.ts).

	// Both the track and the cars are draco + KTX2 compressed, so the decoders must be
	// handed to useGltf (same setup as the gltf-viewer extension: DRACO/KTX2 fetch their
	// decoder binaries on demand from a CDN pinned to the installed three version;
	// Meshopt ships in three). Built ONCE here and passed down as props, so the whole
	// scene shares one loader set — a second KTX2Loader would spin up its own
	// transcoder workers for nothing.
	const threeCdn = `https://cdn.jsdelivr.net/npm/three@0.${THREE.REVISION}`;
	const dracoLoader = useDraco(`${threeCdn}/examples/jsm/libs/draco/gltf/`);
	const meshoptDecoder = useMeshopt();
	const ktx2Loader = useKtx2(`${threeCdn}/examples/jsm/libs/basis/`);

	const decoders = { dracoLoader, meshoptDecoder, ktx2Loader };

	// ── Input ────────────────────────────────────────────────────────────────────
	//
	// The map is live while this SCENE is mounted — not while the car is, so a
	// Garage switch (which remounts PlayerCar below) never churns the activation.
	// Leaving the scene deactivates the slots (which zeroes the pedals — the job
	// `resetCarInput` used to do), and the engine already releases every device on
	// blur and tab-hide. The typing guard, the preventDefault pass and the
	// both-Shifts-are-one-pedal bookkeeping are all the engine's now — see
	// core/input/Keymapper.svelte. The PEDALS are read from the map inside the
	// controller's physics task (PlayerCar's); only the latched SWITCHES are edges,
	// and those are subscribed here.
	useInputMap(carControls);

	// The five LATCHED switches. `on(…, 'press')` fires exactly once per real press
	// because it is an edge from the key event itself, not a keydown — so there is no
	// auto-repeat to filter (holding L used to strobe the car), and nothing polls
	// `justPressed` from the physics task, which would fire once per SUBSTEP.
	// What a press MEANS stays in sim/carSwitches.svelte.ts.
	for (const slot of CAR_TOGGLE_SLOTS) {
		onDestroy(carControls.on(slot, 'press', () => applyCarToggle(slot)));
	}
</script>

<!-- The world — the track GLB, its scene pose, its static colliders and its
     half of the shadow policy. Maps live in world/; see world/Track.svelte
     (decoders passed down so the scene shares ONE loader set with the car).
     CAR-AGNOSTIC, and mounted OUTSIDE the key below on purpose: a Garage
     switch must not re-parse the track's scene graph, rebuild its trimesh
     colliders or re-contour the minimap (~35 ms) — none of that is car work. -->
<Track {decoders} />

<!-- The player's car — the GLB, the chassis body, the driving task, the fx and
     the camera rigs. Everything in there reads `currentCar()` once at init, so
     switching cars is a REMOUNT of exactly this subtree (cars/garage.svelte.ts).
     THE FIRST CAR IS A CHOICE: until the player has taken delivery
     (carGarage.picked — the Garage shop holds itself open with no close until
     then) nothing car-shaped mounts at all, the track above is already up and
     the app camera idles at its boot vantage. The first pick MOUNTS this; every
     later pick flips currentId and the key rebuilds it against the new spec. -->
{#if carGarage.picked}
	{#key carGarage.currentId}
		<PlayerCar {decoders} />
	{/key}
{/if}
