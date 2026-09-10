// Barrel for src/core — import engine parts from '$core'.
// Note: modules inside core/ import each other directly (not via this barrel)
// to avoid circular module graphs.
//
// Layout: audio/ input/ skybox/ utils/ hold the grouped engine parts;
// Camera stays at the root as a plain scene primitive.

export { default as Camera } from './Camera.svelte';

// audio/
export { default as GlobalAudio } from './audio/GlobalAudio.svelte';
export { soundTriggers, soundActions } from './audio/globalAudio.svelte';

// input/
export { default as Keymapper } from './input/Keymapper.svelte';
export { default as InputRuntime } from './input/InputRuntime.svelte';
export { default as MouseLook } from './input/MouseLook.svelte';
export { isTypingTarget, isUiTarget } from './input/domGuards';
export { BASE_SENS, mouseLookState, mouseLookActions } from './input/mouseLook.svelte';
export type { MouseLookState } from './input/mouseLook.svelte';

// skybox/ — everything sky/skybox/weather
export { default as Skybox } from './skybox/Skybox.svelte';
export { default as SkyLight } from './skybox/SkyLight.svelte';
export {
	descriptor,
	skyMeta,
	skyActions,
	skyQueries,
	on as onSky,
	off as offSky
} from './skybox/model';
export type { SkyDescriptor, PhaseName, DayKeyframe, ClockKind } from './skybox/model';

// utils/
export { default as Loader } from './utils/Loader.svelte';
export { default as EngineClock } from './utils/EngineClock.svelte';
export { default as Renderer } from './utils/Renderer.svelte';
export { default as PhysicsWorld } from './utils/PhysicsWorld.svelte';
export { engineClock, setFixedStepSource } from './utils/engineClock';
export type { FixedStepSource } from './utils/engineClock';
export { default as Telemetry } from './utils/Telemetry.svelte';
export { default as Warmup } from './utils/Warmup.svelte';
export { warmupState, warmScene } from './utils/warmup.svelte';
export type { WarmOutcome } from './utils/warmup.svelte';

// postprocessing/ — the pipeline itself is Renderer.svelte's; this is the scene
// transition's driver + the state Loader.svelte reads to know who is covering.
export { default as TransitionDriver } from './postprocessing/TransitionDriver.svelte';
export { transitionFxState } from './postprocessing/transitionState.svelte';
export {
	capabilityState,
	probeCapabilities,
	isBlocked,
	WEBGPU_REPORT_URL
} from './utils/capabilities.svelte';
export type { RenderTier, AdapterSnapshot } from './utils/capabilities.svelte';
export { telemetryState } from './utils/telemetry.svelte';
export type { Backend } from './utils/telemetry.svelte';
