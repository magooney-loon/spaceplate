<script lang="ts">
	import { T } from '@threlte/core';
	import { Stars as StarsComponent, FakeGlowMaterial, GLTF, useDraco } from '@threlte/extras';
	import * as THREE from 'three';
	import { settingsState } from './settings.svelte.js';
	import { profileGetters } from '$lib/game/profile.svelte.js';
	import { Tween } from 'svelte/motion';
	import { cubicInOut } from 'svelte/easing';
	const dracoLoader = useDraco();

	let nebulaOpacity = new Tween(1, {
		duration: 1000,
		easing: cubicInOut
	});

	let stars1Opacity = new Tween(1, {
		duration: 1000,
		easing: cubicInOut
	});

	let stars2Opacity = new Tween(1, {
		duration: 1000,
		easing: cubicInOut
	});

	const initialPlanetData = profileGetters.selectedPlanetFullData;
	let activePlanetData = $state(initialPlanetData);
	let pendingPlanetData = $state<typeof activePlanetData | null>(null);

	// Planet-based environment calculations - derived without state mutation
	const planetEnvironment = $derived.by(() => {
		const planetData = activePlanetData;

		if (!planetData) {
			return {
				position: 8, // Default middle position
				temperature: 0, // Default temperature
				heatFactor: 0.5, // 0 = coldest, 1 = hottest
				distanceFactor: 0.5 // 0 = closest to sun, 1 = farthest
			};
		}

		const position = planetData.data.slotNumber; // 1-15
		const avgTemp = (planetData.data.temperatureMin + planetData.data.temperatureMax) / 2;

		// Calculate factors (position 1 = hottest/closest, position 15 = coldest/farthest)
		const heatFactor = 1 - (position - 1) / 14; // 1 at position 1, 0 at position 15
		const distanceFactor = (position - 1) / 14; // 0 at position 1, 1 at position 15

		return {
			position,
			temperature: avgTemp,
			heatFactor,
			distanceFactor
		};
	});

	const derivedState = $derived.by(() => {
		const env = planetEnvironment;
		const quality = settingsState.graphics.quality;

		// Nebula
		const nebulaIntensity =
			env.heatFactor > 0.33 && env.heatFactor < 0.66
				? 0.36 // Default intensity for medium planets
				: 0.27; // Lower intensity for hot/cold extremes

		// Sun
		const sunGlowColor =
			env.heatFactor > 0.7
				? '#FF6B00' // Intense orange-red for hot planets
				: env.heatFactor < 0.3
					? '#FFDD88' // Cooler yellow for distant planets
					: quality === 'high'
						? '#FF9500'
						: '#FFCC00';

		const sunCoreColor =
			env.heatFactor > 0.7 && quality === 'high'
				? '#FFF8E7' // Brighter white-yellow for hot planets on high quality
				: quality === 'high'
					? '#FFE4B3'
					: '#FFFFFF';

		const sunScale = 0.27 + env.heatFactor * 0.13; // Scale from 0.4 (pos 1) to 0.18 (pos 15)
		const sunOpacity = 0.3 + env.distanceFactor * 0.15; // 0.45 (far) to 0.3 (close)

		let sunFalloff: number, sunGlowInternalRadius: number, sunGlowSharpness: number;
		switch (quality) {
			case 'low':
				sunFalloff = 1.5;
				sunGlowInternalRadius = 9;
				sunGlowSharpness = 0.4;
				break;
			case 'mid':
				sunFalloff = 2.2;
				sunGlowInternalRadius = 5;
				sunGlowSharpness = 0.6;
				break;
			case 'high':
				sunFalloff = 3.0;
				sunGlowInternalRadius = 7;
				sunGlowSharpness = 0.8;
				break;
			default:
				sunFalloff = 2.2;
				sunGlowInternalRadius = 5;
				sunGlowSharpness = 0.6;
		}
		sunFalloff += env.heatFactor * 0.5;
		sunGlowInternalRadius += env.heatFactor * 2;
		sunGlowSharpness += env.heatFactor * 0.2;

		// Counts
		let starCount1: number, starCount2: number;
		switch (quality) {
			case 'low':
				starCount1 = 200;
				starCount2 = 180;
				break;
			case 'mid':
				starCount1 = 450;
				starCount2 = 350;
				break;
			case 'high':
				starCount1 = 720;
				starCount2 = 540;
				break;
			default:
				starCount1 = 450;
				starCount2 = 350;
		}

		return {
			nebulaIntensity,
			sun: {
				glowColor: sunGlowColor,
				coreColor: sunCoreColor,
				scale: sunScale,
				opacity: sunOpacity,
				falloff: sunFalloff,
				glowInternalRadius: sunGlowInternalRadius,
				glowSharpness: sunGlowSharpness
			},
			counts: {
				stars1: starCount1,
				stars2: starCount2
			}
		};
	});

	// Sun property tweens for smooth transitions
	let sunScale = new Tween(0.27, { duration: 1000, easing: cubicInOut });
	let sunOpacity = new Tween(0.3, { duration: 1000, easing: cubicInOut });
	let sunFalloff = new Tween(2.2, { duration: 1000, easing: cubicInOut });
	let sunGlowInternalRadius = new Tween(5, { duration: 1000, easing: cubicInOut });
	let sunGlowSharpness = new Tween(0.6, { duration: 1000, easing: cubicInOut });

	$effect(() => {
		sunScale.target = derivedState.sun.scale;
		sunOpacity.target = derivedState.sun.opacity;
		sunFalloff.target = derivedState.sun.falloff;
		sunGlowInternalRadius.target = derivedState.sun.glowInternalRadius;
		sunGlowSharpness.target = derivedState.sun.glowSharpness;
	});

	// ONLY nebula rotation - smooth and simple
	let nebulaRotationY = new Tween(0, {
		duration: 1600,
		easing: cubicInOut
	});

	let nebulaRotationX = new Tween(0, {
		duration: 1600,
		easing: cubicInOut
	});

	let nebulaRotationZ = new Tween(0, {
		duration: 1600,
		easing: cubicInOut
	});

	// Animated cloud intensity for smooth transitions
	let cloudIntensity = new Tween(0.25, {
		duration: 1200,
		easing: cubicInOut
	});

	let cachedPlanetPosition = -1;
	$effect(() => {
		// Get immediate planet data for instant rotation changes
		const immediatePlanetData = profileGetters.selectedPlanetFullData;
		const immediatePosition = immediatePlanetData?.data.slotNumber ?? 8;

		// Skip if planet position hasn't changed
		if (immediatePosition === cachedPlanetPosition) return;

		const anglePerPosition = (Math.PI * 2) / 15;

		// --- Nebula Rotation (Immediate) ---
		const yRotation = (immediatePosition - 1) * anglePerPosition;
		const xRotation = Math.sin(immediatePosition * 0.5) * 0.3;
		const zRotation = Math.cos(immediatePosition * 0.7) * 0.2;

		// Update cached values AFTER computing direction
		cachedPlanetPosition = immediatePosition;

		nebulaRotationX.target = xRotation;
		nebulaRotationY.target = yRotation;
		nebulaRotationZ.target = zRotation;

		// --- Star Rotation (Immediate) ---
		const baseRotation = (immediatePosition - 1) * anglePerPosition * 0.2;
		const xTilt = Math.sin(immediatePosition * 0.5) * 0.15;
		const zTilt = Math.cos(immediatePosition * 0.7) * 0.1;

		// Layer 1
		stars1RotationX.target = xTilt;
		stars1RotationY.target = baseRotation;
		stars1RotationZ.target = zTilt;

		// Layer 2
		stars2RotationX.target = xTilt * 0.8;
		stars2RotationY.target = baseRotation * 1.1;
		stars2RotationZ.target = zTilt * 0.9;
	});

	// This remains tied to the visual state, so it transitions smoothly with the fade
	$effect(() => {
		cloudIntensity.target = derivedState.nebulaIntensity;
	});

	// Static nebula position - no movement, only rotation
	const nebulaPosition: [number, number, number] = [0, 0, 0];

	// Animated star field rotation - staggered layers for organic feel
	// Layer 1 (inner stars) - closer, moves faster, matches nebula speed
	let stars1RotationY = new Tween(0, {
		duration: 1800,
		easing: cubicInOut
	});

	let stars1RotationX = new Tween(0, {
		duration: 1800,
		easing: cubicInOut
	});

	let stars1RotationZ = new Tween(0, {
		duration: 1700,
		easing: cubicInOut
	});

	// Layer 2 (outer stars) - farther away, moves slower for depth parallax
	let stars2RotationY = new Tween(0, {
		duration: 1800,
		easing: cubicInOut
	});

	let stars2RotationX = new Tween(0, {
		duration: 1800,
		easing: cubicInOut
	});

	let stars2RotationZ = new Tween(0, {
		duration: 1700,
		easing: cubicInOut
	});

	// Store nebula materials for opacity animation
	let nebulaMaterials: THREE.Material[] = [];

	// Handle GLTF load to adjust materials for better blending
	const handleNebulaLoad = (event: {
		materials: Record<string, THREE.Material>;
		nodes: Record<string, THREE.Object3D>;
	}) => {
		nebulaMaterials = [];

		// Tone down materials to reduce brightness and improve blending
		Object.values(event.materials).forEach((material) => {
			if (
				material instanceof THREE.MeshStandardMaterial ||
				material instanceof THREE.MeshBasicMaterial
			) {
				material.transparent = true;
				material.opacity = 0.25 * nebulaOpacity.current; // Lower opacity for better blending with skybox
				material.blending = THREE.AdditiveBlending; // Use additive blending for ethereal glow effect
				material.depthWrite = false; // Disable depth write for better transparency
				material.depthTest = true; // Enable depth test so planet renders in front
				material.needsUpdate = true;
				nebulaMaterials.push(material);
			}
		});

		// Also traverse nodes to ensure all meshes are updated
		Object.values(event.nodes).forEach((node) => {
			if (node instanceof THREE.Mesh && node.material) {
				const material = node.material;
				material.transparent = true;
				if (
					material instanceof THREE.MeshStandardMaterial ||
					material instanceof THREE.MeshBasicMaterial
				) {
					material.opacity = 0.25 * nebulaOpacity.current;
					material.blending = THREE.AdditiveBlending;
					if (!nebulaMaterials.includes(material)) {
						nebulaMaterials.push(material);
					}
				}
				material.depthWrite = false;
				material.depthTest = true; // Enable depth test so planet renders in front
				material.needsUpdate = true;
			}
		});
	};

	$effect(() => {
		const opacity = nebulaOpacity.current;
		nebulaMaterials.forEach((material) => {
			if (
				material instanceof THREE.MeshStandardMaterial ||
				material instanceof THREE.MeshBasicMaterial
			) {
				material.opacity = 0.25 * opacity;
				material.needsUpdate = true;
			}
		});
	});

	// Track previous planet ID to detect planet switches
	let initialLoadHandled = $state(false);

	$effect(() => {
		const newPlanetData = profileGetters.selectedPlanetFullData;
		const isChange = newPlanetData?.data.planetId !== activePlanetData?.data.planetId;
		const isFirstLoad = !initialLoadHandled;

		if (isFirstLoad) {
			initialLoadHandled = true;
			activePlanetData = newPlanetData;
		} else if (isChange && !pendingPlanetData) {
			pendingPlanetData = newPlanetData;
			nebulaOpacity.target = 0;
			stars1Opacity.target = 0;
			stars2Opacity.target = 0;
		}
	});

	$effect(() => {
		// Using nebulaOpacity as the representative tween
		if (nebulaOpacity.current < 0.01 && nebulaOpacity.target === 0) {
			activePlanetData = pendingPlanetData;
			pendingPlanetData = null;

			nebulaOpacity.target = 1;
			stars1Opacity.target = 1;
			stars2Opacity.target = 1;
		}
	});
</script>

<!-- Background stars - Layer 1 (inner, faster) -->
<T.Group
	position={[0, 0, 0]}
	rotation={[stars1RotationX.current, stars1RotationY.current, stars1RotationZ.current]}
	userData={{ hideInTree: true, selectable: false }}
>
	<StarsComponent
		count={derivedState.counts.stars1}
		radius={10}
		depth={30}
		factor={1.45}
		fade={true}
		lightness={0.4}
		opacity={stars1Opacity.current}
		saturation={0.45}
		speed={0.72}
		userData={{ hideInTree: true, selectable: false }}
	/>
</T.Group>

<!-- Background stars - Layer 2 (outer, slower) -->
<T.Group
	position={[0, 0, 0]}
	rotation={[stars2RotationX.current, stars2RotationY.current, stars2RotationZ.current]}
	userData={{ hideInTree: true, selectable: false }}
>
	<StarsComponent
		count={derivedState.counts.stars2}
		radius={10}
		depth={30}
		factor={1.9}
		fade={true}
		lightness={0.4}
		opacity={stars2Opacity.current}
		saturation={0.45}
		speed={0.2}
		userData={{ hideInTree: true, selectable: false }}
	/>
</T.Group>

<!-- Skybox model -->
<T.Group position={[0, 20, -27]} scale={0.2} userData={{ hideInTree: true, selectable: false }}>
	<GLTF
		{dracoLoader}
		scale={0.5}
		rotation={[nebulaRotationX.current, nebulaRotationY.current, nebulaRotationZ.current]}
		position={nebulaPosition}
		url="/models/skybox/skybox_nebula-transformed.glb"
		onload={handleNebulaLoad}
	/>
</T.Group>
<!-- Central Sun/Star -->
<T.Group
	position={[0, 20, -27]}
	scale={sunScale.current}
	userData={{ hideInTree: true, selectable: false }}
>
	<!-- Inner Glow -->
	<T.Mesh
		position={[0, 0, 0]}
		scale={[6, 6, 6]}
		opacity={sunOpacity.current}
		userData={{ hideInTree: true, selectable: false }}
	>
		<FakeGlowMaterial
			glowColor={derivedState.sun.glowColor}
			falloff={sunFalloff.current}
			glowInternalRadius={sunGlowInternalRadius.current}
			glowSharpness={sunGlowSharpness.current}
			depthTest={false}
		/>
		<T.IcosahedronGeometry args={[3, 3]} />
	</T.Mesh>

	<!-- Outer Glow (High Quality Only) -->
	{#if settingsState.graphics.quality === 'high'}
		<T.Mesh
			position={[0, 0, 0]}
			scale={[10, 10, 10]}
			opacity={sunOpacity.current * 0.5}
			userData={{ hideInTree: true, selectable: false }}
		>
			<FakeGlowMaterial
				glowColor="#FF6B35"
				falloff={1.8}
				glowInternalRadius={8}
				glowSharpness={0.3}
				depthTest={false}
			/>
			<T.IcosahedronGeometry args={[4, 2]} />
		</T.Mesh>
	{/if}

	<!-- Core -->
	<T.Mesh
		position={[0, 0, 0]}
		scale={[3, 3, 3]}
		opacity={0.6}
		userData={{ hideInTree: true, selectable: false }}
	>
		<T.MeshBasicMaterial color={derivedState.sun.coreColor} />
		<T.IcosahedronGeometry args={[2, 4]} />
	</T.Mesh>
</T.Group>
