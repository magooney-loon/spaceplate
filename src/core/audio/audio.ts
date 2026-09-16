// THE FACADE — `defineSounds()` and `audio`. The only door into the audio layer.
//
// "Only door" is a contract, not a style preference: the offline render (render.ts)
// reproduces a take by replaying what this module was TOLD, so anything that reaches a
// THREE.Audio around the side is silently missing from a recording. See DOCS/AUDIO.md.

import { audioContext, registerSound, unregisterSounds } from './registry';
import { renderTake } from './render';
import { armRecording, disarmRecording, playOneShot, startLoop, stopAllVoices } from './voices';
import type { AudioScope, PlayOptions, SoundDef, SoundRef, VoiceHandle } from './types';

const makeRef = (soundId: string): SoundRef => ({
	soundId,
	play: (options?: PlayOptions) => playOneShot(soundId, options),
	loop: (options?: PlayOptions) => startLoop(soundId, options)
});

/**
 * Declare sounds. Returns a TYPED map — `engineSfx.click.play()` — so a renamed or
 * misspelled sound is a compile error rather than silence. `audio.play('id')` stays
 * available for ids only known at runtime.
 *
 * Declarations are additive: the engine's manifest (`engineSounds.ts`) is data a game
 * can delete, and a scene declares its own on mount.
 */
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

/**
 * Everything a scope creates dies with it — one `release()` in place of a hand-written
 * detach function walking a dozen module-level pointers.
 */
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
	/** Stop every voice, or every voice of one sound. */
	stopAll: (soundId?: string): void => stopAllVoices(soundId),
	scope: createScope,
	/** Drop a scene's declarations once its voices are gone. */
	undefineSounds: (soundIds: readonly string[]): void => unregisterSounds(soundIds),

	/**
	 * Deterministic take recording, for `capture/`.
	 *
	 * `arm()` at the scene time the take claims the engine clock; `render()` with the
	 * take's SCENE length (`frameCount / fps`) once it stops. The result is an AudioBuffer
	 * exactly that long, so it cannot drift against the video however slowly the take
	 * rendered — see core/audio/timeline.ts.
	 */
	recording: {
		arm: (sceneTime: number): void => armRecording(sceneTime),
		/** Null if nothing was armed, the take was empty, or there is no AudioContext. */
		async render(durationScene: number): Promise<AudioBuffer | null> {
			const take = disarmRecording();
			const context = audioContext();
			if (!take || !context || take.voices.length === 0) return null;
			return renderTake(take, durationScene, context.sampleRate);
		},
		/** Throw the recording away without rendering — a cancelled or failed take. */
		discard: (): void => {
			disarmRecording();
		}
	}
};
