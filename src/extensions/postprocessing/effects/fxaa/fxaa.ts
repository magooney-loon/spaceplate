export interface FXAAState {
	enabled: boolean;
	minEdgeThreshold: number;
	maxEdgeThreshold: number;
	subpixelQuality: number;
	[key: string]: unknown;
}

export const defaultFXAAState: FXAAState = {
	enabled: false,
	minEdgeThreshold: 0.05,
	maxEdgeThreshold: 0.12,
	subpixelQuality: 0.75
};

export function createFXAAActions(state: FXAAState) {
	return {
		toggleFXAA: () => {
			state.enabled = !state.enabled;
		},
		setFXAAEdgeThreshold: (min: number, max: number, quality: number) => {
			state.minEdgeThreshold = min;
			state.maxEdgeThreshold = max;
			state.subpixelQuality = quality;
		},
		resetFXAA: () => {
			state.minEdgeThreshold = defaultFXAAState.minEdgeThreshold;
			state.maxEdgeThreshold = defaultFXAAState.maxEdgeThreshold;
			state.subpixelQuality = defaultFXAAState.subpixelQuality;
		}
	};
}
