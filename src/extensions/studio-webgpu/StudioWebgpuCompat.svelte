<script lang="ts">
	// Applies the scene-side Studio/WebGPU shim. Mount as the first child of <Canvas>
	// so the patch is in place before Studio's render-modes extension assigns an
	// override material. The renderer-side shim can't live here — it has to run at
	// renderer construction, so App.svelte's createRenderer calls
	// patchRendererForStudio directly.
	import { useThrelte } from '@threlte/core/webgpu';
	import { patchSceneOverrideMaterial } from './studioWebgpu';

	const { scene } = useThrelte();

	patchSceneOverrideMaterial(scene);
</script>
