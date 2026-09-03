// LUT assets for the `lut` effect — the only effect with an asset dependency (see
// the "LUTs" section of CLAUDE.md). The set is three's own: the nine LUTs from
// webgpu_postprocessing_3dlut, copied verbatim into `public/luts/`, filenames kept
// as three ships them so the sets stay diffable. Credits: RocketStock (the `.CUBE`
// grades) and FreePresets.com (Presetpro-Cinematic).
//
// A `.svelte.ts` module because the load is async while `EffectDef.build()` is
// synchronous: the effect builds as a no-op until its texture has landed, and the
// `$state` version counter is what rebuilds the graph once it has. Nothing here is
// read per frame.

import { LUTCubeLoader } from 'three/addons/loaders/LUTCubeLoader.js';
import { LUT3dlLoader } from 'three/addons/loaders/LUT3dlLoader.js';
import { LUTImageLoader } from 'three/addons/loaders/LUTImageLoader.js';
import type { Data3DTexture } from 'three/webgpu';
import { BASE_URL } from '$extensions/settings';
import { logPostprocessing } from '$extensions/logger';

export interface LutEntry {
	/** Stable index — this is what the effect stores as its `lut` param. Append only. */
	value: number;
	/** Panel label. */
	text: string;
	/** Filename under `public/luts/`. The extension picks the loader. */
	file: string;
}

/**
 * The shipped set, in the example's own order. Drop a `.cube` / `.3dl` / LUT `.png`
 * into `public/luts/` and append a row here to offer it — indices are persisted in
 * effect state, so add at the end rather than reordering.
 */
export const LUT_CATALOGUE: LutEntry[] = [
	{ value: 0, text: 'Neutral (identity)', file: 'NeutralLUT.png' },
	{ value: 1, text: 'Bourbon 64', file: 'Bourbon 64.CUBE' },
	{ value: 2, text: 'Chemical 168', file: 'Chemical 168.CUBE' },
	{ value: 3, text: 'Clayton 33', file: 'Clayton 33.CUBE' },
	{ value: 4, text: 'Cubicle 99', file: 'Cubicle 99.CUBE' },
	{ value: 5, text: 'Remy 24', file: 'Remy 24.CUBE' },
	{ value: 6, text: 'Presetpro Cinematic', file: 'Presetpro-Cinematic.3dl' },
	{ value: 7, text: 'Black & White', file: 'B&WLUT.png' },
	{ value: 8, text: 'Night', file: 'NightLUT.png' }
];

type LoadState = 'loading' | 'ready' | 'failed';

const textures = new Map<number, Data3DTexture>();
const states = new Map<number, LoadState>();

/**
 * Bumped whenever a load completes. The `lut` effect returns it from `structuralTag`,
 * so the graph rebuilds exactly once per texture that arrives — no polling, and no
 * per-frame reactive read.
 */
export const lutState = $state({ version: 0 });

/** The loaded texture for a catalogue index, or undefined if it is not ready yet. */
export const getLutTexture = (index: number): Data3DTexture | undefined => textures.get(index);

/**
 * All three loaders return `{ texture3D }` with the cube's edge length in
 * `image.width`; only the parser varies. `.png` LUTs are horizontal strips, not
 * sampled images — hence a dedicated loader rather than a TextureLoader.
 */
const loaderFor = (file: string) => {
	if (/\.cube$/i.test(file)) return new LUTCubeLoader();
	if (/\.3dl$/i.test(file)) return new LUT3dlLoader();
	return new LUTImageLoader();
};

/**
 * Start loading a catalogue entry if it has not been started already. Safe to call
 * from `build()` — it never throws, and a failed load degrades to no grading rather
 * than taking the pipeline's fallback path.
 */
export const ensureLutLoaded = (index: number): void => {
	const entry = LUT_CATALOGUE.find((e) => e.value === index);
	if (!entry) return;
	if (states.get(index) !== undefined) return;

	states.set(index, 'loading');
	// Encoded because three's filenames carry spaces and an ampersand ('Bourbon 64.CUBE',
	// 'B&WLUT.png'), kept as-is so this set stays diffable against the example.
	const url = `${BASE_URL}luts/${encodeURIComponent(entry.file)}`;
	loaderFor(entry.file)
		.loadAsync(url)
		.then(
			(result: { texture3D: unknown }) => {
				textures.set(index, result.texture3D as Data3DTexture);
				states.set(index, 'ready');
				lutState.version++;
				logPostprocessing.info(`LUT loaded: ${entry.text}`);
			},
			(error: unknown) => {
				states.set(index, 'failed');
				logPostprocessing.error(`LUT failed to load (${entry.file}):`, error);
			}
		);
};
