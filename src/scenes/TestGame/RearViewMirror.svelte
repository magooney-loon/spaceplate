<script lang="ts">
	// Rear-view mirror — an NFS-style strip at the top of the screen showing the
	// road BEHIND the car.
	//
	// WHY NOT A REFLECTOR. DemoScene's mirror floor and three's webgpu_mirror
	// example are the same `reflector()` TSL node, and neither can do this job:
	// a planar reflector's image is the ACTIVE camera mirrored across the plane,
	// and a camera sitting behind the car can only ever see its own side of any
	// mirror mounted on the car. "What is behind me" needs a camera facing
	// backwards, so this is one: a second PerspectiveCamera riding the car,
	// rendered into a small render target, composited as an overlay quad that
	// tracks the top of the screen. (An ArrayCamera viewport is the other shape
	// this could take — but it means replacing the app camera Threlte renders
	// with, which the ChaseCamera's whole borrowing contract exists to avoid.)
	//
	// THE PASS. A `{ before: autoRenderTask }` task (render stage, after Rapier's
	// synchronization — the physics-pose rule) fills the RT with
	// setRenderTarget/clear/render/restore, the same shape as HeightField's pass.
	// Render-target passes skip the output colour transform, so the RT holds RAW
	// LINEAR HDR — the quad then re-enters tone mapping through the base pass
	// like any lit surface, in pipeline AND bypass mode alike. Shadows are NOT
	// suspended and NOT re-rendered here: the key light's shadow map is armed
	// once a frame from the main draw, so this pass samples the atlas the main
	// camera fitted, one frame old. That is deliberate — the cascades are fitted
	// to whichever camera renders them, and letting this backward-facing camera
	// fit them would leave the car out of its own shadow map ($core/skybox/
	// keyShadow.ts). A frame-old shadow inside a rear-view strip is invisible.
	// (The headlights never cast; LIGHT_CAST_SHADOW.)
	//
	// THE OVERLAY QUAD rides the ACTIVE camera on LENS_LAYER — the first
	// resident of that layer since the rain/frost lenses became post effects
	// (skyLayer.ts keeps the layer and its reasoning for exactly this). The
	// active camera enables the bit while this scene is up; internal cameras are
	// constructed fresh with the layer-0 mask, so nothing re-samples the strip —
	// the same guarantee the lens quads used to rely on. `transparent` +
	// renderOrder 999 draws it after the scene's transparents (smoke must not
	// wash over it); depthTest/Write off, fog off. The casing is a
	// rounded-rectangle SDF with an alphaTest cutout — discarded fragments
	// write NOTHING, so the velocity stamp below only covers the visible shape.
	// KNOWN MRT TRADE (postprocessing/CLAUDE.md §"Non-output attachments do not
	// blend"): the retained pixels stamp their ~zero velocity over the velocity
	// attachment under the strip — nothing visible is lost (they are opaque or
	// the 1px AA band); motion blur leaves the mirror image sharp (a digital
	// mirror — fine) and AO / bloom-Material-mode see the quad's flat inputs
	// under it. A pipeline composite would avoid that but is engine surgery for
	// one scene.
	//
	// MIRROR SEMANTICS: the image is flipped horizontally — a car overtaking on
	// the right appears on the right of the strip, as in a real mirror. A plain
	// backward camera would put it on the left.
	//
	// ON-DEMAND: the task never invalidates. TestGame's follow rig already pins
	// the render loop while the scene is mounted (testperf.md §2.3), so the
	// mirror simply rides whatever frames render. Stands down on Studio's editor
	// camera (the marker trick from ChaseCamera.svelte) and while the car's
	// anchor is missing.

	import { useTask, useThrelte } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import { mix, smoothstep, texture, uv, vec2, vec4 } from 'three/tsl';
	import { LENS_LAYER } from '$core/skybox/layers/skyLayer';

	let { target }: { target?: THREE.Object3D } = $props();

	// ── The strip ─────────────────────────────────────────────────────────────
	// RT and on-screen geometry are locked to the same 4:1 so the image never
	// stretches; the quad's size is derived from the camera's fov every frame so
	// the strip holds a constant screen fraction through the nitrous/launch FOV
	// kicks (ChaseCamera widens the lens up to +24°).
	const STRIP_ASPECT = 4;
	const RT_WIDTH = 1024;
	const RT_HEIGHT = RT_WIDTH / STRIP_ASPECT;
	/** Fraction of the visible frame height the strip covers. */
	const HEIGHT_FRACTION = 0.12;
	/** Gap above the strip, as a fraction of the visible frame height. */
	const TOP_FRACTION = 0.045;
	/** Camera-space distance to the quad — must clear the camera's near (1). */
	const QUAD_DISTANCE = 2;

	// ── The casing shape ───────────────────────────────────────────────────────
	// All in STRIP HALF-HEIGHTS: the SDF below works in pixel-proportional
	// space, so one unit is the same length in pixels on either axis and these
	// read uniform on screen. Corner radius must stay ≤ 1 (the short half-extent).
	/** Corner rounding of the casing — 0.55 ≈ pill-soft. */
	const CORNER_RADIUS = 0.55;
	/** Casing ring thickness. */
	const CASING_WIDTH = 0.14;
	/** Softness of the casing↔glass boundary. */
	const CASING_SOFT = 0.04;
	/** Anti-alias feather across the outer edge; alphaTest cuts beyond it. */
	const EDGE_FEATHER = 0.03;
	/** Glass brightness just inside the casing (its shadow), 1 = untouched. */
	const GLASS_EDGE_LIGHT = 0.78;
	/** How far that glass shading reaches inside the casing. */
	const GLASS_SHADE_WIDTH = 0.06;
	/** Casing tone, bottom → top (a lit rim reads as form, not a flat border). */
	const CASING_BOTTOM: [number, number, number] = [0.016, 0.02, 0.03];
	const CASING_TOP: [number, number, number] = [0.1, 0.115, 0.14];

	// ── The mirror camera ─────────────────────────────────────────────────────
	// Constructed fresh (never cloned): layer-0 mask only, so it skips LENS_LAYER
	// (would otherwise draw the strip into itself) and PRECIPITATION_LAYER (the
	// cost gate — rain/snow stay out of the mirror exactly as they stay out of
	// the cube captures). Level + slightly down, like a driver-adjusted cabin
	// mirror: horizon in the upper half, road in the lower. 24° vertical over
	// 4:1 is ~80° horizontal — enough peripheral awareness behind.
	const MIRROR_FOV = 24;
	const MIRROR_NEAR = 0.2;
	const MIRROR_FAR = 500;
	/** Offset from the chase anchor (which sits at the body's middle, 1.6 up):
	 * anchor-relative [0, 1.95, 5.5] = body [0, 3.55, 5.5] — just above the
	 * roofline (3.28) and just behind the tail (5.25). */
	const MIRROR_OFFSET: readonly [number, number, number] = [0, 1.95, 5.5];

	const mirrorCam = new THREE.PerspectiveCamera(MIRROR_FOV, STRIP_ASPECT, MIRROR_NEAR, MIRROR_FAR);
	mirrorCam.name = 'RearViewMirrorCamera';
	mirrorCam.rotation.order = 'YXZ';
	// Yaw π faces +Z (the tail — the model's nose is −Z); a touch of pitch
	// brings the road into the lower half of the strip.
	mirrorCam.rotation.set(-0.05, Math.PI, 0);
	mirrorCam.position.set(...MIRROR_OFFSET);
	mirrorCam.userData = { selectable: false, hideInTree: true };

	// ── The render target ─────────────────────────────────────────────────────
	// HalfFloat keeps the sky's HDR radiance (render-target passes skip tone
	// mapping) so the mirror tones out identical to the world around it.
	const rt = new THREE.WebGLRenderTarget(RT_WIDTH, RT_HEIGHT, {
		type: THREE.HalfFloatType
	});

	// ── The overlay quad ──────────────────────────────────────────────────────
	const quadGeometry = new THREE.PlaneGeometry(1, 1);
	const quadMaterial = new THREE.MeshBasicNodeMaterial();
	quadMaterial.name = 'RearViewMirror';
	// Built from plain floats/vec4s on purpose — TSL's promotion rules quietly
	// widen mixed-length mixes (postprocessing/CLAUDE.md §"TSL silently widens").
	//
	// THE SAMPLE FLIPS, both deliberate: x for MIRROR semantics (see header); y
	// because WebGPU's texture origin is top-left while the plane's `uv()`
	// origin is bottom-left — an RT sampled with a raw uv() lands upside down
	// (webgpu-notes.md §4's vertical-mirror warning, browser-verified).
	const sampleUv = vec2(uv().x.oneMinus(), uv().y.oneMinus());
	const image = texture(rt.texture, sampleUv);

	// THE SHAPE: a rounded-rectangle signed distance, measured in
	// pixel-proportional space — uv scaled so one unit is the same PIXEL length
	// on both axes (the quad is locked to STRIP_ASPECT, so ×STRIP_ASPECT on x is
	// exact). That is what makes the corner radius and the casing ring read
	// uniform on a 4:1 strip; in raw uv the ring would be 4× thicker on the long
	// edges than the short ones.
	const p = uv().mul(2).sub(1); // −1..1, y up
	const s = vec2(p.x.mul(STRIP_ASPECT), p.y); // pixel-proportional: x ±4, y ±1
	const box = vec2(STRIP_ASPECT - CORNER_RADIUS, 1 - CORNER_RADIUS);
	// Outside distance to the rounded edge: 0 AT the edge, negative inside (the
	// flat-edge distance is exact; the inside is conservative, which is all the
	// masks need).
	const d = s.abs().sub(box).max(0).length().sub(CORNER_RADIUS);

	// Casing ring, shaded bottom→top so it reads as a lit rim rather than a
	// flat border, plus a faint shadow it casts onto the glass just inside.
	const shade = p.y.mul(0.5).add(0.5);
	const casingColor = mix(vec4(...CASING_BOTTOM, 1), vec4(...CASING_TOP, 1), shade);
	const casing = smoothstep(-CASING_WIDTH, -CASING_WIDTH + CASING_SOFT, d);
	const innerClear = smoothstep(-CASING_WIDTH - GLASS_SHADE_WIDTH, -CASING_WIDTH, d);
	const glass = image.mul(mix(GLASS_EDGE_LIGHT, 1, innerClear));
	// Alpha is FORCED to 1 here: `image` is a full vec4 sample, and an RT's own
	// alpha channel is clear-colour garbage (the dome and the sky's transparent
	// layers write whatever they write) — feeding it through made the glass
	// semi-transparent. The shape mask in `opacityNode` is the ONLY alpha this
	// material may emit.
	quadMaterial.colorNode = vec4(mix(glass, casingColor, casing).rgb, 1);

	// AA'd cutout: alpha fades across the edge, alphaTest discards past it — a
	// DISCARDED fragment writes nothing, not even the velocity attachment, so
	// the MRT trade in the header is bounded by the visible shape, not the
	// quad's rectangle.
	quadMaterial.opacityNode = smoothstep(-EDGE_FEATHER, EDGE_FEATHER, d).oneMinus();
	quadMaterial.alphaTest = 0.5;

	// The transparent list, sorted by renderOrder — after smoke and every other
	// scene transparent. The blending is real now (the casing's rounded corners
	// and the AA band show the world through); `transparent` is also what puts
	// the quad in the late list.
	quadMaterial.transparent = true;
	quadMaterial.depthTest = false;
	quadMaterial.depthWrite = false;
	quadMaterial.fog = false;

	const quad = new THREE.Mesh(quadGeometry, quadMaterial);
	quad.name = 'RearViewMirror';
	quad.renderOrder = 999;
	quad.frustumCulled = false;
	quad.layers.set(LENS_LAYER);
	quad.userData = { selectable: false, hideInTree: true };
	quad.visible = false;

	const { scene, renderer, camera, autoRenderTask } = useThrelte();

	// Studio's editor camera marker — same stand-down as ChaseCamera.svelte.
	const isEditorCamera = (cam: THREE.Camera | undefined) => cam?.userData.editorCamera === true;

	// The mirror camera rides the chase anchor (the RigidBody's own pose, no
	// suspension lean — the mirror must not bob with the visual body).
	$effect(() => {
		if (!target) return;
		target.add(mirrorCam);
		return () => mirrorCam.removeFromParent();
	});

	// The overlay rides the ACTIVE camera, which enables LENS_LAYER for the
	// visit — and gives the bit back on the way out (no other resident exists;
	// skyLayer.ts). Re-runs on a camera swap, so Studio's editor camera both
	// unhides and re-hides this correctly.
	$effect(() => {
		const cam = $camera;
		if (!cam || !target || isEditorCamera(cam)) return;
		cam.layers.enable(LENS_LAYER);
		cam.add(quad);
		quad.visible = true;
		return () => {
			quad.visible = false;
			quad.removeFromParent();
			cam.layers.disable(LENS_LAYER);
		};
	});

	// ── The frame task ────────────────────────────────────────────────────────
	// One owner, no invalidate (see header). `quad.parent` is the stand-down
	// gate: unparented means editor camera or no anchor, and then the RT is not
	// filled either.
	const size = new THREE.Vector2();

	useTask(
		() => {
			if (!target || quad.parent === null) return;
			const cam = camera.current;
			if (!(cam instanceof THREE.PerspectiveCamera)) return;

			// 1) Fill the mirror. HeightField's save/clear/render/restore shape —
			// the explicit clear is defensive against anything that left
			// autoClear off on the shared renderer.
			const previousTarget = renderer.getRenderTarget();
			renderer.setRenderTarget(rt);
			renderer.clear();
			renderer.render(scene, mirrorCam);
			renderer.setRenderTarget(previousTarget);

			// 2) Place the strip. Per-frame from the CURRENT fov and canvas aspect
			// so the nitrous/launch kicks resize the world around a steady strip.
			renderer.getSize(size);
			const aspect = size.width > 0 && size.height > 0 ? size.width / size.height : 1;
			const halfH = QUAD_DISTANCE * Math.tan(THREE.MathUtils.degToRad(cam.fov) * 0.5);
			const halfW = halfH * aspect;
			let quadH = HEIGHT_FRACTION * 2 * halfH;
			let quadW = quadH * STRIP_ASPECT;
			// Very narrow windows would push the 4:1 strip past the screen edges —
			// clamp the width and let the height follow.
			const maxW = 0.6 * 2 * halfW;
			if (quadW > maxW) {
				quadW = maxW;
				quadH = quadW / STRIP_ASPECT;
			}
			quad.scale.set(quadW, quadH, 1);
			quad.position.set(0, halfH - TOP_FRACTION * 2 * halfH - quadH / 2, -QUAD_DISTANCE);
		},
		{ before: autoRenderTask, autoInvalidate: false }
	);

	// Script-owned three objects dispose themselves (the Sky.svelte pattern).
	$effect(() => {
		return () => {
			rt.dispose();
			quadGeometry.dispose();
			quadMaterial.dispose();
		};
	});
</script>
