// The two vendored noise PNGs, loaded once for the whole scene.
//
// SkidMarks, TireSmoke and CarExhaustFlames all sample the same
// `public/textures/noises/{perlin,voronoi}.png`, and each used to construct its
// own `TextureLoader` and its own `THREE.Texture` — five fetches and five GPU
// textures for two files, and five separate `dispose()` calls racing each other
// on scene exit. This is the scene-local version of the texture cache
// DOCS/best-practices.md §3.3 describes; it stays here rather than in `core/`
// because TestGame is not engine architecture (see this scene's CLAUDE.md).
//
// NOTHING DISPOSES THESE. A shared texture must never be `dispose()`d by an
// individual component's cleanup (§3.3's own caveat) — the next mount would get
// a disposed texture. Two small PNGs held for the session is the correct trade,
// and it is the same one `useGltf`'s module-side cache already makes.

import * as THREE from 'three/webgpu';
import { BASE_URL } from '$extensions/settings';

const cache = new Map<string, THREE.Texture>();

/**
 * A repeat-wrapped noise texture from `public/textures/noises/`. Returns
 * synchronously and fills in when the PNG lands — pass `onLoad` (an
 * `invalidate`) so the first frame after the decode is drawn.
 */
function noiseTexture(file: string, onLoad?: () => void): THREE.Texture {
	const cached = cache.get(file);
	if (cached) {
		// Already decoded: the caller's frame is already correct, so no invalidate
		// is owed. Still in flight: the FIRST caller's onLoad covers everyone.
		return cached;
	}
	const tex = new THREE.TextureLoader().load(`${BASE_URL}textures/noises/${file}`, () =>
		onLoad?.()
	);
	tex.wrapS = THREE.RepeatWrapping;
	tex.wrapT = THREE.RepeatWrapping;
	cache.set(file, tex);
	return tex;
}

/** Perlin — the roil/mottle source (smoke evolution, skid-mark grain). */
export const perlinNoise = (onLoad?: () => void) => noiseTexture('perlin.png', onLoad);

/** Voronoi — the clump/cell source (smoke blobs, flame cells). */
export const voronoiNoise = (onLoad?: () => void) => noiseTexture('voronoi.png', onLoad);
