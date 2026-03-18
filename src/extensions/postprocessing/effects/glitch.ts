export interface GlitchState {
	enabled: boolean;
	delay: number;
	duration: number;
	strength: number;
	ratio: number;
	columns: number;
	mode: 0 | 1 | 2 | 3;
	[key: string]: unknown;
}

export const defaultGlitchState: GlitchState = {
	enabled: false,
	delay: 2.5,
	duration: 0.8,
	strength: 0.65,
	ratio: 0.85,
	columns: 0.05,
	mode: 1
};

export function createGlitchActions(state: GlitchState) {
	return {
		toggleGlitch: () => {
			state.enabled = !state.enabled;
		},
		setGlitchDelay: (value: number) => {
			state.delay = value;
		},
		setGlitchDuration: (value: number) => {
			state.duration = value;
		},
		setGlitchStrength: (value: number) => {
			state.strength = value;
		},
		setGlitchRatio: (value: number) => {
			state.ratio = value;
		},
		setGlitchColumns: (value: number) => {
			state.columns = value;
		},
		setGlitchMode: (value: 0 | 1 | 2 | 3) => {
			state.mode = value;
		},
		resetGlitch: () => {
			state.delay = defaultGlitchState.delay;
			state.duration = defaultGlitchState.duration;
			state.strength = defaultGlitchState.strength;
			state.ratio = defaultGlitchState.ratio;
			state.columns = defaultGlitchState.columns;
			state.mode = defaultGlitchState.mode;
		}
	};
}
