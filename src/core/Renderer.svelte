<script lang="ts">
	// Post-processing is temporarily disabled: pmndrs/postprocessing's EffectComposer
	// is built against THREE.WebGLRenderer and cannot run against WebGPURenderer at all
	// (regardless of whether it's backed by the WebGPU or WebGL fallback path). Threlte's
	// default autoRender handles rendering until this is rebuilt on THREE.RenderPipeline +
	// TSL nodes — see DOCS/webgpu-migration-roadmap.md (Phase 4). Task-ordering rules for
	// Studio compatibility (gizmo/PiP/selection outline) are documented in ./Renderer.md
	// and still apply once the TSL pipeline lands here.
</script>
