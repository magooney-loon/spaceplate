// Barrel for core/audio. Reachable from '$core' too; modules inside core/audio import
// each other relatively, never through this file.

export { default as AudioRuntime } from './AudioRuntime.svelte';
export { audio, defineSounds } from './audio';
export { engineSounds } from './engineSounds';
export { busAudible, setBusMuted, setBusVolume, mixerSnapshot } from './mixer';
export { positionalDefaults, voiceCount } from './voices';
export { soundsReady } from './registry';
export type { AudioScope, BusId, PlayOptions, SoundDef, SoundRef, VoiceHandle } from './types';
