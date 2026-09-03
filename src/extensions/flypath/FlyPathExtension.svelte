<script lang="ts">
	import { useStudio, ToolbarItem, DropDownPane } from '@threlte/studio/extend';
	import { Folder, Slider, Checkbox, Button, Separator, List } from 'svelte-tweakpane-ui';
	import type { Snippet } from 'svelte';
	import { captureState } from '$extensions/capture';
	import { flyPathState, flyPathActions, totalDuration, segmentCount } from './flypath.svelte';
	import { extensionScope, type FlyPathEasing, type FlyPathOrientationMode } from './types';

	interface Props {
		children?: Snippet;
	}
	let { children }: Props = $props();

	const { createExtension } = useStudio();
	createExtension({ scope: extensionScope, state: () => ({}), actions: {} });

	const orientationOptions = [
		{ value: 'waypoint', text: 'Snapshotted look' },
		{ value: 'lookAt', text: 'Look at target' }
	];

	const easingOptions = [
		{ value: 'easeInOut', text: 'Ease In / Out' },
		{ value: 'easeIn', text: 'Ease In' },
		{ value: 'easeOut', text: 'Ease Out' },
		{ value: 'linear', text: 'Linear' }
	];

	const runnable = $derived(segmentCount(flyPathState) > 0);
	/**
	 * The previous take's file is still being written — arming another would resize the
	 * shared recording canvas out from under it.
	 */
	const finalizing = $derived(captureState.isFinalizing);
	const duration = $derived(totalDuration(flyPathState));

	// svelte-tweakpane-ui fires `change` for PROGRAMMATIC value writes too, tagged
	// `origin: 'external'`. The driver writes flyPathState.progress every frame while
	// playing, so an unguarded handler would call scrub() back — and scrub() pauses
	// playback. Only act on 'internal', i.e. an actual drag.
	const onScrub = (e: CustomEvent<{ value: number; origin: 'external' | 'internal' }>) => {
		if (e.detail.origin === 'external') return;
		flyPathActions.scrub(e.detail.value);
	};
</script>

<ToolbarItem position="center">
	<DropDownPane icon="mdiVideo" title="Fly Path">
		<span
			style="display:block; font-size:11px; color:#9aa5b1; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.12); border-radius:4px; padding:6px 8px; margin-bottom:4px; line-height:1.6; white-space:normal;"
		>
			{flyPathState.status}
		</span>

		<Button title="➕ Add Waypoint Here" on:click={() => flyPathActions.addWaypoint()} />

		{#if flyPathState.waypoints.length > 0}
			<Folder title="Waypoints ({flyPathState.waypoints.length})" expanded={true}>
				<span
					style="display:block; font-size:11px; color:#9aa5b1; padding:2px 4px; line-height:1.5; white-space:normal;"
				>
					🟢 start · 🔴 end · larger = selected
				</span>
				{#each flyPathState.waypoints as waypoint, index (waypoint.id)}
					<Folder
						title="{index + 1}. {waypoint.name}"
						expanded={flyPathState.selectedId === waypoint.id}
					>
						<Button
							title={flyPathState.selectedId === waypoint.id ? '✓ Selected' : '→ Select'}
							on:click={() => flyPathActions.selectWaypoint(waypoint.id)}
						/>
						<Button
							title="🎯 Re-snapshot From Camera"
							on:click={() => flyPathActions.updateWaypoint(waypoint.id)}
						/>
						<Slider
							label="Hold → next (s)"
							value={waypoint.duration}
							min={0.2}
							max={20}
							step={0.1}
							on:change={(e) => flyPathActions.setWaypointDuration(waypoint.id, e.detail.value)}
						/>
						<Slider
							label="FOV"
							value={waypoint.fov}
							min={15}
							max={110}
							step={1}
							on:change={(e) => flyPathActions.setWaypointFov(waypoint.id, e.detail.value)}
						/>
						<Button
							title="▲ Move Earlier"
							on:click={() => flyPathActions.moveWaypoint(waypoint.id, -1)}
						/>
						<Button
							title="▼ Move Later"
							on:click={() => flyPathActions.moveWaypoint(waypoint.id, 1)}
						/>
						<Button title="🗑 Remove" on:click={() => flyPathActions.removeWaypoint(waypoint.id)} />
					</Folder>
				{/each}
				<Separator />
				<Button title="🗑 Clear All" on:click={() => flyPathActions.clear()} />
			</Folder>
		{/if}

		<Separator />

		<Folder title="Path" expanded={true}>
			<List
				label="Aim"
				value={flyPathState.orientationMode}
				options={orientationOptions}
				on:change={(e) =>
					flyPathActions.setOrientationMode(e.detail.value as FlyPathOrientationMode)}
			/>
			{#if flyPathState.orientationMode === 'lookAt'}
				<Button
					title="🎯 Target = Camera Position"
					on:click={() => flyPathActions.setLookAtFromCamera()}
				/>
				<span
					style="display:block; font-size:11px; color:#9aa5b1; padding:2px 4px; line-height:1.5; white-space:normal;"
				>
					Target: {flyPathState.lookAtTarget.map((v) => v.toFixed(1)).join(', ')} — or drag the pink marker
					in the scene.
				</span>
			{/if}
			<List
				label="Easing"
				value={flyPathState.easing}
				options={easingOptions}
				on:change={(e) => flyPathActions.setEasing(e.detail.value as FlyPathEasing)}
			/>
			<Slider
				label="Speed ×"
				value={flyPathState.speed}
				min={0.1}
				max={4}
				step={0.05}
				on:change={(e) => flyPathActions.setSpeed(e.detail.value)}
			/>
			<Slider
				label="Smoothing"
				value={flyPathState.tension}
				min={0}
				max={1}
				step={0.01}
				on:change={(e) => flyPathActions.setTension(e.detail.value)}
			/>
			<Checkbox
				label="Loop"
				value={flyPathState.loop}
				on:change={() => flyPathActions.setLoop(!flyPathState.loop)}
			/>
			<Checkbox
				label="Show Path"
				value={flyPathState.showPath}
				on:change={() => flyPathActions.setShowPath(!flyPathState.showPath)}
			/>
		</Folder>

		<Separator />

		<Folder title="Playback ({duration.toFixed(1)}s)" expanded={true}>
			<Slider
				label="Scrub"
				value={flyPathState.progress}
				min={0}
				max={1}
				step={0.001}
				disabled={!runnable}
				on:change={onScrub}
			/>
			{#if flyPathState.isPlaying}
				<Button title="⏸ Pause" on:click={() => flyPathActions.pause()} />
			{:else}
				<Button title="▶ Play" on:click={() => flyPathActions.play()} />
			{/if}
			<Button title="⏹ Stop / Restore Camera" on:click={() => flyPathActions.stop()} />
			<Separator />
			<Button
				title={finalizing ? '⏳ Preparing video…' : '🎬 Record Flythrough'}
				disabled={!runnable || finalizing}
				on:click={() => flyPathActions.recordFlythrough()}
			/>
		</Folder>
	</DropDownPane>
</ToolbarItem>

{@render children?.()}
