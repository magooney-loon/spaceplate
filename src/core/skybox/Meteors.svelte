<script lang="ts">
	// Occasional meteors. A descriptor consumer like Stars.svelte, faded by
	// `descriptor.sky.starVisibility` so nothing streaks across a noon sky.
	//
	// SCHEDULING IS PURE GPU. Every meteor is a quad whose head position, travel
	// progress and brightness are pure functions of `time` and per-meteor constant
	// attributes: life = fract(t / period + phase) * period, active while life <
	// duration. There is no CPU clock, no state to reset, no event queue -- the sky
	// simply has meteors in it, at the cost of one small draw call.
	//
	// Each quad stretches from head to tail in the VERTEX stage: both endpoints are
	// projected to view space, the quad's cross-axis is taken perpendicular to the
	// screen-space motion, and depth is pinned to the far plane exactly as Stars.svelte
	// does. The trail is a decaying streak -- bright at the head, gone at the tail.
	//
	// WHY THE SCALARS ARE PACKED INTO vec4S: WebGPU caps a pipeline at 8 VERTEX
	// BUFFERS (maxVertexBuffers), and three's WebGPU backend gives every BufferAttribute
	// its own buffer. Six separate float attributes + position + aVel + aCorner = 9
	// buffers, and pipeline creation fails with exactly:
	//   "Vertex buffer count (9) exceeds the maximum number of vertex buffers (8)"
	// Packing the per-meteor constants into two vec4s brings it to 5. Stars.svelte sits
	// at 5 for the same reason -- this limit is why per-vertex data there is frugal too.
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import {
		attribute,
		cameraProjectionMatrix,
		float,
		fract,
		mix,
		modelViewMatrix,
		positionLocal,
		positionWorld,
		pow,
		sin,
		smoothstep,
		step,
		time,
		uniform,
		vec2,
		vec3,
		vec4
	} from 'three/tsl';
	import { descriptor } from './model';

	interface Props {
		/** Meteor "slots". Each fires once per its own period; 6 slots average a meteor every ~15 s. */
		count?: number;
		/** Distance the streaks are placed at. Cosmetic -- depth is pinned to the far plane. */
		radius?: number;
		/** Changing this reshuffles the schedule. */
		seed?: number;
	}

	let { count = 180, radius = 1000, seed = 20260828 }: Props = $props();

	const { invalidate, autoRenderTask } = useThrelte();

	const visibility = uniform(0);

	/** Deterministic PRNG -- same contract as Stars.svelte. */
	const mulberry32 = (a: number) => () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};

	const DEG = Math.PI / 180;

	const buildGeometry = (): THREE.BufferGeometry => {
		// Xor the seed so meteors and stars never share a random sequence.
		const rng = mulberry32(seed ^ 0x9e3779b9);
		const geometry = new THREE.BufferGeometry();

		// 'position' is the meteor's START POINT as a unit direction; the shader walks it
		// along aVel. The per-meteor constants are packed two-vec4s-wide (see the header
		// note on maxVertexBuffers): aParams0 = period, phase, duration, trail fraction;
		// aParams1 = streak half-width, peak brightness, spare, spare.
		const positions = new Float32Array(count * 4 * 3);
		const vels = new Float32Array(count * 4 * 3);
		const corners = new Float32Array(count * 4 * 2);
		const params0 = new Float32Array(count * 4 * 4);
		const params1 = new Float32Array(count * 4 * 4);
		const indices = new Uint32Array(count * 6);

		const CORNERS = [-1, -1, 1, -1, 1, 1, -1, 1];

		for (let i = 0; i < count; i++) {
			// Start point: uniform on the sphere, kept above the horizon band so the
			// whole streak doesn't live and die behind the ground plane.
			let sx = 0;
			let sy = 0;
			let sz = 0;
			for (let tries = 0; tries < 64; tries++) {
				const cosTheta = rng() * 2 - 1;
				const phi = rng() * Math.PI * 2;
				const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
				sx = sinTheta * Math.cos(phi);
				sy = cosTheta;
				sz = sinTheta * Math.sin(phi);
				if (sy > 0.15) break;
			}

			// Velocity: a random tangent at the start point, scaled so that aVel *
			// progress covers the full travel in radians.
			const rx = rng() * 2 - 1;
			const ry = rng() * 2 - 1;
			const rz = rng() * 2 - 1;
			let tx = sy * rz - sz * ry;
			let ty = sz * rx - sx * rz;
			let tz = sx * ry - sy * rx;
			const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
			const travel = 0.35 + rng() * 0.5; // 20-49 deg of sky
			tx = (tx / tl) * travel;
			ty = (ty / tl) * travel;
			tz = (tz / tl) * travel;

			// Trail length as a fraction of travel (3-13 deg at these travels).
			const trail = (0.06 + rng() * 0.14) / travel;
			// Apparent half-width of the streak. Thin: a meteor is a line with a glow,
			// not a ribbon.
			const width = radius * Math.tan((0.06 + rng() * 0.1) * DEG);
			const period = 40 + rng() * 80; // seconds between appearances
			const phase = rng();
			const duration = 0.6 + rng() * 0.9; // seconds visible
			// Mostly shy, occasionally spectacular.
			const bright = 0.5 + Math.pow(rng(), 2) * 1.5;

			for (let v = 0; v < 4; v++) {
				const p = i * 4 + v;
				positions[p * 3] = sx;
				positions[p * 3 + 1] = sy;
				positions[p * 3 + 2] = sz;
				vels[p * 3] = tx;
				vels[p * 3 + 1] = ty;
				vels[p * 3 + 2] = tz;
				corners[p * 2] = CORNERS[v * 2];
				corners[p * 2 + 1] = CORNERS[v * 2 + 1];
				params0[p * 4] = period;
				params0[p * 4 + 1] = phase;
				params0[p * 4 + 2] = duration;
				params0[p * 4 + 3] = trail;
				params1[p * 4] = width;
				params1[p * 4 + 1] = bright;
			}

			const base = i * 4;
			const tri = i * 6;
			indices[tri] = base;
			indices[tri + 1] = base + 1;
			indices[tri + 2] = base + 2;
			indices[tri + 3] = base;
			indices[tri + 4] = base + 2;
			indices[tri + 5] = base + 3;
		}

		geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		geometry.setAttribute('aVel', new THREE.BufferAttribute(vels, 3));
		geometry.setAttribute('aCorner', new THREE.BufferAttribute(corners, 2));
		geometry.setAttribute('aParams0', new THREE.BufferAttribute(params0, 4));
		geometry.setAttribute('aParams1', new THREE.BufferAttribute(params1, 4));
		geometry.setIndex(new THREE.BufferAttribute(indices, 1));
		return geometry;
	};

	const buildMaterial = (): THREE.MeshBasicNodeMaterial => {
		const material = new THREE.MeshBasicNodeMaterial();
		material.transparent = true;
		material.depthWrite = false;
		material.blending = THREE.AdditiveBlending;
		material.toneMapped = false;
		// Never fogged -- a sky layer at radius 1000. See SkyFog.svelte.
		material.fog = false;
		// The perpendicular can flip with geometry winding; a meteor has no back.
		material.side = THREE.DoubleSide;

		// The explicit generics mirror Stars.svelte: a bare 'vec2' widens to `string`
		// and every downstream node method disappears. The scalars unpack from the two
		// packed vec4s -- see the header note on the 8-vertex-buffer limit.
		const aCorner = attribute<'vec2'>('aCorner', 'vec2');
		const aVel = attribute<'vec3'>('aVel', 'vec3');
		const aParams0 = attribute<'vec4'>('aParams0', 'vec4');
		const aParams1 = attribute<'vec4'>('aParams1', 'vec4');
		const aPeriod = aParams0.x;
		const aPhase = aParams0.y;
		const aDur = aParams0.z;
		const aTrail = aParams0.w;
		const aWidth = aParams1.x;
		const aBright = aParams1.y;

		// One pure expression, no assignments, exactly as Stars.svelte requires outside
		// an Fn stack. 0 = head end of the quad, 1 = tail end.
		const along = aCorner.x.mul(0.5).add(0.5);
		// Seconds elapsed in this meteor's cycle. Once it passes aDur the quad keeps
		// "moving" far along its great circle, harmlessly -- active gates it off.
		const life = fract(time.div(aPeriod).add(aPhase)).mul(aPeriod);
		const progress = life.div(aDur);

		// Head and tail points on the unit sphere, then the vertex between them.
		const head = positionLocal.add(aVel.mul(progress)).normalize();
		const tail = positionLocal.add(aVel.mul(progress.sub(aTrail))).normalize();

		// Billboard along the motion: project both endpoints to view space, take the
		// perpendicular to the screen-space motion, offset by the corner across-axis.
		// The epsilon guards the degenerate head-over-tail case (motion straight at
		// the camera) where normalize() of a zero vector is NaN.
		const headVS = modelViewMatrix.mul(vec4(head.mul(float(radius)), 1));
		const tailVS = modelViewMatrix.mul(vec4(tail.mul(float(radius)), 1));
		const motion = tailVS.xy.sub(headVS.xy).add(vec2(1e-5, 1e-5)).normalize();
		const perpendicular = vec2(motion.y.negate(), motion.x);
		const spine = mix(headVS, tailVS, along);
		const offset = perpendicular.mul(aCorner.y.mul(aWidth));
		const clip = cameraProjectionMatrix.mul(vec4(spine.xy.add(offset), spine.z, spine.w));
		// Far-plane depth pinning, as Stars.svelte: honest depth at radius 1000 would
		// be clipped by the camera's far plane.
		material.vertexNode = vec4(clip.xy, clip.w, clip.w);

		// Fragment: gate, envelope, and the streak's own falloffs. Attribute-derived
		// nodes used here are auto-lifted to varyings by TSL.
		const active = step(life, aDur);
		const envelope = sin(progress.mul(Math.PI));
		const tailFade = pow(along.oneMinus(), float(1.8));
		const across2 = aCorner.y.mul(aCorner.y);
		const shape = pow(smoothstep(float(0), float(1), across2).oneMinus(), float(2));
		const horizon = smoothstep(float(-0.02), float(0.12), positionWorld.y.div(float(radius)));

		// Slightly cyan white -- the ionisation colour, and it separates meteors from
		// the warm star ramp at a glance.
		material.colorNode = vec3(0.78, 0.92, 1.0);
		material.opacityNode = active
			.mul(envelope)
			.mul(tailFade)
			.mul(shape)
			.mul(aBright)
			.mul(horizon)
			.mul(visibility);
		return material;
	};

	// Built once, deliberately NOT `$derived` -- same reasoning as Stars.svelte.
	const geometry = buildGeometry();
	const material = buildMaterial();

	useTask(
		() => {
			visibility.value = descriptor.sky.starVisibility;
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

<T.Mesh
	{geometry}
	{material}
	renderOrder={1}
	frustumCulled={false}
	userData={{ hideInTree: true, selectable: false }}
/>
