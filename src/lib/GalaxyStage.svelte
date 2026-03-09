<script module lang="ts">
	export type CharacterAction = 'idle' | 'walk' | 'run' | 'agree' | 'headShake';

	export const galaxyState = $state({ action: 'idle' as CharacterAction });
</script>

<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import { GLTF, useGltfAnimations } from '@threlte/extras';
	import { cubicOut } from 'svelte/easing';
	import { soundActions } from '../Sound.svelte';
	import * as THREE from 'three';

	const { gltf, actions } = useGltfAnimations<CharacterAction>();

	let currentAction: CharacterAction = 'idle';
	let introT = $state(0);
	useTask((delta) => {
		if (introT < 1) introT = Math.min(1, introT + delta * 2.5);
	});

	// Stop all anim sounds when leaving this stage
	$effect(() => () => soundActions.stopAnimSounds());

	// Configure one-shot animations to play once and hold last frame
	$effect(() => {
		for (const key of ['agree', 'headShake'] as CharacterAction[]) {
			const action = $actions[key];
			if (!action) continue;
			action.setLoop(THREE.LoopOnce, 1);
			action.clampWhenFinished = true;
		}
	});

	// Return to idle when a one-shot animation finishes
	$effect(() => {
		const agreeAction = $actions['agree'];
		if (!agreeAction) return;
		const mixer = agreeAction.getMixer();
		const onFinished = (e: THREE.Event & { action: THREE.AnimationAction }) => {
			const name = e.action.getClip().name as CharacterAction;
			if (name === 'agree' || name === 'headShake') galaxyState.action = 'idle';
		};
		mixer.addEventListener('finished', onFinished as (e: THREE.Event) => void);
		return () => mixer.removeEventListener('finished', onFinished as (e: THREE.Event) => void);
	});

	$effect(() => {
		if (!$actions?.['idle']) return;
		$actions['idle'].play();
		soundActions.playAnimSound('idle');
	});

	$effect(() => {
		const next = galaxyState.action;
		const current = $actions[currentAction];
		const nextAction = $actions[next];
		if (!nextAction || current === nextAction) return;
		nextAction.enabled = true;
		if (next === 'agree' || next === 'headShake') nextAction.reset();
		if (current) current.crossFadeTo(nextAction, 0.3, true);
		nextAction.play();
		currentAction = next;
		soundActions.playAnimSound(next);
	});
</script>

<!-- Example: Galaxy Stage — animated GLTF character -->
<T.Group scale={cubicOut(introT)}>
	<T.DirectionalLight position={[0, 10, -20]} castShadow />

	<GLTF
		bind:gltf={$gltf}
		url="{import.meta.env.BASE_URL}models/stages/galaxy/xbot.glb"
		oncreate={(scene) => {
			scene.traverse((child) => {
				child.castShadow = true;
			});
		}}
		scale={10}
	/>

	<T.Mesh position.y={0} position.z={-3.6} rotation.x={-Math.PI / 2} receiveShadow>
		<T.CircleGeometry args={[9, 72]} />
		<T.MeshStandardMaterial color="white" />
	</T.Mesh>
</T.Group>
