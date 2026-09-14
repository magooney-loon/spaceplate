<script lang="ts">
	// The nebula backdrop: a TSL port of the Shadertoy audio-nebula's field() "smoke",
	// with two tinted layers. A descriptor consumer, driven by `descriptor.sky.starVisibility`
	// like Stars.svelte.
	//
	// Heavily adapted for a static sky rather than a flythrough demo: sampling follows
	// the actual view ray (not a screen-anchored slice) so the field rotates with the
	// camera instead of reading as a video overlay, and time is dilated ~20x since a
	// sky's smoke evolves over minutes, not seconds. The four spectrum-bin inputs become
	// slow detuned sine LFOs (no analyser needed).
	//
	// The two original layers were repurposed from generic glow into actual Milky Way
	// anatomy, because nebulosity spread over the whole sphere reads as the view from
	// INSIDE a galaxy, not from a planet where it is a band: layer 2 (18 iterations) is
	// the glow's mottling -- unresolved star clouds; layer 1 (26 iterations) is DUST, an
	// obscuring mask carving the Great Rift.
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import {
		Fn,
		Loop,
		cameraPosition,
		dot,
		float,
		mix,
		positionWorld,
		pow,
		smoothstep,
		sin,
		time,
		uniform,
		vec3,
		vec4
	} from 'three/tsl';
	import { descriptor } from '../../model';
	import { domeVertexNode, skyLayerMaterial, SKY_LAYER_USERDATA } from '../skyLayer';
	import { MILKY_WAY_CORE, MILKY_WAY_NORMAL, MILKY_WAY_SIGMA } from './milkyWay';

	interface Props {
		/** Distance of the backdrop dome. Cosmetic -- depth is pinned to the far plane. */
		radius?: number;
		/** Overall strength of the galactic glow. */
		intensity?: number;
		/** How hard the dust lanes bite. 0 = an even band, 1 = shredded. */
		dustDensity?: number;
		/** Strength of the horizon airglow wash. 0 disables it, giving a pure-black night. */
		airglow?: number;
	}

	let { radius = 1000, intensity = 0.55, dustDensity = 0.85, airglow = 1 }: Props = $props();

	const { invalidate, autoRenderTask } = useThrelte();

	let mesh = $state.raw<THREE.Mesh>();

	const visibility = uniform(0);

	// field(): the "smoke". A factory because the original runs two copies differing
	// only in iteration count (26 vs 18); one body keeps them from drifting apart.
	// Everything mutating a node lives inside Fn (TSL assignment needs an Fn stack and
	// fails with only a console warning otherwise -- see skyLayer.ts).
	const makeField = (iterations: number) =>
		Fn(([p, s]: [any, any]) => {
			// Frozen to the mean rather than jittered per frame like the original --
			// invisible in a loud demo, reads as noise on a quiet sky.
			const strength = float(7);
			const point = p.toVar();
			const accum = s.div(4).toVar();
			const prev = float(0).toVar();
			const totalWeight = float(0).toVar();
			Loop(iterations, ({ i }) => {
				const mag = dot(point, point).toVar();
				point.assign(
					point
						.abs()
						.div(mag)
						.add(vec3(-0.5, -0.4, -1.5))
				);
				const w = i.toFloat().div(-7).exp();
				const contribution = strength
					.mul(pow(mag.sub(prev).abs(), float(2.2)))
					.negate()
					.exp();
				accum.addAssign(w.mul(contribution));
				totalWeight.addAssign(w);
				prev.assign(mag);
			});
			// Softened from the original's 5/-0.7 (which dominates the frame) to 4.2/-0.78
			// so the smoke reads as distance, not wallpaper.
			return accum.div(totalWeight).mul(4.2).sub(0.78).max(0);
		});

	const field = makeField(26);
	const field2 = makeField(18);

	const buildMaterial = (): THREE.MeshBasicNodeMaterial => {
		const material = skyLayerMaterial({
			side: THREE.BackSide,
			blending: THREE.AdditiveBlending
		});

		// Far-plane depth pinning so the smoke sorts behind everything (skyLayer.ts).
		material.vertexNode = domeVertexNode();

		const smoke = Fn(() => {
			// The view ray; sampling the field along it is what makes this a sky instead
			// of a fullscreen overlay.
			const dir = positionWorld.sub(cameraPosition).normalize();
			const t = time;

			// Synthesised "audio" bands, murmuring rather than pulsing -- these two survive
			// as the field's seed inputs, running on minute-long periods instead of the
			// original's music-rate ones.
			const f2 = float(0.5).add(sin(t.mul(0.013).add(1)).mul(0.03));
			const f3 = float(0.48).add(sin(t.mul(0.019).add(3)).mul(0.03));

			// Drift of the sampled region, ~20x slower than the original so the cloud
			// doesn't slide across the sky in seconds. Both layers share it (scaled
			// slightly differently) so they move as one body, not two decals.
			const drift = vec3(sin(t.div(210)), sin(t.div(170)), sin(t.div(260)));

			// The band profile matches the star-density band in Stars.svelte (shared
			// constants in milkyWay.ts) -- the river of stars and river of light must be
			// the same river.
			const offPlane = dot(dir, vec3(...MILKY_WAY_NORMAL));
			const band = offPlane
				.mul(offPlane)
				.negate()
				.div(2 * MILKY_WAY_SIGMA * MILKY_WAY_SIGMA)
				.exp();
			// Asymmetry toward the galactic bulge -- an evenly bright ring is the clearest
			// tell that a sky was generated.
			const bulge = smoothstep(float(-0.15), float(0.8), dot(dir, vec3(...MILKY_WAY_CORE)));
			const bandShape = band.mul(float(0.35).add(bulge.mul(1.15)));

			// Layer 1 is DUST, not a second glow: the Great Rift is an absence (cold
			// molecular cloud blocking light behind it), which an additive-only sky can
			// never produce, so this layer obscures instead of emitting. Sampled coarser
			// than the glow (0.19 vs 0.217) so rifts are larger than the mottling they carve.
			const d1: THREE.Node<'float'> = field(
				dir
					.mul(0.19)
					.add(vec3(1, -1.3, 0))
					.add(drift.mul(0.05)),
				f2
			);
			// Soft-saturate BEFORE use: the raw field's rare peaks are several times higher
			// than everything else; d*a/(d+a) presses them into dense patches instead of
			// hard holes.
			const d1s = d1.mul(0.6).div(d1.add(0.6));
			const dust = float(1).sub(d1s.mul(dustDensity)).max(0.06);

			// Layer 2 -- the glow's mottling: unresolved starlight, clumped like real star
			// clouds. Fixed scale, unlike the original's breathing zoom (queasy on a sky).
			const d2: THREE.Node<'float'> = field2(
				dir
					.div(float(4.6))
					.add(vec3(2, -1.3, -1))
					.add(drift.mul(0.04)),
				f3
			);
			const d2s = d2.mul(1.0).div(d2.add(1.0));

			// Warm-white in the bulge, cool grey on the thread -- naked-eye nebulosity is
			// nearly colourless.
			const hue = mix(vec3(0.62, 0.7, 0.88), vec3(0.95, 0.86, 0.72), bulge);
			// Dust REDDENS what gets through, same physics as a low sun going orange.
			const reddened = mix(hue, hue.mul(vec3(1, 0.78, 0.58)), d1s);
			const glow = reddened.mul(bandShape.mul(float(0.1).add(d2s.mul(0.42))).mul(dust));

			// A trace of smoke survives off-band, at a fraction of its old weight -- texture,
			// not a subject.
			const haze = vec3(0.16, 0.22, 0.34).mul(d2s.mul(0.1));

			// Airglow: SkyMesh renders nothing below -2.31 deg sun elevation (src/CLAUDE.md),
			// so without this the off-band night sky is mathematically pure black, which
			// reads as outer space rather than outdoors after dark.
			const air = vec3(0.055, 0.075, 0.105)
				.mul(smoothstep(float(0.02), float(0.5), dir.y).oneMinus())
				.mul(airglow);

			// Alpha is a FLAT 1, fade left entirely to opacityNode -- AdditiveBlending is
			// (SrcAlpha, One), so letting alpha carry density (as an earlier version did)
			// silently multiplies the whole nebula 2-3x past `intensity`.
			return vec4(glow.add(haze).mul(intensity).add(air), float(1));
		});

		material.colorNode = smoke();

		// Fade out below the horizon. `positionWorld` is correct HERE (unlike the
		// instanced layers) because this geometry really is a sphere of `radius`, so
		// y/radius is the altitude sine -- see `altitudeOf` in skyLayer.ts.
		const horizon = smoothstep(float(-0.06), float(0.1), positionWorld.y.div(float(radius)));
		material.opacityNode = horizon.mul(visibility);
		return material;
	};

	const buildGeometry = (): THREE.SphereGeometry => new THREE.SphereGeometry(radius, 32, 16);

	// Built once, deliberately NOT `$derived` -- same reasoning as Stars.svelte: the
	// inputs are authored constants and a derived would hand the teardown effect the
	// new geometry to dispose while the old one leaked. Change a prop and remount.
	const geometry = buildGeometry();
	const material = buildMaterial();

	useTask(
		() => {
			const visible = descriptor.sky.starVisibility;
			visibility.value = visible;
			// The smoke drifts off the TSL `time` node, so it animates every frame -- but
			// only while it is on screen. Skipping the draw also skips a full-dome
			// 44-iteration fractal, easily the most expensive fragment shader in the sky.
			// See Skybox.svelte on renderMode.
			if (mesh) mesh.visible = visible > 0.002;
			if (visible > 0.002) invalidate();
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
	bind:ref={mesh}
	{geometry}
	{material}
	renderOrder={1}
	frustumCulled={false}
	userData={SKY_LAYER_USERDATA}
/>
