export interface LensDistortionState {
	enabled: boolean;
	distortionX: number;
	distortionY: number;
	principalX: number;
	principalY: number;
	focalLengthX: number;
	focalLengthY: number;
	skew: number;
	[key: string]: unknown;
}

export const defaultLensDistortionState: LensDistortionState = {
	enabled: false,
	distortionX: 0.0,
	distortionY: 0.0,
	principalX: 0.0,
	principalY: 0.0,
	focalLengthX: 1.0,
	focalLengthY: 1.0,
	skew: 0.0
};

export function createLensDistortionActions(state: LensDistortionState) {
	return {
		toggleLensDistortion: () => {
			state.enabled = !state.enabled;
		},
		setLensDistortionX: (value: number) => {
			state.distortionX = value;
		},
		setLensDistortionY: (value: number) => {
			state.distortionY = value;
		},
		setLensPrincipalX: (value: number) => {
			state.principalX = value;
		},
		setLensPrincipalY: (value: number) => {
			state.principalY = value;
		},
		setLensFocalLengthX: (value: number) => {
			state.focalLengthX = value;
		},
		setLensFocalLengthY: (value: number) => {
			state.focalLengthY = value;
		},
		setLensSkew: (value: number) => {
			state.skew = value;
		},
		resetLensDistortion: () => {
			state.distortionX = defaultLensDistortionState.distortionX;
			state.distortionY = defaultLensDistortionState.distortionY;
			state.principalX = defaultLensDistortionState.principalX;
			state.principalY = defaultLensDistortionState.principalY;
			state.focalLengthX = defaultLensDistortionState.focalLengthX;
			state.focalLengthY = defaultLensDistortionState.focalLengthY;
			state.skew = defaultLensDistortionState.skew;
		}
	};
}
