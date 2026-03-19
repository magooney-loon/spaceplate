import type { KernelSize, BlendFunction } from 'postprocessing';

export interface OutlineState {
	enabled: boolean;
	edgeStrength: number;
	visibleEdgeColor: number;
	hiddenEdgeColor: number;
	pulseSpeed: number;
	xRay: boolean;
	blur: boolean;
	kernelSize: KernelSize;
	blendFunction: BlendFunction;
	patternScale: number;
	multisampling: number;
	resolutionScale: number;
	[key: string]: unknown;
}

export const defaultOutlineState: OutlineState = {
	enabled: false,
	edgeStrength: 1.0,
	visibleEdgeColor: 0xffffff,
	hiddenEdgeColor: 0x22090a,
	pulseSpeed: 0.0,
	xRay: true,
	blur: false,
	kernelSize: 1 as KernelSize,
	blendFunction: 22 as BlendFunction,
	patternScale: 1.0,
	multisampling: 0,
	resolutionScale: 0.5
};

export function createOutlineActions(state: OutlineState) {
	return {
		toggleOutline: () => {
			state.enabled = !state.enabled;
		},
		setOutlineEdgeStrength: (value: number) => {
			state.edgeStrength = value;
		},
		setOutlineVisibleEdgeColor: (value: number) => {
			state.visibleEdgeColor = value;
		},
		setOutlineHiddenEdgeColor: (value: number) => {
			state.hiddenEdgeColor = value;
		},
		setOutlinePulseSpeed: (value: number) => {
			state.pulseSpeed = value;
		},
		setOutlineXRay: (value: boolean) => {
			state.xRay = value;
		},
		setOutlineBlur: (value: boolean) => {
			state.blur = value;
		},
		setOutlineKernelSize: (value: KernelSize) => {
			state.kernelSize = value;
		},
		setOutlineBlendFunction: (value: BlendFunction) => {
			state.blendFunction = value;
		},
		setOutlinePatternScale: (value: number) => {
			state.patternScale = value;
		},
		setOutlineMultisampling: (value: number) => {
			state.multisampling = value;
		},
		setOutlineResolutionScale: (value: number) => {
			state.resolutionScale = value;
		},
		resetOutline: () => {
			state.edgeStrength = defaultOutlineState.edgeStrength;
			state.visibleEdgeColor = defaultOutlineState.visibleEdgeColor;
			state.hiddenEdgeColor = defaultOutlineState.hiddenEdgeColor;
			state.pulseSpeed = defaultOutlineState.pulseSpeed;
			state.xRay = defaultOutlineState.xRay;
			state.blur = defaultOutlineState.blur;
			state.kernelSize = defaultOutlineState.kernelSize;
			state.blendFunction = defaultOutlineState.blendFunction;
			state.patternScale = defaultOutlineState.patternScale;
			state.multisampling = defaultOutlineState.multisampling;
			state.resolutionScale = defaultOutlineState.resolutionScale;
		}
	};
}
