// The Milky Way band shared by Stars.svelte and Nebula.svelte — see ../CLAUDE.md.
// The band's great circle is the set of directions where dot(dir, normal) ~ 0.

const RAW_NORMAL: [number, number, number] = [0.42, 0.58, -0.7];
const LEN = Math.hypot(RAW_NORMAL[0], RAW_NORMAL[1], RAW_NORMAL[2]);

export const MILKY_WAY_NORMAL: [number, number, number] = [
	RAW_NORMAL[0] / LEN,
	RAW_NORMAL[1] / LEN,
	RAW_NORMAL[2] / LEN
];

/** Gaussian falloff off the band plane, in radians. ~10 deg to half density. */
export const MILKY_WAY_SIGMA = 0.17;

// Direction of the galactic bulge (the swell in Sagittarius) — see ../CLAUDE.md on why
// the band is asymmetric. Authored by eye, then Gram-Schmidt'd against the normal below:
// the bulge has to lie IN the band plane, and eyeballed numbers never quite do.
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
