<script lang="ts">
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import { useGltf, useDraco, useKtx2, useMeshopt } from '@threlte/extras';
	import { Collider, RigidBody, useRapier, usePhysicsTask } from '@threlte/rapier';
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
	import DebugRig from './debug/DebugRig.svelte';
	import ChaseCamera from './ChaseCamera.svelte';
	import RearViewMirror from './RearViewMirror.svelte';
	import SkidMarks from './fx/SkidMarks.svelte';
	import TireSmoke from './fx/TireSmoke.svelte';
	import NitrousAfterimage from './fx/NitrousAfterimage.svelte';
	import {
		CAR_INPUT_KEYS,
		CAR_TOGGLE_KEYS,
		applyCarToggle,
		carRestart,
		carView,
		resetCarInput,
		setCarInputKey
	} from './sim/carInput.svelte';
	import { currentCar } from './cars';
	import { UNITS_PER_METER } from './units';
	import { createCarController } from './sim/controller';
	import { buildTrackColliders } from './trackColliders';
	import { buildCarHull, chassisMassProperties } from './cars/hull';
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

	const track = useGltf(`${BASE_URL}models/testgame/track.glb`, decoders);
	const carModel = useGltf(car.model.url, decoders);

	// Static collision for the track — built once when the GLB lands. Hand-rolled
	// instead of <AutoColliders> because the trimesh flags (FIX_INTERNAL_EDGES,
	// which stops ghost bumps at internal triangle seams on the flat roads)
	// can only be passed through explicit args. See trackColliders.ts.
	const trackColliders = $derived($track?.scene ? buildTrackColliders($track.scene) : []);

	// The chassis hull — the car's collider computed from its own GLB (see
	// cars/hull.ts): every mesh except the wheels, decimated to a few thousand
	// world-unit points. Rebuilt only when the model changes; undefined only if
	// the GLB had no non-wheel meshes at all.
	const carHull = $derived($carModel?.scene ? buildCarHull($carModel.scene, car) : undefined);

	// The hull collider's EXPLICIT mass properties (mass + COM + inertia + frame —
	// the full set Threlte's Collider needs or it falls back to geometry-derived
	// `setMass`): COM from cogHeight × the weight-bias lever, yaw inertia from the
	// spec, pitch/roll as locked-axis placeholders. See cars/hull.ts.
	const carMassProps = $derived(carHull ? chassisMassProperties(car, carHull) : undefined);

	$effect(() => {
		if ($track?.scene) logGltf.info('TestGame track loaded');
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
	//     armed each frame (the car moves), so all 313 725 track triangles and
	//     324 640 car triangles — 5 + 29 draw calls — were re-rendered into the
	//     2048² map to produce nothing.
	//
	// So: THE CAR CASTS, THE WORLD RECEIVES. With the track out of the caster
	// set the fit collapses to the `shadowRadius` floor (20) centred on the car,
	// which is a 2 cm texel instead of a 39 cm one — the car finally has a sharp
	// shadow — and the shadow pass draws the car alone.
	//
	// Flip this on to get building/tree shadows back, and read the paragraph
	// above first: at this track's size the single cascade cannot serve both, and
	// `CSMShadowNode` (DOCS/best-practices.md §2.6) is the honest answer.
	const TRACK_CASTS_SHADOWS = false;
	/** Which track materials would cast, if they did. Ground/Asphalt are the flat
	 *  surfaces the shadows land ON, and Decals are painted onto them — 51 062
	 *  triangles that can only ever shadow themselves. */
	const TRACK_CASTERS = new Set(['Metal', 'Leafs_Mat']);
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
			[$track?.scene, (mesh) => TRACK_CASTS_SHADOWS && TRACK_CASTERS.has(materialName(mesh))],
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
	// the body/collider contract (enabledRotations, the hull collider).

	let carBody = $state.raw<RapierRigidBody>();
	/** What ChaseCamera follows — an empty parented to the chassis body, see below. */
	let chaseAnchor = $state.raw<THREE.Object3D>();
	/** The visual car group (model + fx) — see the rig-view effect below. */
	let visualRoot = $state.raw<THREE.Group>();

	// The controller needs the Rapier world, not just the body: the car's ground
	// contact is four RAYCASTS now (sim/suspension.ts), and a raycast is a world
	// query. `useRapier` has to be called during component init like any hook.
	const { world } = useRapier();
	const controller = createCarController(car, world);
	// The controller's suspension instance (created from the same spec — per car,
	// like its drivetrain). The task below advances its VISUAL half; the physics
	// half is stepped from inside the controller's own resetForces.
	const suspension = controller.suspension;

	usePhysicsTask((delta) => {
		const body = carBody;
		if (!body) return;
		controller.step(delta, body);
	});

	// ── The body leans (sim/suspension.ts) ───────────────────────────────────
	//
	// The PHYSICS car cannot pitch or roll — `enabledRotations` leaves only yaw
	// free, for the reasons in the markup below — so the lean is the MODEL's, and
	// this is where it gets applied. The suspension springs run off the driving
	// model's own accelerations (carSim.accelFwd/accelLat) and hand back one
	// body-space attitude; the visual group takes it, and the wheels take the
	// matching counter-travel (CarWheels) so the tyres stay on the road while the
	// car moves around them.
	//
	// THIS TASK IS THE SUSPENSION'S VISUAL HALF'S ONE OWNER, and it lives here rather than in a
	// child because two children need it — the car model and the debug rig, and
	// the rig is only mounted in two of the three view modes. Registering it on
	// the scene means it always runs, and runs FIRST: among tasks sharing a
	// constraint the DAG falls back to mount order, and parents mount before
	// children (src/CLAUDE.md), so CarWheels and DebugRig both read a pose that
	// was rebuilt this frame.
	//
	// Render stage, not physics — same rule as CarWheels and the rig: the substep
	// count per rendered frame is `ceil(accumulator / rate)` and therefore never
	// constant, so a spring integrated in physics time pulses against the body
	// Rapier is smoothly interpolating underneath it.
	const { invalidate, autoRenderTask } = useThrelte();

	useTask(
		(delta) => {
			suspension.update(delta);
			const root = visualRoot;
			if (!root) return;
			root.position.y = -suspension.heave;
			root.rotation.set(suspension.pitch, 0, suspension.roll);
			// The car leaning IS a visual change and this is its one reason; a
			// settled car at rest costs nothing.
			if (suspension.moved) invalidate();
		},
		{ before: autoRenderTask, autoInvalidate: false }
	);

	// ── Rig view (B): hide the MODEL, keep everything else alive ──────────────
	//
	// 'rig' hides the car's MESHES so the debug skeleton (debug/DebugRig.svelte)
	// is the car. It hides meshes, never the group: the headlights' projectors and
	// the exhaust pop's PointLight live inside this subtree, and toggling a
	// LIGHT's visibility removes it from the render list — which is part of every
	// lit material's cache key and recompiles the scene's materials (the
	// POP_LIGHT_* rule in fx/CarExhaustFlames.svelte). Only meshes that are
	// VISIBLE at the moment of hiding are recorded and restored: a blanket
	// hide-all/restore-all re-shows the GLB's merged wheel meshes that CarWheels
	// keeps hidden after baking its own — and since CarWheels mutates the SHARED
	// material, those re-shown meshes roll with it: duplicate ghost wheels.
	let hiddenByRig: THREE.Mesh[] = [];
	$effect(() => {
		const root = visualRoot;
		const mode = carView.mode;
		for (const mesh of hiddenByRig) mesh.visible = true;
		hiddenByRig = [];
		if (root && mode === 'rig') {
			root.traverse((obj) => {
				const mesh = obj as THREE.Mesh;
				if (!mesh.isMesh || !mesh.visible) return; // already-hidden stays hidden
				mesh.visible = false;
				hiddenByRig.push(mesh);
			});
		}
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
		// The springs hold state across a teleport otherwise — a car restarted
		// mid-brake respawns nose-down and bobs back up.
		suspension.reset();
	});

	// Unmount parks the instruments — the HUD unmounts with them, but the mirror is
	// module state and would otherwise still read 180 km/h on the way back in. The
	// pedals too: the keyup for a held key never fires after the listeners are gone.
	$effect(() => {
		return () => {
			controller.park();
			resetCarTelemetry();
			suspension.reset();
			resetCarInput();
		};
	});
</script>

<svelte:window onkeydown={onKeydown} onkeyup={onKeyup} onblur={resetCarInput} />

{#if $track}
	<T.Group name="Track" scale={1.5} position={[0, 0, 0]} rotation={[0, -1.0472, 0]}>
		<!-- The track GLB: Asphalt and Metal barriers get trimesh colliders
		     (transforms baked); the Ground dirt plane becomes an analytical
		     cuboid FLOOR — two 460 m triangles were a contact-manifold jitter
		     factory; Decals (road paint) and foliage are excluded — see
		     trackColliders.ts. Bare <Collider>s attach to an implicit fixed body,
		     exactly like AutoColliders did. -->
		<T is={$track.scene} />
		{#each trackColliders as c (c.id)}
			{#if c.kind === 'trimesh'}
				<Collider shape="trimesh" args={c.args} />
			{:else}
				<T.Group position={c.center}>
					<Collider shape="cuboid" args={c.half} />
				</T.Group>
			{/if}
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
		     this 2.5-units-to-the-metre track is 3.9 m/s² — moon gravity, and a car that
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
			<T.Group bind:ref={visualRoot} scale={car.model.scale}>
				<T is={$carModel.scene} />
				<!-- Steerable/rolling wheels — shader-driven, see fx/CarWheels.svelte.
				     visualScale must match this group's scale: the roll rate divides
				     world speed by the world-space wheel radius. -->
				<CarWheels scene={$carModel.scene} visualScale={car.model.scale} {suspension} />
				<!-- Car-local units on purpose (nose is -Z — see fx/CarHeadlights.svelte). -->
				<CarHeadlights />
				<!-- Exhaust pops on downshifts/limiter — tips from the car's spec, see
				     fx/CarExhaustFlames.svelte. Car-local model metres like its siblings. -->
				<CarExhaustFlames />
				<!-- Engine audio — positional rpm bed + lift-off one-shot, task-ticked from
				     carSim (audio/CarEngineAudio.svelte / carAudio.ts). -->
				<CarEngineAudio />
			</T.Group>

			<!-- Chassis: ONE ROUNDED CONVEX HULL computed from the GLB itself
			     (cars/hull.ts builds the point cloud — every mesh except the wheels,
			     whose tyre bottoms would make the body a ground contact and fight the
			     raycast springs that ARE the contact). Replaces the authored
			     roundCuboid: the collider now follows the real silhouette — tapered
			     greenhouse, raked windshield, nose and tail — instead of a full-width
			     slab to 4 cm under the roof. Not <AutoColliders>: that is per-mesh
			     (29 colliders — seats, glass, engine — each silly on its own) and would
			     hull the wheels into ground contacts.
			     WORLD SCALE 1 ON PURPOSE: the points are PRE-BAKED to world units
			     (×model.scale) in hull.ts and this Collider sits directly under the
			     RigidBody with no scaled group, because Threlte's scaleColliderArgs
			     vertex-scales `convexHull` args but NOT `roundConvexHull` — it falls
			     into the positional [x,y,z] branch and would multiply the point array
			     by a scalar (the old roundCuboid fourth-arg quirk's bigger sibling).
			     The MARGIN (hull.ts HULL_MARGIN, 5 cm model) is a small edge FILLET:
			     Rapier DILATES round hulls by the border radius, so every edge —
			     nose, tail, belly, roofline — carries a ~0.13-unit fillet that
			     GLANCES off kerbs and barrier bases instead of face-stopping. The
			     point cloud is REAL surface vertices ONLY (what AutoColliders
			     feeds convexHull, decimated — no synthetic bbox corners: those put
			     phantom roof-height points at the nose/tail tips and were exactly
			     the boxy-too-big hull). The BELLY is CLAMPED to pay for the
			     dilation: points below the line are lifted so the dilated bottom
			     stays on the old box's ~13 cm bump-stop line — the margin can never
			     push the hull below the springs' reach and make the body a ground
			     contact. The doors sit at 0.91 + 0.05 = 0.96 (the old box's 0.95),
			     the mirrors a touch wider still (see hull.ts).
			     MASS: still the sole mass carrier, now with EXPLICIT properties —
			     mass + centerOfMass + principalAngularInertia + angularInertiaLocalFrame
			     (Threlte takes that branch only when ALL THREE extras are present;
			     otherwise it silently `setMass`es and derives from geometry). The COM
			     is the spec's own (cogHeight, the 53/47 lever rule) and the yaw inertia
			     is the spec's hardware.yawInertia — steering is DIRECT setAngvel
			     control, so these scale contact response (barrier hits), never the
			     driving model. Pitch/roll are locked (enabledRotations) so their
			     inertia components are box-equivalent placeholders from the hull's
			     bounds. All world-unit/kg·wu² — the units.ts boundary, applied in
			     hull.ts's chassisMassProperties. Friction props carry what
			     the box ran (1 × Multiply → the track collider's own μ): contacts are
			     bump stop and barrier hits, never grip — that lives in the
			     drivetrain/task and the raycast springs.
			     NOT the ground contact — the springs are; the hull's belly rides
			     ~13 cm off the rest line (clamped, see above) and meets geometry
			     only on real hits. -->
			{#if carHull && carMassProps}
				<Collider
					shape="roundConvexHull"
					args={[carHull.points, carHull.margin]}
					mass={car.hardware.mass}
					centerOfMass={carMassProps.centerOfMass}
					principalAngularInertia={carMassProps.principalAngularInertia}
					angularInertiaLocalFrame={carMassProps.angularInertiaLocalFrame}
					friction={1}
					frictionCombineRule={CoefficientCombineRule.Multiply}
				/>
			{/if}

			<!-- THERE ARE NO WHEEL COLLIDERS. The car's ground contact is FOUR
			     RAYCAST SPRINGS (sim/suspension.ts), cast down at `wheelPatches` from
			     the controller's physics step; their summed force is what holds the
			     car up, and the chassis hull above is now purely the bump stop and
			     the thing that hits barriers.

			     This replaced four frictionless ball colliders at the same patches. The
			     balls were geometrically right — the tyres kissed the road, and a ball
			     rolled over the asphalt↔dirt lip where the old box belly caught — but a
			     rigid ball is an infinitely stiff spring, and `enabledRotations` leaves
			     the body no pitch or roll to absorb an uneven contact with. A 3 cm kerb
			     under ONE wheel therefore had to lift the whole car 3 cm inside a single
			     step: that was the stutter, and it got worse with speed because the
			     contact was discovered further into the lip each step. A spring takes
			     ~0.2 s over the same lip, and a ray cannot manufacture a ghost contact
			     at a trimesh's internal edges the way a shape sweep can.

			     The ride height did not move: the spring's static sag is built into its
			     rest length, so equilibrium still sits the hub exactly one tyre radius
			     above the road. What the rays hit is filtered the same way the balls
			     were — the body itself is excluded, and the track's colliders are still
			     only Asphalt/Metal trimesh + the Ground floor (trackColliders.ts). -->

			<!-- The debug skeleton — wheels/driveline/suspension at the spec's
			     patches, steered and rolled from the same carSim values as CarWheels,
			     struts riding the shared suspension, chassis drawn as the collider's
			     own hull wireframe. It takes the VIEW MODE rather than a boolean,
			     because it draws two layers: the skeleton in both 'rig' and 'both',
			     and the analysis overlays (suspension rays, CG vectors, friction
			     circle) only in 'rig', where there is no car for them to bury.
			     B cycles model → rig → both; it never touches physics. -->
			<DebugRig view={carView.mode} {suspension} hull={carHull} />

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

	<!-- Rear-view strip — a backward camera on the car filling a small RT,
	     composited as a top-of-screen overlay on the active camera.
	     See RearViewMirror.svelte. -->
	<RearViewMirror target={chaseAnchor} />

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
