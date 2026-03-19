import { useStudio } from '@threlte/studio/extend';
import { extensionScope, type ExtensionState, type ExtensionActions } from './types';

export const useSound = () => {
	const { useExtension } = useStudio();
	return useExtension<ExtensionState, ExtensionActions, true>(extensionScope);
};
