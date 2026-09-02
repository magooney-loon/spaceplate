<script lang="ts">
	// The second cloud deck: heavy-weather mass that SkyMesh cannot render.
	//
	// WHY IT EXISTS. SkyMesh's built-in fbm layer saturates -- its mask is
	// `smoothstep(1 - coverage, ..., fbm)` over noise with a hard floor, so past ~0.52
	// coverage the whole dome is one flat sheet (see Sky.svelte). `Sky.svelte` remaps the
	// `cloudCover` channel into the band that still draws clouds, which means `rain`,
	// `snow` and `storm` (0.8-1.0) have nowhere left to go: heavier weather could only
	// get denser and lower, never *bigger*. This layer is that missing mass. It draws
	// only above ~0.5 cover -- exactly where SkyMesh runs out -- plus a faint sheared
	// cirrus band across the middle of the channel so `cloudy`/`overcast` gain streaks.
	//
	// IT IS A SLAB, NOT A PLANE. The deck marches `steps` slices between two apparent
	// altitudes, compositing front to back with the alpha early-out from three's
	// webgpu_volume_cloud. The reason is not detail -- more octaves buy detail, and the flat
	// version had five of them. It is PARALLAX: a plane-projected field only responds to
	// camera rotation, so under translation the whole deck slid along like a decal.
	// Integrating through a thickness is the only fix for that, and self-shadowing (one tap
	// toward the key light per slice) comes free once there are slices to shadow.
	//
	// What it does NOT do is what the example does: no 3D texture. A 128-cube costs 2 MB and
	// 2.1M CPU noise calls at boot, and being a ball rather than a tiling volume it cannot
	// scroll -- which would cost the wind accumulator below, a hard requirement. The noise
	// stays analytic and the slices are sheared apart instead.
	//
	// WIND, AT LAST. SkyMesh cannot take the wind channel: its `cloudSpeed` uniform is
	// multiplied by absolute elapsed time, so changing the speed teleports the pattern
	// (DOCS/weather-system.md §15.7). A layer that owns its offset has no such problem --
	// this component accumulates a UV offset on the CPU every frame and scrolls both of
	// its decks with it. That makes it the wind channel's first scroll consumer; Rain
	// already reads wind for slant.
	//
	// Pure descriptor consumer, like every other sky layer: reads
	// `weather.cloudCover/cloudType/wind` and the `light` hints in a task, writes only its
	// own uniforms, never the descriptor. Lighting comes from the key-light hints, so the
	// deck tracks time of day AND the deck's own attenuation of the key for free -- a
	// storm at sunset gets warm edges, an overcast night goes near-black, and the model
	// needs to know none of this.
	//
	// It also flashes: Lightning.svelte publishes each strike to `flashState` and this
	// layer lights up around it -- localized to the strike's azimuth, weighted by its own
	// cloud structure. That in-deck glow, not a screen wash, is where a storm's lightning
	// reads from; see flashState.ts for why that state is shared plain, not a prop.
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import type { Mesh } from 'three/webgpu';
	import {
		Break,
		Fn,
		If,
		Loop,
		cameraPosition,
		dot,
		float,
		floor,
		fract,
		max,
		mix,
		positionWorld,
		pow,
		smoothstep,
		sin,
		uniform,
		vec2,
		vec3,
		vec4
	} from 'three/tsl';
	import { clamp01, descriptor, smooth01, windAxisX, windAxisZ } from '../../model';
	import { domeVertexNode, skyLayerMaterial, SKY_LAYER_USERDATA } from '../skyLayer';
	import { flashState } from '../lightning/flashState';

	interface Props {
		/** Dome radius. Cosmetic -- depth is pinned to the far plane. */
		radius?: number;
		/** UV multiplier on the plane projection -- smaller is bigger clouds. */
		scale?: number;
		/**
		 * Plane-projection divisor for the BASE of the mass deck. Distinct from SkyMesh's
		 * storm value (0.1) so the two layers sit at different apparent altitudes and
		 * parallax.
		 */
		elevation?: number;
		/**
		 * How far the slab's top sits above its base, as a fraction of the base's apparent
		 * altitude. This is the thickness the march integrates through, and the whole
		 * reason the deck has an inside — 0 collapses it back to the old single plane.
		 */
		slabThickness?: number;
		/**
		 * March steps through the slab. BAKED INTO THE SHADER (a TSL `Loop` count), so it
		 * is a mount-time constant, not a live knob: changing it rebuilds the material.
		 * Cost is roughly linear in it, minus whatever the alpha early-out saves in dense
		 * weather. A scene on a tight budget lowers this; below ~5 the slices stop reading
		 * as one body and start banding.
		 */
		steps?: number;
		/**
		 * Total optical depth through a fully dense column. Per-step alpha is divided by
		 * `steps`, so the deck looks the same at 6 steps as at 12 — raise this for a deck
		 * that goes opaque sooner, not to make it brighter.
		 */
		opticalDepth?: number;
		/** cloudCover range over which the mass deck fades in. Above SkyMesh's band. */
		massFrom?: number;
		massTo?: number;
		/** cloudCover range over which the cirrus band is present. */
		wispFrom?: number;
		wispTo?: number;
		seed?: number;
	}

	let {
		radius = 1000,
		scale = 0.3,
		elevation = 0.38,
		slabThickness = 0.55,
		steps = 8,
		opticalDepth = 5.5,
		massFrom = 0.5,
		massTo = 0.95,
		wispFrom = 0.12,
		wispTo = 0.42,
		seed = 20260831
	}: Props = $props();

	const { invalidate, autoRenderTask } = useThrelte();

	let mesh = $state.raw<Mesh>();

	// ── Uniforms ───────────────────────────────────────────────────────────────────
	// All written by the task, read by the node graph. Plain uniform nodes, so a change
	// is a buffer write, never a recompile.
	const uStrength = uniform(0); // mass deck weight, 0..1
	const uWisp = uniform(0); // cirrus band weight, 0..1
	const uWind = uniform(new THREE.Vector2()); // accumulated scroll offset, OURS alone
	const uLightColor = uniform(new THREE.Color(1, 1, 1));
	const uLightAmount = uniform(0);
	// Horizontal key-light direction, fed to the shader as a sampling offset so the deck
	// can shade itself: brighter on the side facing the light, like a real cloud would.
	const uLightDir = uniform(new THREE.Vector2(1, 0));
	// Lightning, from flashState: `flash` is the softened envelope Lightning publishes
	// (photosafety-capped at the source -- do not re-amplify), `flashDir` the strike
	// direction. The deck localizes the glow around it.
	const uFlash = uniform(0);
	const uFlashDir = uniform(new THREE.Vector3(0, 0.6, 0.8));

	// ── Noise ──────────────────────────────────────────────────────────────────────
	// Same value-noise family SkyMesh uses, seeded differently and with a domain rotation
	// between octaves (SkyMesh's plain `p *= 2` aligns artifacts to the axes).

	const hash21 = Fn(([p]: [any]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453123)));

	const valueNoise = Fn(([pImmutable]: [any]) => {
		const p = vec2(pImmutable).toVar();
		const i = floor(p);
		const f = fract(p);
		const ff = f.mul(f).mul(float(3).sub(f.mul(2)));

		const a = hash21(i);
		const b = hash21(i.add(vec2(1, 0)));
		const c = hash21(i.add(vec2(0, 1)));
		const d = hash21(i.add(vec2(1, 1)));

		return mix(mix(a, b, ff.x), mix(c, d, ff.x), ff.y);
	});

	// A factory, as Nebula's makeField: the octave count is closed over rather than
	// passed as an Fn argument, because Fn parameters are node-typed.
	const makeFbm = (octaves: number) =>
		Fn(([pImmutable]: [any]) => {
			const p = vec2(pImmutable).toVar();
			const value = float(0).toVar();
			const amplitude = float(0.5).toVar();

			Loop(octaves, () => {
				value.addAssign(amplitude.mul(valueNoise(p)));
				// Rotate ~36.6 degrees, then lacunarity. The rotation is what breaks the
				// grid-aligned streaks SkyMesh's plain `p *= 2` produces.
				p.assign(
					vec2(p.x.mul(0.803).sub(p.y.mul(0.595)), p.x.mul(0.595).add(p.y.mul(0.803))).mul(2.03)
				);
				amplitude.mulAssign(0.5);
			});

			return value;
		});

	// OCTAVES CAME DOWN WHEN THE MARCH WENT IN, deliberately. The old single plane needed
	// five octaves because one sample was the entire cloud; a march composites `steps`
	// slices of a sheared field, which manufactures detail the octaves used to buy — so
	// per-slice cost drops and the total still lands around 3x the flat deck rather than 6x.
	const fbm4 = makeFbm(4); // cirrus only — one sample, it can afford the octaves
	const fbm3 = makeFbm(3); // slab density
	const fbm2 = makeFbm(2); // ridge + the light tap, where shape matters more than detail

	const buildMaterial = (): THREE.MeshBasicNodeMaterial => {
		const material = skyLayerMaterial({
			side: THREE.BackSide,
			// NormalBlending, not additive: a storm deck must be able to DARKEN the sky
			// behind it. Additive layers can only ever add light, which reads as haze,
			// not mass.
			blending: THREE.NormalBlending,
			// Tone-mapped, unlike Nebula/Stars: this layer must sit in the same exposure
			// space as the SkyMesh dome it composites onto, or it survives the day
			// curve's exposure changes as a stuck-on decal.
			toneMapped: true
		});

		// Far-plane depth pinning, as every dome layer: honest depth at radius 1000 is
		// clipped by the camera's far plane, and the deck must sort behind the scene.
		material.vertexNode = domeVertexNode();

		// Slab bounds as apparent altitudes. `elevation` is a projection DIVISOR, so the
		// altitude it stands for is its reciprocal -- the base of the deck. Computed in JS
		// because both are authored constants and the shader wants them folded.
		const slabBase = 1 / elevation;
		const slabTop = slabBase * (1 + slabThickness);
		const seedOffset = vec2((seed % 97) * 0.37, (seed % 89) * 0.53);

		// One slice of the slab: the same threshold-driven coverage the flat deck used,
		// times a vertical profile. Coverage is threshold-driven like SkyMesh's, but the
		// threshold TRAVELS with strength -- the headroom SkyMesh does not have.
		//
		// `hf` is the fraction through the slab. The profile is what gives the deck a
		// silhouette instead of a slice sandwich: eroded at the base (flat-bottomed, as
		// cumulus sit on their condensation level) and tapered off the top.
		const sliceDensity = Fn(([uv, hf]: [any, any]) => {
			const n = fbm3(uv.add(seedOffset));
			const r = fbm2(uv.mul(1.9).add(vec2(19.3, 7.1)));
			const ridge = r.mul(2).sub(1).abs().oneMinus();
			const mass = n.mul(0.68).add(ridge.mul(ridge).mul(0.32));

			const threshold = float(0.74).sub(uStrength.mul(0.34));
			const profile = smoothstep(float(0), float(0.2), hf).mul(
				smoothstep(float(1), float(0.5), hf)
			);
			return smoothstep(threshold, threshold.add(0.22), mass).mul(profile);
		});

		const deck = Fn(() => {
			const dir = positionWorld.sub(cameraPosition).normalize();

			// Horizon fade: near the horizon the projection's UV runs to infinity and the
			// noise degenerates. The fade also reads correctly -- a deck meets the haze.
			const horizonFade = smoothstep(float(0.03), float(0.16), dir.y);

			// PLANE PROJECTION, as SkyMesh: where the view ray crosses a virtual cloud
			// plane at apparent altitude `h`, i.e. `dir.xz / dir.y * h`. Same construction,
			// different constants, so the two decks never read as one layer doubled.
			//
			// The divisor is FLOORED here, unlike the flat deck's, because the march would
			// otherwise evaluate `1/0` at the horizon on its way to being multiplied by a
			// zero fade -- and a NaN survives that multiply.
			const ray = dir.xz.div(max(dir.y, float(0.02))).mul(scale);

			// ── Mass deck: the slab march ────────────────────────────────────────────
			// Front to back, low slice first (low = near, since the camera is under the
			// deck looking up), compositing `over` and stopping once the column is opaque.
			// This is the one thing the flat deck could not do: a projected plane has no
			// parallax under camera TRANSLATION, only rotation, so it slid with the camera
			// like a decal. Integrating through a thickness is what fixes that, and the
			// self-shadowing below comes free with it.
			const lit = uLightColor.mul(uLightAmount);
			// Premultiplied while accumulating -- the composite below divides back out.
			const massColorAcc = vec3(0).toVar();
			const massAlphaAcc = float(0).toVar();

			Loop(steps, ({ i }: any) => {
				const hf = float(i).add(0.5).div(float(steps));
				const h = mix(float(slabBase), float(slabTop), hf);
				// The slice offset is a SHEAR, not just the projection's own scaling with
				// height: without it every slice samples a zoom of one pattern and the slab
				// reads as a tunnel rather than as cloud.
				const uv = ray
					.mul(h)
					.add(uWind)
					.add(vec2(hf.mul(3.1), hf.mul(-1.7)));

				// Per-step alpha scales as 1/steps, so the look is step-count independent
				// (raise `opticalDepth`, not the step count, for a denser deck).
				//
				// `uStrength` is DELIBERATELY NOT IN HERE. It scaled the flat deck's alpha
				// linearly; inside the march it would sit in the exponent instead, and a
				// half-strength deck would come out nearly as opaque as a full one --
				// silently retuning every weather that rides massFrom/massTo. It is applied
				// to the accumulated alpha below, exactly where the old `mask * uStrength`
				// applied it. Coverage still grows with strength through the threshold.
				const density = sliceDensity(uv, hf).mul(opticalDepth / steps);

				If(density.greaterThan(0.001), () => {
					// SELF-SHADOWING, replacing the flat deck's gradient proxy: one tap
					// toward the key light and half a slab upward. Cloud there means this
					// slice is in shadow; nothing there means it is a lit edge. Gated, so
					// empty sky never pays for it.
					const occluder = sliceDensity(uv.add(uLightDir.mul(0.13)), hf.add(0.25).clamp(0, 1));
					const shade = mix(float(1.35), float(0.45), occluder);
					const w = massAlphaAcc.oneMinus().mul(density.min(1));
					massColorAcc.addAssign(lit.mul(shade).mul(w));
					massAlphaAcc.addAssign(w);
				});

				// The early-out from the volume-cloud example: once the column is opaque no
				// slice behind it can contribute. Storms hit this within a few steps.
				If(massAlphaAcc.greaterThanEqual(0.95), () => {
					Break();
				});
			});

			// The march's own coverage, reused below as the lightning term's structure
			// weight -- the flat deck's `mask` under a new name.
			const mask = massAlphaAcc;
			const massWeight = uStrength.mul(horizonFade);
			const massAlpha = massAlphaAcc.mul(massWeight);
			// Stays PREMULTIPLIED (colour x alpha, which is what the accumulator holds) so
			// it drops straight into the weighted mean below, where the wisp term is
			// premultiplied by hand. Both terms take the same weight, so the divide leaves
			// the colour itself untouched.
			const massPremul = massColorAcc.mul(massWeight);

			// ── Cirrus band ──────────────────────────────────────────────────────────
			// Sheared UV (stretched 1:3.2) reads as wind-smears; scrolls faster and sits
			// at a higher apparent altitude than the mass deck.
			const wuv = dir.xz
				.div(dir.y.mul(0.22))
				.mul(scale)
				.mul(vec2(0.8, 3.2))
				.add(uWind.mul(1.7))
				.add(vec2(5.2, 13.4));
			const wn = fbm4(wuv);
			const wispColor = lit.mul(1.45).add(vec3(0.015));
			const wispAlpha = smoothstep(float(0.45), float(0.75), wn)
				.mul(uWisp)
				.mul(0.42)
				.mul(horizonFade);

			// Composite the two sub-layers into one (color, alpha) pair: weighted mean of
			// the colors, clamped sum of the alphas. The epsilon keeps the divide honest
			// when both layers are empty (alpha 0 -- color is then never read).
			const totalAlpha = massAlpha.add(wispAlpha).min(1);
			const color = massPremul.add(wispColor.mul(wispAlpha)).div(totalAlpha.max(1e-4));

			// LIGHTNING. The strike lights the deck from the inside: a sharp angular falloff
			// around the strike direction, weighted by the local mask so dense cells catch it
			// and edges stay dark -- structure, which is what makes it read as weather rather
			// than a lamp behind the sky. The small constant term is the deck-wide bounce.
			//
			// Added AFTER the alpha divide, so blending scales it by totalAlpha: only the
			// deck flashes, never the clear sky through its gaps.
			const align = pow(dot(dir, uFlashDir).max(0), float(4));
			const flash = vec3(0.72, 0.8, 1.0)
				.mul(uFlash)
				.mul(align.mul(1.25).add(0.06))
				.mul(float(0.35).add(mask.mul(0.65)));

			return vec4(color.add(flash), totalAlpha);
		});

		material.colorNode = deck();

		return material;
	};

	const buildGeometry = (): THREE.SphereGeometry => new THREE.SphereGeometry(radius, 48, 24);

	// Built once, not $derived -- same reasoning as Nebula/Stars: authored constants in, a
	// derived would hand teardown the new object while the old one leaked. Remount instead.
	const geometry = buildGeometry();
	const material = buildMaterial();

	// ── Wind scroll ────────────────────────────────────────────────────────────────
	// THE ACCUMULATOR (§15.7). The offset only ever advances -- by a rate derived from the
	// wind channel -- so the pattern is continuous by construction. There is no speed
	// uniform for a time multiplication to scramble; changing wind changes only how fast
	// the deck drifts from here on, never where it currently sits.
	let windX = 0;
	let windZ = 0;

	useTask(
		(delta) => {
			const w = descriptor.weather;
			const cover = clamp01(w.cloudCover);

			// Mass deck: only where SkyMesh has saturated. cloudType leans it toward real
			// storm towers rather than flat sheet -- same semantic Sky.svelte gives it.
			const strength = smooth01(massFrom, massTo, cover) * (0.55 + 0.45 * clamp01(w.cloudType));
			// Cirrus: present through the middle of the channel, backed off once the mass
			// deck takes the sky over.
			const wisp = smooth01(wispFrom, wispTo, cover) * (1 - 0.6 * smooth01(0.75, 1, cover));

			// Scroll rate in UV units/s: a slow drift that never fully stops (real air
			// moves) rising to a visible storm wind. The axis comes from `windDirection`
			// now -- this is the spot the old comment said a direction channel would plug
			// into, and it replaces a hardcoded 1 : 0.38 diagonal that made every weather
			// blow the same way. Still an accumulator, so a change of bearing bends the
			// drift from here on instead of teleporting the pattern (§15.7).
			const rate = (0.0025 + clamp01(w.wind) * 0.02) * delta;
			windX += windAxisX(w) * rate;
			windZ += windAxisZ(w) * rate;
			uWind.value.set(windX, windZ);

			// Light hints already carry time of day AND the deck's own attenuation of the
			// key (they were composed after the weather cut). The 0.05 floor keeps a
			// faint silhouette under a night deck so it is not a hole in the sky.
			const { color, intensity, ambient } = descriptor.light;
			uLightColor.value.setRGB(color[0], color[1], color[2]);
			uLightAmount.value = 0.05 + intensity * 0.16 + ambient * 0.55;
			const d = descriptor.light.direction;
			const len = Math.hypot(d.x, d.z) || 1;
			uLightDir.value.set(d.x / len, d.z / len);

			uStrength.value = strength;
			uWisp.value = wisp;

			// Lightning's published envelope, this frame (this task registers after
			// Lightning's -- Skybox.svelte mounts it first -- so the deck flashes in the same
			// frame the bolt appears).
			uFlash.value = flashState.flash;
			uFlashDir.value.set(flashState.direction.x, flashState.direction.y, flashState.direction.z);

			const visible = strength + wisp > 0.015;
			if (mesh) mesh.visible = visible;
			// The deck scrolls on its own accumulator, so it animates every frame while
			// there is any deck to scroll -- and not at all under a clear sky. A live
			// flash also has to reach the screen even if the deck is thin.
			if (visible || flashState.flash > 0.003) invalidate();
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

<!-- renderOrder 2.5: over the moon (a deck occludes it), under the rain (order 3), which
     is near the camera and must draw last among the sky layers. All these layers pin
     depth to the far plane, so renderOrder is the only thing sorting them. -->
<T.Mesh
	bind:ref={mesh}
	{geometry}
	{material}
	renderOrder={2.5}
	frustumCulled={false}
	userData={SKY_LAYER_USERDATA}
/>
