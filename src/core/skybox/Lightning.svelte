<script lang="ts">
	// Lightning: the `lightning` channel's renderer (DOCS/weather-system.md §17).
	//
	// A strike is the bolt, plus a flash published to `flashState` for the other sky
	// layers. CloudDeck.svelte is the flash's main consumer -- the deck lights up from
	// the inside, localized around the strike's azimuth and weighted by its own cloud
	// structure. That localized deck glow, not a screen wash, is where the drama lives.
	// The full-sky wash here is deliberately FAINT (an immersion cue, at most a tenth of
	// the already-halved envelope), and the shadowless flash light carries the scene.
	//
	// PHOTOSAFETY. Flash-induced seizures come from sharp, large-area luminance steps
	// (WCAG 2.3.1 fails at three general flashes within any one second). Every constant
	// below is chosen against that:
	//   - No step edges: every pulse attacks through a ~45-55 ms smoothstep ramp and
	//     decays exponentially. The bolt ribbon attacks faster (~12 ms) but it is a thin
	//     small-area element, not the frame.
	//   - Amplitude: the sky/scene envelope peaks at ~0.55 for bolt strikes and ~0.43 for
	//     sheets, and the wash multiplies that by at most 0.15.
	//   - Density: at most 2 pulses per strike, at least 0.6 s between event starts, and
	//     re-strikes wait 0.45 s -- worst case stays under the three-flashes-per-second
	//     line with margin, and every ramp is soft on top of that.
	// To tone it down further, lower `flashIntensity` and the WASH_* / envelope constants;
	// do not shorten the attack times.
	//
	// TIMING. The channel is an intensity, not an event stream, so this component runs
	// the scheduler: mean inter-event interval falls from ~11 s at the channel's floor to
	// ~2 s at full storm. Two kinds of event: BOLT strikes (ribbon + flash, can re-strike
	// the same channel a few hundred ms later -- real storms do, and the repeat reads as
	// the channel flickering rather than as a new strike) and SHEET strikes (in-cloud
	// flash with no ribbon, softer and slower -- cheap frequency that never strobes).
	//
	// WHERE THEY STRIKE. A uniform pick over the compass puts most bolts behind the
	// player, and a bolt you never see may as well not exist. So azimuths are biased
	// toward the camera's forward direction (triangular spread, dense ahead), and both
	// the bolt and the flash light are re-anchored on the active camera every frame, as
	// Rain is -- a strike holds a fixed BEARING wherever the player stands, instead of
	// living around the world origin. A quarter of strikes still land anywhere on the
	// compass; those still register through the deck glow (directional, so it shows at
	// the edge of view), the wash and the scene light.
	//
	// THE LIGHT STAYS MOUNTED at intensity 0. Toggling a light's visibility changes
	// three's lights-state hash and recompiles every lit material -- a stutter on every
	// strike. A zero-intensity light costs a uniform slot and nothing else.
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import type { DirectionalLight, Mesh } from 'three/webgpu';
	import {
		attribute,
		cameraProjectionMatrix,
		float,
		modelViewMatrix,
		pow,
		positionLocal,
		uniform,
		vec3,
		vec4
	} from 'three/tsl';
	import { descriptor } from './model';
	import { flashState } from './flashState';

	interface Props {
		/** Horizontal distance of the bolt from the active camera. Inside the dome. */
		distance?: number;
		/**
		 * Peak intensity of the flash light. SUN_INTENSITY is 4.75 for scale; 2.5 puts a
		 * full strike at roughly half of noon daylight for a fraction of a second.
		 */
		flashIntensity?: number;
		/** Bolt geometry: top / bottom height in the bolt's local (camera-anchored) plane. */
		boltTop?: number;
		boltBottom?: number;
		seed?: number;
	}

	let {
		distance = 750,
		flashIntensity = 2.5,
		boltTop = 380,
		boltBottom = -50,
		seed = 20260831
	}: Props = $props();

	const { camera, invalidate, autoRenderTask } = useThrelte();

	let bolt = $state.raw<Mesh>();
	let overlay = $state.raw<Mesh>();
	let flashLight = $state.raw<DirectionalLight>();

	const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
	const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

	const mulberry32 = (a: number) => () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	// Captured once on purpose: the seed is an authored constant and re-reading it
	// reactively would rebuild the RNG mid-session.
	// svelte-ignore state_referenced_locally
	const rng = mulberry32(seed);

	// ── Photosafety constants ──────────────────────────────────────────────────────
	// See the header. These bound the worst case no matter what the scheduler rolls.
	/** Seconds between event starts, hard floor. Keeps any rolling 1 s window ≤ 2 events. */
	const MIN_EVENT_GAP_S = 0.6;
	/** Delay before a re-strike of the same channel, in seconds. */
	const RESTRIKE_DELAY_S = [0.45, 0.9] as const;
	/** Sky-wash ceiling at full cloud cover. The wash is an accent, not the effect. */
	const WASH_MAX = 0.1;
	const WASH_MIN = 0.05;
	/** How much of a bolt strike's pulse amplitude reaches the sky/scene envelope. */
	const BOLT_SKY_SCALE = 0.55;
	/** Sheets are their own amplitude (below BOLT_SKY_SCALE) and light the scene less. */
	const SHEET_LIGHT_SCALE = 0.45;

	// ── Strike state ───────────────────────────────────────────────────────────────
	// Plain variables: written and read only by the task, so reactive proxies would just
	// add cost. One strike is live at a time -- overlapping envelopes from different
	// azimuths read as a strobe fault.
	type StrikeKind = 'bolt' | 'sheet';
	type Pulse = {
		t0: number;
		amp: number;
		tau: number;
		/** Ribbon attack: thin element, snappy is safe and reads best. */
		attackBolt: number;
		/** Sky/scene attack: large-area, so this is the photosafety-critical one. */
		attackSky: number;
	};
	type Strike = {
		kind: StrikeKind;
		startMs: number;
		/** Horizontal bearing from the camera, radians -- where the bolt is re-anchored. */
		azimuth: number;
		dir: { x: number; y: number; z: number };
		pulses: Pulse[];
		durationS: number;
		/** How much of the envelope the scene light takes (sheets are gentler). */
		lightScale: number;
	};

	let nowMs = 0;
	let strike: Strike | null = null;
	let nextStrikeAtMs = Infinity;
	// Set when a bolt strike rolls a re-strike: the next strike reuses this direction,
	// because a channel that flickers is the same channel.
	let restrikeDir: { x: number; y: number; z: number } | null = null;
	// Scratch for the camera's forward direction -- the task must not allocate.
	const camDir = new THREE.Vector3();

	const scheduleNext = (channel: number) => {
		const meanS = lerp(11, 2, channel);
		const at = nowMs + meanS * (0.45 + rng() * 1.1) * 1000;
		nextStrikeAtMs = Math.max(nowMs + MIN_EVENT_GAP_S * 1000, at);
	};

	/** The camera's forward bearing; random if the view points too steeply to have one. */
	const forwardAzimuth = (): number => {
		camera.current.getWorldDirection(camDir);
		const horizontal = camDir.x * camDir.x + camDir.z * camDir.z;
		return horizontal > 1e-4 ? Math.atan2(camDir.x, camDir.z) : rng() * Math.PI * 2;
	};

	/**
	 * WHERE a strike lands. Three quarters biased toward the forward bearing with a
	 * triangular spread ((rng+rng-1) is dense at the centre, thin at the edges, ~±97°);
	 * one quarter anywhere on the compass so the storm does not feel like it is
	 * performing for the player. Off-view strikes still register through the deck glow,
	 * the wash and the scene light.
	 */
	const nextAzimuth = (): number =>
		rng() < 0.25 ? rng() * Math.PI * 2 : forwardAzimuth() + (rng() + rng() - 1) * 1.7;

	/**
	 * One pulse at elapsed time `s`. Smoothstep attack then exponential decay -- the
	 * curve is C1-continuous, so there is no step edge anywhere for the eye to catch.
	 */
	const pulseValue = (s: number, p: Pulse, attack: number, decayScale: number): number => {
		if (s < p.t0) return 0;
		const t = s - p.t0;
		const k = Math.min(1, t / attack);
		const rise = k * k * (3 - 2 * k);
		return p.amp * rise * Math.exp(-Math.max(0, t - attack) / (p.tau * decayScale));
	};

	// ── The bolt ───────────────────────────────────────────────────────────────────
	// Buffers are allocated once at max size and rewritten per strike; a strike every
	// few seconds must not allocate. Segment = one quad = 4 verts / 6 indices.
	const MAX_SEGMENTS = 96;
	const boltPositions = new Float32Array(MAX_SEGMENTS * 4 * 3);
	const boltSides = new Float32Array(MAX_SEGMENTS * 4);
	const boltFades = new Float32Array(MAX_SEGMENTS * 4);
	const boltIndices = new Uint32Array(MAX_SEGMENTS * 6);
	for (let i = 0; i < MAX_SEGMENTS; i++) {
		const v = i * 4;
		const t = i * 6;
		boltIndices[t] = v;
		boltIndices[t + 1] = v + 1;
		boltIndices[t + 2] = v + 2;
		boltIndices[t + 3] = v;
		boltIndices[t + 4] = v + 2;
		boltIndices[t + 5] = v + 3;
	}

	let usedSegments = 0;

	/** Append one ribbon quad between two bolt points (x, y, halfWidth, fade each). */
	const emitSegment = (
		ax: number,
		ay: number,
		aw: number,
		af: number,
		bx: number,
		by: number,
		bw: number,
		bf: number
	) => {
		if (usedSegments >= MAX_SEGMENTS) return;
		// Perpendicular of the segment direction, in the bolt's XY plane.
		let dx = bx - ax;
		let dy = by - ay;
		const len = Math.hypot(dx, dy) || 1;
		dx /= len;
		dy /= len;
		const px = -dy;
		const py = dx;

		const base = usedSegments * 4 * 3;
		const coords = [
			ax + px * aw,
			ay + py * aw,
			bx + px * bw,
			by + py * bw,
			bx - px * bw,
			by - py * bw,
			ax - px * aw,
			ay - py * aw
		];
		for (let v = 0; v < 4; v++) {
			boltPositions[base + v * 3] = coords[v * 2];
			boltPositions[base + v * 3 + 1] = coords[v * 2 + 1];
			boltPositions[base + v * 3 + 2] = 0;
		}
		const sBase = usedSegments * 4;
		boltSides[sBase] = -1;
		boltSides[sBase + 1] = -1;
		boltSides[sBase + 2] = 1;
		boltSides[sBase + 3] = 1;
		boltFades[sBase] = af;
		boltFades[sBase + 1] = bf;
		boltFades[sBase + 2] = bf;
		boltFades[sBase + 3] = af;
		usedSegments++;
	};

	/** Rewrite the bolt geometry for a fresh strike: main channel + 2-4 branches. */
	const buildBolt = () => {
		usedSegments = 0;

		// Main channel, top (inside the deck) to bottom. Wanders, pulled toward a random
		// ground target so the strike has intent instead of a random walk. Widths are
		// generous: at 750 units the ribbon must survive as more than a hairline.
		const segments = 16 + Math.floor(rng() * 6);
		const groundX = (rng() - 0.5) * 90;
		let x = (rng() - 0.5) * 30;
		const points: { x: number; y: number; w: number }[] = [];
		for (let i = 0; i <= segments; i++) {
			const k = i / segments;
			x += (rng() - 0.5) * (14 + 26 * k);
			x = x * (1 - 0.55 * k) + groundX * 0.55 * k;
			points.push({
				x,
				y: lerp(boltTop, boltBottom, k),
				w: lerp(11, 4, k) * (0.8 + rng() * 0.4)
			});
		}
		for (let i = 0; i < points.length - 1; i++) {
			const k = i / (points.length - 1);
			const fade = Math.min(1, k * 12) * lerp(1, 0.5, k);
			emitSegment(
				points[i].x,
				points[i].y,
				points[i].w,
				fade,
				points[i + 1].x,
				points[i + 1].y,
				points[i + 1].w,
				fade
			);
		}

		// Branches peel off mid-channel, thinner, fading to nothing.
		const branches = 2 + Math.floor(rng() * 3);
		for (let b = 0; b < branches; b++) {
			const from = points[2 + Math.floor(rng() * (points.length - 5))];
			const side = rng() < 0.5 ? -1 : 1;
			const count = 4 + Math.floor(rng() * 4);
			const step = (boltTop - boltBottom) * (0.006 + rng() * 0.006);
			let bx = from.x;
			let by = from.y;
			for (let i = 0; i < count; i++) {
				const nx = bx + side * step * (0.5 + rng());
				const ny = by - step * (0.8 + rng() * 0.4);
				const w = from.w * 0.45 * (1 - i / count);
				emitSegment(bx, by, w, 0.7 * (1 - i / count), nx, ny, w * 0.8, 0.7 * (1 - (i + 1) / count));
				bx = nx;
				by = ny;
			}
		}
	};

	const buildBoltGeometry = (): THREE.BufferGeometry => {
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(boltPositions, 3));
		geometry.setAttribute('aSide', new THREE.BufferAttribute(boltSides, 1));
		geometry.setAttribute('aFade', new THREE.BufferAttribute(boltFades, 1));
		geometry.setIndex(new THREE.BufferAttribute(boltIndices, 1));
		geometry.setDrawRange(0, 0);
		return geometry;
	};

	const uFlash = uniform(0);
	const uBolt = uniform(0);
	const uWash = uniform(0);

	const buildBoltMaterial = (): THREE.MeshBasicNodeMaterial => {
		const material = new THREE.MeshBasicNodeMaterial();
		material.transparent = true;
		material.depthWrite = false;
		material.blending = THREE.AdditiveBlending;
		material.toneMapped = false;
		material.fog = false;
		material.side = THREE.DoubleSide;

		// Far-plane depth pinning + frustumCulled={false}: the bolt sits at 750 units
		// against a 144 far plane, exactly like the dome layers.
		const clip = cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(positionLocal, 1)));
		material.vertexNode = vec4(clip.xy, clip.w, clip.w);

		// The explicit generic is required -- see Stars.svelte.
		const aSide = attribute<'float'>('aSide', 'float');
		const aFade = attribute<'float'>('aFade', 'float');

		// Soft power edge: a hot core with a wide falloff reads as glow without a second
		// ribbon pass. Above-white colour: the core should clip to white through the
		// additive blend, which is what a lightning core does to your eye.
		const edge = pow(aSide.abs().oneMinus(), float(0.4));
		material.colorNode = vec3(1.05, 1.15, 1.4);
		material.opacityNode = aFade.mul(edge).mul(uBolt);
		return material;
	};

	const buildOverlayMaterial = (): THREE.MeshBasicNodeMaterial => {
		const material = new THREE.MeshBasicNodeMaterial();
		material.side = THREE.BackSide;
		material.transparent = true;
		material.depthWrite = false;
		material.blending = THREE.AdditiveBlending;
		material.toneMapped = false;
		material.fog = false;

		const clip = cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(positionLocal, 1)));
		material.vertexNode = vec4(clip.xy, clip.w, clip.w);

		// Slightly blue: lightning is hotter than daylight (its flash is ~9500 K against
		// the sun's ~5800 K), so the wash must never read warm.
		material.colorNode = vec3(0.82, 0.88, 1.05);
		material.opacityNode = uWash;
		return material;
	};

	const boltGeometry = buildBoltGeometry();
	const boltMaterial = buildBoltMaterial();
	const overlayGeometry = new THREE.SphereGeometry(950, 32, 16);
	const overlayMaterial = buildOverlayMaterial();

	const beginStrike = (cover: number) => {
		const isRestrike = restrikeDir !== null;
		const kind: StrikeKind = !isRestrike && cover > 0.25 && rng() < 0.45 ? 'sheet' : 'bolt';

		// Direction: a re-strike reuses the channel (bearing and all); otherwise a fresh
		// view-biased azimuth. Sheets sit deeper in the deck -- they are the cell
		// backlighting itself, not a channel to the ground.
		let azimuth: number;
		let dir = restrikeDir;
		restrikeDir = null;
		if (dir) {
			azimuth = Math.atan2(dir.x, dir.z);
		} else {
			azimuth = nextAzimuth();
			const elevation = kind === 'sheet' ? 0.55 + rng() * 0.25 : 0.5 + rng() * 0.3;
			dir = {
				x: Math.sin(azimuth) * Math.cos(elevation),
				y: Math.sin(elevation),
				z: Math.cos(azimuth) * Math.cos(elevation)
			};
		}

		// Pulses. Bolt: full-amplitude leader, a second return stroke 60% of the time.
		// Never a third -- see the photosafety constants. Sheet: one soft slow pulse.
		const pulses: Pulse[] =
			kind === 'bolt'
				? [
						{ t0: 0, amp: 1, tau: 0.06 + rng() * 0.04, attackBolt: 0.012, attackSky: 0.045 },
						...(rng() < 0.6
							? [
									{
										t0: 0.12 + rng() * 0.1,
										amp: 0.4 + rng() * 0.15,
										tau: 0.06 + rng() * 0.04,
										attackBolt: 0.012,
										attackSky: 0.045
									}
								]
							: [])
					]
				: [
						{
							t0: 0,
							amp: 0.3 + rng() * 0.13,
							tau: 0.2 + rng() * 0.1,
							attackBolt: 0,
							attackSky: 0.055
						}
					];

		const last = pulses[pulses.length - 1];
		// Bolt ribbons outlive their pulses: the heated channel glows on for a moment
		// after the discharge (see the linger term in the task).
		const durationS =
			kind === 'bolt'
				? Math.max(1.05, last.t0 + last.tau * 4)
				: last.t0 + last.attackSky + last.tau * 4;

		strike = {
			kind,
			startMs: nowMs,
			azimuth,
			dir,
			pulses,
			durationS,
			lightScale: kind === 'sheet' ? SHEET_LIGHT_SCALE : 1
		};
		flashState.direction.x = dir.x;
		flashState.direction.y = dir.y;
		flashState.direction.z = dir.z;

		// Positioning lives in the task, not here: the bolt and the light are re-anchored
		// on the active camera EVERY frame (as Rain is), so a strike holds a fixed bearing
		// wherever the player moves.
		if (kind === 'bolt') {
			buildBolt();
			boltGeometry.attributes.position.needsUpdate = true;
			boltGeometry.attributes.aSide.needsUpdate = true;
			boltGeometry.attributes.aFade.needsUpdate = true;
			boltGeometry.setDrawRange(0, usedSegments * 6);
		}
	};

	useTask(
		(delta) => {
			// `nowMs` advances by task deltas, so the scheduler depends on frames happening at
			// all. Safe here by construction: Lightning mounts only inside the procedural
			// branch, where Sky's and Rain's tasks invalidate every frame.
			nowMs += delta * 1000;
			const channel = clamp01(descriptor.weather.lightning);
			const cover = clamp01(descriptor.weather.cloudCover);

			// Dead channel clears any pending strike so the next storm schedules fresh.
			if (channel <= 0.05) {
				nextStrikeAtMs = Infinity;
				restrikeDir = null;
			} else if (!strike) {
				if (!Number.isFinite(nextStrikeAtMs)) scheduleNext(channel);
				else if (nowMs >= nextStrikeAtMs) beginStrike(cover);
			}

			let flash = 0;
			let boltGlow = 0;
			let lightScale = 1;
			if (strike) {
				const s = (nowMs - strike.startMs) / 1000;
				if (s >= strike.durationS) {
					// A bolt strike may immediately queue a re-strike of the same channel:
					// same direction, short delay. It reads as the channel flickering.
					if (strike.kind === 'bolt' && channel > 0.25 && rng() < 0.35) {
						restrikeDir = strike.dir;
						nextStrikeAtMs = nowMs + lerp(RESTRIKE_DELAY_S[0], RESTRIKE_DELAY_S[1], rng()) * 1000;
					} else {
						scheduleNext(channel);
					}
					strike = null;
				} else {
					lightScale = strike.lightScale;
					// Sky/scene envelope: the pulses, sky-attacked, scaled down for bolts.
					// Sheets run their authored amplitude straight through.
					const skyScale = strike.kind === 'bolt' ? BOLT_SKY_SCALE : 1;
					for (const p of strike.pulses) {
						flash += pulseValue(s, p, p.attackSky, 1) * skyScale;
					}

					if (strike.kind === 'bolt') {
						let sum = 0;
						for (const p of strike.pulses) {
							sum += pulseValue(s, p, p.attackBolt, 0.8);
						}
						// LINGER: the channel's afterglow -- the ribbon stays faintly
						// visible for ~a second after the discharge has ended, decaying.
						const linger = s > 0.08 ? 0.16 * Math.exp(-(s - 0.08) / 0.55) : 0;
						boltGlow = Math.min(1.25, sum + linger);
					}

					// CAMERA-ANCHORED, as Rain is: re-derived from the active camera every
					// frame, so the bolt reads as sky (a fixed bearing and elevation wherever the
					// player stands) rather than as an object sitting near the world origin.
					const cam = camera.current.position;
					if (strike.kind === 'bolt' && bolt && boltGlow > 0.01) {
						bolt.position.set(
							cam.x + Math.sin(strike.azimuth) * distance,
							cam.y,
							cam.z + Math.cos(strike.azimuth) * distance
						);
						bolt.lookAt(cam);
					}
					if (flashLight && flash > 0.001) {
						// A DirectionalLight aims from its position at its TARGET, and the target
						// is not in the scene graph -- three only updates matrixWorld for objects
						// it knows about, so it is touched by hand, every frame.
						flashLight.position.set(
							cam.x + strike.dir.x * 40,
							cam.y + strike.dir.y * 40,
							cam.z + strike.dir.z * 40
						);
						flashLight.target.position.copy(cam);
						flashLight.target.updateMatrixWorld();
					}
				}
			}

			// Publish to the other sky layers FIRST -- CloudDeck's task reads this.
			flashState.flash = flash;

			uFlash.value = flash;
			uBolt.value = boltGlow;
			// The wash is an accent for immersion, not the effect: a fraction of the
			// already-halved envelope, scaled a touch by how much deck there is to
			// backlight. At full storm this peaks near 0.08 additive opacity.
			uWash.value = flash * lerp(WASH_MIN, WASH_MAX, cover);

			if (flashLight) flashLight.intensity = flash * flashIntensity * lightScale;
			if (overlay) overlay.visible = flash > 0.004;
			if (bolt) bolt.visible = strike !== null && strike.kind === 'bolt' && boltGlow > 0.01;

			if (flash > 0.003 || boltGlow > 0.003) invalidate();
		},
		{ before: autoRenderTask, autoInvalidate: false }
	);

	$effect(() => {
		return () => {
			boltGeometry.dispose();
			boltMaterial.dispose();
			overlayGeometry.dispose();
			overlayMaterial.dispose();
		};
	});
</script>

<!-- The bolt (renderOrder 2.6) draws over the cloud deck (2.5) and under the rain (3);
     the wash dome (4) draws over everything, very faintly. All depth-pinned to the far
     plane, so renderOrder is the only sort. The light is always mounted; see the
     header. -->
<T.Mesh
	bind:ref={bolt}
	geometry={boltGeometry}
	material={boltMaterial}
	renderOrder={2.6}
	frustumCulled={false}
	visible={false}
	userData={{ hideInTree: true, selectable: false }}
/>

<T.Mesh
	bind:ref={overlay}
	geometry={overlayGeometry}
	material={overlayMaterial}
	renderOrder={4}
	frustumCulled={false}
	visible={false}
	userData={{ hideInTree: true, selectable: false }}
/>

<T.DirectionalLight
	bind:ref={flashLight}
	castShadow={false}
	color="#b8ceff"
	intensity={0}
	userData={{ hideInTree: true, selectable: false }}
/>
