export const extensionScope = 'camera-controls';

export interface CameraControlsState {
	[key: string]: unknown;
	enabled: boolean;
	minPolarAngle: number;
	maxPolarAngle: number;
	minAzimuthAngle: number;
	maxAzimuthAngle: number;
	minDistance: number;
	maxDistance: number;
	minZoom: number;
	maxZoom: number;
	smoothTime: number;
	draggingSmoothTime: number;
	maxSpeed: number;
	azimuthRotateSpeed: number;
	polarRotateSpeed: number;
	dollySpeed: number;
	truckSpeed: number;
	dollyToCursor: boolean;
}

export type CameraControlsActions = {
	toggleEnabled: () => void;
	setMinPolarAngle: (value: number) => void;
	setMaxPolarAngle: (value: number) => void;
	setMinAzimuthAngle: (value: number) => void;
	setMaxAzimuthAngle: (value: number) => void;
	setMinDistance: (value: number) => void;
	setMaxDistance: (value: number) => void;
	setMinZoom: (value: number) => void;
	setMaxZoom: (value: number) => void;
	setSmoothTime: (value: number) => void;
	setDraggingSmoothTime: (value: number) => void;
	setMaxSpeed: (value: number) => void;
	setAzimuthRotateSpeed: (value: number) => void;
	setPolarRotateSpeed: (value: number) => void;
	setDollySpeed: (value: number) => void;
	setTruckSpeed: (value: number) => void;
	setDollyToCursor: (value: boolean) => void;
	resetAll: () => void;
};
