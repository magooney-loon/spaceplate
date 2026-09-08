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
	// suspended: SkyLight arms `shadow.needsUpdate` once per frame and the first
	// pass to render pays it, every later pass reuses — this pass is that first
	// one, so the frame still renders the shadow map exactly once and the mirror
	// shows correct shadows. (The headlights never cast; LIGHT_CAST_SHADOW.)
	//
	// THE OVERLAY QUAD rides the ACTIVE camera on LENS_LAYER — the first
	// resident of that layer since the rain/frost lenses became post effects
	// (skyLayer.ts keeps the layer and its reasoning for exactly this). The
	// active camera enables the bit while this scene is up; internal cameras are
	// constructed fresh with the layer-0 mask, so nothing re-samples the strip —
	// the same guarantee the lens quads used to rely on. `transparent` +
	// renderOrder 999 draws it after the scene's transparents (smoke must not
	// wash over it); depthTest/Write off, fog off. KNOWN MRT TRADE
	// (postprocessing/CLAUDE.md §"Non-output attachments do not blend"): an
	// in-scene overlay stamps its own ~zero velocity over the velocity
	// attachment under the strip — the strip is opaque, so nothing visible is
	// lost; motion blur leaves the mirror image sharp (a digital mirror — fine)
	// and AO/bloom-Material-mode see the quad's flat inputs under it. A pipeline
	// composite would avoid that but is engine surgery for one scene.
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
	// Mirror flip on x (see header), soft bezel so it reads as a mirror. Built
	// from plain floats/vec4s on purpose — TSL's promotion rules quietly widen
	// mixed-length mixes (postprocessing/CLAUDE.md §"TSL silently widens").
	const sampleUv = vec2(uv().x.oneMinus(), uv().y);
	const image = texture(rt.texture, sampleUv);
	const edgeX = uv().x.sub(0.5).abs().mul(2);
	const edgeY = uv().y.sub(0.5).abs().mul(2);
	const bezel = smoothstep(0.94, 0.985, edgeX.max(edgeY));
	quadMaterial.colorNode = mix(image, vec4(0.02, 0.024, 0.035, 1), bezel);
	// The transparent list, sorted by renderOrder — after smoke and every other
	// scene transparent. No blending actually happens (alpha 1); `transparent`
	// is what puts the quad in the late list.
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
