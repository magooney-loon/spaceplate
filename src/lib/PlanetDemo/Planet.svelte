<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import { Float } from '@threlte/extras';
	import * as THREE from 'three';
	import { untrack } from 'svelte';
	import { cubicOut } from 'svelte/easing';
	import { settingsState } from '$extensions/settings/settings.svelte';
	import { hashCode, seededRandom, getPlanetColors } from './procedural.svelte';
	import { planetGeometryCache, planetUniformsCache } from '$core/cache.svelte';

	interface Props {
		planetId?: string;
		temperature?: number;
	}

	let { planetId = 'default', temperature = 20 }: Props = $props();

	const planetSeed = $derived(hashCode(planetId));
	const avgTemp = $derived(temperature);

	// Noise functions shared between vertex and fragment shaders
	//	Simplex 3D Noise
	//	by Ian McEwan, Ashima Arts
	// Modified by magooney-loon
	const noiseFunctions = `
		const float PI = 3.14159265;

		vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
		vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}

		float simplex3(vec3 v, float seed) {
		  v = v + vec3(seed * 0.1, seed * 0.2, seed * 0.3);
		  const vec2  C = vec2(1.0/6.0, 1.0/3.0);
		  const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
		  vec3 i  = floor(v + dot(v, C.yyy));
		  vec3 x0 =   v - i + dot(i, C.xxx);
		  vec3 g = step(x0.yzx, x0.xyz);
		  vec3 l = 1.0 - g;
		  vec3 i1 = min(g.xyz, l.zxy);
		  vec3 i2 = max(g.xyz, l.zxy);
		  vec3 x1 = x0 - i1 + 1.0 * C.xxx;
		  vec3 x2 = x0 - i2 + 2.0 * C.xxx;
		  vec3 x3 = x0 - 1. + 3.0 * C.xxx;
		  i = mod(i, 289.0);
		  vec4 p = permute(permute(permute(
		            i.z + vec4(0.0, i1.z, i2.z, 1.0))
		          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
		          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
		  float n_ = 1.0/7.0;
		  vec3  ns = n_ * D.wyz - D.xzx;
		  vec4 j = p - 49.0 * floor(p * ns.z *ns.z);
		  vec4 x_ = floor(j * ns.z);
		  vec4 y_ = floor(j - 7.0 * x_);
		  vec4 x = x_ *ns.x + ns.yyyy;
		  vec4 y = y_ *ns.x + ns.yyyy;
		  vec4 h = 1.0 - abs(x) - abs(y);
		  vec4 b0 = vec4(x.xy, y.xy);
		  vec4 b1 = vec4(x.zw, y.zw);
		  vec4 s0 = floor(b0)*2.0 + 1.0;
		  vec4 s1 = floor(b1)*2.0 + 1.0;
		  vec4 sh = -step(h, vec4(0.0));
		  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
		  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
		  vec3 p0 = vec3(a0.xy,h.x);
		  vec3 p1 = vec3(a0.zw,h.y);
		  vec3 p2 = vec3(a1.xy,h.z);
		  vec3 p3 = vec3(a1.zw,h.w);
		  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
		  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
		  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
		  m = m * m;
		  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
		}

		float fractal3(vec3 v, float sharpness, float period, float persistence, float lacunarity, int octaves, float seed) {
		  float n = 0.0; float a = 1.0; float max_amp = 0.0; float P = period;
		  for(int i = 0; i < octaves; i++) {
		    n += a * simplex3(v / P, seed); a *= persistence; max_amp += a; P /= lacunarity;
		  }
		  return n / max_amp;
		}

		float terrainHeight(int type, vec3 v, float amplitude, float sharpness, float offset, float period, float persistence, float lacunarity, int octaves, float seed) {
		  float h = 0.0;
		  if (type == 1) {
		    h = amplitude * simplex3(v / period, seed);
		  } else if (type == 2) {
		    h = amplitude * fractal3(v, sharpness, period, persistence, lacunarity, octaves, seed);
		    h = amplitude * pow(max(0.0, (h + 1.0) / 2.0), sharpness);
		  } else if (type == 3) {
		    h = fractal3(v, sharpness, period, persistence, lacunarity, octaves, seed);
		    h = amplitude * pow(max(0.0, 1.0 - abs(h)), sharpness);
		  }
		  return max(0.0, h + offset);
		}
	`;

	const vertexShader = `
		attribute vec3 tangent;
		uniform int type;
		uniform float radius;
		uniform float amplitude;
		uniform float sharpness;
		uniform float offset;
		uniform float period;
		uniform float persistence;
		uniform float lacunarity;
		uniform int octaves;
		uniform float noiseSeed;
		uniform float bumpStrength;
		uniform float bumpOffset;
		varying vec3 fragPosition;
		varying vec3 fragNormal;
		varying vec3 fragTangent;
		varying vec3 fragBitangent;

		void main() {
		  float h = terrainHeight(type, position, amplitude, sharpness, offset, period, persistence, lacunarity, octaves, noiseSeed);
		  vec3 pos = position * (radius + h);
		  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
		  fragPosition = position;
		  fragNormal = normal;
		  fragTangent = tangent;
		  fragBitangent = cross(normal, tangent);
		}
	`.replace('void main() {', `${noiseFunctions}\nvoid main() {`);

	const fragmentShader = `
		uniform int type;
		uniform float radius;
		uniform float amplitude;
		uniform float sharpness;
		uniform float offset;
		uniform float period;
		uniform float persistence;
		uniform float lacunarity;
		uniform int octaves;
		uniform float noiseSeed;
		uniform vec3 color1;
		uniform vec3 color2;
		uniform vec3 color3;
		uniform vec3 color4;
		uniform vec3 color5;
		uniform float transition2;
		uniform float transition3;
		uniform float transition4;
		uniform float transition5;
		uniform float blend12;
		uniform float blend23;
		uniform float blend34;
		uniform float blend45;
		uniform float bumpStrength;
		uniform float bumpOffset;
		uniform float ambientIntensity;
		uniform float diffuseIntensity;
		uniform float specularIntensity;
		uniform float shininess;
		uniform vec3 lightDirection;
		uniform vec3 lightColor;
		uniform float time;
		uniform float opacity;
		varying vec3 fragPosition;
		varying vec3 fragNormal;
		varying vec3 fragTangent;
		varying vec3 fragBitangent;

		void main() {
		  float h = terrainHeight(type, fragPosition, amplitude, sharpness, offset, period, persistence, lacunarity, octaves, noiseSeed);
		  float mixNoise = simplex3(fragPosition * 12.0, noiseSeed) * 0.04;
		  float hMixed = h + mixNoise;

		  vec3 dx = bumpOffset * fragTangent;
		  float h_dx = terrainHeight(type, fragPosition + dx, amplitude, sharpness, offset, period, persistence, lacunarity, octaves, noiseSeed);
		  vec3 dy = bumpOffset * fragBitangent;
		  float h_dy = terrainHeight(type, fragPosition + dy, amplitude, sharpness, offset, period, persistence, lacunarity, octaves, noiseSeed);
		  vec3 pos = fragPosition * (radius + h);
		  vec3 pos_dx = (fragPosition + dx) * (radius + h_dx);
		  vec3 pos_dy = (fragPosition + dy) * (radius + h_dy);
		  vec3 bumpNormal = normalize(cross(pos_dx - pos, pos_dy - pos));
		  vec3 N = normalize(mix(fragNormal, bumpNormal, bumpStrength));
		  float slope = max(0.0, dot(N, fragNormal));

		  vec3 L = normalize(-lightDirection);
		  vec3 V = normalize(cameraPosition - pos);
		  vec3 R = normalize(reflect(L, N));
		  float diffuse = diffuseIntensity * max(0.0, dot(N, -L));
		  float specularFalloff = clamp((transition3 - h) / transition3, 0.0, 1.0);
		  float specular = max(0.0, specularFalloff * specularIntensity * pow(dot(V, R), shininess));
		  float light = ambientIntensity + diffuse + specular;

		  vec3 col12 = mix(color1, color2, smoothstep(transition2 - blend12, transition2 + blend12, hMixed));
		  vec3 col123 = mix(col12, color3, smoothstep(transition3 - blend23, transition3 + blend23, hMixed));
		  float rockLayer = smoothstep(transition4 - blend34, transition4 + blend34, hMixed);
		  float slopeInfluence = (1.0 - slope) * 0.5;
		  vec3 col1234 = mix(col123, color4, clamp(rockLayer - slopeInfluence, 0.0, 1.0));
		  vec3 finalColor = mix(col1234, color5, smoothstep(transition5 - blend45, transition5 + blend45, hMixed));

		  float varNoise = simplex3(fragPosition * 2.0, noiseSeed + 0.5);
		  finalColor *= (0.95 + varNoise * 0.05);

		  float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0);
		  vec3 atmosColor = mix(finalColor, lightColor, 0.3);
		  finalColor = mix(finalColor, atmosColor, fresnel * 0.4);

		  vec3 color = light * finalColor * lightColor;
		  gl_FragColor = vec4(color, opacity);
		}
	`.replace('void main() {', `${noiseFunctions}\nvoid main() {`);

	const planetDetail = $derived(settingsState.graphics.quality === 'high' ? 128 : 48);
	const terrainOctaves = $derived(settingsState.graphics.quality === 'high' ? 10 : 6);
	const terrainType = $derived(settingsState.graphics.quality === 'high' ? 3 : 2);
	const lightingIntensity = $derived(
		settingsState.graphics.quality === 'high'
			? { ambient: 0.0, diffuse: 0.36, specular: 0.0 }
			: { ambient: 0.0, diffuse: 0.9, specular: 0.0 }
	);

	const generatePlanetColors = $derived(getPlanetColors(avgTemp, planetSeed));

	const terrainParams = $derived.by(() => {
		const r6 = seededRandom(planetSeed + 6);
		const r7 = seededRandom(planetSeed + 7);
		const r8 = seededRandom(planetSeed + 8);
		return {
			amplitude: 1.19 + (r6 - 0.5) * 0.3,
			sharpness: 1.6 + (r7 - 0.5) * 0.5,
			period: 0.6 + (r8 - 0.5) * 0.2
		};
	});

	const planetUniforms = $derived.by(() => {
		const cacheKey = `${planetId}_${settingsState.graphics.quality}`;
		const cachedValues = planetUniformsCache.getOrSet(cacheKey, () => ({
			type: terrainType,
			radius: 20.0,
			amplitude: terrainParams.amplitude,
			sharpness: terrainParams.sharpness,
			offset: -0.016,
			period: terrainParams.period,
			persistence: 0.484,
			lacunarity: 1.8,
			octaves: terrainOctaves,
			noiseSeed: planetSeed / 1000000,
			color1: generatePlanetColors.color1,
			color2: generatePlanetColors.color2,
			color3: generatePlanetColors.color3,
			color4: generatePlanetColors.color4,
			color5: generatePlanetColors.color5,
			transition2: 0.021,
			transition3: 0.15,
			transition4: 0.72,
			transition5: 1.2,
			blend12: 0.04,
			blend23: 0.08,
			blend34: 0.18,
			blend45: 0.25,
			bumpStrength: 1.0,
			bumpOffset: 0.001,
			ambientIntensity: lightingIntensity.ambient,
			diffuseIntensity: lightingIntensity.diffuse,
			specularIntensity: lightingIntensity.specular,
			shininess: 0.1,
			lightDirection: new THREE.Vector3(-9, 45, 0).clone(),
			lightColor: new THREE.Color(0xfce5cd).clone()
		}));

		return {
			type: { value: cachedValues.type },
			radius: { value: cachedValues.radius },
			amplitude: { value: cachedValues.amplitude },
			sharpness: { value: cachedValues.sharpness },
			offset: { value: cachedValues.offset },
			period: { value: cachedValues.period },
			persistence: { value: cachedValues.persistence },
			lacunarity: { value: cachedValues.lacunarity },
			octaves: { value: cachedValues.octaves },
			noiseSeed: { value: cachedValues.noiseSeed },
			color1: { value: cachedValues.color1 },
			color2: { value: cachedValues.color2 },
			color3: { value: cachedValues.color3 },
			color4: { value: cachedValues.color4 },
			color5: { value: cachedValues.color5 },
			transition2: { value: cachedValues.transition2 },
			transition3: { value: cachedValues.transition3 },
			transition4: { value: cachedValues.transition4 },
			transition5: { value: cachedValues.transition5 },
			blend12: { value: cachedValues.blend12 },
			blend23: { value: cachedValues.blend23 },
			blend34: { value: cachedValues.blend34 },
			blend45: { value: cachedValues.blend45 },
			bumpStrength: { value: cachedValues.bumpStrength },
			bumpOffset: { value: cachedValues.bumpOffset },
			ambientIntensity: { value: cachedValues.ambientIntensity },
			diffuseIntensity: { value: cachedValues.diffuseIntensity },
			specularIntensity: { value: cachedValues.specularIntensity },
			shininess: { value: cachedValues.shininess },
			lightDirection: { value: cachedValues.lightDirection },
			lightColor: { value: cachedValues.lightColor },
			time: { value: 0.0 },
			opacity: { value: 0.0 }
		};
	});

	const planetGeometry = $derived.by(() => {
		const cacheKey = `${planetId}_${settingsState.graphics.quality}_geo`;
		return planetGeometryCache.getOrSet(cacheKey, () => {
			const geo = new THREE.SphereGeometry(1, planetDetail, planetDetail);
			geo.computeTangents();
			return geo;
		});
	});

	const planetMaterial = $derived(
		new THREE.ShaderMaterial({
			uniforms: planetUniforms,
			vertexShader,
			fragmentShader,
			side: THREE.FrontSide,
			transparent: true
		})
	);

	let rotation = $state(0);
	let opacityT = $state(0);
	let prevPlanetId = $state(untrack(() => planetId));

	useTask((delta) => {
		// Detect planet switch — reset fade
		if (planetId !== prevPlanetId) {
			prevPlanetId = planetId;
			opacityT = 0;
		}
		if (opacityT < 1) opacityT = Math.min(1, opacityT + delta * 2.5);

		rotation += delta / 30;
		if (planetMaterial instanceof THREE.ShaderMaterial) {
			planetMaterial.uniforms.time.value += delta;
			planetMaterial.uniforms.opacity.value = cubicOut(opacityT);
		}
	});
</script>

<Float floatIntensity={0.15} name="Planet">
	<T.Mesh rotation.y={rotation} geometry={planetGeometry} material={planetMaterial} scale={0.12} />
</Float>
