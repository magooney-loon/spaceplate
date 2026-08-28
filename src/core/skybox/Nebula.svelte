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
	//   soft-clamped (d*a/(d+a)) before colouring: the smoke passes through almost
	//   untouched, the cores get pressed into gentle dense patches.
	// - The smoke layer is blue instead of the original green.
	// - The original's screen-noise stars are dropped: Stars.svelte covers that with
	//   billboards that have real sizes and survive camera rotation.
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import {
		Fn,
		Loop,
		cameraPosition,
		cameraProjectionMatrix,
		dot,
		float,
		modelViewMatrix,
		positionLocal,
		positionWorld,
		pow,
		smoothstep,
		sin,
		time,
		uniform,
		vec3,
		vec4
	} from 'three/tsl';
	import { descriptor } from './model';
	import { MILKY_WAY_NORMAL, MILKY_WAY_SIGMA } from './milkyWay';

	interface Props {
		/** Distance of the backdrop dome. Cosmetic -- depth is pinned to the far plane. */
		radius?: number;
		/** Overall strength. 1 is the faithful Shadertoy look; the default keeps the smoke a backdrop rather than the subject. */
		intensity?: number;
	}

	let { radius = 1000, intensity = 0.55 }: Props = $props();

	const { invalidate, autoRenderTask } = useThrelte();

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
		const material = new THREE.MeshBasicNodeMaterial();
		material.side = THREE.BackSide;
		material.transparent = true;
		material.depthWrite = false;
		material.blending = THREE.AdditiveBlending;
		material.toneMapped = false;

		// Far-plane depth pinning, as Stars.svelte: honest depth at radius 1000 would be
		// clipped by the camera's far plane, and the smoke must sort behind everything.
		const clip = cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(positionLocal, 1)));
		material.vertexNode = vec4(clip.xy, clip.w, clip.w);

		const smoke = Fn(() => {
			// The view ray; sampling the field along it is what makes this a sky instead
			// of a fullscreen overlay.
			const dir = positionWorld.sub(cameraPosition).normalize();
			const t = time;

			// Synthesised "audio" bands, murmuring rather than pulsing: the original
			// swings these at music rates (a full breathe every ~5s, very visible);
			// these periods run minutes, so brightness drifts instead of thumping.
			const f0 = float(0.45).add(sin(t.mul(0.021)).mul(0.03));
			const f1 = float(0.42).add(sin(t.mul(0.017).add(4)).mul(0.03));
			const f2 = float(0.5).add(sin(t.mul(0.013).add(1)).mul(0.03));
			const f3 = float(0.48).add(sin(t.mul(0.019).add(3)).mul(0.03));

			// Drift of the sampled region, ~20x slower and ~4x smaller than the original's
			// sin(t/16)-class terms, which slide the whole cloud across the sky in seconds.
			// Both layers share it (scaled slightly differently) so they move as one body
			// instead of sliding apart and revealing themselves as two decals.
			const drift = vec3(sin(t.div(210)), sin(t.div(170)), sin(t.div(260)));

			// Layer 1 -- the warm structure. The original's uvs/4 slice becomes dir/4. The
			// explicit annotation keeps the loosely-typed Fn result from widening the vec4
			// overloads below into nonsense.
			const d1: THREE.Node<'float'> = field(
				dir
					.mul(0.25)
					.add(vec3(1, -1.3, 0))
					.add(drift.mul(0.05)),
				f2
			);
			// Soft-saturate BEFORE colouring. The raw field's rare peaks are the "galaxies"
			// -- several times brighter than everything else, and they own the sky.
			// d*a/(d+a) is ~linear through the smoke (d << a) and asymptotes at a, so cores
			// become gentle dense patches instead of glowing blobs. This layer gets the
			// low ceiling (0.6) and the quieter multipliers: it is counterpoint, not subject.
			const d1s = d1.mul(0.6).div(d1.add(0.6));
			const d1sq = d1s.mul(d1s);
			const c1 = vec4(
				f2.mul(0.9).mul(d1sq.mul(d1s)),
				f1.mul(0.8).mul(d1sq),
				f3.mul(0.55).mul(d1s),
				float(1)
			);

			// Layer 2 -- the "smoke": blue instead of the original green, at a FIXED scale --
			// the original's breathing zoom (sin terms on the divisor) pumps in and out,
			// which is mesmerising in a demo and queasy on a sky. Same soft-saturation but
			// with a high ceiling (1.0): this layer IS the smoke, so only its densest
			// patches get pressed down. The blue term is the original's t2*freqs[0],
			// carrying the hue.
			const d2: THREE.Node<'float'> = field2(
				dir
					.div(float(4.6))
					.add(vec3(2, -1.3, -1))
					.add(drift.mul(0.04)),
				f3
			);
			const d2s = d2.mul(1.0).div(d2.add(1.0));
			const d2sq = d2s.mul(d2s);
			const c2 = vec4(d2sq.mul(d2s).mul(0.5), d2sq.mul(0.72), d2s.mul(f0.mul(2.1)), d2s);

			// The Milky Way band: the unresolved light of all the stars too faint to
			// resolve, as a glow laid over the smoke and mottled by it, so it reads as
			// structure in the sky rather than a painted stripe. The profile matches the
			// star-density band in Stars.svelte (shared constants in milkyWay.ts) -- the
			// river of stars and the river of light must be the same river. Slightly cool
			// white, like the real thing.
			const offPlane = dot(dir, vec3(...MILKY_WAY_NORMAL));
			const band = offPlane
				.mul(offPlane)
				.negate()
				.div(2 * MILKY_WAY_SIGMA * MILKY_WAY_SIGMA)
				.exp();
			const mw = vec3(0.72, 0.78, 0.92).mul(band.mul(float(0.14).add(d2s.mul(0.18))));

			return c1.add(c2).add(vec4(mw.x, mw.y, mw.z, float(1)));
		});

		const color = smoke();
		material.colorNode = vec4(color.rgb.mul(intensity), color.a);

		// Fade out below the horizon, as Stars does: without a ground plane a full sphere
		// of smoke underfoot reads wrong, and with one the depth test hides it anyway.
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
