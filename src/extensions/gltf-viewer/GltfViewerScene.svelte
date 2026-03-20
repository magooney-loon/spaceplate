<script lang="ts">
	import { gltfViewerState } from './gltfViewer.svelte';
	import GltfViewerInstance from './GltfViewerInstance.svelte';
</script>

{#each gltfViewerState.models as model (model.id)}
	<GltfViewerInstance {model} />
{/each}
