// The engine's own manifest — data, not architecture. A game that wants none of these
// deletes this file and declares its own; nothing in the audio layer knows these ids.

import { defineSounds } from './audio';

export const engineSounds = defineSounds({
	/** UI one-shot. `poly: 1` — a second click cuts the first. */
	click: { url: 'click.mp3', bus: 'ui' },
	/** Scene-transition swoosh. Polyphonic: transitions can overlap. */
	swoosh: { url: 'swoosh.mp3', bus: 'ui', poly: 4 },
	ost: { url: 'ost.mp3', bus: 'music' },
	ambience: { url: 'skybox/ambience.opus', bus: 'ambience' },
	rain: { url: 'skybox/rain.opus', bus: 'ambience' },
	// Variant set — a random take plays each time; adding a take is one line.
	thunder: {
		url: [
			'skybox/thunder-1.opus',
			'skybox/thunder-2.opus',
			'skybox/thunder-3.opus',
			'skybox/thunder-4.opus'
		],
		bus: 'sfx',
		// A storm can put a second strike in the air before the first finishes rolling.
		poly: 4
	}
});
