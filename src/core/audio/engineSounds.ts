// THE ENGINE'S OWN MANIFEST — data, not architecture. A game that wants none of these
// deletes this file and declares its own; nothing in the audio layer knows these ids.
//
// Everything here used to be nine `<Audio>` tags hardcoded in GlobalAudio.svelte's
// markup, with a hand-maintained `AUDIO_TOTAL = 5 + THUNDER_URLS.length` beside them.

import { defineSounds } from './audio';

export const engineSounds = defineSounds({
	/** UI one-shot. `poly: 1` — a second click cuts the first, as it always did. */
	click: { url: 'click.mp3', bus: 'ui' },
	/** The scene-transition swoosh. Polyphonic: transitions can overlap. */
	swoosh: { url: 'swoosh.mp3', bus: 'ui', poly: 4 },
	ost: { url: 'ost.mp3', bus: 'music' },
	// Stereo 48 kbps Opus, loudness-matched to the previous bed (-21.5 LUFS integrated).
	ambience: { url: 'skybox/ambience.opus', bus: 'ambience' },
	// Stereo 64 kbps Opus: the always-on bed keeps its width, at just over half the mp3.
	rain: { url: 'skybox/rain.opus', bus: 'ambience' },
	// The thunder takes as a VARIANT SET — adding a take is one line here, and the
	// random draw that used to live in weatherAudio.ts scales with it by itself.
	// Mono 48 kbps Opus: the claps are low-frequency rumble through a non-positional
	// bed, and the whole set is ~220 KB.
	thunder: {
		url: [
			'skybox/thunder-1.opus',
			'skybox/thunder-2.opus',
			'skybox/thunder-3.opus',
			'skybox/thunder-4.opus'
		],
		bus: 'sfx',
		// A storm can put a second strike in the air before the first finishes rolling,
		// and a delayed clap holds its slot for the whole flight time.
		poly: 4
	}
});
