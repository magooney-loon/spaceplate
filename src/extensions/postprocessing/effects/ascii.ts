export interface ASCIIState {
	enabled: boolean;
	cellSize: number;
	inverted: boolean;
	[key: string]: unknown;
}

export const defaultASCIIState: ASCIIState = {
	enabled: false,
	cellSize: 16,
	inverted: false
};

export function createASCIIActions(state: ASCIIState) {
	return {
		toggleASCII: () => {
			state.enabled = !state.enabled;
		},
		setASCIICellSize: (value: number) => {
			state.cellSize = value;
		},
		setASCIIInverted: (value: boolean) => {
			state.inverted = value;
		},
		resetASCII: () => {
			state.cellSize = defaultASCIIState.cellSize;
			state.inverted = defaultASCIIState.inverted;
		}
	};
}
