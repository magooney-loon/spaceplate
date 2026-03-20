/**
 * Procedural Planet Generation System
 *
 * Shared utilities for generating consistent planet visuals across:
 * - 3D Planet rendering (Planet.svelte)
 * - 2D Planet icons (PlanetIcon.svelte)
 * - Atmospheric nebula clouds (Skybox.svelte)
 *
 * All use the same seeded random system to ensure matching variants
 */

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Hash a string to a consistent number seed
 */
export function hashCode(str: string): number {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash = hash & hash; // Convert to 32bit integer
	}
	return Math.abs(hash);
}

/**
 * Seeded random number generator (0-1 range)
 */
export function seededRandom(seed: number): number {
	const x = Math.sin(seed) * 10000;
	return x - Math.floor(x);
}

// ============================================================================
// PLANET COLOR VARIANTS (24 Total)
// ============================================================================

export interface PlanetColors {
	color1: string; // Deepest/Ocean
	color2: string; // Low elevation
	color3: string; // Mid elevation
	color4: string; // High elevation
	color5: string; // Peaks/Mountains
}

export interface AtmosphericColors {
	colors: string[]; // 6 nebula/cloud colors
}

/**
 * Get the planet variant index based on temperature and seed
 */
export function getPlanetVariantIndex(
	temperature: number,
	seed: number
): {
	biome: 'scorched' | 'arid' | 'lush' | 'cool' | 'frozen';
	variantIndex: number;
	totalVariants: number;
} {
	const r = (offset: number) => seededRandom(seed * offset);

	if (temperature >= 70) {
		return { biome: 'scorched', variantIndex: Math.floor(r(1.0) * 4), totalVariants: 4 };
	} else if (temperature >= 40) {
		return { biome: 'arid', variantIndex: Math.floor(r(2.0) * 5), totalVariants: 5 };
	} else if (temperature >= 10) {
		return { biome: 'lush', variantIndex: Math.floor(r(3.0) * 6), totalVariants: 6 };
	} else if (temperature >= -20) {
		return { biome: 'cool', variantIndex: Math.floor(r(4.0) * 4), totalVariants: 4 };
	} else {
		return { biome: 'frozen', variantIndex: Math.floor(r(5.0) * 5), totalVariants: 5 };
	}
}

/**
 * Get surface colors for a planet variant
 */
export function getPlanetSurfaceColors(temperature: number, seed: number): PlanetColors {
	const variant = getPlanetVariantIndex(temperature, seed);

	if (variant.biome === 'scorched') {
		const colors: PlanetColors[] = [
			// Classic Volcanic - matches PlanetIcon.svelte order
			{
				color1: '#e8d4b9',
				color2: '#d19a66',
				color3: '#a35d36',
				color4: '#6b3e23',
				color5: '#1a0a05'
			},
			// Hellscape
			{
				color1: '#ffa07a',
				color2: '#ff6347',
				color3: '#ff4500',
				color4: '#8b0000',
				color5: '#330000'
			},
			// Toxic Wasteland
			{
				color1: '#ffff99',
				color2: '#d4d45f',
				color3: '#a8a82b',
				color4: '#4a4a1c',
				color5: '#1a1506'
			},
			// Ember World
			{
				color1: '#ffd8b8',
				color2: '#ff8c42',
				color3: '#d4692f',
				color4: '#6b3e23',
				color5: '#1a0a05'
			}
		];
		return colors[variant.variantIndex];
	} else if (variant.biome === 'arid') {
		const colors: PlanetColors[] = [
			// Classic Desert - warm sandy/tan tones only
			{
				color1: '#d2b48c', // Tan base
				color2: '#daa520', // Goldenrod
				color3: '#f4a460', // Sandy brown
				color4: '#cd853f', // Peru
				color5: '#8b4513' // Saddle brown
			},
			// Red Mars
			{
				color1: '#f4a460',
				color2: '#d2691e',
				color3: '#cd7f32',
				color4: '#6b3410',
				color5: '#3d2817'
			},
			// Terracotta Desert - orange/red clay
			{
				color1: '#e07020', // Terra cotta
				color2: '#d2691e', // Chocolate
				color3: '#cd5c5c', // Indian red
				color4: '#a0522d', // Sienna
				color5: '#654321' // Dark brown
			},
			// Rocky Badlands
			{
				color1: '#C0C0C0',
				color2: '#A9A9A9',
				color3: '#8B4513',
				color4: '#5D4037',
				color5: '#3E2723'
			},
			// Golden Savanna
			{
				color1: '#fff8dc',
				color2: '#ffd700',
				color3: '#daa520',
				color4: '#8b7355',
				color5: '#3d2f1f'
			}
		];
		return colors[variant.variantIndex];
	} else if (variant.biome === 'lush') {
		const colors: PlanetColors[] = [
			// Classic Earth - matches PlanetIcon.svelte order
			{
				color1: '#77b05d',
				color2: '#469d44',
				color3: '#87ceeb',
				color4: '#2d5a27',
				color5: '#0a1f3d'
			},
			// Tropical Paradise
			{
				color1: '#cddc39',
				color2: '#8bc34a',
				color3: '#4caf50',
				color4: '#00bcd4',
				color5: '#003d5c'
			},
			// Autumn World
			{
				color1: '#ffa500',
				color2: '#ff8c00',
				color3: '#cd853f',
				color4: '#8b4513',
				color5: '#1a3c40'
			},
			// Alien Jungle
			{
				color1: '#d1ffbd',
				color2: '#90f990',
				color3: '#50c878',
				color4: '#007a33',
				color5: '#004d20'
			},
			// Savanna
			{
				color1: '#d2b48c',
				color2: '#8fbc8f',
				color3: '#9acd32',
				color4: '#556b2f',
				color5: '#2c5530'
			},
			// Cyan Oasis
			{
				color1: '#e0ffff',
				color2: '#7fffd4',
				color3: '#00ced1',
				color4: '#006994',
				color5: '#001a33'
			}
		];
		return colors[variant.variantIndex];
	} else if (variant.biome === 'cool') {
		const colors: PlanetColors[] = [
			// Classic Tundra - matches PlanetIcon.svelte order
			{
				color1: '#78a1bb',
				color2: '#6497b1',
				color3: '#b3cde0',
				color4: '#4a7c91',
				color5: '#1a3c4a'
			},
			// Boreal Forest
			{
				color1: '#f0f8ff',
				color2: '#708090',
				color3: '#2e5e3e',
				color4: '#2f4f4f',
				color5: '#0d2818'
			},
			// Permafrost
			{
				color1: '#e6e6fa',
				color2: '#b8b8d1',
				color3: '#8da9c4',
				color4: '#4b4a7a',
				color5: '#1a1a3e'
			},
			// Stormy World
			{
				color1: '#f5f5f5',
				color2: '#b0c4de',
				color3: '#778899',
				color4: '#404040',
				color5: '#1c1c1c'
			}
		];
		return colors[variant.variantIndex];
	} else {
		// frozen - matches PlanetIcon.svelte order
		const colors: PlanetColors[] = [
			// Classic Ice
			{
				color1: '#ffffff',
				color2: '#a2c4e0',
				color3: '#e2ebf0',
				color4: '#5f7894',
				color5: '#2d4059'
			},
			// Methane Ice
			{
				color1: '#f0ffff',
				color2: '#e0ffff',
				color3: '#b0e0e6',
				color4: '#3d5c6b',
				color5: '#1a2f3a'
			},
			// Dark Ice
			{
				color1: '#87ceeb',
				color2: '#4682b4',
				color3: '#2f4f7f',
				color4: '#1e1e3f',
				color5: '#0a0a1a'
			},
			// Ammonia Ice
			{
				color1: '#ffffff',
				color2: '#fffff0',
				color3: '#fffacd',
				color4: '#6b6b54',
				color5: '#3a3a2f'
			},
			// Crystal World
			{
				color1: '#fff5ff',
				color2: '#f8e6f8',
				color3: '#dda0dd',
				color4: '#5d3a5f',
				color5: '#2d1b2e'
			}
		];
		return colors[variant.variantIndex];
	}
}

import * as THREE from 'three';

/**
 * Get surface colors for a planet variant, with HSL randomization.
 * This is the centralized function used by both 3D planets and 2D icons.
 */
export function getPlanetColors(
	temperature: number,
	seed: number
): {
	color1: THREE.Color;
	color2: THREE.Color;
	color3: THREE.Color;
	color4: THREE.Color;
	color5: THREE.Color;
} {
	const surfaceColors = getPlanetSurfaceColors(temperature, seed);
	const r = (offset: number) => seededRandom(seed * offset);

	const createCol = (hex: string, s: number) => {
		const c = new THREE.Color(hex);
		c.offsetHSL((r(s) - 0.5) * 0.05, (r(s + 1) - 0.5) * 0.1, (r(s + 2) - 0.5) * 0.05);
		return c;
	};

	return {
		color1: createCol(surfaceColors.color1, 1.1),
		color2: createCol(surfaceColors.color2, 1.2),
		color3: createCol(surfaceColors.color3, 1.3),
		color4: createCol(surfaceColors.color4, 1.4),
		color5: createCol(surfaceColors.color5, 1.5)
	};
}

/**
 * Get atmospheric/nebula colors for a planet variant
 * Returns 6 colors for cloud particles
 */
export function getPlanetAtmosphericColors(temperature: number, seed: number): AtmosphericColors {
	const variant = getPlanetVariantIndex(temperature, seed);

	if (variant.biome === 'scorched') {
		const colorSets: string[][] = [
			// Classic Volcanic - rich volcanic tones
			[
				'#4a2f1e',
				'#6b3e23',
				'#8b5a3c',
				'#a35d36',
				'#b8806a',
				'#d19a66',
				'#d4a574',
				'#e8d4b9',
				'#e8c8b0',
				'#ffb088',
				'#ffcc99',
				'#fff0e6'
			],
			// Hellscape - intense heat gradients
			[
				'#5a0000',
				'#8b0000',
				'#cc3300',
				'#ff4500',
				'#ff6347',
				'#ff7f50',
				'#ff9975',
				'#ffa07a',
				'#ffb088',
				'#ffb347',
				'#ffccaa',
				'#ffddcc'
			],
			// Toxic Wasteland - sulfurous haze
			[
				'#2d2d0d',
				'#4a4a1c',
				'#6b6b2a',
				'#a8a82b',
				'#c8c870',
				'#d4d45f',
				'#e0e078',
				'#e6e685',
				'#f0f09a',
				'#f5f5a0',
				'#ffff99',
				'#ffffd0'
			],
			// Ember World - glowing embers
			[
				'#3d1e3e',
				'#5e3a5f',
				'#8b455a',
				'#a84a5a',
				'#d4692f',
				'#e07840',
				'#ff8c42',
				'#ff9977',
				'#ffb366',
				'#ffccaa',
				'#ffd8b8',
				'#ffe8d6'
			]
		];
		return { colors: colorSets[variant.variantIndex] };
	} else if (variant.biome === 'arid') {
		const colorSets: string[][] = [
			// Classic Desert - rich sandy sunset tones
			[
				'#654321',
				'#8b4513',
				'#a0522d',
				'#cd853f',
				'#d4a574',
				'#daa520',
				'#deb887',
				'#eecfa1',
				'#f0e68c',
				'#f4a460',
				'#ffd0a0',
				'#ffd8b1'
			],
			// Red Mars - rusty Martian atmosphere
			[
				'#3d2817',
				'#6b3410',
				'#8b4513',
				'#a0522d',
				'#cd7f32',
				'#d2691e',
				'#e08840',
				'#f4a460',
				'#ff7f50',
				'#ff9050',
				'#ffa500',
				'#ffa07a'
			],
			// Terracotta Desert - vibrant clay sunset
			[
				'#4a2f1e',
				'#654321',
				'#a0522d',
				'#c86030',
				'#d2691e',
				'#e07020',
				'#e88c30',
				'#ff8c42',
				'#ff9966',
				'#ffa07a',
				'#ffb088',
				'#ffb366'
			],
			// Purple Badlands - alien desert dusk
			[
				'#2e1a47',
				'#5d3a7a',
				'#6b4e8a',
				'#8b6b9b',
				'#9370db',
				'#a855c8',
				'#ba55d3',
				'#c890dc',
				'#dda0dd',
				'#e8c0f0',
				'#e8d0f0',
				'#f5e6fa'
			],
			// Golden Savanna - golden hour atmosphere
			[
				'#3d2f1f',
				'#8b7355',
				'#b8860b',
				'#daa520',
				'#eeb830',
				'#ffd700',
				'#ffda50',
				'#ffec8b',
				'#fff5ba',
				'#ffe082',
				'#fff8dc',
				'#ffffe0'
			]
		];
		return { colors: colorSets[variant.variantIndex] };
	} else if (variant.biome === 'lush') {
		const colorSets: string[][] = [
			// Classic Earth - vibrant terrestrial atmosphere
			[
				'#0a1f3d',
				'#2d5a27',
				'#469d44',
				'#5c9d88',
				'#6bb880',
				'#77b05d',
				'#87ceeb',
				'#98d4cc',
				'#a0d6b4',
				'#b0e0e6',
				'#c4e0e8',
				'#d0f0e0'
			],
			// Tropical Paradise - exotic island paradise
			[
				'#003d5c',
				'#006994',
				'#0088aa',
				'#00bcd4',
				'#00ced1',
				'#2dd4a8',
				'#4caf50',
				'#6bc460',
				'#7cc898',
				'#8bc34a',
				'#a8d450',
				'#cddc39'
			],
			// Autumn World - rich fall foliage sky
			[
				'#1a3c40',
				'#8b4513',
				'#cd853f',
				'#d0954e',
				'#e07018',
				'#ff8c00',
				'#ff9f00',
				'#ffa500',
				'#ffb400',
				'#ffb347',
				'#ffc107',
				'#ffd4a3'
			],
			// Alien Jungle - bioluminescent alien world
			[
				'#1e1e3f',
				'#4a235a',
				'#6b2d6b',
				'#8e44ad',
				'#a855c8',
				'#b077c3',
				'#c39bd3',
				'#d4a5d9',
				'#e8d5f0',
				'#f0c5e8',
				'#f8b4d9',
				'#ffcce0'
			],
			// Savanna - African golden plains
			[
				'#2c5530',
				'#556b2f',
				'#6b8e23',
				'#7fb050',
				'#8fbc8f',
				'#9acd32',
				'#a8b478',
				'#c4d8a0',
				'#d2b48c',
				'#d4c4a8',
				'#e8d8c8',
				'#deb887'
			],
			// Cyan Oasis - mystical cyan lagoon
			[
				'#001a33',
				'#003366',
				'#005580',
				'#006994',
				'#0088aa',
				'#00aacc',
				'#00ced1',
				'#40dcd4',
				'#7fffd4',
				'#a0f0f0',
				'#c4f0f0',
				'#e0ffff'
			]
		];
		return { colors: colorSets[variant.variantIndex] };
	} else if (variant.biome === 'cool') {
		const colorSets: string[][] = [
			// Classic Tundra - arctic twilight
			[
				'#1a3c4a',
				'#2d5a5a',
				'#4a7c91',
				'#5f8a9b',
				'#6497b1',
				'#7090a8',
				'#78a1bb',
				'#88a8b8',
				'#98b8c8',
				'#a8c8d8',
				'#b3cde0',
				'#c8d8e8'
			],
			// Boreal Forest - northern aurora
			[
				'#0d2818',
				'#2e5e3e',
				'#2f4f4f',
				'#4c7a60',
				'#5c8a70',
				'#6c8070',
				'#708090',
				'#88a098',
				'#98b0a8',
				'#a8c0a8',
				'#c0d8c8',
				'#f0f8ff'
			],
			// Permafrost - ethereal polar ice
			[
				'#1a1a3e',
				'#2d2d5e',
				'#4b4a7a',
				'#6b6b8a',
				'#8088a0',
				'#8da9c4',
				'#a098c8',
				'#b0b0d0',
				'#b8b8d1',
				'#c8d8e8',
				'#d8e8f0',
				'#e6e6fa'
			],
			// Stormy World - tempestuous atmosphere
			[
				'#1c1c1c',
				'#404040',
				'#5c5c5c',
				'#707880',
				'#778899',
				'#8898a8',
				'#98a8b8',
				'#a8b8c8',
				'#b0c4de',
				'#d0e0e8',
				'#e0f0f0',
				'#f5f5f5'
			]
		];
		return { colors: colorSets[variant.variantIndex] };
	} else {
		// frozen - glacial wonderlands
		const colorSets: string[][] = [
			// Classic Ice - pristine arctic
			[
				'#2d4059',
				'#5f7894',
				'#7a9bb8',
				'#a2c4e0',
				'#b8d0e8',
				'#c8e0f0',
				'#d4e8f4',
				'#e0f0f8',
				'#e8f4fc',
				'#eef4f8',
				'#f2f8fc',
				'#ffffff'
			],
			// Methane Ice - exotic blue-green
			[
				'#1a2f3a',
				'#3d5c6b',
				'#5c7a8a',
				'#7a99aa',
				'#90b0c0',
				'#a8c8d8',
				'#b0e0e6',
				'#c8e8ec',
				'#d8f8f0',
				'#e0ffff',
				'#f0ffff',
				'#fffffa'
			],
			// Dark Ice - mysterious deep space
			[
				'#0a0a1a',
				'#1e1e3f',
				'#2f4f7f',
				'#3d6b9b',
				'#4682b4',
				'#5c7ca8',
				'#6b8eb8',
				'#7aa0c8',
				'#88b0d8',
				'#98c0e0',
				'#a8d0f0',
				'#87ceeb'
			],
			// Ammonia Ice - soft cream atmosphere
			[
				'#3a3a2f',
				'#6b6b54',
				'#8a8a6a',
				'#a8a882',
				'#b8b890',
				'#c8c8a0',
				'#d8d8b8',
				'#e8e8d0',
				'#f0f0d8',
				'#f8f8e8',
				'#fffff0',
				'#ffffff'
			],
			// Crystal World - ethereal violet
			[
				'#2d1b2e',
				'#4a2a4b',
				'#5d3a5f',
				'#8b5a8b',
				'#a855c8',
				'#b077c3',
				'#c890d0',
				'#d8b0d8',
				'#dda0dd',
				'#e8c0e8',
				'#f0d0f8',
				'#fff5ff'
			]
		];
		return { colors: colorSets[variant.variantIndex] };
	}
}

/**
 * Get variant name for debugging/display
 */
export function getPlanetVariantName(temperature: number, seed: number): string {
	const variant = getPlanetVariantIndex(temperature, seed);

	const scorchedNames = ['Classic Volcanic', 'Hellscape', 'Toxic Wasteland', 'Ember World'];
	const aridNames = [
		'Classic Desert',
		'Red Mars',
		'Terracotta Desert',
		'Rocky Badlands',
		'Golden Savanna'
	];
	const lushNames = [
		'Classic Earth',
		'Tropical Paradise',
		'Autumn World',
		'Alien Jungle',
		'Savanna',
		'Cyan Oasis'
	];
	const coolNames = ['Classic Tundra', 'Boreal Forest', 'Permafrost', 'Stormy World'];
	const frozenNames = ['Classic Ice', 'Methane Ice', 'Dark Ice', 'Ammonia Ice', 'Crystal World'];

	if (variant.biome === 'scorched') return scorchedNames[variant.variantIndex];
	if (variant.biome === 'arid') return aridNames[variant.variantIndex];
	if (variant.biome === 'lush') return lushNames[variant.variantIndex];
	if (variant.biome === 'cool') return coolNames[variant.variantIndex];
	return frozenNames[variant.variantIndex];
}
