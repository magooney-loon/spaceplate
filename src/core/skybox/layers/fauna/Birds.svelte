<script lang="ts">
	// Bird flocks as sky dressing -- a few distant flocks wheeling over the sky plus
	// some stray birds drifting between them, ported from three.js's
	// `webgpu_compute_birds` example and rescaled from its 800-unit murmuration to
	// ambient fauna you notice the way you notice real birds: mostly at the edge of
	// attention, wheeling far off against the clouds.
	//
	// WHY GPU COMPUTE, unlike every other particle layer here. Stars, Rain and Snow are
	// stateless -- each particle is a pure function of `time`, so a vertex node
	// synthesises motion at zero per-frame cost. Flocking is not: separation, alignment
	// and cohesion are O(n²) interactions between PERSISTENT neighbours, so each bird
	// carries position / velocity / flap phase in `instancedArray` storage buffers that
	// two compute passes integrate every frame. That is also why this is the one layer
	// that cannot run on the WebGL2 fallback (three's own example is marked "TODO: Fix
	// example with WebGL backend"): the task gates on the live backend and the flock
	// simply never mounts work elsewhere.
	//
	// FEW FLOCKS AND STRAYS FROM ONE PASS. Every bird carries its own FLOCK ANCHOR in a
	// read-only storage buffer, and the centre-pull targets that instead of a shared
	// origin -- so one compute pass serves several independent flocks (their anchors sit
	// far apart, well outside the ~12-unit interaction zone, so flocks never merge) plus
	// single birds anchored to points of their own. A strayed bird that crosses a
	// flock's zone briefly joins it, which reads as exactly what a stray does.
	//
	// DESCRIPTOR-DRIVEN, like the weather it lives in:
	//   - DAY. Birds are diurnal. They fade out through twilight on the same
	//     `starVisibility` ramp that fades Stars in, so dusk hands the sky over.
	//   - STORMS. Real birds land before weather arrives; precipitation or fog thick
	//     enough grounds the flock. It cannot simply be fogged to the same effect --
	//     sky layers run `fog = false` by contract (skyLayer.ts) -- so the channel is
	//     read as visibility instead.
	//   - WIND. The weather's bearing pushes the flock downwind as an acceleration, so
	//     a rising wind first bends the flock and only later hides it.
	//   - LIGHT. The plumage rides the key-light hints: a dark end and a light end of
	//     the light's hue, mixed per bird by a seeded shade -- mostly near-black and
	//     mid-grey birds with a few pale ones, the mottle a real flock shows at
	//     distance, rather than one flat fill colour.
	//
	// Drawn UNDER the cloud deck (renderOrder 2.2, deck is 2.5): where the deck is
	// dense the birds go behind it, which is the look -- they are part of the
	// skybox's weather, not actors in front of it.
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import type { Mesh } from 'three/webgpu';
	import {
		cameraProjectionMatrix,
		cameraViewMatrix,
		clamp,
		Continue,
		cos,
		float,
		Fn,
		If,
		instancedArray,
		instanceIndex,
		length,
		Loop,
		mat3,
		max,
		mix,
		modelWorldMatrix,
		negate,
		normalize,
		positionLocal,
		sin,
		sqrt,
		uint,
		uniform,
		vertexIndex
	} from 'three/tsl';
	import { descriptor, mulberry32, smooth01, windAxisX, windAxisZ } from '../../model';
	import {
		instancedFloat,
		pinFarPlane,
		SKY_LAYER_USERDATA,
		skyLayerMaterial
	} from '../skyLayer';

	interface Props {
		/**
		 * Approximate total bird count -- the flock layout below takes shares of it.
		 * The velocity compute is O(count²), and at these numbers it is nothing; the
		 * constraint is the LOOK, which wants a handful of flocks, not a swarm.
		 */
		count?: number;
		/** Changing this reseeds the flocks, strays and plumage. */
		seed?: number;
	}

	let { count = 68, seed = 20260901 }: Props = $props();

	const { renderer, invalidate, autoRenderTask } = useThrelte();

	let mesh = $state.raw<Mesh>();

	// ── Tuning ────────────────────────────────────────────────────────────────────
	// The reference example's feel at skybox scale: its wingspan-8 birds in an 800
	// cube with a 55-radius interaction zone become wingspan-2 birds in flocks a
	// dozen-odd units across, with a ~12.5-radius zone (~6 wingspans either way) and
	// its speed limit 9 (×15 at integration) becomes 2.2.
	const SPEED_LIMIT = 2.2;
	/** Birds never hover: a floor keeps strays flying their lazy loops instead of
	 *  damping onto their anchors as the centre-pull decays them. */
	const MIN_SPEED = 0.55;
	const INTEGRATION = 15;
	const SEPARATION = 3.5;
	const ALIGNMENT = 4.5;
	const COHESION = 4.5;
	/** Centre-pull toward the bird's own anchor, per second -- with a vertical bias,
	 *  because a flock flies as a slab rather than a cube. */
	const CENTER_PULL = 1.2;
	const SLAB_Y = 1.8;
	/** Weather wind channel (0..1) to acceleration. */
	const WIND_GAIN = 10;
	const FLAP_AMP = 1.25;
	const FLAP_RATE_XZ = 8;
	const FLAP_RATE_Y = 12;
	/** SUN_INTENSITY at full day (model/sky.svelte.ts); normalises the light inputs. */
	const KEY_FULL = 4.75;

	/**
	 * The flock layout: azimuth (deg, 0 = dead ahead of the boot camera), distance
	 * from the scene origin, altitude, share of `count`, and seed spread. Anchors sit
	 * FAR and LOW -- elevations of roughly 6-15 degrees -- because both stock cameras
	 * look at the origin roughly horizontally: anything overhead is simply never in
	 * frame. Distances also keep the flocks well outside each other's interaction
	 * zone, which is what keeps them from merging into one swarm.
	 */
	const FLOCKS = [
		{ az: 0, distance: 150, altitude: 34, share: 0.38, spread: 20 },
		{ az: 38, distance: 185, altitude: 46, share: 0.3, spread: 17 },
		{ az: 205, distance: 210, altitude: 28, share: 0.2, spread: 15 }
	] as const;

	// ── Uniforms (one set, shared by the computes and the material) ───────────────
	const deltaTime = uniform(0);
	const uWind = uniform(new THREE.Vector3());
	/** The key light's hue at unit luminance; the two levels below mix along it. */
	const uHue = uniform(new THREE.Vector3(1, 1, 1));
	const uDark = uniform(0.08);
	const uLight = uniform(0.7);
	const opacity = uniform(0);

	// ── Geometry ──────────────────────────────────────────────────────────────────
	// Three triangles, as in the reference: a vertical body slab (nose +z, belly down)
	// plus two horizontal wings whose tips -- vertices 4 and 7 -- the vertex node
	// flaps. Drawn `count` times through InstancedBufferGeometry; the per-bird
	// dynamics live in storage buffers rather than attributes, which is what escapes
	// the 8-vertex-buffer cap skyLayer.ts documents.
	const birdGeometry = (): THREE.InstancedBufferGeometry => {
		const vertices = new Float32Array([
			// Body
			0, 0, -1.0, 0, -0.4, 0.5, 0, 0, 1.5,
			// Left wing (tip = vertex 4)
			0, 0, -0.75, -1.0, 0, 0.25, 0, 0, 0.75,
			// Right wing (tip = vertex 7)
			0, 0, 0.75, 1.0, 0, 0.25, 0, 0, -0.75
		]);
		const geometry = new THREE.InstancedBufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
		geometry.instanceCount = count;
		return geometry;
	};

	/**
	 * Builds the storages, the compute passes and the material together, once. One
	 * closure because every input is a BUILD-TIME prop -- see the same note in
	 * Stars.svelte.
	 */
	const build = () => {
		const rng = mulberry32(seed);

		// Walk the layout: the flocks take their shares of `count`, strays fill the
		// rest. Both stay far and low (see FLOCKS) so they are actually in frame.
		const anchors = new Float32Array(count * 3);
		const positions = new Float32Array(count * 3);
		const velocities = new Float32Array(count * 3);
		const phases = new Float32Array(count);
		const shades = new Float32Array(count);

		const entries: { x: number; y: number; z: number; spread: number }[] = [];
		for (const flock of FLOCKS) {
			const az = (flock.az * Math.PI) / 180;
			for (
				let j = 0;
				j < Math.round(count * flock.share) && entries.length < count;
				j++
			) {
				entries.push({
					x: Math.sin(az) * flock.distance,
					y: flock.altitude,
					z: -Math.cos(az) * flock.distance,
					spread: flock.spread
				});
			}
		}
		while (entries.length < count) {
			// Strays, scattered around the compass.
			const az = rng() * Math.PI * 2;
			const distance = 150 + rng() * 120;
			entries.push({
				x: Math.sin(az) * distance,
				y: 28 + rng() * 34,
				z: -Math.cos(az) * distance,
				spread: 26
			});
		}

		for (let i = 0; i < count; i++) {
			const { x, y, z, spread } = entries[i];
			anchors[i * 3] = x;
			anchors[i * 3 + 1] = y;
			anchors[i * 3 + 2] = z;

			// Seed in a flat-ish box around the anchor; the slab bias below holds the
			// flock there. Phases spread across the reference's 62.83 (= 2π·10) wrap so
			// no two birds flap in lockstep.
			positions[i * 3] = x + (rng() - 0.5) * spread;
			positions[i * 3 + 1] = y + (rng() - 0.5) * spread * 0.45;
			positions[i * 3 + 2] = z + (rng() - 0.5) * spread;

			const vx = rng() - 0.5;
			const vy = rng() - 0.5;
			const vz = rng() - 0.5;
			const l = Math.hypot(vx, vy, vz) || 1;
			const s = 0.6 + rng() * 0.9;
			velocities[i * 3] = (vx / l) * s;
			velocities[i * 3 + 1] = (vy / l) * s;
			velocities[i * 3 + 2] = (vz / l) * s;

			phases[i] = rng() * 62.83;

			// Plumage: mostly dark to mid greys with a few pale birds -- a real flock
			// at distance is a mottle, not a fill.
			const r = rng();
			shades[i] =
				r < 0.55 ? 0.05 + rng() * 0.3 : r < 0.85 ? 0.35 + rng() * 0.3 : 0.72 + rng() * 0.28;
		}

		// No setPBO(): that is the WebGL2 compute readback path, and this layer is
		// WebGPU-only by the gate below. The anchor buffer is read in the COMPUTE pass
		// only, so the vertex stage still reads exactly three storage buffers --
		// position, velocity, phase -- which is the count App.svelte requests.
		const positionStorage = instancedArray(positions, 'vec3').setName('birdPosition');
		const velocityStorage = instancedArray(velocities, 'vec3').setName('birdVelocity');
		const phaseStorage = instancedArray(phases, 'float').setName('birdPhase');
		const anchorStorage = instancedArray(anchors, 'vec3').setName('birdAnchor');

		// ── The velocity pass ────────────────────────────────────────────────────
		// Boids, verbatim from the reference minus its pointer-ray scatter: pull to
		// the bird's own anchor, then the O(n²) separation / alignment / cohesion
		// sweep and a speed clamp. The zone thresholds are ratios of the zone radius,
		// so tuning the three radii retunes the personality without touching the
		// branches.
		const computeVelocity = Fn(() => {
			const PI = float(3.141592653589793);
			const PI_2 = PI.mul(2.0);

			const zoneRadius = float(SEPARATION + ALIGNMENT + COHESION).toConst();
			const separationThresh = float(SEPARATION).div(zoneRadius).toConst();
			const alignmentThresh = float(SEPARATION + ALIGNMENT).div(zoneRadius).toConst();
			const zoneRadiusSq = zoneRadius.mul(zoneRadius).toConst();

			const birdIndex = instanceIndex.toConst('birdIndex');
			const position = positionStorage.element(birdIndex).toVar();
			const velocity = velocityStorage.element(birdIndex).toVar();

			// The anchor: pull toward the bird's own flock centre, harder vertically
			// (the slab), plus the weather's wind as a plain acceleration along its
			// bearing. The division is the epsilon-hardened form of normalize() -- a bird
			// passing exactly over its anchor must not write NaNs into the buffers.
			const dirToCenter = position.sub(anchorStorage.element(birdIndex)).toVar();
			dirToCenter.y.mulAssign(float(SLAB_Y));
			const centerDist = length(dirToCenter).max(1e-6);
			velocity.subAssign(
				dirToCenter.div(centerDist).mul(deltaTime).mul(float(CENTER_PULL))
			);
			velocity.addAssign(uWind.mul(deltaTime).mul(float(WIND_GAIN)));

			Loop({ start: uint(0), end: uint(count), type: 'uint', condition: '<' }, ({ i }) => {
				If(i.equal(birdIndex), () => {
					Continue();
				});

				const birdPosition = positionStorage.element(i);
				const dirToBird = birdPosition.sub(position);
				const distToBird = length(dirToBird);

				If(distToBird.lessThan(0.0001), () => {
					Continue();
				});

				const distToBirdSq = distToBird.mul(distToBird);

				// Out of the zone: no interaction at all. With the anchors spaced as
				// they are, this is also what keeps separate flocks separate.
				If(distToBirdSq.greaterThan(zoneRadiusSq), () => {
					Continue();
				});

				const percent = distToBirdSq.div(zoneRadiusSq);

				If(percent.lessThan(separationThresh), () => {
					// Separation -- move apart for comfort.
					const velocityAdjust = separationThresh.div(percent).sub(1.0).mul(deltaTime);
					velocity.subAssign(normalize(dirToBird).mul(velocityAdjust));
				}).ElseIf(percent.lessThan(alignmentThresh), () => {
					// Alignment -- fly the same direction.
					const threshDelta = alignmentThresh.sub(separationThresh);
					const adjustedPercent = percent.sub(separationThresh).div(threshDelta);
					const birdVelocity = velocityStorage.element(i);

					const cosRange = cos(adjustedPercent.mul(PI_2));
					const cosRangeAdjust = float(0.5).sub(cosRange.mul(0.5)).add(0.5);
					const velocityAdjust = cosRangeAdjust.mul(deltaTime);
					velocity.addAssign(normalize(birdVelocity).mul(velocityAdjust));
				}).Else(() => {
					// Cohesion -- move closer.
					const threshDelta = alignmentThresh.oneMinus();
					const adjustedPercent = threshDelta
						.equal(0.0)
						.select(1.0, percent.sub(alignmentThresh).div(threshDelta));

					const cosRange = cos(adjustedPercent.mul(PI_2));
					const velocityAdjust = float(0.5).sub(cosRange.mul(-0.5).add(0.5)).mul(deltaTime);
					velocity.addAssign(normalize(dirToBird).mul(velocityAdjust));
				});
			});

			// The speed band: capped as in the reference, and floored because birds
			// do not hover -- without the floor the centre-pull damps a lonely stray
			// onto its anchor until it hangs there. Again divided rather than
			// normalize()d, so a freak zero speed cannot smear NaNs into the buffers.
			const speed = length(velocity).max(1e-6);
			velocity.assign(
				velocity.div(speed).mul(clamp(speed, float(MIN_SPEED), float(SPEED_LIMIT)))
			);

			velocityStorage.element(birdIndex).assign(velocity);
		})().compute(count).setName('Sky birds velocity');

		// ── The position pass ────────────────────────────────────────────────────
		// Integrate, and advance the flap phase by how fast the bird is actually
		// flying -- a gliding bird stops flapping, a climbing one flaps hardest.
		const computePosition = Fn(() => {
			positionStorage
				.element(instanceIndex)
				.addAssign(velocityStorage.element(instanceIndex).mul(deltaTime).mul(float(INTEGRATION)));

			const velocity = velocityStorage.element(instanceIndex);
			const phase = phaseStorage.element(instanceIndex);

			const modValue = phase
				.add(deltaTime)
				.add(length(velocity.xz).mul(deltaTime).mul(float(FLAP_RATE_XZ)))
				.add(max(velocity.y, 0.0).mul(deltaTime).mul(float(FLAP_RATE_Y)));
			phaseStorage.element(instanceIndex).assign(modValue.mod(62.83));
		})().compute(count).setName('Sky birds position');

		// ── The material ─────────────────────────────────────────────────────────
		// Tone-mapped like CloudDeck and Moon: a bird is an object in the dome's
		// exposure space, not an emissive phenomenon.
		const material = skyLayerMaterial({ side: THREE.DoubleSide, toneMapped: true });

		// The vertex node, as the reference: flap the wing tips, rotate the bird into
		// its velocity's heading frame, add the storage position, project. The mesh's
		// own rotation.y = π/2 (set on the T.Mesh below) is part of the construction,
		// not framing -- it turns the geometry's +z nose into the frame's forward.
		// `negate()` is required wherever the reference uses it: a plain `-node`
		// resolves to NaN under WGSL.
		const birdVertex = Fn(() => {
			const position = positionLocal.toVar();
			const phase = phaseStorage.element(instanceIndex).toVar();
			const heading = normalize(velocityStorage.element(instanceIndex)).toVar();

			If(vertexIndex.equal(4).or(vertexIndex.equal(7)), () => {
				position.y = sin(phase).mul(float(FLAP_AMP));
			});

			const world = modelWorldMatrix.mul(position);

			heading.z.mulAssign(-1.0);
			// The epsilons guard the degenerate headings the reference leaves to
			// chance: straight up (xz → 0) and the sqrt rounding past 1.0, either of
			// which would smear a NaN triangle across the sky.
			const xz = length(heading.xz).add(1e-6);
			const x = sqrt(heading.y.mul(heading.y).oneMinus().max(0.0));

			const cosry = heading.x.div(xz).toVar();
			const sinry = heading.z.div(xz).toVar();
			const cosrz = x;
			const sinrz = heading.y.toVar();

			const maty = mat3(cosry, 0, negate(sinry), 0, 1, 0, sinry, 0, cosry);
			const matz = mat3(cosrz, sinrz, 0, negate(sinrz), cosrz, 0, 0, 0, 1);

			const finalVert = maty.mul(matz).mul(world);
			finalVert.addAssign(positionStorage.element(instanceIndex));

			// Far-plane pinning, exactly like every dome layer: honest depth at these
			// distances is beyond the camera's 144 far plane. Pinned also means scene
			// geometry occludes the flock for free -- a bird behind terrain hides.
			return pinFarPlane(cameraProjectionMatrix.mul(cameraViewMatrix).mul(finalVert));
		})();

		material.vertexNode = birdVertex;

		// Plumage: the per-bird shade mixes between the dark and light ends of the
		// key light's hue. An instanced attribute, not storage -- used in the fragment
		// stage it is auto-lifted to a varying (the same lift Meteors' brightness
		// rides), and it keeps the vertex stage at three storage buffers.
		const aShade = instancedFloat(shades);
		material.colorNode = uHue.mul(mix(uDark, uLight, aShade));
		material.opacityNode = opacity;

		return { geometry: birdGeometry(), material, computeVelocity, computePosition };
	};

	const { geometry, material, computeVelocity, computePosition } = build();

	// The backend gate. Storage-buffer compute is WebGPU-only (see the header); on the
	// WebGL2 fallback the layer goes dormant instead of erroring. Typed as a narrow
	// object because `isWebGPUBackend` is a runtime flag three's Backend type does not
	// declare.
	const isComputeBackend = (backend: object): boolean =>
		(backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;

	// Set once the first frame has gone through computeAsync: the backend may not be
	// initialized before anything has rendered, and compute() would warn about it.
	let computeReady = false;

	useTask(
		(delta) => {
			if (!isComputeBackend(renderer.backend)) {
				if (mesh) mesh.visible = false;
				return;
			}

			const w = descriptor.weather;

			// Day, on the same ramp the stars use and inverted: dusk hands the sky over.
			const day = 1 - smooth01(0.15, 0.5, descriptor.sky.starVisibility);
			// Weather: birds land before it arrives. The mixer already eases both
			// channels over their blends, so this needs no easing of its own.
			const grounded = Math.max(
				smooth01(0.2, 0.5, w.precipitation),
				smooth01(0.55, 0.85, w.fog)
			);
			opacity.value = day * (1 - grounded);

			const visible = opacity.value > 0.01;
			if (mesh) mesh.visible = visible;
			if (!visible) return;

			// Wind: the bearing and strength as one acceleration vector.
			uWind.value.set(windAxisX(w) * w.wind, 0, windAxisZ(w) * w.wind);

			// Plumage from the key-light hints: the hue at unit luminance, with a dark
			// end that is the old silhouette and a light end that only exists by day --
			// a pale bird at midnight would read as a ghost.
			const { color, intensity } = descriptor.light;
			const norm = Math.min(1, intensity / KEY_FULL);
			const m = Math.max(0.001, color[0], color[1], color[2]);
			uHue.value.set(color[0] / m, color[1] / m, color[2] / m);
			uDark.value = 0.05 + 0.07 * norm;
			uLight.value = 0.3 + 0.5 * norm;

			// Integrate, then draw. The clamp keeps a backgrounded tab's one huge delta
			// from firing the flocks across the sky on return.
			deltaTime.value = Math.min(delta, 0.1);
			if (computeReady) {
				renderer.compute(computeVelocity);
				renderer.compute(computePosition);
			} else {
				void renderer.computeAsync(computeVelocity);
				void renderer.computeAsync(computePosition);
				computeReady = true;
			}

			// The flocks only animate while they exist at all -- the compute passes are
			// this layer's clock, not the TSL `time` node. See Skybox.svelte on
			// renderMode.
			invalidate();
		},
		{ before: autoRenderTask, autoInvalidate: false }
	);

	$effect(() => {
		return () => {
			geometry.dispose();
			material.dispose();
		};
	});
</script>

<!-- renderOrder 2.2 -- under the cloud deck (2.5) and over the Moon (2): where the
     deck is dense the birds go behind it, and a flock always flies in front of
     everything celestial. frustumCulled={false} is mandatory for a depth-pinned layer
     (see pinFarPlane). The rotation is part of the heading construction, not
     framing. -->
<T.Mesh
	bind:ref={mesh}
	{geometry}
	{material}
	rotation={[0, Math.PI / 2, 0]}
	renderOrder={2.2}
	frustumCulled={false}
	userData={SKY_LAYER_USERDATA}
/>
