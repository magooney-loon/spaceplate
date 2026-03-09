<script lang="ts">
	import { T } from '@threlte/core';
	import { Stars as StarsComponent, FakeGlowMaterial, GLTF, useDraco } from '@threlte/extras';
	import * as THREE from 'three';
	import { settingsState } from './settings.svelte.js';
	import { Tween } from 'svelte/motion';
	import { cubicInOut } from 'svelte/easing';

	const dracoLoader = useDraco();

	// ─── Quality-based star counts ────────────────────────────────────────────
	const starCounts = $derived.by(() => {
		switch (settingsState.graphics.quality) {
			case 'low':
				return { stars1: 200, stars2: 180 };
			case 'mid':
				return { stars1: 450, stars2: 350 };
			case 'high':
				return { stars1: 720, stars2: 540 };
			default:
				return { stars1: 450, stars2: 350 };
		}
	});

	// ─── Quality-based sun settings ───────────────────────────────────────────
	const sunSettings = $derived.by(() => {
		const q = settingsState.graphics.quality;
		return {
			glowColor: q === 'high' ? '#FF9500' : '#FFCC00',
			coreColor: q === 'high' ? '#FFE4B3' : '#FFFFFF',
			scale: 0.33,
			opacity: 0.38,
			falloff: q === 'low' ? 1.5 : q === 'mid' ? 2.2 : 3.0,
			glowInternalRadius: q === 'low' ? 9 : q === 'mid' ? 5 : 7,
			glowSharpness: q === 'low' ? 0.4 : q === 'mid' ? 0.6 : 0.8
		};
	});

	// Tween sun properties for smooth quality-change transitions
	let sunScale = new Tween(0.33, { duration: 1000, easing: cubicInOut });
	let sunOpacity = new Tween(0.38, { duration: 1000, easing: cubicInOut });
	let sunFalloff = new Tween(2.2, { duration: 1000, easing: cubicInOut });
	let sunGlowInternalRadius = new Tween(5, { duration: 1000, easing: cubicInOut });
	let sunGlowSharpness = new Tween(0.6, { duration: 1000, easing: cubicInOut });

	$effect(() => {
		sunScale.target = sunSettings.scale;
		sunOpacity.target = sunSettings.opacity;
		sunFalloff.target = sunSettings.falloff;
		sunGlowInternalRadius.target = sunSettings.glowInternalRadius;
		sunGlowSharpness.target = sunSettings.glowSharpness;
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

<!-- Central Sun/Star -->
<T.Group
	position={[0, 20, -27]}
	scale={sunScale.current}
	userData={{ hideInTree: true, selectable: false }}
>
	<!-- Inner glow -->
	<T.Mesh position={[0, 0, 0]} scale={[6, 6, 6]} opacity={sunOpacity.current}>
		<FakeGlowMaterial
			glowColor={sunSettings.glowColor}
			falloff={sunFalloff.current}
			glowInternalRadius={sunGlowInternalRadius.current}
			glowSharpness={sunGlowSharpness.current}
			depthTest={true}
		/>
		<T.IcosahedronGeometry args={[3, 3]} />
	</T.Mesh>

	<!-- Outer glow (high quality only) -->
	{#if settingsState.graphics.quality === 'high'}
		<T.Mesh position={[0, 0, 0]} scale={[10, 10, 10]} opacity={sunOpacity.current * 0.5}>
			<FakeGlowMaterial
				glowColor="#FF6B35"
				falloff={1.8}
				glowInternalRadius={8}
				glowSharpness={0.3}
				depthTest={true}
			/>
			<T.IcosahedronGeometry args={[4, 2]} />
		</T.Mesh>
	{/if}

	<!-- Core -->
	<T.Mesh position={[0, 0, 0]} scale={[3, 3, 3]} opacity={0.6}>
		<T.MeshBasicMaterial color={sunSettings.coreColor} />
		<T.IcosahedronGeometry args={[2, 4]} />
	</T.Mesh>
</T.Group>
