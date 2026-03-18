import type { KernelSize } from 'postprocessing';

export const extensionScope = 'postprocessing';

export type BloomState = {
	enabled: boolean;
	intensity: number;
	luminanceThreshold: number;
	luminanceSmoothing: number;
	kernelSize: KernelSize;
};

export type SMAAState = {
	enabled: boolean;
	preset: 0 | 1 | 2;
};

export type VignetteState = {
	enabled: boolean;
	offset: number;
	darkness: number;
};

export type ExtensionState = {
	bloom: BloomState;
	smaa: SMAAState;
	vignette: VignetteState;
};

export type ExtensionActions = {
	toggleBloom: () => void;
	setBloomIntensity: (value: number) => void;
	setBloomThreshold: (value: number) => void;
	setBloomSmoothing: (value: number) => void;
	setBloomKernelSize: (value: KernelSize) => void;
	toggleSMAA: () => void;
	setSMAAPreset: (value: 0 | 1 | 2) => void;
	toggleVignette: () => void;
	setVignetteOffset: (value: number) => void;
	setVignetteDarkness: (value: number) => void;
	resetAll: () => void;
};
