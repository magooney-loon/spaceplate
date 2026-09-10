// Post-processing extension types. The param shapes are imported from the effect
// modules in $core/postprocessing/effects — one source of truth; this file only
// assembles the state shape the UI binds to (every effect gets an `enabled`).

import type { AfterimageParams } from '$core/postprocessing/effects/afterimage';
import type { BloomParams } from '$core/postprocessing/effects/bloom';
import type { DofParams } from '$core/postprocessing/effects/dof';
import type { FogScatterParams } from '$core/postprocessing/effects/fogScatter';
import type { FxaaParams } from '$core/postprocessing/effects/fxaa';
import type { LutParams } from '$core/postprocessing/effects/lut';
import type { MotionBlurParams } from '$core/postprocessing/effects/motionblur';
import type { RetroParams } from '$core/postprocessing/effects/retro';
import type { SceneTransitionParams } from '$core/postprocessing/effects/sceneTransition';
import type { SmaaParams } from '$core/postprocessing/effects/smaa';
import type { SsaaParams } from '$core/postprocessing/effects/ssaa';
import type { VignetteParams } from '$core/postprocessing/effects/vignette';

export const extensionScope = 'postprocessing';

type ParamMap = {
	bloom: BloomParams;
	afterimage: AfterimageParams;
	dof: DofParams;
	fogScatter: FogScatterParams;
	motionBlur: MotionBlurParams;
	vignette: VignetteParams;
	sceneTransition: SceneTransitionParams;
	lut: LutParams;
	smaa: SmaaParams;
	fxaa: FxaaParams;
	ssaa: SsaaParams;
	retro: RetroParams;
};

export type EffectId = keyof ParamMap;

export type PostProcessingState = {
	[K in keyof ParamMap]: { enabled: boolean } & ParamMap[K];
};

export type ExtensionState = PostProcessingState;
export type ExtensionActions = typeof import('./postprocessing.svelte').postprocessingActions;
