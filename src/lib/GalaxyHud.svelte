<script lang="ts">
	import { stageActions } from '../stage.svelte.js';
	import { soundActions } from '../Sound.svelte';

	const btn = (fn: () => void) => () => { soundActions.playClick(); fn(); };
</script>

<!-- Example: Galaxy Stage HUD overlay -->
<!-- Replace this with your actual galaxy HUD content -->

<div style="position: absolute; bottom: 2rem; left: 50%; transform: translateX(-50%); display: flex; gap: 1rem;">
	<button onclick={btn(stageActions.goToHome.bind(stageActions))} style="padding: 0.5rem 1.5rem; background: rgba(255,255,255,0.15); color: white; border: 1px solid rgba(255,255,255,0.3); border-radius: 0.5rem; cursor: pointer; backdrop-filter: blur(4px);">
		Home View
	</button>
	<button onclick={btn(stageActions.goToSettings.bind(stageActions))} style="padding: 0.5rem 1.5rem; background: rgba(255,255,255,0.15); color: white; border: 1px solid rgba(255,255,255,0.3); border-radius: 0.5rem; cursor: pointer; backdrop-filter: blur(4px);">
		Settings
	</button>
</div>
