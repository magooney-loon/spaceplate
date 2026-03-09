<script lang="ts">
	import { fly } from 'svelte/transition';
	import { stageActions } from '../stage.svelte.js';
	import { soundActions } from '../Sound.svelte';
	import { galaxyState, type CharacterAction } from './GalaxyStage.svelte';

	const btn = (fn: () => void) => () => {
		soundActions.playClick();
		fn();
	};

	const animations: { key: CharacterAction; label: string }[] = [
		{ key: 'idle', label: 'Idle' },
		{ key: 'walk', label: 'Walk' },
		{ key: 'run', label: 'Run' },
		{ key: 'agree', label: 'Agree' },
		{ key: 'headShake', label: 'Head Shake' }
	];
</script>

<!-- Animation controls -->
<div
	transition:fly={{ y: -12, duration: 220 }}
	style="position: absolute; top: 2rem; left: 50%; transform: translateX(-50%); display: flex; gap: 0.5rem; flex-wrap: wrap; justify-content: center;"
>
	{#each animations as anim}
		<button
			onclick={btn(() => (galaxyState.action = anim.key))}
			style="padding: 0.4rem 1rem; background: {galaxyState.action === anim.key
				? 'rgba(255,255,255,0.3)'
				: 'rgba(255,255,255,0.1)'}; color: white; border: 1px solid rgba(255,255,255,{galaxyState.action ===
			anim.key
				? '0.5'
				: '0.2'}); border-radius: 0.5rem; cursor: pointer; backdrop-filter: blur(4px); font-size: 0.875rem; transition: background 0.15s;"
		>
			{anim.label}
		</button>
	{/each}
</div>

<!-- Nav buttons -->
<div
	transition:fly={{ y: 12, duration: 220 }}
	style="position: absolute; bottom: 2rem; left: 50%; transform: translateX(-50%); display: flex; gap: 1rem;"
>
	<button
		onclick={btn(stageActions.goToHome.bind(stageActions))}
		style="padding: 0.5rem 1.5rem; background: rgba(255,255,255,0.15); color: white; border: 1px solid rgba(255,255,255,0.3); border-radius: 0.5rem; cursor: pointer; backdrop-filter: blur(4px);"
	>
		Home View
	</button>
	<button
		onclick={btn(stageActions.goToSettings.bind(stageActions))}
		style="padding: 0.5rem 1.5rem; background: rgba(255,255,255,0.15); color: white; border: 1px solid rgba(255,255,255,0.3); border-radius: 0.5rem; cursor: pointer; backdrop-filter: blur(4px);"
	>
		Settings
	</button>
</div>
