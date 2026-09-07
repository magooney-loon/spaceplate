<script lang="ts">
	import { T } from '@threlte/core/webgpu';
	import { useGltf, useDraco, useKtx2, useMeshopt } from '@threlte/extras';
	import { Collider, RigidBody, usePhysicsTask } from '@threlte/rapier';
	import {
		CoefficientCombineRule,
		type RigidBody as RapierRigidBody
	} from '@dimforge/rapier3d-compat';
	import * as THREE from 'three/webgpu';
	import type { Mesh } from 'three/webgpu';
	import { BASE_URL } from '$extensions/settings';
	import { logGltf } from '$extensions/logger';
	import CarHeadlights from './fx/CarHeadlights.svelte';
	import CarExhaustFlames from './fx/CarExhaustFlames.svelte';
	import CarEngineAudio from './audio/CarEngineAudio.svelte';
	import CarWheels from './fx/CarWheels.svelte';
	import ChaseCamera from './ChaseCamera.svelte';
	import SkidMarks from './fx/SkidMarks.svelte';
	import TireSmoke from './fx/TireSmoke.svelte';
	import NitrousAfterimage from './fx/NitrousAfterimage.svelte';
	import {
		CAR_INPUT_KEYS,
		CAR_TOGGLE_KEYS,
		applyCarToggle,
		carRestart,
		resetCarInput,
		setCarInputKey
	} from './sim/carInput.svelte';
	import { currentCar } from './cars';
	import { UNITS_PER_METER } from './units';
	import { createCarController } from './sim/controller';
	import { buildCityColliders } from './cityColliders';
	import { resetCarTelemetry } from './sim/carTelemetry.svelte';

	// Test Game 3D scene — the driving prototype's composition layer. The driving
	// model itself lives in sim/ (controller.ts owns the physics task's brain,
	// drivetrain.ts the engine/gearbox, handling.ts the tune contract); the car's
	// facts are DATA in cars/ (see cars/types.ts — adding a car is a spec file +
	// a registry entry, not component edits). Controls: arrows drive, Space
	// handbrake, Q/E shift down/up, either Shift nitrous, L lights, K main beam —
	// deliberately keys Studio doesn't bind (w a s z t r c v m — Shift is a
	// modifier, invisible to its bare-letter binds). Input is this scene's own
	// svelte:window keymap (sim/carInput.svelte.ts), not the shared keymapper —
	// that needs a per-scene rework first.

	const car = currentCar();
	// T.Group's position/rotation props want mutable tuples; the spec's are
	// readonly data. Widened once, here, at the only consumer.
	const spawnPosition = [...car.model.spawn.position] as [number, number, number];
	const spawnRotation = [...car.model.spawn.rotation] as [number, number, number];

	// Both models are draco + KTX2 compressed, so the decoders must be handed to useGltf
	// (same setup as the gltf-viewer extension: DRACO/KTX2 fetch their decoder binaries
	// on demand from a CDN pinned to the installed three version; Meshopt ships in three).
	const threeCdn = `https://cdn.jsdelivr.net/npm/three@0.${THREE.REVISION}`;
	const dracoLoader = useDraco(`${threeCdn}/examples/jsm/libs/draco/gltf/`);
	const meshoptDecoder = useMeshopt();
	const ktx2Loader = useKtx2(`${threeCdn}/examples/jsm/libs/basis/`);

	const decoders = { dracoLoader, meshoptDecoder, ktx2Loader };

	const city = useGltf(`${BASE_URL}models/testgame/track.glb`, decoders);
	const carModel = useGltf(car.model.url, decoders);

	// Static collision for the city — built once when the GLB lands. Hand-rolled
	// instead of <AutoColliders> because the trimesh flags (FIX_INTERNAL_EDGES,
	// which stops ghost bumps at internal triangle seams on the flat roads) can
	// only be passed through explicit args. See cityColliders.ts.
	const cityColliders = $derived($city?.scene ? buildCityColliders($city.scene) : []);

	$effect(() => {
		if ($city?.scene) logGltf.info('TestGame track loaded');
		if ($carModel?.scene) logGltf.info(`TestGame car loaded (${car.label})`);
	});

	// ── Shadow casting is a POLICY, not a blanket flag ──────────────────────────
	//
	// This used to be `castShadow = receiveShadow = true` on every mesh in both
	// GLBs, and that was wrong in both directions at once. `SkyLight` auto-fits
	// its ONE shadow cascade to the bounding sphere of the visible CASTERS
	// (core/skybox/CLAUDE.md), clamped at `maxShadowRadius` = 400 world units.
	// The track's `Metal` mesh spans ~2 970 × 2 540 world units, so:
	//
	//   • the fit saturated at 400 and centred on the caster bounds — roughly
	//     (-1086, ., -118) world, about 1 090 units from where the car spawns
	//     and drives. The car sat entirely OUTSIDE the shadow frustum, so it
	//     cast no shadow, and the asphalt received none either. There were no
	//     sun shadows anywhere the player could go;
	//   • and the engine paid for that every single frame: `needsUpdate` is
	//     armed each frame (the car moves), so all 313 725 city triangles and
	//     324 640 car triangles — 5 + 29 draw calls — were re-rendered into the
	//     2048² map to produce nothing.
	//
	// So: THE CAR CASTS, THE WORLD RECEIVES. With the city out of the caster
	// set the fit collapses to the `shadowRadius` floor (20) centred on the car,
	// which is a 2 cm texel instead of a 39 cm one — the car finally has a sharp
	// shadow — and the shadow pass draws the car alone.
	//
	// Flip this on to get building/tree shadows back, and read the paragraph
	// above first: at this city's size the single cascade cannot serve both, and
	// `CSMShadowNode` (DOCS/best-practices.md §2.6) is the honest answer.
	const CITY_CASTS_SHADOWS = false;
	/** Which city materials would cast, if they did. Ground/Asphalt are the flat
	 *  surfaces the shadows land ON, and Decals are painted onto them — 51 062
	 *  triangles that can only ever shadow themselves. */
	const CITY_CASTERS = new Set(['Metal', 'Leafs_Mat']);
	/** Car materials that are interior or engine: never part of the car's
	 *  silhouette, so they cast nothing the bodywork doesn't already cast.
	 *  117 176 of the model's 324 640 triangles, and 14 of its 29 meshes, out of
	 *  the shadow pass for no visible difference. */
	const CAR_NON_CASTERS = new Set([
		'Engine',
		'Engine_Alpha',
		'Interior_Plastic',
		'Interior_Accents',
		'Leather',
		'Leather_2',
		'Seat',
		'Seat_Belt',
		'Carpet',
		'Carpet_2',
		'Speaker',
		'Screen',
		'Screen_2',
		'Mirror'
	]);

	const materialName = (mesh: Mesh): string =>
		(mesh.material as THREE.Material | undefined)?.name ?? '';

	$effect(() => {
		const roots: [THREE.Object3D | undefined, (mesh: Mesh) => boolean][] = [
			[$city?.scene, (mesh) => CITY_CASTS_SHADOWS && CITY_CASTERS.has(materialName(mesh))],
			[$carModel?.scene, (mesh) => !CAR_NON_CASTERS.has(materialName(mesh))]
		];
		for (const [root, casts] of roots) {
			if (!root) continue;
			root.traverse((obj) => {
				const mesh = obj as Mesh;
				if (!mesh.isMesh) return;
				mesh.castShadow = casts(mesh);
				mesh.receiveShadow = true;
			});
		}
	});

	// ── Input (this scene's own keymap) ──────────────────────────────────────────

	function isTypingTarget(target: EventTarget | null): boolean {
		if (!(target instanceof HTMLElement)) return false;
		return !!target.closest('input, textarea, select, [contenteditable="true"]');
	}

	// Studio's tweakpane panes are real <input>s — never swallow keys there.
	function setKey(e: KeyboardEvent, value: boolean): void {
		if (isTypingTarget(e.target)) return;
		const action = CAR_INPUT_KEYS[e.code];
		if (!action) return;
		e.preventDefault();
		// State change goes through the edge helper — nitrous is both Shift keys, and
		// releasing one must not drop the pedal while the other is held.
		setCarInputKey(e.code, value);
	}

	// Switches (headlights) latch on the keydown EDGE, so auto-repeat has to be dropped
	// or holding L strobes the car. Ctrl is left alone — Ctrl+H is the engine's UI toggle.
	function onKeydown(e: KeyboardEvent): void {
		const toggle = CAR_TOGGLE_KEYS[e.code];
		if (toggle && !e.repeat && !e.ctrlKey && !e.metaKey && !isTypingTarget(e.target)) {
			e.preventDefault();
			applyCarToggle(toggle);
			return;
		}
		setKey(e, true);
	}

	const onKeyup = (e: KeyboardEvent) => setKey(e, false);

	// ── The driving task — everything model-shaped lives in sim/controller.ts ───
	// The header comment there carries the full driving-model rules (yaw-rate
	// control, the stability argument, the grip cap); the markup below carries
	// the body/collider contract (enabledRotations, frictionless chassis).

	let carBody = $state.raw<RapierRigidBody>();
	/** What ChaseCamera follows — an empty parented to the chassis body, see below. */
	let chaseAnchor = $state.raw<THREE.Object3D>();

	const controller = createCarController(car);

	usePhysicsTask((delta) => {
		const body = carBody;
		if (!body) return;
		controller.step(delta, body);
	});

	// Restart button (HUD → carRestart token): pose and motion back to the
	// captured spawn, nothing else — gear/lights/instruments are left alone and
	// self-correct from the body next step. The controller's own spawnCaptured
	// guard drops a stale token from an earlier mount: the body is a fresh one
	// at the authored pose then, and the controller's spawn copy is still zeroed
	// until its first step captures it.
	$effect(() => {
		if (carRestart.token === 0) return;
		const body = carBody;
		if (body) controller.restart(body);
	});

	// Unmount parks the instruments — the HUD unmounts with them, but the mirror is
	// module state and would otherwise still read 180 km/h on the way back in. The
	// pedals too: the keyup for a held key never fires after the listeners are gone.
	$effect(() => {
		return () => {
			controller.park();
			resetCarTelemetry();
			resetCarInput();
		};
	});
</script>

<svelte:window onkeydown={onKeydown} onkeyup={onKeyup} onblur={resetCarInput} />

{#if $city}
	<T.Group name="City" scale={1.5} position={[0, 0, 0]} rotation={[0, -1.0472, 0]}>
		<!-- The track GLB: Ground/Asphalt planes, Metal barriers, trees, decals — one
		     trimesh per mesh, transforms baked (cityColliders.ts). Bare <Collider>s
		     attach to an implicit fixed body, exactly like AutoColliders did. -->
		<T is={$city.scene} />
		{#each cityColliders as c (c.id)}
			<Collider shape="trimesh" args={c.args} />
		{/each}
	</T.Group>
{/if}

<!-- Player car. The outer group is the spec's spawn pose (RigidBody reads its
     world transform at creation); the visual scale lives on the children so the
     BODY speaks world units while the collider args below stay in model metres. -->
{#if $carModel}
	<T.Group name={car.model.name} rotation={spawnRotation} position={spawnPosition}>
		<!-- linearDamping is 0 on purpose: aero drag and rolling resistance are in the
		     drivetrain now, and a blanket damping term on top of them is the same loss
		     counted twice (it was also what capped the old top speed). gravityScale is
		     UNITS_PER_METER because the shared <World> pulls at 9.8 units/s², which in
		     this 2.5-units-to-the-metre city is 3.9 m/s² — moon gravity, and a car that
		     floats over every kerb. Scene-local: the global value belongs to DemoScene too.
		     enabledRotations: only yaw (world Y) is free — see sim/controller.ts's
		     header for why pitch had to be locked too, not just roll. -->
		<RigidBody
			bind:rigidBody={carBody}
			type="dynamic"
			linearDamping={0}
			angularDamping={1.5}
			gravityScale={UNITS_PER_METER}
			enabledRotations={[false, true, false]}
			ccd={true}
		>
			<T.Group scale={car.model.scale}>
				<T is={$carModel.scene} />
				<!-- Steerable/rolling wheels — shader-driven, see fx/CarWheels.svelte.
				     visualScale must match this group's scale: the roll rate divides
				     world speed by the world-space wheel radius. -->
				<CarWheels scene={$carModel.scene} visualScale={car.model.scale} />
				<!-- Car-local units on purpose (nose is -Z — see fx/CarHeadlights.svelte). -->
				<CarHeadlights />
				<!-- Exhaust pops on downshifts/limiter — tips from the car's spec, see
				     fx/CarExhaustFlames.svelte. Car-local model metres like its siblings. -->
				<CarExhaustFlames />
				<!-- Engine audio — positional rpm bed + lift-off one-shot, task-ticked from
				     carSim (audio/CarEngineAudio.svelte / carAudio.ts). -->
				<CarEngineAudio />
			</T.Group>

			<!-- Chassis: ONE rounded box instead of per-mesh hulls (the model is dozens
			     of meshes — seats, glass, engine — each a silly collider). Args are in
			     model meters, scaled by the parent group to match the visual; both come
			     from the car's spec (geometry.collider — measured off the GLB).
			     ROUNDED (spec `rounding`): a plain cuboid's square edges catch on
			     triangle seams, kerbs and barrier lips — each edge contact is a
			     wall-faced stop. The rounding is DILATING in rapier (total half-extent
			     = h + r), so each half-extent has r subtracted to preserve the outer
			     size; the subtraction happens here so the spec holds the real, readable
			     measurements. FRICTIONLESS (Min rule → min(0, μ_road) = 0) on purpose:
			     the chassis is one box, so contact friction is STATIC friction against
			     the COM drive force — at real gravity the cap sits ABOVE the
			     drivetrain's entire force range and every Newton of throttle was
			     cancelled (the car could not move at all; verified against rapier in
			     isolation — see CLAUDE.md's collider rules). Grip belongs to the
			     drivetrain (driven-axle traction clip, rolling resistance, brakes) and
			     the lateral velocity damp; contacts keep their normal impulses only.
			     (Wheel-contact balls at the measured pivots were tried on top of this
			     and reverted — see git history before revisiting.) -->
			<T.Group position={[0, car.geometry.collider.mountY, 0]} scale={car.model.scale}>
				<Collider
					shape="roundCuboid"
					args={[
						car.geometry.collider.hx - car.geometry.collider.rounding,
						car.geometry.collider.hy - car.geometry.collider.rounding,
						car.geometry.collider.hz - car.geometry.collider.rounding,
						car.geometry.collider.rounding
					]}
					mass={car.hardware.mass}
					friction={0}
					frictionCombineRule={CoefficientCombineRule.Min}
				/>
			</T.Group>

			<!-- What the chase camera looks at. An empty inside the RigidBody rather than
			     the visual group: this level is UNSCALED, so the offset is world units and
			     stays put if the visual scale ever changes; and its world transform is the
			     body's own pose, which is what the camera should track (the visual group
			     carries the model's offsets). ~1.6 up = the car's middle, not its floor. -->
			<T.Object3D name="ChaseAnchor" position={[0, 1.6, 0]} bind:ref={chaseAnchor} />
		</RigidBody>
	</T.Group>

	<!-- Borrows the app camera while this scene is current and hands it back on the
	     way out — see ChaseCamera.svelte. Outside the car's group: it is a rig, not cargo. -->
	<ChaseCamera target={chaseAnchor} />

	<!-- Skid marks — world-anchored ring buffer of rubber quads laid at the tyre
	     patches while the car slides (same anchor: its parent is the body, the space
	     the wheel offsets live in). See fx/SkidMarks.svelte. -->
	<SkidMarks target={chaseAnchor} />

	<!-- Tyre smoke — continuous puffs at the contact patches while a wheel
	     slides (burnout / drift / hard brake / max cornering). World-anchored
	     like the marks; same anchor trick. See fx/TireSmoke.svelte. -->
	<TireSmoke target={chaseAnchor} />

	<!-- Renders nothing — drives the afterimage effect's runtime boost from the
	     nitrous flow. See fx/NitrousAfterimage.svelte. -->
	<NitrousAfterimage />
{/if}
