<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import { Float, useTexture } from '@threlte/extras';
	import * as THREE from 'three';
	import { BASE_URL, settingsState } from '$extensions/settings/settings.svelte';
	import { hashCode, getPlanetAtmosphericColors } from './procedural.svelte';
	import { planetSmokeCache, createPlanetSmokeCacheKey } from './cache.svelte';

	interface Props {
		planetId?: string;
		temperature?: number;
	}

	let { planetId = 'default', temperature = 20 }: Props = $props();

	const PLANET_RADIUS = 180;

	interface CloudParticle {
		position: THREE.Vector3;
		baseSpherical: { phi: number; theta: number; radius: number };
		rotation: number;
		rotationAxis: THREE.Vector3;
		rotationSpeed: number;
		rotationDirection: number;
		scale: number;
		color: THREE.Color;
		initialMatrix: THREE.Matrix4;
		depthFactor: number;
	}

	const nebulaColors = $derived.by(() => {
		const seed = hashCode(planetId);
		const cacheKey = createPlanetSmokeCacheKey(planetId, temperature, settingsState.graphics.quality);
		return planetSmokeCache.getOrSet(cacheKey, () => {
			const atmosphericColors = getPlanetAtmosphericColors(temperature, seed);
			return atmosphericColors.colors.map((hex) => new THREE.Color(hex));
		});
	});

	const particleCount = $derived(settingsState.graphics.quality === 'high' ? 120 : 0);

	const nebulaIntensity = $derived.by(() => {
		const heatFactor = Math.max(0, Math.min(1, (temperature + 60) / 160));
		return heatFactor > 0.33 && heatFactor < 0.66 ? 0.32 : 0.24;
	});

	// Reusable objects
	const tempMatrix = new THREE.Matrix4();
	const tempPosition = new THREE.Vector3();
	const tempQuaternion = new THREE.Quaternion();
	const tempScale = new THREE.Vector3();
	const tempColor = new THREE.Color();

	const createCloudParticles = (count: number): CloudParticle[] => {
		const particles: CloudParticle[] = [];
		const colors = nebulaColors;
		for (let i = 0; i < count; i++) {
			const depthBias = Math.pow(Math.random(), 2.2);
			const depthFactor = depthBias;
			const radius = PLANET_RADIUS + depthFactor * (PLANET_RADIUS * 2.5);

			const goldenRatio = (1 + Math.sqrt(5)) / 2;
			const theta = (2 * Math.PI * i) / goldenRatio;
			const phi = Math.acos(1 - (2 * (i + 0.5)) / count);

			const noiseScale = 0.15 + depthFactor * 0.25;
			const noisyTheta = theta + Math.sin(i * 12.9898 + 78.233) * noiseScale;
			const noisyPhi = Math.max(
				0.15,
				Math.min(Math.PI - 0.15, phi + Math.cos(i * 4.1234 + 43.521) * noiseScale * 0.5)
			);

			const x = radius * Math.sin(noisyPhi) * Math.cos(noisyTheta);
			const y = radius * Math.sin(noisyPhi) * Math.sin(noisyTheta);
			const z = radius * Math.cos(noisyPhi);
			const position = new THREE.Vector3(x, y, z);

			const scaleBase = 0.9 + Math.random() * 1.0;
			const scale = scaleBase * (1 + depthFactor * 0.6);

			const rotationSpeed = (Math.random() * 0.00015 + 0.00003) * (1 + (1 - depthFactor) * 0.5);
			const rotationAxis = new THREE.Vector3(
				Math.random() - 0.5,
				Math.random() - 0.5,
				Math.random() - 0.5
			).normalize();

			const colorIndex1 = Math.floor(Math.random() * colors.length);
			const colorIndex2 = (colorIndex1 + 2 + Math.floor(Math.random() * 3)) % colors.length;
			const colorIndex3 = (colorIndex1 + 5 + Math.floor(Math.random() * 3)) % colors.length;
			const color = new THREE.Color()
				.copy(colors[colorIndex1])
				.lerp(colors[colorIndex2], Math.random() * 0.5)
				.lerp(colors[colorIndex3], Math.random() * 0.3);

			const intensity = 0.32 - depthFactor * 0.08 + Math.random() * 0.12;
			color.multiplyScalar(intensity);

			tempPosition.copy(position);
			tempQuaternion.setFromAxisAngle(rotationAxis, 0);
			tempScale.set(scale, scale, scale);
			tempMatrix.compose(tempPosition, tempQuaternion, tempScale);

			particles.push({
				position: position.clone(),
				baseSpherical: { phi: noisyPhi, theta: noisyTheta, radius },
				rotation: 0,
				rotationAxis,
				rotationSpeed,
				rotationDirection: i % 2 === 0 ? 1 : -1,
				scale,
				color: color.clone(),
				initialMatrix: tempMatrix.clone(),
				depthFactor
			});
		}
		return particles;
	};

	let cloudParticles = $state<CloudParticle[]>([]);
	let cloudInstancedMesh = $state<THREE.InstancedMesh | null>(null);
	let cloudRotationOffset = $state(0);
	let cloudRotationSpeed = $state(0.0015);
	let frameSkipCounter = 0;

	const frameSkipModulo = $derived(settingsState.graphics.quality === 'high' ? 2 : 4);

	const smokeTexture = useTexture(`${BASE_URL}textures/utils/smoke.png`, {
		transform: (texture) => {
			texture.generateMipmaps = true;
			texture.minFilter = THREE.LinearMipmapLinearFilter;
			texture.magFilter = THREE.LinearFilter;
			texture.wrapS = THREE.ClampToEdgeWrapping;
			texture.wrapT = THREE.ClampToEdgeWrapping;
			return texture;
		}
	});

	const handleCloudMeshCreate = (mesh: THREE.InstancedMesh) => {
		cloudInstancedMesh = mesh;
		const count = particleCount;
		if (count === 0) return;
		const particles = createCloudParticles(count);
		cloudParticles = particles;
		for (let i = 0; i < particles.length; i++) {
			mesh.setMatrixAt(i, particles[i].initialMatrix);
			mesh.setColorAt(i, particles[i].color);
		}
		mesh.instanceMatrix.needsUpdate = true;
		if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
		mesh.frustumCulled = true;
		return () => {
			cloudInstancedMesh = null;
			cloudParticles = [];
		};
	};

	const handleMaterialCreate = (material: THREE.MeshBasicMaterial) => {
		material.transparent = true;
		material.side = THREE.DoubleSide;
		material.blending = THREE.AdditiveBlending;
		material.depthWrite = false;
		material.depthTest = true;
		material.opacity = nebulaIntensity * 0.4;
		material.alphaTest = 0.001;
		return () => {};
	};

	useTask(() => {
		frameSkipCounter++;
		if (frameSkipCounter % frameSkipModulo !== 0) return;
		const time = Date.now() * 0.0001;

		cloudRotationOffset += cloudRotationSpeed;

		if (cloudInstancedMesh && cloudParticles.length > 0) {
			for (let i = 0; i < cloudParticles.length; i++) {
				const particle = cloudParticles[i];
				const parallaxFactor = 1 - particle.depthFactor * 0.2;
				const { phi, radius } = particle.baseSpherical;
				const theta =
					particle.baseSpherical.theta +
					cloudRotationOffset * parallaxFactor * particle.rotationDirection;

				const depthWaveFactor = (1 - particle.depthFactor) * 1.5;
				const waveRadius =
					radius +
					Math.sin(time * 0.06 + particle.baseSpherical.theta * 2) * (3 + depthWaveFactor * 2) +
					Math.cos(time * 0.04 + particle.baseSpherical.phi * 3) * (2 + depthWaveFactor);

				particle.position.x =
					waveRadius * Math.sin(phi) * Math.cos(theta) +
					Math.sin(time * 0.05 + i * 0.08) * (1.5 + depthWaveFactor);
				particle.position.y =
					waveRadius * Math.sin(phi) * Math.sin(theta) +
					Math.cos(time * 0.06 + i * 0.1) * (1.5 + depthWaveFactor);
				particle.position.z =
					waveRadius * Math.cos(phi) +
					Math.sin(time * 0.04 + i * 0.07) * (1.5 + depthWaveFactor);

				particle.rotation += particle.rotationSpeed;
				tempQuaternion.setFromAxisAngle(particle.rotationAxis, particle.rotation);
				tempScale.set(particle.scale, particle.scale, particle.scale);
				tempMatrix.compose(particle.position, tempQuaternion, tempScale);

				const depthPulseFactor = (1 - particle.depthFactor) * 0.3;
				const pulse =
					1 +
					Math.sin(time * 2.5 + i * 0.3) * (0.015 + depthPulseFactor) +
					Math.cos(time * 2 + i * 0.4) * (0.012 + depthPulseFactor);
				const depthFade = 1 - particle.depthFactor * 0.15;

				tempColor.copy(particle.color).multiplyScalar(pulse * depthFade);
				cloudInstancedMesh.setMatrixAt(i, tempMatrix);
				cloudInstancedMesh.setColorAt(i, tempColor);
			}
			cloudInstancedMesh.instanceMatrix.needsUpdate = true;
			if (cloudInstancedMesh.instanceColor) cloudInstancedMesh.instanceColor.needsUpdate = true;
		}
	});
</script>

<T.Group position={[0, 0, 0.9]} scale={0.009} userData={{ hideInTree: true, selectable: false }}>
	<Float floatIntensity={1.3} userData={{ hideInTree: true, selectable: false }}>
		{#if particleCount > 0 && settingsState.graphics.quality !== 'low' && $smokeTexture}
			<T.InstancedMesh
				args={[undefined, undefined, particleCount]}
				userData={{ hideInTree: true, selectable: false }}
				oncreate={handleCloudMeshCreate}
			>
				<T.PlaneGeometry args={[270, 270]} attach="geometry" />
				<T.MeshBasicMaterial
					map={$smokeTexture}
					color="#ffffff"
					attach="material"
					oncreate={handleMaterialCreate}
				/>
			</T.InstancedMesh>
		{/if}
	</Float>
</T.Group>
