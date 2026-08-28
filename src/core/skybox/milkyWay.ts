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
