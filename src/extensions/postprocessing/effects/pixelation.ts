export interface PixelationState {
	enabled: boolean;
	granularity: number;
	[key: string]: unknown;
}

export const defaultPixelationState: PixelationState = {
	enabled: false,
	granularity: 30.0
};

export function createPixelationActions(state: PixelationState) {
	return {
		togglePixelation: () => {
			state.enabled = !state.enabled;
		},
		setPixelationGranularity: (value: number) => {
			state.granularity = value;
		},
		resetPixelation: () => {
			state.granularity = defaultPixelationState.granularity;
		}
	};
}
