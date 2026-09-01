<script lang="ts">
	// The nebula backdrop: a TSL port of the Shadertoy audio-nebula (the `field()`
	// "smoke" with two tinted layers). A descriptor consumer like Stars.svelte, driven
	// by `descriptor.sky.starVisibility` -- the same day-curve channel that fades the
	// stars also fades the smoke.
	//
	// ADAPTATIONS from the 2D original, all deliberate:
	// - iChannel0 is gone: the four spectrum bins are synthesised as slow detuned sine
	//   LFOs, so the smoke keeps breathing without an analyser in the graph.
	// - The original samples a screen-anchored 2D slice (uvs/4, z=0) of the field. We
	//   sample along the actual view ray instead: same 3D field, but it wraps the whole
	//   sky and, crucially, ROTATES with the camera. A screen-anchored backdrop reads
	//   as a video overlay the moment the camera turns.
	// - Time is dilated ~20x. The original is a demo that flies you THROUGH the cloud:
	//   sample-point drift on 12-16s periods, a zoom-breathing second layer, per-frame
	//   strength jitter, and brightness pulsing at music rates. A sky's smoke evolves
	//   over minutes. All of that is either frozen or slowed here -- what made the
	//   demo exciting made the sky obvious.
	// - The screen-edge vignette is gone with it: dimming toward the FRAME border on a
	//   world-anchored sky betrays the overlay every time the camera turns.
	// - The field's rare peaks -- the bright blobs that read as "galaxies" -- are
	//   soft-clamped (d*a/(d+a)) before use: the body passes through almost untouched,
	//   the cores get pressed into gentle dense patches.
	// - The original's screen-noise stars are dropped: Stars.svelte covers that with
	//   billboards that have real sizes and survive camera rotation.
	//
	// AND THEN THE BIGGER DEPARTURE. The first pass kept the demo's two tinted layers
	// spread across the whole sphere and added a Milky Way glow on top. It looked like a
	// nebula, which is exactly the problem: a sky with nebulosity in every direction is
	// the view from inside one. From a planet the galaxy is a BAND and the rest is empty.
	// So the two layers were repurposed into that band's anatomy --
	//
	//   layer 2 (18 iterations) -> the glow's mottling: unresolved star clouds
	//   layer 1 (26 iterations) -> DUST: an obscuring mask that carves the rifts
	//
	// -- the palette was desaturated toward warm-white, the band was made asymmetric
	// about the galactic bulge, and an airglow wash was added so the off-band sky is dark
	// rather than mathematically black. What is left of the Shadertoy is its field(), and
	// that turns out to be the only part that was ever doing sky-shaped work.
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
	// only in iteration count (26 vs 18); one body keeps them from drifting apart the
	// way the pasted source already has.
	//
	// Everything mutating a node lives inside Fn, never at top level: TSL assignment
	// needs an Fn stack and fails with a console warning otherwise, not a throw. See
	// Stars.svelte for the war story.
	const makeField = (iterations: number) =>
		Fn(([p, s]: [any, any]) => {
			// The original jitters `strength` with fract(sin(t)*4373.11) every frame -- a
			// chaotic shimmer that is invisible in a loud demo but reads as noise on a
			// quiet sky. Frozen to the mean.
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
			// The original returns max(0, 5*avg - 0.7), which dominates the frame; softened
			// to 4.2/-0.78 so the smoke reads as distance, not wallpaper.
			return accum.div(totalWeight).mul(4.2).sub(0.78).max(0);
		});

	const field = makeField(26);
	const field2 = makeField(18);

	const buildMaterial = (): THREE.MeshBasicNodeMaterial => {
		const material = skyLayerMaterial({
			side: THREE.BackSide,
			blending: THREE.AdditiveBlending
		});

		// Far-plane depth pinning: honest depth at radius 1000 would be clipped by the
		// camera's far plane, and the smoke must sort behind everything. See skyLayer.ts.
		material.vertexNode = domeVertexNode();

		const smoke = Fn(() => {
			// The view ray; sampling the field along it is what makes this a sky instead
			// of a fullscreen overlay.
			const dir = positionWorld.sub(cameraPosition).normalize();
			const t = time;

			// Synthesised "audio" bands, murmuring rather than pulsing: the original
			// swings these at music rates (a full breathe every ~5s, very visible);
			// these periods run minutes, so the field drifts instead of thumping. Two of
			// the original four are gone with the layers they used to tint -- these two
			// survive as the field's seed inputs, which is what keeps it evolving at all.
			const f2 = float(0.5).add(sin(t.mul(0.013).add(1)).mul(0.03));
			const f3 = float(0.48).add(sin(t.mul(0.019).add(3)).mul(0.03));

			// Drift of the sampled region, ~20x slower and ~4x smaller than the original's
			// sin(t/16)-class terms, which slide the whole cloud across the sky in seconds.
			// Both layers share it (scaled slightly differently) so they move as one body
			// instead of sliding apart and revealing themselves as two decals.
			const drift = vec3(sin(t.div(210)), sin(t.div(170)), sin(t.div(260)));

			// THE BAND IS THE SUBJECT, NOT A STRIPE LAID OVER A BACKDROP. The previous
			// version rendered the fractal smoke across the entire sphere and then added a
			// Milky Way glow on top of it. That is why the night never read as a night:
			// unresolved nebulosity in every direction is what you see from INSIDE a
			// nebula, not what you see standing on a planet, where the galaxy is a band
			// and the rest of the sky is essentially empty. So the fractal is now the
			// band's internal structure rather than wallpaper competing with it.
			//
			// The profile matches the star-density band in Stars.svelte (shared constants
			// in milkyWay.ts) -- the river of stars and the river of light must be the
			// same river.
			const offPlane = dot(dir, vec3(...MILKY_WAY_NORMAL));
			const band = offPlane
				.mul(offPlane)
				.negate()
				.div(2 * MILKY_WAY_SIGMA * MILKY_WAY_SIGMA)
				.exp();
			// Asymmetry along the band: a broad warm swell toward the galactic bulge, a
			// thin cold thread away from it. An evenly bright ring is the clearest tell
			// that a sky was generated.
			const bulge = smoothstep(float(-0.15), float(0.8), dot(dir, vec3(...MILKY_WAY_CORE)));
			const bandShape = band.mul(float(0.35).add(bulge.mul(1.15)));

			// Layer 1 is now DUST, not a second glow -- the change that buys the most
			// realism per line. The Great Rift is the defining feature of the naked-eye
			// Milky Way, and it is an absence: cold molecular cloud in the foreground
			// blocking the light behind it. An additive-only sky can never produce one, so
			// this layer stopped emitting and started obscuring. Sampled coarser than the
			// glow (0.19 vs 0.217) so the rifts are larger than the mottling they carve.
			//
			// The explicit annotation keeps the loosely-typed Fn result from widening the
			// vec3/vec4 overloads below into nonsense.
			const d1: THREE.Node<'float'> = field(
				dir
					.mul(0.19)
					.add(vec3(1, -1.3, 0))
					.add(drift.mul(0.05)),
				f2
			);
			// Soft-saturate BEFORE use. The raw field's rare peaks are several times higher
			// than everything else; d*a/(d+a) is ~linear through the body (d << a) and
			// asymptotes at a, so those peaks become dense patches instead of hard holes.
			const d1s = d1.mul(0.6).div(d1.add(0.6));
			const dust = float(1).sub(d1s.mul(dustDensity)).max(0.06);

			// Layer 2 -- the glow's mottling: the unresolved light of the stars too faint
			// to resolve, clumped the way real star clouds clump. FIXED scale; the
			// original's breathing zoom (sin terms on the divisor) pumps in and out, which
			// is mesmerising in a demo and queasy on a sky.
			const d2: THREE.Node<'float'> = field2(
				dir
					.div(float(4.6))
					.add(vec3(2, -1.3, -1))
					.add(drift.mul(0.04)),
				f3
			);
			const d2s = d2.mul(1.0).div(d2.add(1.0));

			// Warm-white in the bulge, cool grey out on the thread. The old layers were
			// scored (0.5, 0.72, f0*2.1) and (0.9, 0.8, 0.55) -- a teal smoke with magenta
			// cores, which is a Shadertoy palette, not a sky. Naked-eye nebulosity is very
			// nearly colourless; what little hue there is comes from the bulge being warm.
			const hue = mix(vec3(0.62, 0.7, 0.88), vec3(0.95, 0.86, 0.72), bulge);
			// Dust does not only block, it REDDENS what gets through -- the same physics
			// that makes a low sun orange. Cheap, and it is what keeps the rifts from
			// reading as flat grey holes punched in a stripe.
			const reddened = mix(hue, hue.mul(vec3(1, 0.78, 0.58)), d1s);
			const glow = reddened.mul(bandShape.mul(float(0.1).add(d2s.mul(0.42))).mul(dust));

			// A trace of the smoke survives off-band so the empty sky is not perfectly
			// dead, but at a fraction of its old weight -- it is texture, not a subject.
			const haze = vec3(0.16, 0.22, 0.34).mul(d2s.mul(0.1));

			// AIRGLOW. A moonless night is not black: atmospheric oxygen emission plus
			// scattered starlight leave a faint wash, brightest a few degrees up where the
			// line of sight runs longest through the emitting layer. This matters more here
			// than it would elsewhere, because SkyMesh renders NOTHING below -2.31 deg of
			// sun elevation (see the SkyLight note in src/CLAUDE.md), so without this term
			// the off-band night sky is mathematically pure black -- which reads as outer
			// space rather than as being outdoors after dark.
			const air = vec3(0.055, 0.075, 0.105)
				.mul(smoothstep(float(0.02), float(0.5), dir.y).oneMinus())
				.mul(airglow);

			// Alpha is a FLAT 1 and the fade is left entirely to opacityNode. The old
			// version returned c1.a + c2.a + mw.a = 2 + d2s, and AdditiveBlending is
			// (SrcAlpha, One), so the whole nebula was being multiplied by 2-3x past
			// `intensity` -- and non-linearly in density, since d2s rode in the alpha as
			// well as the colour. Every value in this function was being read against a
			// silent gain of two and a half.
			return vec4(glow.add(haze).mul(intensity).add(air), float(1));
		});

		material.colorNode = smoke();

		// Fade out below the horizon, as Stars does: without a ground plane a full sphere
		// of smoke underfoot reads wrong, and with one the depth test hides it anyway.
		//
		// `positionWorld` is correct HERE, unlike in the instanced layers, because this
		// layer's geometry really is a sphere of `radius` -- so y/radius is the altitude
		// sine. See `altitudeOf` in skyLayer.ts for where copying this line went wrong.
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
