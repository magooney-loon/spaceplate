<script lang="ts">
	// The capture driver — renders nothing; owns the ONE task both captures run in, and
	// wires up the three pieces that do the work: the renderer-size override
	// (resolution.ts), the still grab (still.ts) and the offline take (take.ts). All three
	// are plain closures over the Threlte context, so this file is only assembly.
	//
	// Mount position, task ordering vs. the Gizmo, and what ends up in the output:
	// capture/CLAUDE.md.

	import { useTask, useThrelte } from '@threlte/core/webgpu';
	import { sceneState } from '$extensions/scene';
	import {
		captureResolutionSize,
		captureState,
		registerCaptureDriver,
		unregisterCaptureDriver
	} from './capture.svelte';
	import { createResolutionOverride } from './resolution';
	import { createStillGrabber } from './still';
	import { createTakeRunner } from './take';

	const { renderer, camera, invalidate, autoRenderTask } = useThrelte();

	const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

	const download = (blob: Blob, extension: string) => {
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = `spaceplate-${sceneState.currentScene}-${stamp()}.${extension}`;
		anchor.click();
		// Revoking synchronously after click races the download in some browsers.
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	};

	/** The live canvas. Read fresh on every use — a still and a take both read it directly. */
	const source = () => renderer.domElement;

	const resolution = createResolutionOverride({
		renderer,
		camera: () => camera.current,
		invalidate,
		target: () => captureResolutionSize(captureState.resolution)
	});

	const still = createStillGrabber({ source, resolution, download, invalidate });
	const take = createTakeRunner({ source, resolution, download, invalidate });

	useTask(
		() => {
			// Before anything reads the canvas: if Threlte took the size back mid-capture
			// (a window resize or a dpr change), claim it again. Re-applying costs a prime
			// frame, which the check below then burns — so no consumer ever sees the
			// cleared canvas or the stale velocity buffer.
			resolution.hold();

			// The prime frame is consumed HERE and nowhere else, so both consumers (the
			// still and the take's clock source) skip the same frame. invalidate() because
			// the still path has nothing else to wake the loop.
			if (resolution.priming) {
				resolution.consumePrime();
				invalidate();
				return;
			}

			still.tick();
			take.tick();
		},
		{ after: autoRenderTask, autoInvalidate: false }
	);

	$effect(() => {
		registerCaptureDriver({
			screenshot: () => still.arm(),
			startRecording: () => take.start(),
			stopRecording: () => take.stop()
		});
		return () => {
			// take.dispose() covers a take in flight and still.dispose() a still armed but
			// never grabbed; resolution.dispose() is the backstop, because leaving the
			// renderer resized after unmount would be permanent.
			take.dispose();
			still.dispose();
			resolution.dispose();
			unregisterCaptureDriver();
		};
	});
</script>
