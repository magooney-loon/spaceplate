// The only door into the audio layer — anything that reaches a THREE.Audio around the
// side is invisible to the take recorder (render.ts). See DOCS/AUDIO.md.

import { audioContext, registerSound, unregisterSounds } from './registry';
import { renderTake } from './render';
import { armRecording, disarmRecording, playOneShot, startLoop, stopAllVoices } from './voices';
import type { AudioScope, PlayOptions, SoundDef, SoundRef, VoiceHandle } from './types';

const makeRef = (soundId: string): SoundRef => ({
	soundId,
	play: (options?: PlayOptions) => playOneShot(soundId, options),
	loop: (options?: PlayOptions) => startLoop(soundId, options)
});

/** Declare sounds. Returns a typed map so a renamed/misspelled sound is a compile error. */
export const defineSounds = <T extends Record<string, SoundDef>>(
	defs: T
): { [K in keyof T]: SoundRef } => {
	const refs = {} as { [K in keyof T]: SoundRef };
	for (const key of Object.keys(defs) as (keyof T & string)[]) {
		registerSound(key, defs[key]);
		refs[key] = makeRef(key);
	}
	return refs;
};

/** Everything a scope creates dies with it, via one `release()`. */
const createScope = (): AudioScope => {
	const held = new Set<VoiceHandle>();
	const track = (handle: VoiceHandle | null): VoiceHandle | null => {
		if (handle) held.add(handle);
		return handle;
	};
	return {
		play: (soundId, options) => track(playOneShot(soundId, options)),
		loop: (soundId, options) => track(startLoop(soundId, options)),
		release() {
			for (const handle of held) handle.stop();
			held.clear();
		}
	};
};

export const audio = {
	play: (soundId: string, options?: PlayOptions): VoiceHandle | null =>
		playOneShot(soundId, options),
	loop: (soundId: string, options?: PlayOptions): VoiceHandle | null => startLoop(soundId, options),
	stopAll: (soundId?: string): void => stopAllVoices(soundId),
	scope: createScope,
	undefineSounds: (soundIds: readonly string[]): void => unregisterSounds(soundIds),

	/**
	 * Deterministic take recording for `capture/`. `arm()` at the scene time the take
	 * claims the engine clock; `render()` with the take's scene length once it stops —
	 * the result is exactly that long, so it can't drift against the video.
	 */
	recording: {
		arm: (sceneTime: number): void => armRecording(sceneTime),
		async render(durationScene: number): Promise<AudioBuffer | null> {
			const take = disarmRecording();
			const context = audioContext();
			if (!take || !context || take.voices.length === 0) return null;
			return renderTake(take, durationScene, context.sampleRate);
		},
		discard: (): void => {
			disarmRecording();
		}
	}
};
