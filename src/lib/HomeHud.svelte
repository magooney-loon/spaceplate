<script lang="ts">
	import { stageActions } from '../stage.svelte.js';
</script>

<!-- Example: Home Stage HUD overlay -->
<!-- Replace this with your actual home HUD content -->

<div style="position: absolute; bottom: 2rem; left: 50%; transform: translateX(-50%); display: flex; gap: 1rem;">
	<button onclick={() => stageActions.goToGalaxy()} style="padding: 0.5rem 1.5rem; background: rgba(255,255,255,0.15); color: white; border: 1px solid rgba(255,255,255,0.3); border-radius: 0.5rem; cursor: pointer; backdrop-filter: blur(4px);">
		Galaxy View
	</button>
	<button onclick={() => stageActions.goToSettings()} style="padding: 0.5rem 1.5rem; background: rgba(255,255,255,0.15); color: white; border: 1px solid rgba(255,255,255,0.3); border-radius: 0.5rem; cursor: pointer; backdrop-filter: blur(4px);">
		Settings
	</button>
</div>
