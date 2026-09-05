<script lang="ts">
	import { onDestroy } from 'svelte';
	import { T } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import {
		Fn,
		color,
		float,
		modelViewMatrix,
		mx_fractal_noise_float,
		normalView,
		positionLocal,
		positionView,
		positionViewDirection,
		positionWorld,
		uv,
		vec2,
		vec3,
		vec4
	} from 'three/tsl';

	// Front headlight rig for the GR86. Mounts INSIDE the car group, so it inherits the
	// hand-tuned scale/rotation/position and lives in car-local units (metres — measured
	// off the GLB: the body spans z -2.12..2.12, x ±0.91, y 0.16..1.31, and the lamp
	// glass (`Light_Glass`) reaches z = -1.95 at the nose. The nose is -Z.)
	//
	// Three layers per side, cheapest-first:
	//   1. a ProjectorLight for the pool on the road — a SpotLight whose attenuation is a
	//      rectangular frustum instead of a cone, with a TSL `colorNode` painting the
	//      pattern inside it (low-beam cutoff, kerb-side kick-up, hot spot, lens fringe).
	//      This is what makes the pool read as a headlight and not as a torch;
	//   2. two additive TSL-shaded cones for the light hanging in the air — a wide soft
	//      wash plus a narrow core, both shaped across their cross-section so the beam is
	//      a flat blade with a soft top edge, and both dusted with world-space noise;
	//   3. an HDR emitter card at the lens — core, halo and a star flare that only opens
	//      up when you are in front of the car. >1 radiance, so it tone-maps hot and
	//      feeds Bloom (global mode is on by default, so its ghosts come for free).
	//
	// The volumetric-lighting example (DOCS/three.js-dev/examples/webgpu_volume_lighting)
	// ray-marches a VolumeNodeMaterial in its own quarter-res pipeline pass. That is
	// engine work — this rig is scene content, so the volume stays faked in-scene.
	//
	// All numbers are tweak-me constants; nothing here is load-bearing elsewhere.

	// ---------------------------------------------------------------- placement

	const LAMP_X = 0.65; // per-side |x| — outer lamp cluster
	const LAMP_Y = 0.66; // lamp height
	// Just AHEAD of the lamp glass (which ends at z ≈ -1.95), not behind it. Everything
	// in this rig is additive and depth-TESTED, so a beam that starts inside the
	// bodywork gets clipped by the bumper and shows a hard edge where it breaks out.
	const LAMP_Z = -1.67;
	const BEAM_PITCH = -0.045; // radians, negative dips the visible beam slightly down

	// ------------------------------------------------------------------- light

	// A real 2023 GR86 runs LED projectors — cool white, not halogen amber. For the old
	// halogen look use (1.0, 0.93, 0.82) here and in the beam/emitter colours below.
	const LAMP_COLOR = new THREE.Color(0.88, 0.93, 1.0);

	const LIGHT_INTENSITY = 420;
	const LIGHT_DISTANCE = 420; // world units, not scaled by the group's 2.5
	const LIGHT_ANGLE = 0.46; // VERTICAL half-angle of the frustum (rad)
	const LIGHT_ASPECT = 2.3; // width/height — a headlight is wide and short
	// Inverted vs a SpotLight: ProjectorLightNode's edge softness is angle·(1−penumbra)/2
	// in projected UV, so a HIGHER penumbra gives a CRISPER rectangle.
	const LIGHT_PENUMBRA = 0.55;
	const LIGHT_DECAY = 1.35;
	const LIGHT_CAST_SHADOW = false; // two shadowed lights over the track trimesh is pricey

	// The light aims lower than the visible beam: its own drop over `AIM_DISTANCE`, on
	// top of the group's BEAM_PITCH. atan(1.62/8) ≈ 0.20 rad, so the axis sits ≈ 0.245
	// rad down and the frustum covers the road from ~0.8 m ahead of the bumper outward.
	// The cones must NOT follow it down there — they would plunge into the tarmac.
	const AIM_DISTANCE = 8;
	const AIM_DROP = 1.62;

	// Pattern coordinates are the projected frustum remapped to -1..1, x right, y up.
	const CUTOFF_Y = 0.46; // the cutoff line ≈ 0.025 rad below horizontal → lands ~26 m out
	const CUTOFF_KICK = 0.24; // kerb-side step up (right-hand traffic — see the note below)
	const CUTOFF_SOFT = 0.055;
	const HOTSPOT_Y = 0.4; // peak sits immediately UNDER the cutoff, as on a real lamp
	const HOTSPOT_W = 0.4;
	const HOTSPOT_H = 0.3;
	const HOTSPOT_GAIN = 1.7;
	const WASH_BASE = 0.18; // dim fill everywhere below the cutoff
	const WASH_GAIN = 0.55; // extra fill in the middle of the width
	const FRINGE_COLOR = color(0.25, 0.45, 1.0);
	const FRINGE_GAIN = 0.35;
	const FRINGE_WIDTH = 0.05;

	// --------------------------------------------------------------- beam cones

	const BEAM_TIP = 0.03; // cone radius at the lamp, as a fraction of the far radius
	const BEAM_EMERGE = 0.965; // the last stretch at the lamp fades into the emitter glow
	const BEAM_CAMERA_FADE = 4; // world units — nothing solid when the chase cam swings in
	const BEAM_DUST_SCALE = 2.5; // world-space noise frequency (see the note on `dust`)
	// How much of the cone survives when you are looking INTO the beam (see `phase`).
	const BEAM_HEADON = 0.16;
	const BEAM_NEAR_COLOR = color(0.9, 0.95, 1.0);
	const BEAM_FAR_COLOR = color(0.6, 0.74, 1.0);

	const WASH_LENGTH = 9; // car-local metres
	const WASH_HALF_WIDTH = 1.8; // half-extents at the far end
	const WASH_HALF_HEIGHT = 0.5;
	const CORE_LENGTH = 11;
	const CORE_HALF_WIDTH = 0.8;
	const CORE_HALF_HEIGHT = 0.3;

	// ------------------------------------------------------------- emitter card

	// The card is the GLOW's reach, not the lamp's size: halo, bar and spike all run to
	// its edges, so an oversized card throws light onto the fender either side of the
	// lamp. Keep it square and tight, and size the lit slot in metres on top of it —
	// the two used to be coupled, which is why widening the card smeared the glow.
	const CARD_SIZE = 0.3; // square quad, car-local metres
	const LENS_W = 0.1; // lit slot, metres — matches the model's projector element
	const LENS_H = 0.055;
	const LENS_HALF_U = LENS_W / CARD_SIZE; // …and the same slot in card UV (-1..1)
	const LENS_HALF_V = LENS_H / CARD_SIZE;
	const LENS_HEAT = 9; // HDR core: tone-maps to white, drives bloom
	const HALO_HEAT = 1.1;
	const FLARE_HEAT = 0.9;
	const LENS_CORE_COLOR = color(0.96, 0.98, 1.0);
	const LENS_GLOW_COLOR = color(0.62, 0.78, 1.0);

	// ------------------------------------------------------------ the TSL parts

	/** @types/three exports no `ShaderNodeObject`, so borrow the type off a builtin. */
	type Node3 = ReturnType<typeof vec3>;

	/**
	 * The low beam's projected pattern, called once per light with its frustum UV.
	 *
	 * u > 0.5 is the car's RIGHT: the shadow camera looks down the car's -Z with +Y up,
	 * so its +X is the car's +X. The cutoff is therefore kicked up on the right, which
	 * is the right-hand-traffic convention (mirror `CUTOFF_KICK`'s smoothstep for LHT).
	 *
	 * Every smoothstep here is ascending + `oneMinus()` — the descending form is
	 * undefined, not reversed (webgpu-notes.md §1.2).
	 */
	const lowBeamPattern = Fn(([projectorUV]: [Node3]) => {
		const p = projectorUV.xy.sub(0.5).mul(2).toVar();
		const x = p.x;
		const y = p.y;

		const cutoff = float(CUTOFF_Y).add(x.smoothstep(0.02, 0.34).mul(CUTOFF_KICK));
		const below = y.smoothstep(cutoff.sub(CUTOFF_SOFT), cutoff.add(CUTOFF_SOFT)).oneMinus();

		// Wide fill, tapering to the sides and pulled off the bottom edge so the frustum
		// doesn't paint a bright band across the tarmac right at the bumper.
		const wash = x
			.abs()
			.smoothstep(0.3, 1)
			.oneMinus()
			.mul(WASH_GAIN)
			.add(WASH_BASE)
			.mul(y.smoothstep(-1, -0.55));

		const hot = vec2(x.div(HOTSPOT_W), y.sub(HOTSPOT_Y).div(HOTSPOT_H))
			.length()
			.smoothstep(0.25, 1)
			.oneMinus();

		// The blue-violet fringe a projector lens leaves along the cutoff. Signature
		// detail of a real LED/HID low beam, and it costs two smoothsteps.
		const fringe = y
			.sub(cutoff)
			.abs()
			.smoothstep(0, FRINGE_WIDTH)
			.oneMinus()
			.mul(x.abs().smoothstep(0.55, 1).oneMinus());

		const lit = wash.add(hot.mul(HOTSPOT_GAIN)).mul(below);

		return vec3(lit).add(FRINGE_COLOR.mul(fringe).mul(FRINGE_GAIN));
	});

	type BeamOptions = {
		name: string;
		/** Peak additive radiance at the lamp. */
		strength: number;
		/** Exponent on the length fade — higher pulls the light back toward the lamp. */
		falloff: number;
		/** Exponent on the view-facing term — higher is a thinner, wispier volume. */
		body: number;
		/** How much the world-space dust noise modulates it (0 = clean cone). */
		dust: number;
	};

	/**
	 * One additive cone. The mesh is a UNIT cone (far radius 1, length 1) scaled
	 * per-instance, so the shader can work in cross-section units and both cones share
	 * one geometry.
	 */
	const makeBeamMaterial = (o: BeamOptions) => {
		const material = new THREE.MeshBasicNodeMaterial({
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			side: THREE.DoubleSide
		});
		material.name = o.name;
		// Fog would mix the (mostly zero) cone colour toward the fog colour and additive
		// blending would then ADD that — under weather fog the whole cone silhouette
		// would light up as a solid shape. Same reason on the emitter card.
		material.fog = false;

		// CylinderGeometry's uv.y is 1 at +Y (radiusTop) and 0 at -Y; the mesh is rotated
		// so +Y faces the lamp, so uv.y = 1 is AT the lamp.
		const uvY = uv().y;
		const along = uvY.oneMinus(); // 0 at the lamp → 1 at the far end

		// Geometry radius of this ring, and the fragment's position on the unit
		// cross-section: .x runs side to side, .y is +down (local +Z maps to parent -Y
		// through the mesh's +π/2 rotation about X).
		const shellR = along.mul(1 - BEAM_TIP).add(BEAM_TIP);
		const cross = positionLocal.xz.div(shellR);

		const axial = uvY.pow(o.falloff);
		const emerge = uvY.smoothstep(BEAM_EMERGE, 1).oneMinus();

		// Fake volume thickness: a shell is brightest where its normal faces the camera
		// (you are looking through the middle of the cone) and vanishes at the
		// silhouette. `abs()` because the material is double-sided and the back faces
		// come through with negated normals.
		const thickness = normalView.dot(positionViewDirection).abs().pow(o.body);

		// Cross-section profile. The top arc fades out completely (that soft upper edge
		// IS the cutoff, seen side-on) and the bottom arc is held back, both so the beam
		// reads as a flat blade and so the line where the cone cuts the road is faint.
		const profile = cross.y
			.smoothstep(-0.9, -0.05)
			.mul(cross.y.smoothstep(0.45, 1).oneMinus().mul(0.65).add(0.35));

		// Airborne dust, sampled in WORLD space: driving sweeps the beam through a static
		// field, so it shimmers while moving without a `time` node — which would need its
		// own invalidate() owner to animate under on-demand rendering.
		const dust = mx_fractal_noise_float(positionWorld.mul(BEAM_DUST_SCALE), 2).mul(o.dust).add(1);

		// Scatter phase — and this one is deliberately BACKWARDS from the physics. The
		// cone's local -Y is the direction the light travels (+Y is the lamp), so
		// `cosPhase` is +1 with the camera behind the car (back-scatter, the chase view
		// the beams exist for) and -1 head-on (forward-scatter, which in reality is the
		// strongest lobe by far). Rendered honestly, head-on fills the screen with flat
		// milky sheets and washes the car out; the dazzle is already carried by the
		// emitter's HDR core and bloom, so the shafts get pulled way back instead.
		const beamAxis = modelViewMatrix
			.mul(vec4(0, 1, 0, 0))
			.xyz.normalize()
			.negate();
		const cosPhase = beamAxis.dot(positionView.normalize());
		const phase = cosPhase.smoothstep(-0.75, 0.15).mix(BEAM_HEADON, 1);

		// No wall of light when the camera ends up inside the cone.
		const nearCamera = positionView.length().smoothstep(BEAM_CAMERA_FADE * 0.3, BEAM_CAMERA_FADE);

		const strength = float(o.strength)
			.mul(axial)
			.mul(emerge)
			.mul(thickness)
			.mul(profile)
			.mul(dust)
			.mul(phase)
			.mul(nearCamera);

		// colorNode, never fragmentNode (§1.5). Alpha stays 1: AdditiveBlending is
		// SrcAlpha·src + dst, so the fades belong in rgb only — putting them in alpha too
		// squares them and eats the faint end of every gradient.
		material.colorNode = vec4(along.mix(BEAM_NEAR_COLOR, BEAM_FAR_COLOR).mul(strength), 1);

		return material;
	};

	// `body` is the exponent on the view-facing term, i.e. how hard the shell falls off
	// toward its own silhouette. Low values give a cone with a readable straight EDGE —
	// which is what makes it look like a flat sheet rather than a volume — so both sit
	// well above 1 and the strengths carry the brightness instead.
	const washMaterial = makeBeamMaterial({
		name: 'HeadlightBeamWash',
		strength: 0.34,
		falloff: 1.9,
		body: 2.1,
		dust: 0.35
	});

	const coreMaterial = makeBeamMaterial({
		name: 'HeadlightBeamCore',
		strength: 0.58,
		falloff: 2.4,
		body: 2.4,
		dust: 0.18
	});

	// The emitter: a lit slot, a halo around it, and a star flare. Shaped in UV rather
	// than modelled, so the quad's own corners are never visible. FrontSide — the card
	// faces forward and the bodywork occludes it from behind anyway.
	const emitterMaterial = new THREE.MeshBasicNodeMaterial({
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
		side: THREE.FrontSide
	});
	emitterMaterial.name = 'HeadlightEmitter';
	emitterMaterial.fog = false;
	{
		const p = uv().sub(0.5).mul(2).toVar();

		const slot = vec2(p.x.div(LENS_HALF_U), p.y.div(LENS_HALF_V))
			.length()
			.smoothstep(0.45, 1)
			.oneMinus();
		const halo = p.length().smoothstep(0.06, 1).oneMinus().pow(2.4);
		const bar = p.y
			.abs()
			.smoothstep(0, 0.1)
			.oneMinus()
			.mul(p.x.abs().smoothstep(0.15, 1).oneMinus());
		const spike = p.x
			.abs()
			.smoothstep(0, 0.045)
			.oneMinus()
			.mul(p.y.abs().smoothstep(0.1, 1).oneMinus());

		// How square-on the lamp is. Each layer rides a different power of it: the lit
		// slot holds up to a wide angle (a real lens scatters), the halo falls off with
		// it, and the flare only opens when you are nearly in front of the car.
		const facing = normalView.dot(positionViewDirection).clamp(0, 1);

		const core = slot.pow(1.3).mul(LENS_HEAT).mul(facing.pow(0.35));
		const glow = halo.mul(HALO_HEAT).mul(facing.pow(0.8));
		const flare = bar.add(spike.mul(0.5)).mul(FLARE_HEAT).mul(facing.pow(4));

		emitterMaterial.colorNode = vec4(
			LENS_CORE_COLOR.mul(core.add(flare)).add(LENS_GLOW_COLOR.mul(glow)),
			1
		);
	}

	// -------------------------------------------------------------- the objects

	// Unit cone: far radius 1, length 1, open-ended (a far cap would read as a glowing
	// disc). Each mesh scales it into place, so one geometry serves all four cones.
	const beamGeometry = new THREE.CylinderGeometry(BEAM_TIP, 1, 1, 28, 1, true);
	const emitterGeometry = new THREE.PlaneGeometry(CARD_SIZE, CARD_SIZE);

	/** `colorNode` is a WebGPU-only hook @types/three doesn't declare on lights. */
	type PatternLight = THREE.ProjectorLight & { colorNode: unknown };

	// Built imperatively rather than through `<T.ProjectorLight>` + refs: `colorNode`,
	// `aspect` and `target` all have to be set on the instance anyway, and a SpotLight
	// aims at `target`'s WORLD matrix — the default target is an Object3D at the origin
	// that is not in the graph, so each light needs a mounted one.
	const makeLamp = (side: 'L' | 'R') => {
		const light = new THREE.ProjectorLight(
			LAMP_COLOR,
			LIGHT_INTENSITY,
			LIGHT_DISTANCE,
			LIGHT_ANGLE,
			LIGHT_PENUMBRA,
			LIGHT_DECAY
		) as PatternLight;
		light.name = `HeadlightLamp${side}`;
		light.aspect = LIGHT_ASPECT;
		light.colorNode = lowBeamPattern;
		light.castShadow = LIGHT_CAST_SHADOW;
		// The projection is only applied between the shadow camera's near and far planes,
		// whether or not the light casts shadows; pull near in so nothing right at the
		// bumper falls out of the pattern and gets lit flat.
		light.shadow.camera.near = 0.2;

		const target = new THREE.Object3D();
		target.name = `HeadlightAim${side}`;
		light.target = target;

		return { light, target };
	};

	const lampL = makeLamp('L');
	const lampR = makeLamp('R');

	onDestroy(() => {
		washMaterial.dispose();
		coreMaterial.dispose();
		emitterMaterial.dispose();
		beamGeometry.dispose();
		emitterGeometry.dispose();
		lampL.light.dispose();
		lampR.light.dispose();
	});
</script>

{#snippet lamp({ light, target }: { light: PatternLight; target: THREE.Object3D })}
	<T is={light} />
	<T is={target} position={[0, -AIM_DROP, -AIM_DISTANCE]} />

	<!-- The cones: rotation.x = +π/2 maps +Y → +Z, so the narrow top (uv.y = 1) sits at
	     the lamp (z = 0) and the cone widens toward −Z (forward). With −π/2 it inverts —
	     a narrow bright tip out in front and the wide end at the lamp, which reads as the
	     beam shining INTO the car. Scale is [width, length, height]: the mesh's local Y
	     is the length and its local Z becomes the vertical after the rotation. -->
	<T.Mesh
		geometry={beamGeometry}
		material={washMaterial}
		position={[0, 0, -WASH_LENGTH / 2]}
		rotation={[Math.PI / 2, 0, 0]}
		scale={[WASH_HALF_WIDTH, WASH_LENGTH, WASH_HALF_HEIGHT]}
		userData={{ selectable: false, hideInTree: true }}
	/>
	<T.Mesh
		geometry={beamGeometry}
		material={coreMaterial}
		position={[0, 0, -CORE_LENGTH / 2]}
		rotation={[Math.PI / 2, 0, 0]}
		scale={[CORE_HALF_WIDTH, CORE_LENGTH, CORE_HALF_HEIGHT]}
		userData={{ selectable: false, hideInTree: true }}
	/>

	<!-- Emitter, a hair in front of the lens. Plane faces +Z by default → flip to -Z. -->
	<T.Mesh
		geometry={emitterGeometry}
		material={emitterMaterial}
		position={[0, 0, -0.01]}
		rotation={[0, Math.PI, 0]}
		userData={{ selectable: false, hideInTree: true }}
	/>
{/snippet}

<T.Group name="HeadlightL" position={[-LAMP_X, LAMP_Y, LAMP_Z]} rotation={[BEAM_PITCH, 0, 0]}>
	{@render lamp(lampL)}
</T.Group>

<T.Group name="HeadlightR" position={[LAMP_X, LAMP_Y, LAMP_Z]} rotation={[BEAM_PITCH, 0, 0]}>
	{@render lamp(lampR)}
</T.Group>
