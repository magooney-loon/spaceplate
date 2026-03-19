<script lang="ts">
	import { T } from '@threlte/core';
	import { Stars as StarsComponent, GLTF, useDraco } from '@threlte/extras';
	import * as THREE from 'three';
	import { settingsState } from '$core/settings.svelte.js';

	const dracoLoader = useDraco();

	// ─── Quality-based star counts ────────────────────────────────────────────
	const starCounts = $derived.by(() => {
		switch (settingsState.graphics.quality) {
			case 'low':
				return { stars1: 200, stars2: 180 };
			case 'high':
				return { stars1: 720, stars2: 540 };
			default:
				return { stars1: 720, stars2: 540 };
		}
	});

	// ─── Nebula material opacity ──────────────────────────────────────────────
	let nebulaMaterials: THREE.Material[] = [];

	const handleNebulaLoad = (event: {
		materials: Record<string, THREE.Material>;
		nodes: Record<string, THREE.Object3D>;
	}) => {
		nebulaMaterials = [];

		Object.values(event.materials).forEach((material) => {
			if (
				material instanceof THREE.MeshStandardMaterial ||
				material instanceof THREE.MeshBasicMaterial
			) {
				material.transparent = true;
				material.opacity = 0.25;
				material.blending = THREE.AdditiveBlending;
				material.depthWrite = false;
				material.depthTest = true;
				material.needsUpdate = true;
				nebulaMaterials.push(material);
			}
		});

		Object.values(event.nodes).forEach((node) => {
			if (node instanceof THREE.Mesh && node.material) {
				const material = node.material;
				material.transparent = true;
				if (
					material instanceof THREE.MeshStandardMaterial ||
					material instanceof THREE.MeshBasicMaterial
				) {
					material.opacity = 0.25;
					material.blending = THREE.AdditiveBlending;
					if (!nebulaMaterials.includes(material)) {
						nebulaMaterials.push(material);
					}
				}
				material.depthWrite = false;
				material.depthTest = true;
				material.needsUpdate = true;
			}
		});
	};
</script>

<!-- Background stars — Layer 1 (inner, faster) -->
<T.Group userData={{ hideInTree: true, selectable: false }}>
	<StarsComponent
		count={starCounts.stars1}
		radius={10}
		depth={30}
		factor={1.45}
		fade={true}
		lightness={0.4}
		opacity={1}
		saturation={0.45}
		speed={0.72}
		userData={{ hideInTree: true, selectable: false }}
	/>
</T.Group>

<!-- Background stars — Layer 2 (outer, slower for depth parallax) -->
<T.Group userData={{ hideInTree: true, selectable: false }}>
	<StarsComponent
		count={starCounts.stars2}
		radius={10}
		depth={30}
		factor={1.9}
		fade={true}
		lightness={0.4}
		opacity={1}
		saturation={0.45}
		speed={0.2}
		userData={{ hideInTree: true, selectable: false }}
	/>
</T.Group>

<!-- Nebula model — place at /public/models/skybox/skybox_nebula-transformed.glb -->
<T.Group position={[0, 20, -27]} scale={0.2} userData={{ hideInTree: true, selectable: false }}>
	<GLTF
		{dracoLoader}
		scale={0.5}
		url="{import.meta.env.BASE_URL}models/skybox/skybox_nebula-transformed.glb"
		onload={handleNebulaLoad}
	/>
</T.Group>
