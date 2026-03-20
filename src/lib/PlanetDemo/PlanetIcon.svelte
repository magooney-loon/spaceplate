<script lang="ts">
	interface Props {
		temperature?: number;
		size?: number;
		planetId?: string;
		class?: string;
		celestialType?: 'Planet' | 'Moon';
		getSvgDataUri?: (uri: string) => void;
	}

	let {
		temperature = 20,
		size = 48,
		planetId = '',
		class: className = '',
		celestialType = 'Planet',
		getSvgDataUri
	}: Props = $props();

	import { hashCode, getPlanetColors, seededRandom } from '$lib/game/utils/procedural.svelte.js';
	import { planetIconCache, createPlanetIconCacheKey } from '$lib/game/utils/cache.svelte.js';
	import { settingsState } from '$lib/settings/settings.svelte.js';
	import { highlightOnChange } from '$lib/game/utils/attachments';

	const planetSvg = $derived.by(() => {
		const cacheKey = createPlanetIconCacheKey(
			planetId,
			temperature,
			size,
			settingsState.graphics.quality
		);

		// Use centralized cache with getOrSet pattern
		return planetIconCache.getOrSet(cacheKey, () => {
			const idSeed = planetId ? hashCode(planetId) : Math.floor(Math.random() * 100000);
			const planetColors = getPlanetColors(temperature, idSeed);

			// For moons, use grayscale colors instead of planet colors
			const colors =
				celestialType === 'Moon'
					? [
							'rgb(200, 200, 200)', // Light gray
							'rgb(180, 180, 180)', // Medium-light gray
							'rgb(160, 160, 160)', // Medium gray
							'rgb(140, 140, 140)', // Medium-dark gray
							'rgb(220, 220, 220)' // Very light gray
						]
					: [
							planetColors.color1.getStyle(),
							planetColors.color2.getStyle(),
							planetColors.color3.getStyle(),
							planetColors.color4.getStyle(),
							planetColors.color5.getStyle()
						];
			const idSuffix = planetId ? `_${planetId}` : `_${idSeed}`;

			const center = size / 2;
			const r = size * 0.45;

			// Scale turbulence frequency inversely with size to maintain consistent noise pattern
			const referenceSize = 48;
			const sizeScale = referenceSize / size;
			const baseFreq = (0.02 + (idSeed % 30) / 1000) * sizeScale;

			// Adjust turbulence complexity based on icon size to prevent render issues on mobile
			const isHighQuality = settingsState.graphics.quality === 'high';
			let octaves1, octaves2;

			if (size < 48) {
				// Lower detail for small icons
				octaves1 = isHighQuality ? 3 : 2;
				octaves2 = isHighQuality ? 2 : 1;
			} else if (size < 96) {
				// Medium detail
				octaves1 = isHighQuality ? 4 : 3;
				octaves2 = isHighQuality ? 3 : 2;
			} else {
				// Full detail for large icons
				octaves1 = isHighQuality ? 5 : 3;
				octaves2 = isHighQuality ? 4 : 2;
			}

			// Generate random rotation speed based on planet seed (7.5s to 17.5s duration)
			const rotationSpeed = (180 + seededRandom(idSeed * 2.7)) / 2;

			// Random direction for rotation
			const directionMultiplier = isHighQuality ? 600 : 100;
			const direction = seededRandom(idSeed * 5.3) > 0.5 ? -directionMultiplier : 0;

			const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">
			<defs>
				<filter id="noise${idSuffix}" x="0%" y="0%" width="100%" height="100%">
					<feTurbulence
						type="fractalNoise"
						baseFrequency="${baseFreq}"
						numOctaves="${octaves1}"
						seed="${idSeed % 1000}"
						result="noise" />
					<feColorMatrix in="noise" type="matrix"
						values="1 0 0 0 0
						        0 1 0 0 0
								0 0 1 0 0
								0 0 0 1.5 -0.5" />
				</filter>

				<filter id="noise2${idSuffix}" x="0%" y="0%" width="100%" height="100%">
					<feTurbulence
						type="fractalNoise"
						baseFrequency="${baseFreq * 1.5}"
						numOctaves="${octaves2}"
						seed="${(idSeed + 500) % 1000}"
						result="noise" />
					<feColorMatrix in="noise" type="matrix"
						values="1 0 0 0 0
						        0 1 0 0 0
								0 0 1 0 0
								0 0 0 1.5 -0.5" />
				</filter>

				<radialGradient id="overLight${idSuffix}" cx="35%" cy="35%">
					<stop offset="0%" stop-color="white" stop-opacity="0.3" />
					<stop offset="50%" stop-color="black" stop-opacity="0" />
					<stop offset="100%" stop-color="black" stop-opacity="0.6" />
				</radialGradient>

				<clipPath id="circleClip${idSuffix}">
					<circle cx="${center}" cy="${center}" r="${r}" />
				</clipPath>
			</defs>

			<circle cx="${center}" cy="${center}" r="${r * 1.05}" fill="${colors[3]}" opacity="0.2" />

			<circle cx="${center}" cy="${center}" r="${r}" fill="${colors[3]}" />

			<style>
				${
					isHighQuality
						? `
				@keyframes planetRotate${idSuffix} {
					0% { transform: translateX(${direction === 0 ? 0 : -directionMultiplier}%); }
					50% { transform: translateX(${direction === 0 ? -directionMultiplier : 0}%); }
					100% { transform: translateX(${direction === 0 ? 0 : -directionMultiplier}%); }
				}
				.planet-surface {
					width: ${'800'}%;
					height: 100%;
					animation: planetRotate${idSuffix} ${rotationSpeed.toFixed(2)}s cubic-bezier(0.35, 0, 0.65, 1) infinite;
					will-change: transform;
				}
				`
						: ''
				}
			</style>

			<g clip-path="url(#circleClip${idSuffix})">
				<rect class="planet-surface${idSuffix}${
					isHighQuality ? ' planet-surface' : ''
				}" x="0" y="0" width="${isHighQuality ? 800 : 200}%" height="100%" fill="${
					colors[2]
				}" filter="url(#noise${idSuffix})" />

				<rect class="planet-surface${idSuffix}${
					isHighQuality ? ' planet-surface' : ''
				}" x="0" y="0" width="${isHighQuality ? 800 : 200}%" height="100%" fill="${
					colors[2]
				}" filter="url(#noise2${idSuffix})" style="mix-blend-mode: ${
					isHighQuality ? 'overlay' : 'screen'
				};" opacity="${isHighQuality ? 0.5 : 0.4}" />

				<rect class="planet-surface${idSuffix}${
					isHighQuality ? ' planet-surface' : ''
				}" x="0" y="0" width="${isHighQuality ? 800 : 200}%" height="100%" fill="${
					colors[2]
				}" filter="url(#noise${idSuffix})" style="mix-blend-mode: multiply;" opacity="${
					isHighQuality ? 0.2 : 0.15
				}" />

				<circle cx="${center}" cy="${center}" r="${r}" fill="url(#overLight${idSuffix})" />
			</g>

			<circle cx="${center}" cy="${center}" r="${r}" fill="none" stroke="white" stroke-width="0.5" opacity="0.2" />
		</svg>`;

			return svg;
		});
	});

	const dataUri = $derived(`data:image/svg+xml,${encodeURIComponent(planetSvg)}`);

	$effect(() => {
		if (getSvgDataUri) getSvgDataUri(dataUri);
	});
</script>

<img
	src={dataUri}
	alt="{celestialType === 'Moon' ? 'Moon' : 'Planet'} {planetId}"
	class="drop-shadow-2xl {celestialType === 'Moon' ? 'brightness-110' : 'saturate-150'} {className}"
	style="width: {size}px; height: {size}px;"
	{@attach highlightOnChange(temperature)}
/>
