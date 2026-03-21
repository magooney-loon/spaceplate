<script lang="ts">
	import { useStudio, ToolbarItem, DropDownPane } from '@threlte/studio/extend';
	import { Folder, Slider, Checkbox, Button, Separator, List } from 'svelte-tweakpane-ui';
	import { extensionScope, type GravityType, type PhysicsFramerate } from './types';
	import { physicsState, physicsActions } from './physics.svelte';
	import { sceneState } from '$extensions/scene/scene.svelte';
	import type { Snippet } from 'svelte';

	interface Props {
		children?: Snippet;
	}
	let { children }: Props = $props();

	const { createExtension } = useStudio();
	createExtension({ scope: extensionScope, state: () => ({}), actions: {} });

	const isInDemoScene = $derived(sceneState.currentScene === 'demoScene');
</script>

<ToolbarItem position="left">
	<DropDownPane icon="mdiAtom" title="Physics">
		{#if !isInDemoScene}
			<span
				style="display:block; font-size:11px; color:#ffcc44; background:rgba(255,200,0,0.08); border:1px solid rgba(255,200,0,0.25); border-radius:4px; padding:6px 8px; margin-bottom:4px; line-height:1.6; white-space:normal;"
			>
				⚠️ Physics runs in <strong>Demo Scene</strong>.<br />Spawning will switch automatically.
			</span>
		{/if}

		<Folder title="World" expanded={true}>
			<Slider
				label="Gravity Y"
				value={physicsState.gravityY}
				min={-30}
				max={30}
				step={0.1}
				on:change={(e) => physicsActions.setGravityY(e.detail.value)}
			/>
			<Slider
				label="Gravity X"
				value={physicsState.gravityX}
				min={-30}
				max={30}
				step={0.1}
				on:change={(e) => physicsActions.setGravityX(e.detail.value)}
			/>
			<Slider
				label="Gravity Z"
				value={physicsState.gravityZ}
				min={-30}
				max={30}
				step={0.1}
				on:change={(e) => physicsActions.setGravityZ(e.detail.value)}
			/>
			<List
				label="Framerate"
				value={physicsState.framerate}
				options={[
					{ value: 'varying', text: 'Varying (default)' },
					{ value: 60, text: '60 Hz' },
					{ value: 120, text: '120 Hz' },
					{ value: 200, text: '200 Hz (deterministic)' }
				]}
				on:change={(e) => physicsActions.setFramerate(e.detail.value as PhysicsFramerate)}
			/>
			<Checkbox
				label="Debug Colliders"
				value={physicsState.debug}
				on:change={() => physicsActions.toggleDebug()}
			/>
			<Button title="Reset World" on:click={() => physicsActions.resetWorld()} />
		</Folder>

		<Separator />

		<Folder title="Spawn Defaults" expanded={false}>
			<Slider
				label="Restitution"
				value={physicsState.spawnRestitution}
				min={0}
				max={1}
				step={0.01}
				on:change={(e) => physicsActions.setSpawnRestitution(e.detail.value)}
			/>
			<Slider
				label="Friction"
				value={physicsState.spawnFriction}
				min={0}
				max={2}
				step={0.01}
				on:change={(e) => physicsActions.setSpawnFriction(e.detail.value)}
			/>
			<Slider
				label="Linear Damping"
				value={physicsState.spawnLinearDamping}
				min={0}
				max={10}
				step={0.1}
				on:change={(e) => physicsActions.setSpawnLinearDamping(e.detail.value)}
			/>
			<Slider
				label="Angular Damping"
				value={physicsState.spawnAngularDamping}
				min={0}
				max={10}
				step={0.1}
				on:change={(e) => physicsActions.setSpawnAngularDamping(e.detail.value)}
			/>
			<Slider
				label="Gravity Scale"
				value={physicsState.spawnGravityScale}
				min={-2}
				max={3}
				step={0.1}
				on:change={(e) => physicsActions.setSpawnGravityScale(e.detail.value)}
			/>
			<Checkbox
				label="CCD"
				value={physicsState.spawnCcd}
				on:change={() => physicsActions.setSpawnCcd(!physicsState.spawnCcd)}
			/>
			<Checkbox
				label="Can Sleep"
				value={physicsState.spawnCanSleep}
				on:change={() => physicsActions.setSpawnCanSleep(!physicsState.spawnCanSleep)}
			/>
			<Checkbox
				label="Spawn Random"
				value={physicsState.spawnRandom}
				on:change={() => physicsActions.setSpawnRandom(!physicsState.spawnRandom)}
			/>
			<Button title="Reset Spawn Defaults" on:click={() => physicsActions.resetSpawnDefaults()} />
		</Folder>

		<Separator />

		<Folder title="Attractor" expanded={physicsState.attractorEnabled}>
			<Checkbox
				label="Enabled"
				value={physicsState.attractorEnabled}
				on:change={() => physicsActions.toggleAttractor()}
			/>
			{#if physicsState.attractorEnabled}
				<Slider
					label="Strength"
					value={physicsState.attractorStrength}
					min={-50}
					max={50}
					step={0.5}
					on:change={(e) => physicsActions.setAttractorStrength(e.detail.value)}
				/>
				<Slider
					label="Range"
					value={physicsState.attractorRange}
					min={1}
					max={50}
					step={0.5}
					on:change={(e) => physicsActions.setAttractorRange(e.detail.value)}
				/>
				<List
					label="Gravity Type"
					value={physicsState.attractorGravityType}
					options={[
						{ value: 'static', text: 'Static (constant force)' },
						{ value: 'linear', text: 'Linear (distance-based)' },
						{ value: 'newtonian', text: 'Newtonian (F=GMm/r²)' }
					]}
					on:change={(e) => physicsActions.setAttractorGravityType(e.detail.value as GravityType)}
				/>
				<Slider
					label="Pos X"
					value={physicsState.attractorX}
					min={-20}
					max={20}
					step={0.1}
					on:change={(e) => physicsActions.setAttractorPosition(e.detail.value, physicsState.attractorY, physicsState.attractorZ)}
				/>
				<Slider
					label="Pos Y"
					value={physicsState.attractorY}
					min={-10}
					max={20}
					step={0.1}
					on:change={(e) => physicsActions.setAttractorPosition(physicsState.attractorX, e.detail.value, physicsState.attractorZ)}
				/>
				<Slider
					label="Pos Z"
					value={physicsState.attractorZ}
					min={-20}
					max={20}
					step={0.1}
					on:change={(e) => physicsActions.setAttractorPosition(physicsState.attractorX, physicsState.attractorY, e.detail.value)}
				/>
			{/if}
			<Button title="Reset Attractor" on:click={() => physicsActions.resetAttractor()} />
		</Folder>

		<Separator />

		<Folder title="Bodies ({physicsState.bodies.length})" expanded={true}>
			<Button title="Spawn Ball" on:click={() => physicsActions.spawnBall()} />
			<Button title="Spawn Box" on:click={() => physicsActions.spawnBox()} />
			<Button title="Clear All" on:click={() => physicsActions.clearBodies()} />
		</Folder>
	</DropDownPane>
</ToolbarItem>

{@render children?.()}
