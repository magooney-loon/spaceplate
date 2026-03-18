import { useStudio } from '@threlte/studio/extend';
import { extensionScope, type CameraControlsState, type CameraControlsActions } from './types';

export const useCameraControls = () => {
	const { useExtension } = useStudio();
	return useExtension<CameraControlsState, CameraControlsActions, true>(extensionScope);
};
