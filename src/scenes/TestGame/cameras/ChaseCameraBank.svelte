<script lang="ts">
	import { useTask, useThrelte } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';

	// The camera-roll half of ChaseCamera's corner bank (see that file's "Corner
	// bank" constants block) — split out for exactly one reason: it has to run
	// AFTER CameraControls' own task, which calls `camera.lookAt()`
	// unconditionally every frame (zero roll, relative to `camera.up`) and would
	// erase a roll applied before it runs. Tasks with no ordering constraint
	// fall back to mount order, and ChaseCamera mounts this component AFTER
	// `<CameraControls>` in its markup — so this task registers, and therefore
	// runs, after CameraControls' update with no explicit `{ after }` needed.

	let { active, roll }: { active: boolean; roll: () => number } = $props();

	const { camera, invalidate } = useThrelte();

	useTask(
		() => {
			if (!active) return;
			const cam = camera.current;
			if (!(cam instanceof THREE.PerspectiveCamera)) return;
			const r = roll();
			if (r === 0) return;
			// Incremental about the camera's own (just-relevelled) forward axis —
			// CameraControls left it at zero roll this frame, so this IS the roll.
			cam.rotateZ(r);
			invalidate();
		},
		{ autoInvalidate: false }
	);
</script>
