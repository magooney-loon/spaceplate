export interface SMAAState {
	enabled: boolean;
	preset: 0 | 1 | 2 | 3;
	edgeDetectionMode: 0 | 1 | 2;
	predicationMode: 0 | 1 | 2;
	[key: string]: unknown;
}

export const defaultSMAAState: SMAAState = {
	enabled: false,
	preset: 2,
	edgeDetectionMode: 2,
	predicationMode: 0
};

export function createSMAAActions(state: SMAAState) {
	return {
		toggleSMAA: () => {
			state.enabled = !state.enabled;
		},
		setSMAAPreset: (value: 0 | 1 | 2 | 3) => {
			state.preset = value;
		},
		setSMAEEdgeDetectionMode: (value: 0 | 1 | 2) => {
			state.edgeDetectionMode = value;
		},
		setSMAAPredicationMode: (value: 0 | 1 | 2) => {
			state.predicationMode = value;
		},
		resetSMAA: () => {
			state.preset = defaultSMAAState.preset;
			state.edgeDetectionMode = defaultSMAAState.edgeDetectionMode;
			state.predicationMode = defaultSMAAState.predicationMode;
		}
	};
}
