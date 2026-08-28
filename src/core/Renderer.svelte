<script lang="ts">
	// STUB — post-processing is intentionally removed.
	//
	// This component used to build a ~300-line TSL RenderPipeline covering 25 effects.
	// It was torn out because the pipeline rebuilt itself continuously (see
	// DOCS/graphics-rework.md §1.2) and the graph was too entangled to fix
	// incrementally. Rendering is now plain: Threlte's own autoRenderTask draws the
	// scene, with no composer or render pipeline in between.
	//
	// Tone mapping is deliberately NOT set here. Threlte's renderer context already
	// owns renderer.toneMapping (defaulting to AgX) and drives it from the <Canvas>
	// toneMapping option -- writing it from here as well would mean two owners for one
	// property, which is how several of the earlier bugs started.
	//
	// The `$extensions/postprocessing` module is left in place, untouched and unused,
	// as the starting point for the rebuild. Its Studio panel is already unregistered
	// in App.svelte, and nothing imports its state any more.
	import { settingsState } from '$extensions/settings';
	import { logPostprocessing } from '$extensions/logger';

	// Primitive dependency only. Reading reactive objects directly inside an effect is
	// what produced the original rebuild loop, so the pattern stays avoided even though
	// the body is now trivial.
	const qualityKey = $derived(settingsState.graphics.quality);

	$effect(() => {
		logPostprocessing.info(
			`Graphics quality: ${qualityKey.toUpperCase()} — post-processing disabled (stub)`
		);
	});
</script>
