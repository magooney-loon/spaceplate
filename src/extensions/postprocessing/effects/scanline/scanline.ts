import type { BlendFunction } from 'postprocessing';

export interface ScanlineState {
	enabled: boolean;
	density: number;
	opacity: number;
	scrollSpeed: number;
	blendFunction: BlendFunction;
	[key: string]: unknown;
}

export const defaultScanlineState: ScanlineState = {
	enabled: false,
	density: 1.25,
	opacity: 0.5,
	scrollSpeed: 0,
	blendFunction: 25 as BlendFunction
};

export function createScanlineActions(state: ScanlineState) {
	return {
		toggleScanline: () => {
			state.enabled = !state.enabled;
		},
		setScanlineDensity: (value: number) => {
			state.density = value;
		},
		setScanlineOpacity: (value: number) => {
			state.opacity = value;
		},
		setScanlineScrollSpeed: (value: number) => {
			state.scrollSpeed = value;
		},
		setScanlineBlendFunction: (value: BlendFunction) => {
			state.blendFunction = value;
		},
		resetScanline: () => {
			state.density = defaultScanlineState.density;
			state.opacity = defaultScanlineState.opacity;
			state.scrollSpeed = defaultScanlineState.scrollSpeed;
			state.blendFunction = defaultScanlineState.blendFunction;
		}
	};
}
