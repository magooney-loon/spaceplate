import type { ExtensionState } from './types';

export type SoundState = ExtensionState;

export const defaultSoundState = (): SoundState => ({
	refDistance: 5,
	maxDistance: 80,
	rolloffFactor: 1.5,
	panningModel: 'HRTF' as 'HRTF' | 'equalpower',
	listenerEnabled: true
});

export const soundState = $state<SoundState>(defaultSoundState());
