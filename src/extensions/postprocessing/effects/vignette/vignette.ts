export interface VignetteState {
	enabled: boolean;
	offset: number;
	darkness: number;
	technique: 0 | 1;
	[key: string]: unknown;
}

export const defaultVignetteState: VignetteState = {
	enabled: false,
	offset: 0.5,
	darkness: 0.5,
	technique: 0
};

export function createVignetteActions(state: VignetteState) {
	return {
		toggleVignette: () => {
			state.enabled = !state.enabled;
		},
		setVignetteOffset: (value: number) => {
			state.offset = value;
		},
		setVignetteDarkness: (value: number) => {
			state.darkness = value;
		},
		setVignetteTechnique: (value: 0 | 1) => {
			state.technique = value;
		},
		resetVignette: () => {
			state.offset = defaultVignetteState.offset;
			state.darkness = defaultVignetteState.darkness;
			state.technique = defaultVignetteState.technique;
		}
	};
}
