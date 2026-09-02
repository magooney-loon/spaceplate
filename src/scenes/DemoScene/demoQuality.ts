// Per-quality settings for the demo scene, in one table.
//
// Consumers read `DEMO_QUALITY[settingsState.graphics.quality]` through a `$derived`,
// so flipping the preset in Settings ▸ General retunes the scene live. Everything here
// is a knob that costs real frame time; the engine-wide knob (device pixel ratio) lives
// in App.svelte, and the preset itself is seeded from the boot capability probe
// (extensions/settings, seedGraphicsQuality).
//
// What the expensive ones actually cost:
//
// - reflectionScale — the mirror floor renders the whole scene a second time, from the
//   mirrored camera, into a target sized `canvas × scale` (three's
//   ReflectorBaseNode._updateResolution). At 1 that is a second full-resolution scene
//   render every frame; at 0.3 it is ~9% of the pixels. Note this is per FRAME now, not
//   per render pass — the cube captures below take the reflector out of the graph while
//   they run (mirrorFloor.ts).
// - the cube captures — each one is six scene renders, so cost scales with
//   6 × size² × hz. Low turns the ball capture off entirely: the corner balls fall back
//   to scene.environment (the baked procedural sky), which is what they sampled before
//   the capture existed. The mirror sphere keeps its capture at every quality — it is
//   the centrepiece, and without it the sphere is a flat gray ball.

import type { QualityLevel } from '$extensions/settings';

export type DemoQuality = {
	/** `reflector()` resolutionScale for the mirror floor: 1 = full canvas resolution. */
	reflectionScale: number;
	/** false → no CubeCamera for the corner balls; they sample scene.environment instead. */
	ballCapture: boolean;
	/** Cube face size in px for the corner balls' shared capture. */
	ballCaptureSize: number;
	/** Refresh rate of that capture, Hz. */
	ballCaptureHz: number;
	/** Cube face size in px for the orbiting mirror sphere. */
	mirrorCaptureSize: number;
	/** Refresh rate of that capture, Hz. */
	mirrorCaptureHz: number;
	/** SphereGeometry width/height segments for the four corner balls. */
	ballSegments: [number, number];
	/** SphereGeometry segments for spawned ball bodies (both axes). */
	spawnBallSegments: number;
	/** Whether spawned bodies cast shadows — there can be a lot of them. */
	spawnShadows: boolean;
	/** Anisotropy on the car-paint flake texture. */
	flakeAnisotropy: number;
};

export const DEMO_QUALITY: Record<QualityLevel, DemoQuality> = {
	high: {
		reflectionScale: 1,
		ballCapture: true,
		ballCaptureSize: 96,
		ballCaptureHz: 15,
		mirrorCaptureSize: 128,
		mirrorCaptureHz: 30,
		ballSegments: [64, 32],
		spawnBallSegments: 16,
		spawnShadows: true,
		flakeAnisotropy: 16
	},
	low: {
		reflectionScale: 0.3,
		ballCapture: false,
		ballCaptureSize: 48,
		ballCaptureHz: 8,
		mirrorCaptureSize: 64,
		mirrorCaptureHz: 15,
		ballSegments: [24, 12],
		spawnBallSegments: 8,
		spawnShadows: false,
		flakeAnisotropy: 4
	}
};
