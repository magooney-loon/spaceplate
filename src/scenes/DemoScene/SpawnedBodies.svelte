<script lang="ts">
	// The spawned physics bodies: N Rapier bodies, TWO draw calls.
	//
	// WHY THIS IS ITS OWN COMPONENT. Every body used to be its own `<T.Mesh>` with its
	// own `MeshStandardMaterial` (the colour is random per spawn). That is one draw call
	// per body -- and this scene renders the whole scene many times per frame, so the
	// real multiplier is much worse than it looks:
	//
	//   main pass                                    1
	//   shadow pass (quality.spawnShadows)           1
	//   mirror-floor reflector, every frame          1
	//   mirror sphere cube capture, 6 faces @ 30 Hz  3   (per 60 fps frame, averaged)
	//   corner-ball cube capture, 6 faces @ 15 Hz    1.5
	//                                              ----
	//                                              ~7.5 draw calls per frame PER BODY
	//
	// i.e. the whole "under 100 draw calls" budget was gone at about fourteen balls.
	// Now: one `InstancedMesh` per shape, one shared material, colour per instance.
	// Two shapes = two draw calls, whatever the body count.
	//
	// Rapier is unchanged -- every body still needs its own `<RigidBody>` and collider.
	// Only the rendering collapses. `MAX_BODIES` caps the simulation side.
	//
	// NOT USED: `<InstancedMesh>` from @threlte/extras. Its Api task calls `invalidate()`
	// unconditionally whenever it syncs instances (`update` defaults to true), and scenes
	// here are keep-alive -- so mounting one would pin the render loop at full rate
	// forever, in every scene, killing on-demand rendering (see src/CLAUDE.md, "Frame
	// tasks"). The sync below invalidates only when a matrix actually changed.

	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import { RigidBody, Collider } from '@threlte/rapier';
	import { untrack } from 'svelte';
	import * as THREE from 'three/webgpu';
	import { physicsState, MAX_BODIES } from '$extensions/physics';
	import { sceneState } from '$extensions/scene';
	import { settingsState } from '$extensions/settings';
	import { logPhysics } from '$extensions/logger';
	import { DEMO_QUALITY } from './demoQuality';

	let { mountId }: { mountId: string } = $props();

	const { autoRenderTask, invalidate } = useThrelte();

	const quality = $derived(DEMO_QUALITY[settingsState.graphics.quality]);

	// One geometry per shape, not per body. The ball is rebuilt when the preset changes;
	// the box has no segment count worth scaling (12 triangles either way).
	const ballGeometry = $derived(
		new THREE.SphereGeometry(0.4, quality.spawnBallSegments, quality.spawnBallSegments)
	);
	const boxGeometry = new THREE.BoxGeometry(0.8, 0.8, 0.8);

	// ONE material for both meshes and every body. Per-body colour rides `instanceColor`,
	// which `NodeMaterial.setupDiffuseColor` multiplies into the material colour -- so the
	// base MUST stay white or every instance would be tinted by it.
	const material = new THREE.MeshStandardNodeMaterial();
	material.color.set('white');
	material.flatShading = true;

	const makeMesh = (geometry: THREE.BufferGeometry) => {
		const mesh = new THREE.InstancedMesh(geometry, material, MAX_BODIES);
		// Constructed with a real geometry on purpose -- an InstancedMesh submitted with
		// the default empty BufferGeometry throws `Vertex attribute "position" not found`
		// (webgpu-notes.md §8).
		mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BODIES * 3), 3);
		mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
		mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
		mesh.count = 0;
		mesh.visible = false;
		// The instances move every frame over a 20x20 floor that is essentially always on
		// screen, so a bounding sphere would have to be recomputed per frame to be correct.
		// Culling one always-visible draw call is not worth that.
		mesh.frustumCulled = false;
		mesh.userData = { selectable: false, hideInTree: true };
		return mesh;
	};

	// untrack: only the INITIAL geometry — the effect below re-assigns it on a preset
	// change (and constructing with a real geometry is what avoids the empty-geometry
	// first frame).
	const ballMesh = makeMesh(untrack(() => ballGeometry));
	const boxMesh = makeMesh(boxGeometry);

	$effect(() => {
		const geometry = ballGeometry;
		ballMesh.geometry = geometry;
		invalidate();
		// Disposes the PREVIOUS geometry when the preset changes, the last one on unmount.
		return () => geometry.dispose();
	});

	$effect(() => {
		const cast = quality.spawnShadows;
		ballMesh.castShadow = cast;
		boxMesh.castShadow = cast;
		invalidate();
	});

	// --- instance sync ---------------------------------------------------------------

	/**
	 * One entry per live body, in spawn order. A PLAIN Map on purpose: the sync task runs
	 * every frame and iterating `physicsState.bodies` would pay Svelte's proxy cost on
	 * every field of every body, 60x a second. Same rule as the sky descriptor
	 * (`core/skybox/CLAUDE.md`) -- per-frame data is never reactive.
	 */
	type Anchor = { object: THREE.Object3D; ball: boolean; color: THREE.Color };
	const anchors = new Map<string, Anchor>();

	/** Set when a body is added or removed: slots shift, so the next sync must publish. */
	let anchorsDirty = true;

	useTask(
		() => {
			// Keep-alive: this component stays mounted while other scenes are current.
			// Physics is paused then (Scene.svelte), so there is nothing to sync.
			if (sceneState.currentScene !== 'demoScene') return;

			let ballCount = 0;
			let boxCount = 0;
			let moved = anchorsDirty;
			anchorsDirty = false;

			for (const anchor of anchors.values()) {
				const mesh = anchor.ball ? ballMesh : boxMesh;
				const slot = anchor.ball ? ballCount++ : boxCount++;

				// Rapier's synchronization stage has already written this frame's
				// interpolated position/quaternion (its stage is `before: renderStage`,
				// and this task lives inside that stage) -- but `matrixWorld` is only
				// recomposed during the render itself, so compose it here.
				anchor.object.updateWorldMatrix(true, false);

				const elements = anchor.object.matrixWorld.elements;
				const matrices = mesh.instanceMatrix.array as Float32Array;
				const m = slot * 16;
				for (let k = 0; k < 16; k++) {
					if (matrices[m + k] !== elements[k]) {
						matrices[m + k] = elements[k];
						moved = true;
					}
				}

				// Colour only changes when a slot is reassigned, but comparing is cheaper
				// than tracking it separately.
				const colors = mesh.instanceColor!.array as Float32Array;
				const c = slot * 3;
				const { r, g, b } = anchor.color;
				if (colors[c] !== r || colors[c + 1] !== g || colors[c + 2] !== b) {
					colors[c] = r;
					colors[c + 1] = g;
					colors[c + 2] = b;
					moved = true;
				}
			}

			ballMesh.count = ballCount;
			boxMesh.count = boxCount;
			// An empty shape costs no draw call at all, same as the sky layers.
			ballMesh.visible = ballCount > 0;
			boxMesh.visible = boxCount > 0;

			// Nothing moved means every body is asleep (or there are none): no upload, and
			// no invalidate -- renderMode is on-demand and this task must not pin it.
			if (!moved) return;

			ballMesh.instanceMatrix.needsUpdate = true;
			boxMesh.instanceMatrix.needsUpdate = true;
			ballMesh.instanceColor!.needsUpdate = true;
			boxMesh.instanceColor!.needsUpdate = true;
			invalidate();
		},
		{ before: autoRenderTask, autoInvalidate: false }
	);

	$effect(() => {
		return () => {
			// Script-owned, and mounted with `dispose={false}` below, so this is the only
			// owner. `ballGeometry` disposes in its own effect above.
			ballMesh.dispose();
			boxMesh.dispose();
			boxGeometry.dispose();
			material.dispose();
		};
	});
</script>

<!-- Two draw calls for every spawned body. `dispose={false}`: these are script-owned
     (see the cleanup above), and the material is shared between them. -->
<T is={ballMesh} dispose={false} />
<T is={boxMesh} dispose={false} />

{#each physicsState.bodies as body (body.id)}
	<T.Group position={body.position} userData={{ selectable: false, hideInTree: true }}>
		<RigidBody
			type="dynamic"
			ccd={body.ccd}
			canSleep={body.canSleep}
			linearDamping={body.linearDamping}
			angularDamping={body.angularDamping}
			gravityScale={body.gravityScale}
			userData={{ selectable: false, hideInTree: true }}
			oncreate={(rigidBody) => {
				logPhysics.info(`Spawned body create [${mountId}]`, {
					id: body.id,
					type: body.type,
					initialPosition: body.position,
					handle: rigidBody.handle,
					count: `${physicsState.bodies.length}/${MAX_BODIES}`
				});
			}}
			onsleep={() => {
				logPhysics.info(`Spawned body sleep [${mountId}]`, { id: body.id });
			}}
			onwake={() => {
				logPhysics.info(`Spawned body wake [${mountId}]`, { id: body.id });
			}}
		>
			{#if body.type === 'ball'}
				<Collider
					shape="ball"
					args={[0.4]}
					restitution={body.restitution}
					friction={body.friction}
				/>
			{:else}
				<Collider
					shape="cuboid"
					args={[0.4, 0.4, 0.4]}
					restitution={body.restitution}
					friction={body.friction}
				/>
			{/if}

			<!-- The body's pose carrier. Rapier writes the transform onto the Object3D that
			     `<RigidBody>` owns, and this sits at local identity under it, so its world
			     matrix IS the body's -- which the sync task copies into an instance slot.
			     Draws nothing; it replaces the per-body mesh. -->
			<T.Object3D
				oncreate={(ref) => {
					anchors.set(body.id, {
						object: ref,
						ball: body.type === 'ball',
						color: new THREE.Color(body.color)
					});
					anchorsDirty = true;
					return () => {
						anchors.delete(body.id);
						anchorsDirty = true;
					};
				}}
			/>
		</RigidBody>
	</T.Group>
{/each}
