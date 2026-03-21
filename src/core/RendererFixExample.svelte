<script lang="ts">
	import { useThrelte, useTask } from '@threlte/core';
import type { Camera } from 'three';
	import {
		EffectComposer,
		EffectPass,
		RenderPass,
		SMAAEffect,
		SMAAPreset,
		BloomEffect,
		KernelSize
	} from 'postprocessing';

	const { scene, renderer, camera, size } = useThrelte();

	// Adapt the default WebGLRenderer: https://github.com/pmndrs/postprocessing#usage
	const composer = new EffectComposer(renderer);
	// EffectComposer constructor permanently sets renderer.autoClear = false (by design —
	// it manages clearing itself). Restore it immediately so that Studio's tasks
	// (RenderSelectedObjects, DefaultCamera) which call renderer.render() directly will
	// still clear their render targets correctly. We re-disable it only during our own
	// composer.render() call in the task below.
	renderer.autoClear = true;

	const setupEffectComposer = (camera: Camera) => {
		composer.removeAllPasses();
		composer.addPass(new RenderPass(scene, camera));
		composer.addPass(
			new EffectPass(
				camera,
				new BloomEffect({
					intensity: 1,
					luminanceThreshold: 0.15,
					height: 512,
					width: 512,
					luminanceSmoothing: 0.08,
					mipmapBlur: true,
					kernelSize: KernelSize.MEDIUM
				})
			)
		);
		composer.addPass(
			new EffectPass(
				camera,
				new SMAAEffect({
					preset: SMAAPreset.LOW
				})
			)
		);
	};

	// We need to set up the passes according to the camera in use
	$effect(() => {
		setupEffectComposer($camera);
	});

	$effect(() => {
		composer.setSize($size.width, $size.height);
	});

	const { autoRenderTask, autoRender } = useThrelte();

	// We need to disable auto rendering as soon as this component is
	// mounted and restore the previous state when it is unmounted.
	$effect(() => {
		let before = autoRender.current;
		autoRender.set(false);
		return () => autoRender.set(before);
	});

	// `after: autoRenderTask` ensures we always run AFTER DefaultCamera and
	// RenderSelectedObjects (which use `before: autoRenderTask`), even when they
	// unmount and re-register mid-session. <Renderer /> must be placed FIRST in
	// <Canvas> so our task registers before the Gizmo's `after: autoRenderTask`
	// task — guaranteeing the Gizmo still renders on top of us.
	// See src/core/Renderer.md for the full explanation.
	useTask(
		(delta) => {
			// Disable autoClear for the composer (it manages clearing itself),
			// then restore immediately so the next frame's Studio tasks (RSO,
			// DefaultCamera) get autoClear=true and clear their render targets.
			renderer.autoClear = false;
			composer.render(delta);
			renderer.autoClear = true;
		},
		{ after: autoRenderTask, autoInvalidate: false }
	);
</script>
