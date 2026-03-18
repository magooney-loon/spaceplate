import { useStudio } from '@threlte/studio/extend';
import { extensionScope, type ExtensionState, type ExtensionActions } from './types';

export const usePostProcessing = () => {
	const { useExtension } = useStudio();
	const extension = useExtension<ExtensionState, ExtensionActions>(extensionScope);

	return {
		get bloomEnabled() {
			return extension.state.bloom!.enabled;
		},
		get bloomIntensity() {
			return extension.state.bloom!.intensity;
		},
		get bloomThreshold() {
			return extension.state.bloom!.luminanceThreshold;
		},
		get bloomSmoothing() {
			return extension.state.bloom!.luminanceSmoothing;
		},
		get bloomKernelSize() {
			return extension.state.bloom!.kernelSize;
		},
		get smaaEnabled() {
			return extension.state.smaa!.enabled;
		},
		get smaaPreset() {
			return extension.state.smaa!.preset;
		},
		get vignetteEnabled() {
			return extension.state.vignette!.enabled;
		},
		get vignetteOffset() {
			return extension.state.vignette!.offset;
		},
		get vignetteDarkness() {
			return extension.state.vignette!.darkness;
		},
		toggleBloom: extension.toggleBloom,
		setBloomIntensity: extension.setBloomIntensity,
		setBloomThreshold: extension.setBloomThreshold,
		setBloomSmoothing: extension.setBloomSmoothing,
		setBloomKernelSize: extension.setBloomKernelSize,
		toggleSMAA: extension.toggleSMAA,
		setSMAAPreset: extension.setSMAAPreset,
		toggleVignette: extension.toggleVignette,
		setVignetteOffset: extension.setVignetteOffset,
		setVignetteDarkness: extension.setVignetteDarkness,
		resetAll: extension.resetAll
	};
};
