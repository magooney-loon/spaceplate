// The Milky Way band, defined once because two components have to agree on it:
// Stars.svelte concentrates star density along it, and Nebula.svelte lays the
// unresolved glow of all those too-faint stars into the smoke. If the two ever
// drift apart, the band of stars and the band of light separate and the illusion
// collapses.
//
// The band's great circle is the set of directions where dot(dir, normal) ~ 0.
// `sigma` is the Gaussian falloff off the plane, in radians.

const RAW_NORMAL: [number, number, number] = [0.42, 0.58, -0.7];
const LEN = Math.hypot(RAW_NORMAL[0], RAW_NORMAL[1], RAW_NORMAL[2]);

export const MILKY_WAY_NORMAL: [number, number, number] = [
	RAW_NORMAL[0] / LEN,
	RAW_NORMAL[1] / LEN,
	RAW_NORMAL[2] / LEN
];

/** ~10 deg to half density -- roughly the visual width of the real thing. */
export const MILKY_WAY_SIGMA = 0.17;

// Direction of the galactic bulge -- the swell in Sagittarius. The real Milky Way is
// strongly ASYMMETRIC: one side of the band is a broad, warm, obviously-structured
// glow, the far side a thin cold thread you have to look for. A band of even width and
// even brightness all the way round is the single clearest tell that a sky was
// generated, so both consumers weight themselves toward this direction.
//
// Authored by eye, then Gram-Schmidt'd against the normal below: the bulge has to lie
// IN the band plane, and eyeballed numbers never quite do.
const RAW_CORE: [number, number, number] = [-0.9, 0.25, -0.35];

const CORE_DOT =
	RAW_CORE[0] * MILKY_WAY_NORMAL[0] +
	RAW_CORE[1] * MILKY_WAY_NORMAL[1] +
	RAW_CORE[2] * MILKY_WAY_NORMAL[2];

const CORE_IN_PLANE: [number, number, number] = [
	RAW_CORE[0] - CORE_DOT * MILKY_WAY_NORMAL[0],
	RAW_CORE[1] - CORE_DOT * MILKY_WAY_NORMAL[1],
	RAW_CORE[2] - CORE_DOT * MILKY_WAY_NORMAL[2]
];

const CORE_LEN = Math.hypot(...CORE_IN_PLANE);

export const MILKY_WAY_CORE: [number, number, number] = [
	CORE_IN_PLANE[0] / CORE_LEN,
	CORE_IN_PLANE[1] / CORE_LEN,
	CORE_IN_PLANE[2] / CORE_LEN
];
