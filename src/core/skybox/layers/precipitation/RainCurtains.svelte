<script lang="ts">
	// Distant rain curtains — the storm's geography.
	//
	// WHY IT EXISTS. `Rain.svelte` is a 70-unit box around the camera: inside it there is
	// weather, outside it there is nothing at all. So a storm has no size and no distance
	// — you cannot watch one arrive, cross a valley or move off, which is most of what
	// makes rain read as a place rather than as an effect switched on. This layer is the
	// part of the rain you look AT rather than stand in.
	//
	// WHAT IT IS. One open-ended cylinder at dome distance, far-plane pinned like every
	// dome layer, with shafts drawn procedurally into the horizon band. A cylinder rather
	// than CloudDeck's sphere purely as a cost decision: the effect only ever occupies a
	// band above the horizon, and a sphere would rasterize the whole sky to draw it.
	//
	// SEAMLESS BY CONSTRUCTION, not by fudge. The shaft field is built from `sin(k·az)`
	// at INTEGER `k`, which is exactly periodic over a full turn, so the pattern closes on
	// itself at the ±π branch cut of `atan` with no blend region and no visible join. It
	// is the same requirement `rainLens`'s `RADIAL_COLUMNS` solves, reached the cheap way
	// because here we choose the frequencies rather than inherit a ported pattern.
	//
	// It is NOT a particle layer and deliberately shares nothing with Rain: at this
	// distance an individual drop is far smaller than a pixel, so drawing one would be
	// dishonest as well as ruinous. What a curtain looks like from a kilometre away is a
	// translucent grey veil with vertical structure, which is a shader, not a field.
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import type { Mesh } from 'three/webgpu';
	import { atan, cameraPosition, float, positionWorld, sin, smoothstep, uniform } from 'three/tsl';
	import { clamp01, descriptor, rainAmount, windAxisX } from '../../model';
	import { domeVertexNode, skyLayerMaterial, SKY_LAYER_USERDATA } from '../skyLayer';
	import { flashState } from '../lightning/flashState';

	interface Props {
		/** Dome radius. Cosmetic — depth is pinned to the far plane, as every dome layer. */
		radius?: number;
		/**
		 * Top of the curtain band as a SINE OF ALTITUDE (i.e. `dir.y`), so it is the cloud
		 * base the shafts hang from. Keep it under CloudDeck's own base or the rain falls
		 * from above the cloud it is supposed to be falling out of.
		 */
		bandTop?: number;
		/** Peak opacity of the veil at full storm, before the weather gates below. */
		strength?: number;
	}

	let { radius = 1000, bandTop = 0.34, strength = 0.5 }: Props = $props();

	const { invalidate, autoRenderTask } = useThrelte();

	let mesh = $state.raw<Mesh>();

	const uOpacity = uniform(0);
	/**
	 * Accumulated azimuthal drift in radians — the self-accumulated-distance rule every
	 * moving sky layer follows (`layers/CLAUDE.md`). Multiplying an elapsed clock by a
	 * wind-driven rate would sweep every curtain around the sky the instant the weather
	 * blended.
	 */
	const uDrift = uniform(0);
	/**
	 * How much of the azimuth is curtain rather than gap, 0..1. Rides rain amount: a
	 * shower is a few isolated shafts you can see daylight past, a storm is a closed wall.
	 */
	const uCoverage = uniform(0);
	/** The veil's colour: the horizon's own haze, darkened. Premultiplied on the CPU. */
	const uVeil = uniform(new THREE.Vector3(0.5, 0.54, 0.6));

	/** Base azimuthal drift rate, rad/s — air is never quite still. */
	const DRIFT_BASE = 0.004;
	/** What a full-strength crosswind adds to it. */
	const DRIFT_WIND = 0.05;

	const buildMaterial = (): THREE.MeshBasicNodeMaterial => {
		const material = skyLayerMaterial({
			// Inward-facing: the camera is inside the cylinder.
			side: THREE.BackSide,
			// NormalBlending and tone-mapped, both for CloudDeck's reasons: a curtain must
			// be able to DARKEN the sky behind it (additive can only add light, which reads
			// as haze rather than as water), and it must live in the dome's exposure space
			// or it survives the day curve's exposure changes as a stuck-on decal.
			blending: THREE.NormalBlending,
			toneMapped: true
		});

		material.vertexNode = domeVertexNode();

		// The view direction, as CloudDeck builds it. `positionWorld` is the real dome
		// position here — the `altitudeOf` warning in `layers/CLAUDE.md` is about INSTANCED
		// layers, where it would be the quad corner instead.
		const dir = positionWorld.sub(cameraPosition).normalize();
		const alt = dir.y;
		const az = atan(dir.z, dir.x);

		// THE SHAFTS. Integer frequencies only — see the header on why the seam closes for
		// free. Three octaves is enough to stop the spacing reading as regular; a fourth
		// only adds cost at a scale the veil's own softness swallows.
		const shafts = sin(az.mul(7).add(uDrift))
			.mul(0.5)
			.add(sin(az.mul(11).sub(uDrift.mul(0.7)).add(1.7)).mul(0.3))
			.add(sin(az.mul(19).add(uDrift.mul(1.3)).sub(0.9)).mul(0.2));

		// Thresholded against coverage, so heavier rain widens the shafts and closes the
		// gaps rather than simply making the same shafts more opaque. The threshold is
		// `uCoverage` remapped into the field's own [-1, 1] range, and the ramp above it is
		// wide on purpose — a hard cut gives a curtain a vertical EDGE, which is the one
		// thing a rain shaft has not got. Ascending edges, as WGSL requires.
		const threshold = uCoverage.mul(-2).add(1);
		const curtain = smoothstep(threshold, threshold.add(0.55), shafts);

		// Fine vertical striation inside each shaft, at a frequency high enough to read as
		// texture rather than as more shafts. Integer again, for the same reason.
		const striation = sin(az.mul(160).add(uDrift.mul(2.2)))
			.mul(0.12)
			.add(0.88);

		// THE VERTICAL PROFILE. Both smoothsteps are written ASCENDING and inverted where a
		// falling edge is wanted — WGSL leaves `smoothstep` undefined when edge0 >= edge1,
		// the rule the whole layers tree follows.
		//
		// Bottom: fades in across the horizon, so a curtain does not end in a hard line at
		// the world's edge. Top: fades out approaching the cloud base it hangs from, which
		// is what makes it read as falling OUT of the deck rather than as a painted band.
		const horizonFade = smoothstep(float(-0.03), float(0.05), alt);
		const topFade = smoothstep(float(bandTop * 0.45), float(bandTop), alt).oneMinus();
		const profile = horizonFade.mul(topFade);

		material.colorNode = uVeil;
		material.opacityNode = uOpacity.mul(curtain).mul(striation).mul(profile);
		return material;
	};

	// Open-ended, and generous in height: the profile above does the shaping, and geometry
	// that stops short of it would clip the fade into a hard edge. Few segments — every
	// value the shader reads is a direction, so the mesh is a rasterization mask and
	// nothing else. A closure for the same reason CloudDeck's `buildGeometry` is one:
	// `radius` is a BUILD-TIME prop here, and reading it at the top level is the thing
	// Svelte warns about.
	const buildGeometry = (): THREE.CylinderGeometry => {
		const g = new THREE.CylinderGeometry(radius, radius, radius * 0.95, 64, 1, true);
		g.translate(0, radius * 0.22, 0);
		return g;
	};

	const material = buildMaterial();
	const geometry = buildGeometry();

	let drift = 0;
	const scratch = new THREE.Color();

	useTask(
		(delta) => {
			const w = descriptor.weather;
			const rain = rainAmount(w);
			const cover = clamp01(w.cloudCover);
			const wind = clamp01(w.wind);

			// A presence curve, as Rain's: whether there is a storm out there is a threshold
			// question, and the DEPTH of it is what the coverage term expresses.
			const presence = Math.min(1, rain * 2.2);

			// THREE GATES, and the third is the one that is easy to forget. A curtain needs
			// a deck to fall out of (`cover`), it needs rain (`presence`) — and it has to
			// DISAPPEAR IN FOG, because `fog = false` is the sky-layer material contract, so
			// nothing else in the engine will hide a thing at a kilometre when visibility is
			// a hundred metres. Without it the curtains hang in front of their own fog bank.
			const visibility = 1 - clamp01(w.fog);
			uOpacity.value = presence * cover * visibility * strength;

			// Coverage rides the rain amount alone: the gaps between shafts are what a
			// shower has and a storm does not.
			uCoverage.value = clamp01(0.12 + rain * 0.8);

			// Apparent azimuthal drift, SIGNED by the wind's X axis rather than its full
			// bearing — and that is the physics, not a shortcut. Wind blowing across the
			// view sweeps curtains through a lot of azimuth; wind blowing toward or away
			// from the camera sweeps them through almost none, and `windAxisX` is exactly
			// that projection. Accumulated, never `elapsed × rate` (see `uDrift`).
			drift += delta * (DRIFT_BASE + wind * DRIFT_WIND * windAxisX(w));
			uDrift.value = drift;

			// The veil is the horizon's own haze, darkened — a rain shaft at this distance
			// is the sky with the light taken out of it, not a grey object hung in front of
			// it. `sky.fogColor` is the authored-sRGB field (SkyFog.svelte's note on the two
			// colour fields), so it is read as sRGB and lands in working space.
			const [r, g, b] = descriptor.sky.fogColor;
			scratch.setRGB(r, g, b, THREE.SRGBColorSpace);
			// Lightning lights a distant curtain the same way it lights the deck and the fog
			// — the same capped envelope, never scaled back up. This is the layer where a
			// strike is most legible, since a shaft is a silhouette against the sky.
			const flash = clamp01(flashState.flash) * 0.9;
			uVeil.value.set(scratch.r * 0.72 + flash, scratch.g * 0.74 + flash, scratch.b * 0.78 + flash);

			const visible = uOpacity.value > 0.004;
			if (mesh) mesh.visible = visible;
			// Self-animated (the drift accumulator), so it owns its invalidation gated on
			// visibility — the layer contract in `../../CLAUDE.md`.
			if (visible) invalidate();
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

<!-- renderOrder 2.55: after CloudDeck (2.5), because a curtain hangs BELOW the deck it
     falls from and is nearer the camera than it; before the bolt (2.6), which is drawn at
     a fixed near-ish distance and must be able to strike in front of one. All dome layers
     pin depth to the far plane, so renderOrder is the only thing sorting them. -->
<T.Mesh
	bind:ref={mesh}
	{geometry}
	{material}
	renderOrder={2.55}
	frustumCulled={false}
	userData={SKY_LAYER_USERDATA}
/>
