import type { BlendFunction } from 'postprocessing';

export interface BrightnessContrastState {
	enabled: boolean;
	brightness: number;
	contrast: number;
	blendFunction: BlendFunction;
	[key: string]: unknown;
}

export const defaultBrightnessContrastState: BrightnessContrastState = {
	enabled: false,
	brightness: 0,
	contrast: 0,
	blendFunction: 0 as BlendFunction
};

export function createBrightnessContrastActions(state: BrightnessContrastState) {
	return {
		toggleBrightnessContrast: () => {
			state.enabled = !state.enabled;
		},
		setBrightness: (value: number) => {
			state.brightness = value;
		},
		setContrast: (value: number) => {
			state.contrast = value;
		},
		setBrightnessContrastBlendFunction: (value: BlendFunction) => {
			state.blendFunction = value;
		},
		resetBrightnessContrast: () => {
			state.brightness = defaultBrightnessContrastState.brightness;
			state.contrast = defaultBrightnessContrastState.contrast;
			state.blendFunction = defaultBrightnessContrastState.blendFunction;
		}
	};
}
