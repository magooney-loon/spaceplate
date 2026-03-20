import { useStudio } from '@threlte/studio/extend';
import { extensionScope, type ExtensionState, type ExtensionActions } from './types';
import { soundState } from './soundState.svelte';

export type { SoundState } from './soundState.svelte';

export const useSound = () => {
	try {
		const { useExtension } = useStudio();
		if (useExtension) {
			return useExtension<ExtensionState, ExtensionActions, true>(extensionScope);
		}
	} catch {
		// Studio not available
	}
	return { state: soundState };
};
