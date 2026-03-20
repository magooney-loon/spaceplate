<script lang="ts">
	import { T, useTask } from '@threlte/core';
	import { Float } from '@threlte/extras';
	import * as THREE from 'three';
	import { settingsState, swooshTrigger } from '$lib/settings/settings.svelte.js';
	import { hashCode, seededRandom, getPlanetColors } from '$lib/game/utils/procedural.svelte.js';
	import { PositionalAudio } from '@threlte/extras';
	import swoosh from '$lib/assets/sound/swoosh.mp3';
	import scan from '$lib/assets/sound/scan.mp3';
	import { PositionalAudio as ThreePositionalAudio } from 'three';
	import { Tween } from 'svelte/motion';
	import { cubicInOut, cubicOut } from 'svelte/easing';
	import {
		planetGeometryCache,
		planetUniformsCache,
		createPlanetCacheKey
	} from '$lib/game/utils/cache.svelte.js';
	import PlanetModels from './PlanetModels.svelte';

	// Shared state to track the current visible planet's base scale
	let globalCurrentPlanetBaseScale = $state<number>(0.1);

	let audioRef = $state<ThreePositionalAudio>();
	let scanAudioRef = $state<ThreePositionalAudio>();

	const handleAudioCreate = (audio: ThreePositionalAudio) => {
		audioRef = audio;

		return () => {
			// Cleanup audio
			if (audio.isPlaying) {
				audio.stop();
			}
			audioRef = undefined;
		};
	};

	const handleScanAudioCreate = (audio: ThreePositionalAudio) => {
		scanAudioRef = audio;

		return () => {
			// Cleanup audio
			if (audio.isPlaying) {
				audio.stop();
			}
			scanAudioRef = undefined;
		};
	};

	$effect(() => {
		const currentTrigger = swooshTrigger.value;

		// Only play if effects are enabled, trigger is positive, and audio is ready
		if (currentTrigger > 0 && audioRef && settingsState.audio.effectsEnabled) {
			try {
				// Stop current playback if any
				if (audioRef.isPlaying) {
					audioRef.stop();
				}
				// Play the sound
				audioRef.play();
			} catch (error) {
				console.warn('Failed to play swoosh sound:', error);
			}
		}
	});

	interface Props {
		planetId?: string;
		fieldsMax?: number;
		temperatureMin?: number;
		temperatureMax?: number;
		isCurrent?: boolean;
		celestialType?: 'Planet' | 'Moon';
		isBackdrop?: boolean; // Static backdrop planet (no transitions, smaller scale)
		holographic?: boolean; // Holographic effect for default moon
	}

	let {
		planetId = 'default',
		fieldsMax = 300,
		temperatureMin = -50,
		temperatureMax = 50,
		isCurrent = true,
		celestialType = 'Planet',
		isBackdrop = false,
		holographic = false
	}: Props = $props();

	// Glitch transition effect - using Tween stores
	let glitchIntensity = new Tween(0, {
		duration: settingsState.graphics.quality === 'low' ? 0 : 400,
		easing: cubicOut
	});
	let planetOpacity = new Tween(1, {
		duration: settingsState.graphics.quality === 'low' ? 0 : 700,
		easing: cubicOut
	});
	let planetScaleAnim = new Tween(1, {
		duration: settingsState.graphics.quality === 'low' ? 0 : 700,
		easing: cubicOut
	});
	let planetRotationYOffset = new Tween(0, {
		duration: settingsState.graphics.quality === 'low' ? 0 : 1700,
		easing: cubicOut
	});

	// Will be initialized on first effect run to match actual planetScale
	let planetBaseScale = $state<Tween<number> | null>(null);

	let previousPlanetId = $state<string | undefined>(undefined);

	// Smoothly transition base scale when planet scale changes
	$effect(() => {
		if (!planetBaseScale) {
			// Initialize on first run - new planets inherit global scale
			const startScale = isCurrent ? globalCurrentPlanetBaseScale : planetScale;
			// Duration matches planetScaleAnim (700ms) for smooth crossfade
			planetBaseScale = new Tween(startScale, { duration: 700, easing: cubicInOut });
		}

		// Always target the actual planet scale
		planetBaseScale.target = planetScale;
	});

	// Update global scale when this planet is current
	$effect(() => {
		if (isCurrent && planetBaseScale) {
			globalCurrentPlanetBaseScale = planetBaseScale.current;
		}
	});

	$effect(() => {
		// Backdrop planets: no transitions, just show immediately
		if (isBackdrop) {
			planetOpacity.target = 1;
			planetScaleAnim.target = 1;
			planetRotationYOffset.target = 0;
			glitchIntensity.target = 0;
			return;
		}

		// Check isCurrent inside the effect to properly track it
		const current = isCurrent;
		const currentPlanetId = planetId;

		if (current) {
			// Current planet: start invisible and small, scale up and fade in with glitch
			if (currentPlanetId !== previousPlanetId) {
				// Play scan and swoosh sounds if effects are enabled and this isn't the initial render
				if (previousPlanetId !== undefined && settingsState.audio.effectsEnabled) {
					try {
						if (scanAudioRef) {
							if (scanAudioRef.isPlaying) {
								scanAudioRef.stop();
							}
							scanAudioRef.play();
						}
						if (audioRef) {
							if (audioRef.isPlaying) {
								audioRef.stop();
							}
							audioRef.play();
						}
					} catch (error) {
						console.warn('Failed to play planet transition sounds:', error);
					}
				}

				// Start invisible, scale down with old planet to 0.5
				planetOpacity.target = 0;
				planetScaleAnim.target = 0.5;

				// Rotate in same direction as nebula (based on planet seed)
				const rotationDirection = Math.sin(planetSeed * 0.0001) > 0 ? 1 : -1;
				planetRotationYOffset.target = Math.PI * rotationDirection;

				// Start glitch effect
				glitchIntensity.target = 0.8;

				// After scaling to 0.5 together, fade in new planet
				setTimeout(
					() => {
						glitchIntensity.target = 0;
						planetOpacity.target = 1;
						// Scale to actual planet size and reset rotation
						planetScaleAnim.target = 1;
						planetRotationYOffset.target = 0;
					},
					settingsState.graphics.quality === 'low' ? 0 : 700
				);

				previousPlanetId = currentPlanetId;
			} else if (planetOpacity.current === 0) {
				// Initial render - immediately show planet
				planetOpacity.target = 1;
				planetScaleAnim.target = 1;
				planetRotationYOffset.target = 0;
			}
		} else {
			// Previous planet: scale down to 0.5 with new planet, then fade out
			planetScaleAnim.target = 0.5;
			glitchIntensity.target = 0.8;

			// Rotate in opposite direction of new planet
			const rotationDirection = Math.sin(planetSeed * 0.0001) > 0 ? -1 : 1;
			planetRotationYOffset.target = Math.PI * rotationDirection;

			// Fade out at same time new planet fades in
			setTimeout(
				() => {
					planetOpacity.target = 0;
				},
				settingsState.graphics.quality === 'low' ? 0 : 700
			);
		}
	});

	let rotation = $state(0);
	let rotationFrameSkipCounter = 0;
	useTask((delta) => {
		// Skip updates for performance - rotate every 2 frames instead of every frame
		rotationFrameSkipCounter++;
		if (rotationFrameSkipCounter % 2 !== 0) return;

		// Multiply by 2 to compensate for fewer updates (maintain same visual rotation speed)
		rotation += (delta / 30) * 2;
	});

	// Generate planet parameters based on ID, fieldsMax, and temperature
	const planetSeed = $derived(hashCode(planetId));

	// Temperature affects colors (cold = blue/white, hot = red/orange)
	const avgTemp = $derived((temperatureMin + temperatureMax) / 2);

	// Calculate planet scale based on fieldsMax (230-420 range maps to 0.08-0.12 scale)
	const planetScale = $derived.by(() => {
		// Min fieldsMax: 230, Max fieldsMax: 420
		// Map to scale range: 0.08 (smallest) to 0.12 (largest)
		const minFields = 230;
		const maxFields = 420;
		const minScale = 0.08;
		const maxScale = 0.12;

		const normalizedSize = (fieldsMax - minFields) / (maxFields - minFields);
		return minScale + normalizedSize * (maxScale - minScale);
	});

	// Noise functions shader code
	const noiseFunctions = `
		const float PI = 3.14159265;

		//	Simplex 3D Noise
		//	by Ian McEwan, Ashima Arts
		//  Modified by Magooney-loon
		//
		vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
		vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}

		//
		float simplex3(vec3 v, float seed) {
		  // Offset position by seed to create variation
		  v = v + vec3(seed * 0.1, seed * 0.2, seed * 0.3);
		  const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
		  const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);

		  // First corner
		  vec3 i  = floor(v + dot(v, C.yyy) );
		  vec3 x0 =   v - i + dot(i, C.xxx) ;

		  // Other corners
		  vec3 g = step(x0.yzx, x0.xyz);
		  vec3 l = 1.0 - g;
		  vec3 i1 = min( g.xyz, l.zxy );
		  vec3 i2 = max( g.xyz, l.zxy );

		  //  x0 = x0 - 0. + 0.0 * C
		  vec3 x1 = x0 - i1 + 1.0 * C.xxx;
		  vec3 x2 = x0 - i2 + 2.0 * C.xxx;
		  vec3 x3 = x0 - 1. + 3.0 * C.xxx;

		  // Permutations
		  i = mod(i, 289.0 );
		  vec4 p = permute( permute( permute(
		            i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
		          + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))
		          + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));

		  // Gradients
		  // ( N*N points uniformly over a square, mapped onto an octahedron.)
		  float n_ = 1.0/7.0; // N=7
		  vec3  ns = n_ * D.wyz - D.xzx;

		  vec4 j = p - 49.0 * floor(p * ns.z *ns.z);  //  mod(p,N*N)

		  vec4 x_ = floor(j * ns.z);
		  vec4 y_ = floor(j - 7.0 * x_ );    // mod(j,N)

		  vec4 x = x_ *ns.x + ns.yyyy;
		  vec4 y = y_ *ns.x + ns.yyyy;
		  vec4 h = 1.0 - abs(x) - abs(y);

		  vec4 b0 = vec4( x.xy, y.xy );
		  vec4 b1 = vec4( x.zw, y.zw );

		  vec4 s0 = floor(b0)*2.0 + 1.0;
		  vec4 s1 = floor(b1)*2.0 + 1.0;
		  vec4 sh = -step(h, vec4(0.0));

		  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
		  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;

		  vec3 p0 = vec3(a0.xy,h.x);
		  vec3 p1 = vec3(a0.zw,h.y);
		  vec3 p2 = vec3(a1.xy,h.z);
		  vec3 p3 = vec3(a1.zw,h.w);

		  //Normalise gradients
		  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
		  p0 *= norm.x;
		  p1 *= norm.y;
		  p2 *= norm.z;
		  p3 *= norm.w;

		  // Mix final noise value
		  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
		  m = m * m;
		  return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1),
		                                dot(p2,x2), dot(p3,x3) ) );
		}

		float fractal3(
		  vec3 v,
		  float sharpness,
		  float period,
		  float persistence,
		  float lacunarity,
		  int octaves,
		  float seed
		) {
		  float n = 0.0;
		  float a = 1.0; // Amplitude for current octave
		  float max_amp = 0.0; // Accumulate max amplitude so we can normalize after
		  float P = period;  // Period for current octave

		  for(int i = 0; i < octaves; i++) {
		      n += a * simplex3(v / P, seed);
		      a *= persistence;
		      max_amp += a;
		      P /= lacunarity;
		  }

		  // Normalize noise between [0.0, amplitude]
		  return n / max_amp;
		}

		float terrainHeight(
		  int type,
		  vec3 v,
		  float amplitude,
		  float sharpness,
		  float offset,
		  float period,
		  float persistence,
		  float lacunarity,
		  int octaves,
		  float seed
		) {
		  float h = 0.0;

		  if (type == 1) {
		    h = amplitude * simplex3(v / period, seed);
		  } else if (type == 2) {
		    h = amplitude * fractal3(
		      v,
		      sharpness,
		      period,
		      persistence,
		      lacunarity,
		      octaves,
		      seed);
		    h = amplitude * pow(max(0.0, (h + 1.0) / 2.0), sharpness);
		  } else if (type == 3) {
		    h = fractal3(
		      v,
		      sharpness,
		      period,
		      persistence,
		      lacunarity,
		      octaves,
		      seed);
		    h = amplitude * pow(max(0.0, 1.0 - abs(h)), sharpness);
		  }

		  // Multiply by amplitude and adjust offset
		  return max(0.0, h + offset);
		}
	`;

	// Vertex shader - inject noise functions
	const vertexShader = `
		attribute vec3 tangent;

		// Terrain generation parameters
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

		// Bump mapping
		uniform float bumpStrength;
		uniform float bumpOffset;

		varying vec3 fragPosition;
		varying vec3 fragNormal;
		varying vec3 fragTangent;
		varying vec3 fragBitangent;

		void main() {
		  // Calculate terrain height
		  float h = terrainHeight(
		    type,
		    position,
		    amplitude,
		    sharpness,
		    offset,
		    period,
		    persistence,
		    lacunarity,
		    octaves,
		    noiseSeed);

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

			uniform float glitchIntensity;
			uniform float time;
			uniform float isMoon;
			uniform float holographic;

			varying vec3 fragPosition;
			varying vec3 fragNormal;
			varying vec3 fragTangent;
			varying vec3 fragBitangent;

			void main() {
				// 1. Get base height
				float h = terrainHeight(type, fragPosition, amplitude, sharpness, offset, period, persistence, lacunarity, octaves, noiseSeed);

				// 2. Create "Mixing Noise" to break up the lines
				float mixNoise = simplex3(fragPosition * 12.0, noiseSeed) * 0.04;
				float hMixed = h + mixNoise;

				// 3. Normal Calculation for Slopes
				vec3 dx = bumpOffset * fragTangent;
				float h_dx = terrainHeight(type, fragPosition + dx, amplitude, sharpness, offset, period, persistence, lacunarity, octaves, noiseSeed);
				vec3 dy = bumpOffset * fragBitangent;
				float h_dy = terrainHeight(type, fragPosition + dy, amplitude, sharpness, offset, period, persistence, lacunarity, octaves, noiseSeed);
				vec3 pos = fragPosition * (radius + h);
				vec3 pos_dx = (fragPosition + dx) * (radius + h_dx);
				vec3 pos_dy = (fragPosition + dy) * (radius + h_dy);
				vec3 bumpNormal = normalize(cross(pos_dx - pos, pos_dy - pos));
				vec3 N = normalize(mix(fragNormal, bumpNormal, bumpStrength));

				// Slope factor: 1.0 is flat, 0.0 is vertical cliff
				float slope = max(0.0, dot(N, fragNormal));

				// 4. Lighting
				vec3 L = normalize(-lightDirection);
				vec3 V = normalize(cameraPosition - pos);
				vec3 R = normalize(reflect(L, N));
				float diffuse = diffuseIntensity * max(0.0, dot(N, -L));
				float specularFalloff = clamp((transition3 - h) / transition3, 0.0, 1.0);
				float specular = max(0.0, specularFalloff * specularIntensity * pow(dot(V, R), shininess));
				float light = ambientIntensity + diffuse + specular;

				// 5. Advanced Color Mixing
				// We use hMixed (with noise) to prevent perfect circles
				vec3 col12 = mix(color1, color2, smoothstep(transition2 - blend12, transition2 + blend12, hMixed));
				vec3 col123 = mix(col12, color3, smoothstep(transition3 - blend23, transition3 + blend23, hMixed));

				// Blend in Slope: Rocks (color5) appear more on steep cliffs even at low altitudes
				float rockLayer = smoothstep(transition4 - blend34, transition4 + blend34, hMixed);
				float slopeInfluence = (1.0 - slope) * 0.5; // Steeper = more rock
				vec3 col1234 = mix(col123, color4, clamp(rockLayer - slopeInfluence, 0.0, 1.0));

				vec3 finalColor = mix(col1234, color5, smoothstep(transition5 - blend45, transition5 + blend45, hMixed));

				// Sub-surface hue shift (makes plains look less "flat")
				float varNoise = simplex3(fragPosition * 2.0, noiseSeed + 0.5);
				finalColor *= (0.95 + varNoise * 0.05);

				// 6. Fresnel Atmosphere
				float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0);
				vec3 atmosColor = mix(finalColor, lightColor, 0.3);
				finalColor = mix(finalColor, atmosColor, fresnel * 0.4);

				vec3 color = light * finalColor * lightColor;

				// 7. Enhanced Glitch/Scan Effect
				if (glitchIntensity > 0.0) {
					// Vertical scan wave that sweeps across
					float scanWave = fract(fragPosition.y * 0.5 + time * 2.0);
					float scanLine = smoothstep(0.0, 0.15, scanWave) * smoothstep(1.0, 0.85, scanWave);
					scanLine = pow(scanLine, 2.0) * glitchIntensity;

					// Horizontal grid lines (subtle)
					float gridLine = abs(sin(fragPosition.y * 60.0));
					gridLine = smoothstep(0.97, 1.0, gridLine) * glitchIntensity * 0.4;

					// Hexagonal pattern for sci-fi feel
					vec2 hexCoord = fragPosition.xy * 30.0;
					float hexPattern = abs(sin(hexCoord.x + sin(hexCoord.y * 1.732))) *
					                   abs(cos(hexCoord.y + cos(hexCoord.x * 0.577)));
					hexPattern = smoothstep(0.92, 1.0, hexPattern) * glitchIntensity * 0.25;

					// Energy field shimmer
					float shimmer = sin(fragPosition.x * 20.0 + time * 8.0) *
					               cos(fragPosition.y * 20.0 - time * 6.0);
					shimmer = shimmer * 0.5 + 0.5;
					shimmer = pow(shimmer, 4.0) * glitchIntensity * 0.3;

					// Subtle chromatic aberration on scan line
					vec3 scanColor = color;
					float aberration = scanLine * 0.015;
					scanColor.r *= 1.0 + aberration;
					scanColor.b *= 1.0 - aberration;

					// Holographic blue/cyan tint for the scan effects
					vec3 holoColor = vec3(0.4, 0.7, 0.9);
					vec3 scanGlow = holoColor * (scanLine + gridLine + hexPattern);

					// Energy field color (blend with planet colors)
					vec3 energyColor = mix(color, holoColor, 0.2) * shimmer;

					// Combine effects - much more subtle
					color = mix(color, scanColor, scanLine * 0.15);
					color += scanGlow * 0.3;
					color += energyColor * 0.5;

					// Subtle digital noise (very light)
					float noise = fract(sin(dot(fragPosition.xy + time, vec2(12.9898, 78.233))) * 43758.5453);
					color += vec3(noise) * glitchIntensity * 0.03;

					// Brightness pulse on scan line (barely noticeable)
					float pulse = scanLine * 0.08 + 1.0;
					color *= pulse;
				}

				// Moon desaturation effect - grayscale with slight brightness boost
				if (isMoon > 0.5) {
					float gray = dot(color, vec3(0.299, 0.587, 0.114));
					color = vec3(gray) * 1.15; // Slight brightness boost for moons
				}

				float finalAlpha = 1.0;

				// Holographic effect for default moon
				if (holographic > 0.5) {
					float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0);
					vec3 holoColor = vec3(0.4, 0.8, 1.0); // Cyan-blue

					float scanline = sin(fragPosition.y * 200.0) * 0.5 + 0.5;
					scanline = smoothstep(0.9, 1.0, scanline);

					float noise = fract(
						sin(dot(fragPosition.xy + time * 0.1, vec2(12.9898, 78.233))) * 43758.5453
					);
					noise = smoothstep(0.8, 1.0, noise);

					color = holoColor;
					finalAlpha = (fresnel * 0.8 + scanline * 0.2 + noise * 0.1) * 0.7;
				}

				gl_FragColor = vec4(color, finalAlpha);
			}
		`.replace('void main() {', `${noiseFunctions}\nvoid main() {`);

	// Planet parameters based on quality settings
	const planetDetail = $derived.by(() => {
		switch (settingsState.graphics.quality) {
			case 'low':
				return 64; // Lower subdivisions for performance
			case 'mid':
				return 96; // Standard quality
			case 'high':
				return 128; // High detail (original)
			default:
				return 96;
		}
	});

	const terrainOctaves = $derived.by(() => {
		switch (settingsState.graphics.quality) {
			case 'low':
				return 6; // Fewer octaves
			case 'mid':
				return 8; // Standard
			case 'high':
				return 10; // More detail (original)
			default:
				return 8;
		}
	});

	const terrainType = $derived.by(() => {
		switch (settingsState.graphics.quality) {
			case 'low':
				return 2; // Fewer octaves
			case 'mid':
				return 2; // Standard
			case 'high':
				return 3; // More detail (original)
			default:
				return 2;
		}
	});

	// Quality-based lighting - current values are for high quality
	const lightingIntensity = $derived.by(() => {
		switch (settingsState.graphics.quality) {
			case 'low':
				return {
					ambient: 0.0, // Lower ambient
					diffuse: 0.9, // Reduced diffuse
					specular: 0.0 // Keep specular off
				};
			case 'mid':
				return {
					ambient: 0.0, // Mid ambient
					diffuse: 0.27, // Mid diffuse
					specular: 0.0 // Keep specular off
				};
			case 'high':
				return {
					ambient: 0.0, // Current values
					diffuse: 0.36, // Current values
					specular: 0.0 // Current values
				};
			default:
				return {
					ambient: 0.0,
					diffuse: 0.27,
					specular: 0.0
				};
		}
	});

	// Create planet geometry function - use SphereGeometry like original
	const createPlanetGeometry = (widthSegments: number, heightSegments: number) => {
		const geometry = new THREE.SphereGeometry(1, widthSegments, heightSegments);
		// Use Three.js built-in tangent computation like the original
		geometry.computeTangents();
		return geometry;
	};

	const generatePlanetColors = $derived.by(() => {
		// Get colors from centralized system
		return getPlanetColors(avgTemp, planetSeed);
	});

	// Generate terrain parameters with seeded variation
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

	// Original planet parameters from the GitHub repo - with centralized caching
	// Cache stores only static values, uniforms are rebuilt fresh to avoid reference issues
	const planetUniforms = $derived.by(() => {
		const cacheKey = createPlanetCacheKey(
			planetId,
			fieldsMax,
			temperatureMin,
			temperatureMax,
			settingsState.graphics.quality
		);

		// Get cached values (without value wrappers)
		const cachedValues = planetUniformsCache.getOrSet(cacheKey, () => {
			return {
				// Terrain parameters (from original with variations)
				type: terrainType,
				radius: 20.0,
				amplitude: terrainParams.amplitude,
				sharpness: terrainParams.sharpness,
				offset: -0.016,
				period: terrainParams.period,
				persistence: 0.484,
				lacunarity: 1.8,
				octaves: terrainOctaves,
				noiseSeed: planetSeed / 1000000, // Normalize seed to reasonable range

				// Generated layer colors based on temperature and planet ID
				color1: generatePlanetColors.color1,
				color2: generatePlanetColors.color2,
				color3: generatePlanetColors.color3,
				color4: generatePlanetColors.color4,
				color5: generatePlanetColors.color5,

				// Original transition points
				transition2: 0.021,
				transition3: 0.15,
				transition4: 0.72,
				transition5: 1.2,

				// Tighten the water-to-sand transition (blend12/23)
				// but keep the sand-to-grass (34/45) soft.
				blend12: 0.04, // Sharper "wet" edge
				blend23: 0.08, // Transition to beach
				blend34: 0.18, // Soft transition to vegetation
				blend45: 0.25, // Very soft mountain blend

				// Original bump mapping
				bumpStrength: 1.0,
				bumpOffset: 0.001,

				// Quality-based lighting
				ambientIntensity: lightingIntensity.ambient,
				diffuseIntensity: lightingIntensity.diffuse,
				specularIntensity: lightingIntensity.specular,
				shininess: 0.1,
				lightDirection: new THREE.Vector3(-9, 45, 0).clone(),
				lightColor: new THREE.Color(0xfce5cd).clone()
			};
		});

		// Rebuild uniform objects from cached values with fresh wrappers
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
			// Dynamic uniforms (updated per frame) - always fresh
			glitchIntensity: { value: 0.0 },
			time: { value: 0.0 },
			isMoon: { value: celestialType === 'Moon' ? 1.0 : 0.0 },
			holographic: { value: holographic ? 1.0 : 0.0 }
		};
	});

	// Planet geometry (derived) - use same dimensions for both width and height segments - with centralized caching
	const planetGeometry = $derived.by(() => {
		const cacheKey = createPlanetCacheKey(
			planetId,
			fieldsMax,
			temperatureMin,
			temperatureMax,
			settingsState.graphics.quality
		);

		return planetGeometryCache.getOrSet(cacheKey, () => {
			return createPlanetGeometry(planetDetail, planetDetail);
		});
	});

	// Planet material (derived) - NOT cached because it needs fresh uniforms reference
	const planetMaterial = $derived.by(() => {
		// Materials need fresh uniforms reference, so we create them fresh each time
		return new THREE.ShaderMaterial({
			uniforms: planetUniforms,
			vertexShader,
			fragmentShader,
			side: THREE.FrontSide,
			transparent: true
		});
	});

	// Update glitch uniforms and opacity
	useTask((delta) => {
		if (planetMaterial && planetMaterial instanceof THREE.ShaderMaterial) {
			planetMaterial.uniforms.glitchIntensity.value = glitchIntensity.current;
			planetMaterial.uniforms.time.value += delta;
			planetMaterial.opacity = planetOpacity.current;
		}
	});

	// Note: Geometry is managed by centralized cache system
	// Note: Material is recreated on every reactive update (acceptable tradeoff for simplicity)
</script>

<!-- Planet Mesh -->
<Float
	rotation.y={rotation + planetRotationYOffset.current}
	floatIntensity={0.18}
	userData={{ hideInTree: true, selectable: false }}
>
	<!-- Planet with glitch shader effect -->
	<T.Mesh
		geometry={planetGeometry}
		material={planetMaterial}
		scale={[
			(planetBaseScale?.current ?? planetScale) * planetScaleAnim.current * (isBackdrop ? 0.5 : 1),
			(planetBaseScale?.current ?? planetScale) * planetScaleAnim.current * (isBackdrop ? 0.5 : 1),
			(planetBaseScale?.current ?? planetScale) * planetScaleAnim.current * (isBackdrop ? 0.5 : 1)
		]}
		userData={{ hideInTree: true, selectable: false }}
	/>

	<PositionalAudio
		src={swoosh}
		volume={0.18}
		playbackRate={1.8}
		refDistance={5}
		rolloffFactor={2}
		maxDistance={50}
		oncreate={handleAudioCreate}
	/>

	<PositionalAudio
		src={scan}
		volume={4.5}
		playbackRate={2.7}
		refDistance={5}
		rolloffFactor={2}
		maxDistance={50}
		oncreate={handleScanAudioCreate}
	/>
</Float>

<!-- Orbital units (solar satellite, spy probe) and shield domes -->
<PlanetModels
	{isCurrent}
	{isBackdrop}
	{celestialType}
	{planetScale}
	scaleAnim={planetScaleAnim.current}
	opacityAnim={planetOpacity.current}
	planetRotationY={rotation + planetRotationYOffset.current}
/>
