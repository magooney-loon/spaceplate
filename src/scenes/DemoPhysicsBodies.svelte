<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { T } from '@threlte/core';
	import { HTML, PositionalAudio } from '@threlte/extras';
	import { RigidBody, Collider, usePhysicsTask, useRapier } from '@threlte/rapier';
	import type { RigidBody as RapierRigidBody } from '@dimforge/rapier3d-compat';
	import * as THREE from 'three';
	import { Spring } from 'svelte/motion';
	import { soundActions } from '$core/GlobalAudio.svelte';
	import { logPhysics } from '$extensions/logger/logger.svelte';
	import { useSound } from '$extensions/sound/useSound';
	import { settingsState, BASE_URL } from '$extensions/settings/settings.svelte';

	const { state: soundState } = useSound();
	const { world } = useRapier();
	const POS_URL = `${BASE_URL}sounds/positional.mp3`;
	const mountId = crypto.randomUUID().slice(0, 8);

	// Icosahedron
	const colors = ['#4488ff', '#ff4466', '#44ff88', '#ff8844', '#aa44ff', '#ffdd44'];
	let colorIndex = $state(0);
	const scale = new Spring(1);
	let icoRb = $state.raw<RapierRigidBody>();
	let icoAngle = 0;

	// Bouncing sphere
	let sphereRb = $state.raw<RapierRigidBody>();
	let time = 0;
	let heartbeat = 0;

	const snapshotWorld = () => {
		let rigidBodies = 0;
		let colliders = 0;

		world.forEachRigidBody(() => {
			rigidBodies += 1;
		});

		world.forEachCollider(() => {
			colliders += 1;
		});

		return { rigidBodies, colliders };
	};

	const readTranslation = (body?: RapierRigidBody) => {
		if (!body) return null;
		try {
			if (!body.isValid()) return null;
			const t = body.translation();
			return { x: t.x, y: t.y, z: t.z };
		} catch {
			return null;
		}
	};

	onMount(() => {
		logPhysics.info(`DemoPhysicsBodies mount [${mountId}]`, snapshotWorld());
	});

	onDestroy(() => {
		logPhysics.info(`DemoPhysicsBodies destroy [${mountId}]`, {
			...snapshotWorld(),
			ico: readTranslation(icoRb),
			sphere: readTranslation(sphereRb)
		});
	});

	usePhysicsTask((delta) => {
		// Icosahedron spin
		if (icoRb) {
			icoAngle += delta * 0.5;
			const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, icoAngle, 0));
			icoRb.setNextKinematicTranslation({ x: 0, y: 2.5, z: 0 });
			icoRb.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
		}

		// Bouncing sphere orbit
		if (sphereRb) {
			time += delta;
			const x = Math.sin(time * 0.5) * 15;
			const z = Math.cos(time * 0.5) * 9;
			const y = Math.sin(time) * 1.5 + 2;
			const rotQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(time, 0, 0));
			sphereRb.setNextKinematicTranslation({ x, y, z });
			sphereRb.setNextKinematicRotation({ x: rotQ.x, y: rotQ.y, z: rotQ.z, w: rotQ.w });
		}

		heartbeat += delta;
		if (heartbeat >= 1) {
			heartbeat = 0;
			logPhysics.info(`DemoPhysicsBodies heartbeat [${mountId}]`, {
				icoAngle: Number(icoAngle.toFixed(3)),
				time: Number(time.toFixed(3)),
				ico: readTranslation(icoRb),
				sphere: readTranslation(sphereRb)
			});
		}
	});
</script>

<!-- Rotating icosahedron — kinematic, spins in place, spawned bodies bounce off it -->
<T.Group userData={{ selectable: false, hideInTree: true }}>
	<RigidBody
		type="kinematicPosition"
		bind:rigidBody={icoRb}
		oncreate={(rigidBody) => {
			logPhysics.info(`Icosahedron create [${mountId}]`, {
				handle: rigidBody.handle,
				translation: readTranslation(rigidBody)
			});
		}}
		onsleep={() => {
			logPhysics.info(`Icosahedron sleep [${mountId}]`);
		}}
		onwake={() => {
			logPhysics.info(`Icosahedron wake [${mountId}]`);
		}}
	>
		<Collider shape="ball" args={[1]} />
		<T.Mesh
			scale={scale.current}
			onpointerenter={() => (scale.target = 1.5)}
			onpointerleave={() => (scale.target = 1)}
			onclick={() => {
				colorIndex = (colorIndex + 1) % colors.length;
				soundActions.playClick();
			}}
			castShadow
		>
			<T.IcosahedronGeometry args={[1, 1]} />
			<T.MeshStandardMaterial color={colors[colorIndex]} flatShading />
		</T.Mesh>

		<HTML position.y={2} center transform zIndexRange={[0, 0]}>
			<div
				class="text-[18px] font-bold"
				style="color: {colors[colorIndex]}; text-shadow: 0 0 6px {colors[
					colorIndex
				]}, 0 1px 3px rgba(0,0,0,0.8);"
			>
				{colors[colorIndex]}
			</div>
		</HTML>
	</RigidBody>
</T.Group>

<!-- Orbiting bouncing sphere — kinematic, collides with dynamic bodies -->
<T.Group userData={{ selectable: false, hideInTree: true }}>
	<RigidBody
		type="kinematicPosition"
		bind:rigidBody={sphereRb}
		oncreate={(rigidBody) => {
			logPhysics.info(`Orbit sphere create [${mountId}]`, {
				handle: rigidBody.handle,
				translation: readTranslation(rigidBody)
			});
		}}
		onsleep={() => {
			logPhysics.info(`Orbit sphere sleep [${mountId}]`);
		}}
		onwake={() => {
			logPhysics.info(`Orbit sphere wake [${mountId}]`);
		}}
	>
		<Collider shape="ball" args={[0.5]} />
		<T.Mesh castShadow>
			<T.SphereGeometry args={[0.5, 32, 32]} />
			<T.MeshStandardMaterial color="#d94a4a" flatShading />

			<PositionalAudio
				src={POS_URL}
				volume={settingsState.audio.sfxEnabled ? settingsState.audio.sfxVolume : 0}
				refDistance={soundState.refDistance}
				maxDistance={soundState.maxDistance}
				rolloffFactor={soundState.rolloffFactor}
				panningModel={soundState.panningModel}
				loop
				autoplay={settingsState.audio.sfxEnabled}
			/>
		</T.Mesh>
	</RigidBody>
</T.Group>
