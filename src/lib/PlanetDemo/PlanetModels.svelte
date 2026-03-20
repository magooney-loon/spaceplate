<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import { Float, GLTF, useDraco } from '@threlte/extras';
	import * as THREE from 'three';
	import { settingsState } from '$lib/settings/settings.svelte.js';
	import { PositionalAudio } from '@threlte/extras';
	import { profileGetters } from '$lib/game/profile.svelte';
	import { fleetGetters } from '$lib/game/fleet.svelte';
	import scan from '$lib/assets/sound/scan.mp3';
	import { PositionalAudio as ThreePositionalAudio } from 'three';
	import { CacheManager, CACHE_NAMES } from '$lib/game/utils/cache.svelte';

	const dracoLoader = useDraco();

	interface Props {
		isCurrent?: boolean;
		isBackdrop?: boolean;
		celestialType?: 'Planet' | 'Moon';
		planetScale?: number;
		scaleAnim?: number; // Animated scale multiplier (0.5 to 1) for transitions
		opacityAnim?: number; // Animated opacity (0 to 1) for transitions
		planetRotationY?: number; // Current planet Y rotation (for syncing shield domes)
	}

	let {
		isCurrent = true,
		isBackdrop = false,
		celestialType = 'Planet',
		planetScale = 0.1,
		scaleAnim = 1,
		opacityAnim = 1,
		planetRotationY = 0
	}: Props = $props();

	// ============== SHIELD DOMES ==============
	// Get shield dome counts (capped for rendering)
	const smallShieldCount = $derived.by(() => {
		const planetData = profileGetters.selectedPlanetFullData;
		if (!planetData) return 0;
		const unit = planetData.hangar.units.find((u) => u.unitId === 'SMALL_SHIELD_DOME');
		return Math.min(unit?.quantity ?? 0, 27);
	});

	const largeShieldCount = $derived.by(() => {
		const planetData = profileGetters.selectedPlanetFullData;
		if (!planetData) return 0;
		const unit = planetData.hangar.units.find((u) => u.unitId === 'LARGE_SHIELD_DOME');
		return Math.min(unit?.quantity ?? 0, 12);
	});

	const hasAtmosphericShield = $derived.by(() => {
		const planetData = profileGetters.selectedPlanetFullData;
		if (!planetData) return false;
		const unit = planetData.hangar.units.find((u) => u.unitId === 'ATMOSPHERIC_SHIELD');
		return (unit?.quantity ?? 0) > 0;
	});

	// Should render shields based on quality and ownership
	const shouldRenderShields = $derived(
		isCurrent &&
			!isBackdrop &&
			celestialType === 'Planet' &&
			(smallShieldCount > 0 || largeShieldCount > 0 || hasAtmosphericShield) &&
			settingsState.graphics.quality !== 'low'
	);

	let shieldTime = $state(0);

	const hasIncomingHostileFleets = $derived(() => {
		const planetData = profileGetters.selectedPlanetFullData;
		if (!planetData) return false;
		const hostileFleets = fleetGetters.getIncomingHostileFleets(
			planetData.data.galaxyNumber,
			planetData.data.systemNumber,
			planetData.data.slotNumber
		);
		return hostileFleets.length > 0;
	});

	// Shield sizes (relative to planet)
	// Include scaleAnim to match planet transition animations
	const planetRadius = $derived(20 * planetScale * scaleAnim); // Actual rendered planet radius
	const atmosphericShieldScale = $derived(planetScale * 1.22 * scaleAnim);

	// Holographic shield shader - creates a translucent energy field effect
	const shieldVertexShader = `
		varying vec3 vNormal;
		varying vec3 vPosition;
		varying vec2 vUv;

		void main() {
			vNormal = normalize(normalMatrix * normal);
			vPosition = position;
			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
		}
	`;

	const shieldFragmentShader = `
		uniform vec3 color;
		uniform float time;
		uniform float opacity;

		varying vec3 vNormal;
		varying vec3 vPosition;
		varying vec2 vUv;

		void main() {
			// Fresnel effect - more visible at edges
			vec3 viewDirection = normalize(cameraPosition - vPosition);
			float fresnel = pow(1.0 - abs(dot(viewDirection, vNormal)), 3.0);

			// Hexagonal grid pattern
			vec2 hexUv = vUv * 40.0;
			float hex = abs(sin(hexUv.x * 3.14159) * sin(hexUv.y * 3.14159 * 1.732));
			hex = smoothstep(0.85, 1.0, hex);

			// Flowing energy waves
			float wave1 = sin(vPosition.y * 10.0 + time * 2.0) * 0.5 + 0.5;
			float wave2 = sin(vPosition.x * 8.0 - time * 1.5) * 0.5 + 0.5;
			float energy = wave1 * wave2 * 0.3;

			// Scanline effect
			float scanline = sin(vPosition.y * 100.0 + time * 5.0);
			scanline = smoothstep(0.95, 1.0, scanline) * 0.2;

			// Combine effects
			float alpha = fresnel * 0.6 + hex * 0.15 + energy * 0.1 + scanline;
			alpha *= opacity;

			// Add slight glow
			vec3 finalColor = color + vec3(0.1) * fresnel;

			gl_FragColor = vec4(finalColor, alpha * 0.4);
		}
	`;

	// Create shield materials
	const smallShieldMaterial = CacheManager.getOrSet(
		CACHE_NAMES.ORBITAL_MATERIAL,
		'small_shield_material',
		() =>
			new THREE.ShaderMaterial({
				uniforms: {
					color: { value: new THREE.Color(0x4488ff) }, // Blue
					time: { value: 0 },
					opacity: { value: 1.0 }
				},
				vertexShader: shieldVertexShader,
				fragmentShader: shieldFragmentShader,
				transparent: true,
				side: THREE.DoubleSide,
				blending: THREE.AdditiveBlending,
				depthWrite: false
			})
	);

	const largeShieldMaterial = CacheManager.getOrSet(
		CACHE_NAMES.ORBITAL_MATERIAL,
		'large_shield_material',
		() =>
			new THREE.ShaderMaterial({
				uniforms: {
					color: { value: new THREE.Color(0x888899) }, // Grayish
					time: { value: 0 },
					opacity: { value: 1.0 }
				},
				vertexShader: shieldVertexShader,
				fragmentShader: shieldFragmentShader,
				transparent: true,
				side: THREE.DoubleSide,
				blending: THREE.AdditiveBlending,
				depthWrite: false
			})
	);

	const atmosphericShieldMaterial = CacheManager.getOrSet(
		CACHE_NAMES.ORBITAL_MATERIAL,
		'atmospheric_shield_material',
		() =>
			new THREE.ShaderMaterial({
				uniforms: {
					color: { value: new THREE.Color(0x9944ff) }, // Purple
					time: { value: 0 },
					opacity: { value: 1.0 }
				},
				vertexShader: shieldVertexShader,
				fragmentShader: shieldFragmentShader,
				transparent: true,
				side: THREE.DoubleSide,
				blending: THREE.AdditiveBlending,
				depthWrite: false
			})
	);

	// Shield geometries (unit radius 1, shallow caps oriented along +Y)
	// Small shield: shallow dome cap
	const smallShieldGeometry = CacheManager.getOrSet(
		CACHE_NAMES.ORBITAL_GEOMETRY,
		'small_shield_dome',
		() => new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.3)
	);
	// Large shield: slightly deeper dome cap
	const largeShieldGeometry = CacheManager.getOrSet(
		CACHE_NAMES.ORBITAL_GEOMETRY,
		'large_shield_dome',
		() => new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.35)
	);
	// Atmospheric shield: full sphere
	const atmosphericShieldGeometry = CacheManager.getOrSet(
		CACHE_NAMES.ORBITAL_GEOMETRY,
		'atmospheric_shield_sphere',
		() => new THREE.SphereGeometry(20, 48, 32)
	);

	// Evenly distribute points on a sphere using Fibonacci sphere method
	// Returns [theta, phi] pairs (longitude, latitude from pole)
	function fibonacciSpherePositions(count: number): [number, number][] {
		const goldenAngle = Math.PI * (3 - Math.sqrt(5));
		const positions: [number, number][] = [];
		for (let i = 0; i < count; i++) {
			// y goes from ~1 to ~-1, evenly spaced
			const y = 1 - (2 * (i + 0.5)) / count;
			const phi = Math.acos(y); // latitude from pole
			const theta = goldenAngle * i; // longitude, golden angle spacing
			positions.push([theta, phi]);
		}
		return positions;
	}

	const smallShieldPositions = fibonacciSpherePositions(27);
	const largeShieldPositions = fibonacciSpherePositions(12);

	// ============== SOLAR SATELLITE ==============
	let satelliteOrbitAngle = $state(0);

	// Check if player has solar satellites
	const hasSolarSatellites = $derived.by(() => {
		const planetData = profileGetters.selectedPlanetFullData;
		if (!planetData) return false;
		const solarSatelliteUnit = planetData.hangar.units.find((u) => u.unitId === 'SOLAR_SATELLITE');
		return (solarSatelliteUnit?.quantity ?? 0) > 0;
	});

	// Should render satellite based on quality, ownership, and being the main planet (not backdrop, not moon)
	const shouldRenderSatellite = $derived(
		isCurrent &&
			!isBackdrop &&
			celestialType === 'Planet' &&
			hasSolarSatellites &&
			settingsState.graphics.quality !== 'low'
	);

	// Calculate satellite orbital position - orbit tilted towards camera for better visibility
	const satelliteOrbitRadius = $derived(planetRadius * 2.25); // ~2.25x planet radius from center

	// On medium: static position, on high: full orbit around planet (counter to planet rotation)
	// Orbit is tilted so satellite spends more time visible in front of planet
	const satelliteX = $derived(
		settingsState.graphics.quality === 'high'
			? Math.cos(satelliteOrbitAngle) * satelliteOrbitRadius * 0.6 // Elliptical, narrower side-to-side
			: -planetRadius * 1.25 // Static position for medium
	);
	const satelliteY = $derived(
		settingsState.graphics.quality === 'high'
			? Math.sin(satelliteOrbitAngle) * satelliteOrbitRadius * 0.4 // Vertical component
			: planetRadius * 0.75 // Static position for medium
	);
	const satelliteZ = $derived(
		settingsState.graphics.quality === 'high'
			? Math.sin(satelliteOrbitAngle) * satelliteOrbitRadius * 0.8 + planetRadius * 1.25 // Offset forward so mostly in front
			: planetRadius * 1.5 // Static position for medium
	);

	// Satellite rotation - faces direction of travel
	const satelliteRotation = $derived(
		settingsState.graphics.quality === 'high' ? satelliteOrbitAngle : 0.5 // Static rotation for medium
	);

	// ============== SPY PROBE ==============
	let spyProbeOrbitAngle = $state(Math.PI); // Start opposite side from satellite
	let spyProbeScanTimer = $state(0);
	let spyProbeIsScanning = $state(false);
	let spyProbeScanIntensity = $state(0);
	let spyProbeNextScanTime = $state(0); // Set on first loop iteration based on hostile status
	let spyProbeShouldPlaySound = $state(false);
	let spyProbeScanAudioRef = $state<ThreePositionalAudio>();

	// Scan beam state - a cone of light that sweeps across the planet
	let scanBeamProgress = $state(0); // Linear 0→1 sweep progress
	let scanBeamActive = $state(false);

	// Scan cone geometry (beam from probe to planet)
	const scanConeGeometry = CacheManager.getOrSet(
		CACHE_NAMES.ORBITAL_GEOMETRY,
		'scan_cone',
		() => new THREE.ConeGeometry(0.5, 2.5, 8, 1, true)
	);

	// Beam material — translucent energy cone with fresnel-like edge glow
	const scanBeamMaterial = CacheManager.getOrSet(
		CACHE_NAMES.ORBITAL_MATERIAL,
		'scan_beam_material',
		() =>
			new THREE.ShaderMaterial({
				uniforms: {
					time: { value: 0 },
					opacity: { value: 1.0 },
					color: { value: new THREE.Color(0x44aacc) }
				},
				vertexShader: `
					varying vec2 vUv;
					varying vec3 vNormal;
					varying vec3 vWorldPos;
					void main() {
						vUv = uv;
						vNormal = normalize(normalMatrix * normal);
						vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
						gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
					}
				`,
				fragmentShader: `
					uniform float time;
					uniform float opacity;
					uniform vec3 color;
					varying vec2 vUv;
					varying vec3 vNormal;
					varying vec3 vWorldPos;

					void main() {
						// Fresnel: bright at edges, transparent through center
						vec3 viewDir = normalize(cameraPosition - vWorldPos);
						float fresnel = pow(1.0 - abs(dot(viewDir, vNormal)), 2.0);

						// Fade from probe (tip) to planet (base)
						float fade = 1.0 - vUv.y;

						// Flowing energy lines
						float energy = sin(vUv.y * 20.0 - time * 5.0) * 0.5 + 0.5;
						energy = smoothstep(0.7, 1.0, energy) * 0.15;

						float alpha = (fresnel * 0.5 + energy) * fade * opacity;
						gl_FragColor = vec4(color + vec3(0.1) * fresnel, alpha);
					}
				`,
				transparent: true,
				side: THREE.DoubleSide,
				blending: THREE.AdditiveBlending,
				depthWrite: false
			})
	);

	// Scan target state — beam impact point on planet surface
	let scanTargetPosition = $state(new THREE.Vector3(0, 0, 0));

	// Handle spy probe scan audio
	const handleSpyProbeScanAudio = (audio: ThreePositionalAudio) => {
		spyProbeScanAudioRef = audio;
		return () => {
			if (audio.isPlaying) audio.stop();
			spyProbeScanAudioRef = undefined;
		};
	};

	// Play scan sound when flag is set
	$effect(() => {
		if (spyProbeShouldPlaySound && spyProbeScanAudioRef && settingsState.audio.effectsEnabled) {
			try {
				if (spyProbeScanAudioRef.isPlaying) spyProbeScanAudioRef.stop();
				spyProbeScanAudioRef.play();
			} catch (e) {
				console.warn('Failed to play spy probe scan sound:', e);
			}
			spyProbeShouldPlaySound = false;
		}
	});

	// Check if player has spy probes
	const hasSpyProbes = $derived.by(() => {
		const planetData = profileGetters.selectedPlanetFullData;
		if (!planetData) return false;
		const spyProbeUnit = planetData.hangar.units.find((u) => u.unitId === 'SPY_PROBE');
		return (spyProbeUnit?.quantity ?? 0) > 0;
	});

	// Should render spy probe based on quality, ownership, and being the main planet (not backdrop, not moon)
	const shouldRenderSpyProbe = $derived(
		isCurrent &&
			!isBackdrop &&
			celestialType === 'Planet' &&
			hasSpyProbes &&
			settingsState.graphics.quality !== 'low'
	);

	// Spy probe orbital position - different orbit plane than satellite for variety
	const spyProbeOrbitRadius = $derived(planetRadius * 2.35); // ~2.35x planet radius, slightly closer than satellite

	const spyProbeX = $derived(
		settingsState.graphics.quality === 'high'
			? Math.sin(spyProbeOrbitAngle) * spyProbeOrbitRadius * 0.7 // Elliptical orbit
			: planetRadius * 1.25 // Static position for medium
	);
	const spyProbeY = $derived(
		settingsState.graphics.quality === 'high'
			? Math.cos(spyProbeOrbitAngle) * spyProbeOrbitRadius * 0.5 +
					planetRadius * 0.25 +
					Math.sin(spyProbeOrbitAngle * 2.5) * 0.1 // Gentle vertical sway
			: planetRadius * 0.6 // Static position for medium
	);
	const spyProbeZ = $derived(
		settingsState.graphics.quality === 'high'
			? Math.cos(spyProbeOrbitAngle) * spyProbeOrbitRadius * 0.6 + planetRadius * 1.4 // Offset forward, mostly visible
			: planetRadius * 1.4 // Static position for medium
	);

	// Calculate velocity direction for nose-forward orientation
	// Derivatives of position: dx/dt, dy/dt, dz/dt (ignoring constant offsets)
	const spyProbeVelX = $derived(Math.cos(spyProbeOrbitAngle) * spyProbeOrbitRadius * 0.7);
	const spyProbeVelZ = $derived(-Math.sin(spyProbeOrbitAngle) * spyProbeOrbitRadius * 0.6);

	// Rotation around Y axis to face direction of travel (atan2 of velocity in XZ plane)
	// On medium: point nose toward planet center (0,0,0) from static position
	const spyProbeRotationY = $derived(
		settingsState.graphics.quality === 'high'
			? Math.atan2(spyProbeVelX, spyProbeVelZ)
			: Math.atan2(-spyProbeX, -spyProbeZ)
	);

	// Animation loop for orbital units and shields
	useTask((delta) => {
		// Update shield time and opacity (works on all quality levels except low)
		if (settingsState.graphics.quality !== 'low') {
			shieldTime += delta;

			// Update shield material uniforms (time and opacity for transitions)
			if (smallShieldCount > 0 && smallShieldMaterial) {
				smallShieldMaterial.uniforms.time.value = shieldTime;
				smallShieldMaterial.uniforms.opacity.value = opacityAnim;
			}
			if (largeShieldCount > 0 && largeShieldMaterial) {
				largeShieldMaterial.uniforms.time.value = shieldTime;
				largeShieldMaterial.uniforms.opacity.value = opacityAnim;
			}
			if (hasAtmosphericShield && atmosphericShieldMaterial) {
				atmosphericShieldMaterial.uniforms.time.value = shieldTime;
				atmosphericShieldMaterial.uniforms.opacity.value = opacityAnim;
			}
		}

		// Orbital movement only on high quality
		if (settingsState.graphics.quality === 'high') {
			// Satellite orbits around the planet in counter direction
			satelliteOrbitAngle -= delta * 0.08; // Negative = counter direction to planet rotation

			// Spy probe orbits faster in same direction as planet
			spyProbeOrbitAngle += delta * 0.1;
		}

		// Spy probe scanning logic - scan every 7-9 seconds (medium and high), faster (2-3s) if hostile
		// Initialize scan interval on first frame to avoid warning about using derived in state init
		if (spyProbeNextScanTime === 0) {
			spyProbeNextScanTime = hasIncomingHostileFleets() ? 2 + Math.random() : 7 + Math.random() * 2;
		}
		spyProbeScanTimer += delta;
		if (!spyProbeIsScanning && spyProbeScanTimer > spyProbeNextScanTime) {
			spyProbeScanTimer = 0;
			spyProbeIsScanning = true;
			spyProbeScanIntensity = 0;
			scanBeamProgress = 0;
			scanBeamActive = true;
			spyProbeNextScanTime = hasIncomingHostileFleets() ? 2 + Math.random() : 7 + Math.random() * 2;
			spyProbeShouldPlaySound = true;
		}

		// Scan beam animation - smooth arc sweep across the near-side planet surface
		if (spyProbeIsScanning) {
			spyProbeScanIntensity += delta * 0.8;

			// Smooth progress 0 → 1 over the scan duration
			scanBeamProgress = Math.min(1, scanBeamProgress + delta * 0.55);
			// Ease in-out for natural acceleration/deceleration
			const easedProgress =
				scanBeamProgress < 0.5
					? 2 * scanBeamProgress * scanBeamProgress
					: 1 - Math.pow(-2 * scanBeamProgress + 2, 2) / 2;

			// Update shader time uniform
			scanBeamMaterial.uniforms.time.value += delta;

			// Place the beam target directly on the near hemisphere of the planet
			// facing the probe, sweeping in a smooth arc
			const probePos = new THREE.Vector3(spyProbeX, spyProbeY, spyProbeZ);
			const probeDir = probePos.clone().normalize(); // direction from planet center to probe

			// Build a stable tangent frame on the sphere at the sub-probe point
			const worldUp = new THREE.Vector3(0, 1, 0);
			let tangentU = worldUp.clone().cross(probeDir);
			if (tangentU.lengthSq() < 0.001) {
				tangentU = new THREE.Vector3(1, 0, 0).cross(probeDir);
			}
			tangentU.normalize();
			const tangentV = probeDir.clone().cross(tangentU).normalize();

			// Sweep angle: arc from -40deg to +40deg across the visible face
			const sweepAngle = (easedProgress - 0.5) * 1.4;
			const surfaceNormal = probeDir
				.clone()
				.multiplyScalar(Math.cos(sweepAngle))
				.add(tangentU.clone().multiplyScalar(Math.sin(sweepAngle) * 0.9))
				.add(tangentV.clone().multiplyScalar(Math.sin(sweepAngle * 0.7) * 0.3))
				.normalize();

			const R = planetRadius + 0.05;
			scanTargetPosition.copy(surfaceNormal.clone().multiplyScalar(R));

			// Fade in/out
			let fadeOpacity = 1.0;
			if (spyProbeScanIntensity < 0.3) {
				fadeOpacity = spyProbeScanIntensity / 0.3;
			} else if (spyProbeScanIntensity > 1.3) {
				fadeOpacity = Math.max(0, 1.0 - (spyProbeScanIntensity - 1.3) / 0.2);
			}
			scanBeamMaterial.uniforms.opacity.value = fadeOpacity * 0.5;

			// Update scan beam color based on hostile fleets
			const beamColor = hasIncomingHostileFleets()
				? new THREE.Color(0xff3333) // Red for hostile
				: new THREE.Color(0x44aacc); // Cyan for normal
			scanBeamMaterial.uniforms.color.value.lerp(beamColor, 0.1);

			// End scan
			if (spyProbeScanIntensity >= 1.5) {
				spyProbeScanIntensity = 0;
				spyProbeIsScanning = false;
				scanBeamActive = false;
			}
		}
	});
</script>

<!-- Orbital units container with shared sun-direction lighting -->
{#if shouldRenderSatellite || shouldRenderSpyProbe}
	<T.Group userData={{ hideInTree: true, selectable: false }}>
		<!-- Shared lighting for orbital units - sun comes from top-left-back -->
		<T.DirectionalLight
			position={[10, 15, -20]}
			intensity={1.2}
			color="#FFF5E0"
			userData={{ hideInTree: true, selectable: false }}
		/>

		<!-- Solar Satellite -->
		{#if shouldRenderSatellite}
			<Float floatIntensity={0.15} userData={{ hideInTree: true, selectable: false }}>
				<T.Group
					position={[satelliteX, satelliteY, satelliteZ]}
					userData={{ hideInTree: true, selectable: false }}
				>
					<GLTF
						{dracoLoader}
						scale={0.9}
						rotation={[satelliteRotation * 0.3, satelliteRotation, -0.3]}
						position={[0, 0, 0]}
						url="/models/fleet/SOLAR_SATELITTE-transformed.glb"
					/>
				</T.Group>
			</Float>
		{/if}

		<!-- Spy Probe -->
		{#if shouldRenderSpyProbe}
			<T.Group
				position={[spyProbeX, spyProbeY, spyProbeZ]}
				userData={{ hideInTree: true, selectable: false }}
			>
				<!-- Positional scan sound -->
				<PositionalAudio
					src={scan}
					volume={0.45}
					playbackRate={2.2}
					refDistance={8}
					rolloffFactor={1.5}
					maxDistance={40}
					oncreate={handleSpyProbeScanAudio}
				/>
				<!-- Probe nose always points in direction of travel -->
				<GLTF
					{dracoLoader}
					scale={0.45}
					rotation={[
						settingsState.graphics.quality === 'high'
							? // Pitch based on vertical movement + wobble
								Math.sin(spyProbeOrbitAngle) * 0.25 + Math.cos(spyProbeOrbitAngle * 3) * 0.08
							: // Pitch down toward planet center
								Math.atan2(spyProbeY, Math.sqrt(spyProbeX * spyProbeX + spyProbeZ * spyProbeZ)),
						spyProbeRotationY,
						settingsState.graphics.quality === 'high'
							? // Roll based on turning direction (banking) + wobble
								-Math.cos(spyProbeOrbitAngle) * 0.3 + Math.sin(spyProbeOrbitAngle * 2) * 0.1
							: 0
					]}
					position={[0, 0, 0]}
					url="/models/fleet/SPY_PROBE.glb"
				/>
			</T.Group>

			<!-- Scanning beam effect -->
			{#if scanBeamActive && settingsState.graphics.quality !== 'low'}
				{@const probePos = new THREE.Vector3(spyProbeX, spyProbeY, spyProbeZ)}
				{@const beamDir = scanTargetPosition.clone().sub(probePos).normalize()}
				{@const fullLength = probePos.distanceTo(scanTargetPosition)}
				{@const beamLength = Math.max(0, fullLength + 0.3)}
				{@const beamMidpoint = probePos
					.clone()
					.add(probePos.clone().add(beamDir.clone().multiplyScalar(beamLength)))
					.multiplyScalar(0.5)}
				{@const beamRotation = new THREE.Euler().setFromQuaternion(
					new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), beamDir)
				)}
				{@const pScale = planetRadius / 2.0}

				<!-- Scan beam cone -->
				<T.Mesh
					geometry={scanConeGeometry}
					material={scanBeamMaterial}
					position={[beamMidpoint.x, beamMidpoint.y, beamMidpoint.z]}
					rotation={[beamRotation.x, beamRotation.y, beamRotation.z]}
					scale={[pScale, beamLength / 2.5, pScale]}
				/>
			{/if}
		{/if}
	</T.Group>
{/if}

<!-- Shield Domes - translucent holographic energy fields -->
{#if shouldRenderShields}
	<!-- Small & Large shield domes rotate with the planet -->
	<T.Group rotation.y={planetRotationY}>
		<!-- Small Shield Domes - Multiple small blue bubbles on planet surface -->
		{#if smallShieldCount > 0}
			{#each smallShieldPositions.slice(0, smallShieldCount) as [theta, phi]}
				{@const nx = Math.sin(phi) * Math.sin(theta)}
				{@const ny = Math.cos(phi)}
				{@const nz = Math.sin(phi) * Math.cos(theta)}
				{@const quat = new THREE.Quaternion().setFromUnitVectors(
					new THREE.Vector3(0, 1, 0),
					new THREE.Vector3(nx, ny, nz)
				)}
				{@const euler = new THREE.Euler().setFromQuaternion(quat)}
				{@const domeSize = planetRadius * 0.12}
				{@const domeOffset = planetRadius * 0.99}
				<T.Mesh
					geometry={smallShieldGeometry}
					material={smallShieldMaterial}
					position={[nx * domeOffset, ny * domeOffset, nz * domeOffset]}
					rotation={[euler.x, euler.y, euler.z]}
					scale={[domeSize, domeSize * 0.6, domeSize]}
					userData={{ hideInTree: true, selectable: false }}
				/>
			{/each}
		{/if}

		<!-- Large Shield Domes - Fewer, bigger partial domes on planet surface -->
		{#if largeShieldCount > 0}
			{#each largeShieldPositions.slice(0, largeShieldCount) as [theta, phi]}
				{@const nx = Math.sin(phi) * Math.sin(theta)}
				{@const ny = Math.cos(phi)}
				{@const nz = Math.sin(phi) * Math.cos(theta)}
				{@const quat = new THREE.Quaternion().setFromUnitVectors(
					new THREE.Vector3(0, 1, 0),
					new THREE.Vector3(nx, ny, nz)
				)}
				{@const euler = new THREE.Euler().setFromQuaternion(quat)}
				{@const domeSize = planetRadius * 0.22}
				{@const domeOffset = planetRadius * 0.98}
				<T.Mesh
					geometry={largeShieldGeometry}
					material={largeShieldMaterial}
					position={[nx * domeOffset, ny * domeOffset, nz * domeOffset]}
					rotation={[euler.x, euler.y, euler.z]}
					scale={[domeSize, domeSize * 0.5, domeSize]}
					userData={{ hideInTree: true, selectable: false }}
				/>
			{/each}
		{/if}
	</T.Group>

	<!-- Atmospheric Shield - Purple, full sphere wrapping the planet -->
	{#if hasAtmosphericShield}
		<T.Mesh
			geometry={atmosphericShieldGeometry}
			material={atmosphericShieldMaterial}
			scale={[atmosphericShieldScale, atmosphericShieldScale, atmosphericShieldScale]}
			userData={{ hideInTree: true, selectable: false }}
		/>
	{/if}
{/if}
