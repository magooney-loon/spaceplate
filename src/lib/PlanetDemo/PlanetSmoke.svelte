<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import { Float, useTexture } from '@threlte/extras';
	import * as THREE from 'three';
	import smoke from '$lib/assets/smoke.png';
	import { settingsState } from '$lib/settings/settings.svelte.js';
	import { profileGetters } from '$lib/game/profile.svelte.js';
	import { hashCode, getPlanetAtmosphericColors } from '$lib/game/utils/procedural.svelte.js';
	import { planetSmokeCache, createPlanetSmokeCacheKey } from '$lib/game/utils/cache.svelte.js';
	import { Tween } from 'svelte/motion';
	import { cubicInOut } from 'svelte/easing';

	// Animated opacity for atmospheric cloud system - single instance (start at 0 for fade-in on load)
	let cloudOpacity = new Tween(0, {
		duration: settingsState.graphics.quality === 'low' ? 0 : 900,
		easing: cubicInOut
	});
	// Planet radius in same coordinate space as smoke
	const PLANET_RADIUS = 180; // Approximate planet radius in smoke coordinates
	const MOON_RADIUS = 360; // Spread radius for moons

	interface CloudParticle {
		position: THREE.Vector3;
		basePosition: THREE.Vector3; // Store original position
		baseSpherical: { phi: number; theta: number; radius: number }; // Spherical coords
		rotation: number;
		rotationAxis: THREE.Vector3;
		rotationSpeed: number;
		rotationDirection: number; // 1 = clockwise, -1 = counter-clockwise
		scale: number;
		opacity: number;
		color: THREE.Color;
		initialMatrix: THREE.Matrix4;
		depthFactor: number; // 0 = close, 1 = far
	}

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

	// Cloud particles state - single instance
	let cloudParticles = $state<CloudParticle[]>([]);
	let cloudInstancedMesh = $state<THREE.InstancedMesh | null>(null);

	// Color transition state for smooth morphing
	let isColorTransitioning = $state(false);
	let colorTransitionProgress = $state(0);
	let targetColors = $state<THREE.Color[]>([]);

	// Reusable objects to avoid creation in loops
	const tempMatrix = new THREE.Matrix4();
	const tempPosition = new THREE.Vector3();
	const tempQuaternion = new THREE.Quaternion();
	const tempScale = new THREE.Vector3();
	const tempColor = new THREE.Color();

	// Dynamic nebula color palette based on planet temperature and variant
	// Uses centralized procedural system matching Planet.svelte - with centralized caching
	const nebulaColors = $derived.by(() => {
		const planetData = activePlanetData;

		// Default atmospheric colors
		if (!planetData) {
			const cacheKey = createPlanetSmokeCacheKey('default', 0, settingsState.graphics.quality);
			return planetSmokeCache.getOrSet(cacheKey, () => {
				return [
					new THREE.Color('#0D47A1'), // Deep midnight blue
					new THREE.Color('#1565C0'), // Rich azure blue
					new THREE.Color('#0277BD'), // Medium blue
					new THREE.Color('#4A90A2'), // Medium blue-teal
					new THREE.Color('#00838F'), // Teal-cyan blend
					new THREE.Color('#00CED1'), // Cyan
					new THREE.Color('#00695C'), // Muted teal
					new THREE.Color('#4527A0'), // Soft purple
					new THREE.Color('#6B3FA0'), // Medium violet
					new THREE.Color('#9370DB'), // Medium orchid
					new THREE.Color('#8A2BE2'), // Blue-violet
					new THREE.Color('#E6E6FA') // Light lavender
				];
			});
		}

		const planetId = planetData.data.planetId || 'default';
		const planetSeed = hashCode(planetId);
		const temp = planetEnvironment.temperature;
		const quality = settingsState.graphics.quality;

		// Check if selected body is a moon
		const selectedBasic = profileGetters.selectedPlanet;
		const isMoon = selectedBasic?.celestialBodyType === 'Moon';

		// Use centralized cache with getOrSet pattern
		const cacheKey = createPlanetSmokeCacheKey(planetId, temp, quality) + (isMoon ? '_moon' : '');
		return planetSmokeCache.getOrSet(cacheKey, () => {
			const atmosphericColors = getPlanetAtmosphericColors(temp, planetSeed);
			return atmosphericColors.colors.map((hex) => {
				const color = new THREE.Color(hex);
				// Desaturate colors for moons
				if (isMoon) {
					const hsl = { h: 0, s: 0, l: 0 };
					color.getHSL(hsl);
					color.setHSL(hsl.h, hsl.s * 0.1, hsl.l * 1.1); // Mostly grayscale, slightly brighter
				}
				return color;
			});
		});
	});

	const isMoonBody = $derived.by(() => {
		const selectedBasic = profileGetters.selectedPlanet;
		return selectedBasic?.celestialBodyType === 'Moon';
	});

	const bodyRadius = $derived(isMoonBody ? MOON_RADIUS : PLANET_RADIUS);

	const derivedState = $derived.by(() => {
		const env = planetEnvironment;
		const quality = settingsState.graphics.quality;

		const nebulaIntensity =
			env.heatFactor > 0.33 && env.heatFactor < 0.66
				? 0.32 // Default intensity for medium planets
				: 0.24; // Lower intensity for hot/cold extremes

		// Counts - more particles for better volumetric feel
		let particleCount: number;
		switch (quality) {
			case 'low':
				particleCount = 0;
				break;
			case 'mid':
				particleCount = 50;
				break;
			case 'high':
				particleCount = 120;
				break;
			default:
				particleCount = 50;
		}

		return {
			nebulaIntensity,
			counts: {
				particles: particleCount
			}
		};
	});

	// Animated cloud intensity for smooth transitions
	let cloudIntensity = new Tween(0.18, {
		duration: settingsState.graphics.quality === 'low' ? 0 : 1200,
		easing: cubicInOut
	});

	$effect(() => {
		cloudIntensity.target = derivedState.nebulaIntensity;
	});

	const smokeTexture = useTexture(smoke, {
		transform: (texture) => {
			texture.generateMipmaps = true;
			texture.minFilter = THREE.LinearMipmapLinearFilter;
			texture.magFilter = THREE.LinearFilter;
			texture.wrapS = THREE.ClampToEdgeWrapping;
			texture.wrapT = THREE.ClampToEdgeWrapping;
			if (settingsState.graphics.quality === 'mid') {
				texture.repeat.set(0.85, 0.85);
			}
			return texture;
		}
	});

	const createCloudParticles = (count: number, smokeRadius: number): CloudParticle[] => {
		const particles: CloudParticle[] = [];
		for (let i = 0; i < count; i++) {
			// Start from body edge outward - avoid rendering over body center
			const depthBias = Math.pow(Math.random(), 2.2); // Bias towards closer to body edge
			const depthFactor = depthBias;
			// Start at body edge (smokeRadius) and extend outward
			const radius = smokeRadius + depthFactor * (smokeRadius * 2.5);

			// Use Fibonacci sphere for even distribution
			const goldenRatio = (1 + Math.sqrt(5)) / 2;
			const theta = (2 * Math.PI * i) / goldenRatio;
			const phi = Math.acos(1 - (2 * (i + 0.5)) / count);

			// Add organic noise to distribution - less noise closer to planet
			const noiseScale = 0.15 + depthFactor * 0.25;
			const noiseOffset1 = Math.sin(i * 12.9898 + 78.233) * noiseScale;
			const noiseOffset2 = Math.cos(i * 4.1234 + 43.521) * noiseScale;
			const noisyTheta = theta + noiseOffset1;
			const noisyPhi = Math.max(0.15, Math.min(Math.PI - 0.15, phi + noiseOffset2 * 0.5));

			const x = radius * Math.sin(noisyPhi) * Math.cos(noisyTheta);
			const y = radius * Math.sin(noisyPhi) * Math.sin(noisyTheta);
			const z = radius * Math.cos(noisyPhi);

			const position = new THREE.Vector3(x, y, z);

			// Scale varies dramatically - larger particles closer for wrapping effect
			const scaleBase = 0.9 + Math.random() * 1.0;
			const depthScale = 1 + depthFactor * 0.6;
			const scale = scaleBase * depthScale;

			// Opacity - closer particles are more visible (wrap effect), further ones fade
			const baseOpacity = 0.35 - depthFactor * 0.1;
			const opacity = baseOpacity + (Math.random() - 0.5) * 0.2;

			// Rotation speed varies - inner particles rotate faster for dynamic feel
			const rotationSpeed = (Math.random() * 0.00015 + 0.00003) * (1 + (1 - depthFactor) * 0.5);

			// Random rotation axis for better 3D volumetric appearance
			const rotationAxis = new THREE.Vector3(
				Math.random() - 0.5,
				Math.random() - 0.5,
				Math.random() - 0.5
			).normalize();

			// Blend between multiple colors from the full palette for lush variety
			const colorIndex1 = Math.floor(Math.random() * nebulaColors.length);
			const colorIndex2 = (colorIndex1 + 2 + Math.floor(Math.random() * 3)) % nebulaColors.length;
			const colorIndex3 = (colorIndex1 + 5 + Math.floor(Math.random() * 3)) % nebulaColors.length;
			const blendFactor1 = Math.random() * 0.5;
			const blendFactor2 = Math.random() * 0.3;
			const color = new THREE.Color()
				.copy(nebulaColors[colorIndex1])
				.lerp(nebulaColors[colorIndex2], blendFactor1)
				.lerp(nebulaColors[colorIndex3], blendFactor2);

			// Assign rotation direction - half clockwise, half counter-clockwise
			const rotationDirection = i % 2 === 0 ? 1 : -1;

			// Intensity - closer particles are brighter for atmospheric glow
			const intensity = 0.32 - depthFactor * 0.08 + Math.random() * 0.12;
			color.multiplyScalar(intensity);

			tempPosition.copy(position);
			tempQuaternion.setFromAxisAngle(rotationAxis, 0);
			tempScale.set(scale, scale, scale);
			tempMatrix.compose(tempPosition, tempQuaternion, tempScale);

			const particle: CloudParticle = {
				position: position.clone(),
				basePosition: position.clone(),
				baseSpherical: { phi: noisyPhi, theta: noisyTheta, radius },
				rotation: 0,
				rotationAxis,
				rotationSpeed,
				rotationDirection,
				scale,
				opacity: Math.max(0.08, Math.min(0.4, opacity)),
				color: color.clone(),
				initialMatrix: tempMatrix.clone(),
				depthFactor
			};
			particles.push(particle);
		}
		return particles;
	};

	let initialLoadHandled = $state(false);

	let cloudRotationOffset = $state(0);
	const BASE_ROTATION_SPEED = 0.0015;
	const TRANSITION_ROTATION_SPEED = 0.0045;
	let cloudRotationSpeed = $state(BASE_ROTATION_SPEED);
	let cloudRotationDirection = $state(1);
	let isTransitioning = $state(false);
	let isSlowingDown = $state(false);

	$effect(() => {
		const newPlanetData = profileGetters.selectedPlanetFullData;
		const isChange = newPlanetData?.data.planetId !== activePlanetData?.data.planetId;
		const isFirstLoad = !initialLoadHandled;

		if (isFirstLoad) {
			initialLoadHandled = true;
			activePlanetData = newPlanetData;
			cloudOpacity.target = 1;
			isTransitioning = true;
			isSlowingDown = false;
			cloudRotationSpeed = TRANSITION_ROTATION_SPEED;
			setTimeout(() => {
				isTransitioning = false;
				isSlowingDown = true;
			}, 450);
		} else if (isChange && !pendingPlanetData) {
			pendingPlanetData = newPlanetData;

			// --- Start MORPH transition ---
			// 1. Calculate new target colors immediately
			let newPlanetColors: THREE.Color[] | undefined = undefined;
			if (newPlanetData) {
				const planetId = newPlanetData.data.planetId || 'default';
				const planetSeed = hashCode(planetId);
				const temp = (newPlanetData.data.temperatureMin + newPlanetData.data.temperatureMax) / 2;
				const atmosphericColors = getPlanetAtmosphericColors(temp, planetSeed);
				newPlanetColors = atmosphericColors.colors.map((hex: string) => new THREE.Color(hex));
			}
			const newTargetColors: THREE.Color[] = [];
			if (newPlanetColors) {
				for (let i = 0; i < cloudParticles.length; i++) {
					// Blend between multiple colors from the full palette for lush variety
					const colorIndex1 = Math.floor(Math.random() * newPlanetColors.length);
					const colorIndex2 =
						(colorIndex1 + 2 + Math.floor(Math.random() * 3)) % newPlanetColors.length;
					const colorIndex3 =
						(colorIndex1 + 5 + Math.floor(Math.random() * 3)) % newPlanetColors.length;
					const blendFactor1 = Math.random() * 0.5;
					const blendFactor2 = Math.random() * 0.3;
					const newColor = new THREE.Color()
						.copy(newPlanetColors[colorIndex1])
						.lerp(newPlanetColors[colorIndex2], blendFactor1)
						.lerp(newPlanetColors[colorIndex3], blendFactor2);
					const depthFactor = cloudParticles[i].depthFactor;
					const intensity = 0.32 - depthFactor * 0.08 + Math.random() * 0.12;
					newColor.multiplyScalar(intensity);
					newTargetColors.push(newColor);
				}
			}
			targetColors = newTargetColors;
			isColorTransitioning = true; // Start color lerp
			colorTransitionProgress = 0; // Reset progress

			// 2. Start opacity dip
			cloudOpacity.target = 0.01;

			// 3. Start fast rotation
			isTransitioning = true;
			isSlowingDown = false;
			cloudRotationSpeed = TRANSITION_ROTATION_SPEED;
		}
	});

	// This effect triggers at the bottom of the dip
	$effect(() => {
		if (cloudOpacity.current < 0.011 && cloudOpacity.target === 0.01) {
			// After any transition dip, trigger the rotation to slow down.
			setTimeout(() => {
				isTransitioning = false;
				isSlowingDown = true;
			}, 1000);

			// 1. Update the active data (works for new planets and for logout where pending is null)
			activePlanetData = pendingPlanetData;
			pendingPlanetData = null;

			// 2. Start opacity rise
			cloudOpacity.target = 1;
		}
	});

	const handleCloudInstancedMeshCreate = (mesh: THREE.InstancedMesh) => {
		cloudInstancedMesh = mesh;
		const count = derivedState.counts.particles;
		if (count === 0) return;
		const particles = createCloudParticles(count, bodyRadius);
		cloudParticles = particles;
		for (let i = 0; i < particles.length; i++) {
			const particle = particles[i];
			mesh.setMatrixAt(i, particle.initialMatrix);
			mesh.setColorAt(i, particle.color);
		}
		mesh.instanceMatrix.needsUpdate = true;
		if (mesh.instanceColor) {
			mesh.instanceColor.needsUpdate = true;
		}
		mesh.frustumCulled = true;
		return () => {
			cloudInstancedMesh = null;
			cloudParticles = [];
		};
	};

	const handleGeometryCreate = () => {
		return () => {};
	};

	const handleCloudMaterialCreate = (material: THREE.MeshBasicMaterial) => {
		material.transparent = true;
		material.side = THREE.DoubleSide;
		material.blending = THREE.AdditiveBlending;
		material.depthWrite = false;
		material.depthTest = true;
		material.opacity = derivedState.nebulaIntensity * 0.4;
		// Softer alpha test for edge fade-out
		material.alphaTest = 0.001;
		return () => {};
	};

	$effect(() => {
		if (cloudInstancedMesh && cloudInstancedMesh.material) {
			const material = cloudInstancedMesh.material as THREE.MeshBasicMaterial;
			material.opacity = cloudIntensity.current * 1.5 * cloudOpacity.current;
			material.needsUpdate = true;
		}
	});

	let frameSkipCounter = 0;
	const Z_AXIS = new THREE.Vector3(0, 0, 1);

	const frameSkipModulo = $derived.by(() => {
		switch (settingsState.graphics.quality) {
			case 'high':
				return 2;
			case 'mid':
				return 3;
			case 'low':
				return 10;
			default:
				return 3;
		}
	});

	useTask(() => {
		frameSkipCounter++;
		if (frameSkipCounter % frameSkipModulo !== 0) return;
		const time = Date.now() * 0.0001;
		let needsUpdate = false;
		if (isColorTransitioning && colorTransitionProgress < 1) {
			colorTransitionProgress += 0.016;
			if (colorTransitionProgress >= 1) {
				colorTransitionProgress = 1;
				isColorTransitioning = false;
			}
		}
		cloudRotationOffset += cloudRotationSpeed * cloudRotationDirection;
		if (isSlowingDown) {
			cloudRotationSpeed = cloudRotationSpeed * 0.97 + BASE_ROTATION_SPEED * 0.03;
			if (Math.abs(cloudRotationSpeed - BASE_ROTATION_SPEED) < 0.00005) {
				cloudRotationSpeed = BASE_ROTATION_SPEED;
				isSlowingDown = false;
			}
		}
		if (cloudInstancedMesh && cloudParticles.length > 0 && cloudOpacity.current > 0.01) {
			for (let i = 0; i < cloudParticles.length; i++) {
				const particle = cloudParticles[i];

				// Parallax based rotation - outer shells move slower (reduced for more cohesive look)
				const parallaxFactor = 1 - particle.depthFactor * 0.2;
				const rotationSpeed = cloudRotationSpeed * parallaxFactor * particle.rotationDirection;

				// Rotate particle around Y axis in spherical coordinates
				const { phi, radius } = particle.baseSpherical;
				const theta =
					particle.baseSpherical.theta +
					cloudRotationOffset * parallaxFactor * particle.rotationDirection;

				// Calculate new position with organic wave motion - more movement near planet
				const depthWaveFactor = (1 - particle.depthFactor) * 1.5;
				const waveRadius =
					radius +
					Math.sin(time * 0.06 + particle.baseSpherical.theta * 2) * (3 + depthWaveFactor * 2) +
					Math.cos(time * 0.04 + particle.baseSpherical.phi * 3) * (2 + depthWaveFactor);

				const waveX = Math.sin(time * 0.05 + i * 0.08) * (1.5 + depthWaveFactor);
				const waveY = Math.cos(time * 0.06 + i * 0.1) * (1.5 + depthWaveFactor);
				const waveZ = Math.sin(time * 0.04 + i * 0.07) * (1.5 + depthWaveFactor);

				particle.position.x = waveRadius * Math.sin(phi) * Math.cos(theta) + waveX;
				particle.position.y = waveRadius * Math.sin(phi) * Math.sin(theta) + waveY;
				particle.position.z = waveRadius * Math.cos(phi) + waveZ;

				// Simple rotation for misty effect with random axis
				particle.rotation += particle.rotationSpeed;
				tempPosition.copy(particle.position);
				tempQuaternion.setFromAxisAngle(particle.rotationAxis, particle.rotation);
				tempScale.set(particle.scale, particle.scale, particle.scale);
				tempMatrix.compose(particle.position, tempQuaternion, tempScale);

				// Color lerping during transitions
				if (isColorTransitioning && targetColors.length > i) {
					const easeFactor =
						colorTransitionProgress * colorTransitionProgress * (3 - 2 * colorTransitionProgress);
					particle.color.lerp(targetColors[i], 0.035 * (1 + easeFactor * 0.5));
				}

				// Subtle pulse effect - more pronounced near planet
				const depthPulseFactor = (1 - particle.depthFactor) * 0.3;
				const pulse1 = Math.sin(time * 2.5 + i * 0.3) * (0.015 + depthPulseFactor);
				const pulse2 = Math.cos(time * 2 + i * 0.4) * (0.012 + depthPulseFactor);
				const pulse3 = Math.sin(time * 1.8 + i * 0.25) * 0.006;
				const pulse = 1 + pulse1 + pulse2 + pulse3;

				// Fade based on depth (further particles stay more visible for wrapping effect)
				const depthFade = 1 - particle.depthFactor * 0.15;

				// Apply color with pulse and depth fade
				tempColor.copy(particle.color).multiplyScalar(pulse * depthFade);

				cloudInstancedMesh.setMatrixAt(i, tempMatrix);
				cloudInstancedMesh.setColorAt(i, tempColor);
			}
			needsUpdate = true;
		}
		if (needsUpdate && cloudInstancedMesh) {
			cloudInstancedMesh.instanceMatrix.needsUpdate = true;
			if (cloudInstancedMesh.instanceColor) {
				cloudInstancedMesh.instanceColor.needsUpdate = true;
			}
		}
	});
</script>

<!-- Nebula Cloud System - Single Instance -->
<T.Group position={[0, 0, 0.9]} scale={0.009} userData={{ hideInTree: true, selectable: false }}>
	<Float floatIntensity={1.3} userData={{ hideInTree: true, selectable: false }}>
		<!-- Single Cloud System -->
		{#if derivedState.counts.particles > 0 && settingsState.graphics.quality !== 'low' && $smokeTexture}
			<T.Group position={[0, 0, 0]} userData={{ hideInTree: true, selectable: false }}>
				<T.InstancedMesh
					args={[
						undefined, // geometry will be attached
						undefined, // material will be attached
						derivedState.counts.particles
					]}
					userData={{ hideInTree: true, selectable: false }}
					oncreate={handleCloudInstancedMeshCreate}
				>
					<T.PlaneGeometry args={[270, 270]} attach="geometry" oncreate={handleGeometryCreate} />
					<T.MeshBasicMaterial
						map={$smokeTexture}
						color="#ffffff"
						attach="material"
						oncreate={handleCloudMaterialCreate}
					/>
				</T.InstancedMesh>
			</T.Group>
		{/if}
	</Float>
</T.Group>
