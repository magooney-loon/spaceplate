import type { KernelSize, BlendFunction } from 'postprocessing';

export interface TiltShiftState {
	enabled: boolean;
	offset: number;
	rotation: number;
	focusArea: number;
	feather: number;
	kernelSize: KernelSize;
	blendFunction: BlendFunction;
	[key: string]: unknown;
}

export const defaultTiltShiftState: TiltShiftState = {
	enabled: false,
	offset: 0.0,
	rotation: 0.0,
	focusArea: 0.4,
	feather: 0.3,
	kernelSize: 3 as KernelSize,
	blendFunction: 0 as BlendFunction
};

export function createTiltShiftActions(state: TiltShiftState) {
	return {
		toggleTiltShift: () => {
			state.enabled = !state.enabled;
		},
		setTiltShiftOffset: (value: number) => {
			state.offset = value;
		},
		setTiltShiftFocusArea: (value: number) => {
			state.focusArea = value;
		},
		setTiltShiftFeather: (value: number) => {
			state.feather = value;
		},
		setTiltShiftKernelSize: (value: KernelSize) => {
			state.kernelSize = value;
		},
		setTiltShiftBlendFunction: (value: BlendFunction) => {
			state.blendFunction = value;
		},
		resetTiltShift: () => {
			state.offset = defaultTiltShiftState.offset;
			state.rotation = defaultTiltShiftState.rotation;
			state.focusArea = defaultTiltShiftState.focusArea;
			state.feather = defaultTiltShiftState.feather;
			state.kernelSize = defaultTiltShiftState.kernelSize;
			state.blendFunction = defaultTiltShiftState.blendFunction;
		}
	};
}
