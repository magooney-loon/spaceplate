<script lang="ts">
	import { fly } from 'svelte/transition';
	import { stageActions } from '../stage.svelte.js';
	import { soundActions } from '../Sound.svelte';
	import { useSpacetimeDB, useTable, useReducer } from 'spacetimedb/svelte';
	import { tables, reducers } from '../module_bindings';

	const btn = (fn: () => void) => () => {
		soundActions.playClick();
		fn();
	};

	const conn = useSpacetimeDB();
	const [people] = useTable(tables.person);
	const addReducer = useReducer(reducers.add);

	let name = $state('');

	function addPerson(e: SubmitEvent) {
		e.preventDefault();
		if (!name.trim() || !$conn.isActive) return;
		addReducer({ name });
		name = '';
	}
</script>

<!-- SpacetimeDB example panel -->
<div
	transition:fly={{ y: -12, duration: 220 }}
	style="position: absolute; top: 2rem; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.15); border-radius: 0.75rem; padding: 1.5rem; min-width: 280px; color: white; backdrop-filter: blur(8px);"
>
	<div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1rem;">
		<span
			style="font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.5;"
			>SpacetimeDB</span
		>
		<span
			style="font-size: 0.7rem; padding: 0.1rem 0.5rem; border-radius: 999px; background: {$conn.isActive
				? 'rgba(74,222,128,0.2)'
				: 'rgba(239,68,68,0.2)'}; color: {$conn.isActive ? '#4ade80' : '#f87171'};"
		>
			{$conn.isActive ? 'Connected' : 'Disconnected'}
		</span>
	</div>

	<form onsubmit={addPerson} style="display: flex; gap: 0.5rem; margin-bottom: 1rem;">
		<input
			type="text"
			placeholder="Enter name…"
			bind:value={name}
			disabled={!$conn.isActive}
			style="flex: 1; padding: 0.4rem 0.6rem; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); border-radius: 0.375rem; color: white; font-size: 0.875rem; outline: none;"
		/>
		<button
			type="submit"
			disabled={!$conn.isActive}
			style="padding: 0.4rem 0.9rem; background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.25); border-radius: 0.375rem; color: white; cursor: pointer; font-size: 0.875rem;"
		>
			Add
		</button>
	</form>

	<div style="font-size: 0.8rem; opacity: 0.6; margin-bottom: 0.5rem;">
		People ({$people.length})
	</div>
	{#if $people.length === 0}
		<p style="font-size: 0.85rem; opacity: 0.4; margin: 0;">No people yet.</p>
	{:else}
		<ul
			style="margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 0.25rem;"
		>
			{#each $people as person}
				<li
					style="font-size: 0.875rem; padding: 0.25rem 0.5rem; background: rgba(255,255,255,0.05); border-radius: 0.25rem;"
				>
					{person.name}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<!-- Nav buttons -->
<div
	transition:fly={{ y: 12, duration: 220 }}
	style="position: absolute; bottom: 2rem; left: 50%; transform: translateX(-50%); display: flex; gap: 1rem;"
>
	<button
		onclick={btn(stageActions.goToGalaxy.bind(stageActions))}
		style="padding: 0.5rem 1.5rem; background: rgba(255,255,255,0.15); color: white; border: 1px solid rgba(255,255,255,0.3); border-radius: 0.5rem; cursor: pointer; backdrop-filter: blur(4px);"
	>
		Galaxy View
	</button>
	<button
		onclick={btn(stageActions.goToSettings.bind(stageActions))}
		style="padding: 0.5rem 1.5rem; background: rgba(255,255,255,0.15); color: white; border: 1px solid rgba(255,255,255,0.3); border-radius: 0.5rem; cursor: pointer; backdrop-filter: blur(4px);"
	>
		Settings
	</button>
</div>
