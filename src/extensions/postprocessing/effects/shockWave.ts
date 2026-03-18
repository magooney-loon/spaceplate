export interface ShockWaveState {
	enabled: boolean;
	speed: number;
	maxRadius: number;
	waveSize: number;
	amplitude: number;
	epicenterX: number;
	epicenterY: number;
	epicenterZ: number;
	triggered: boolean;
	[key: string]: unknown;
}

export const defaultShockWaveState: ShockWaveState = {
	enabled: false,
	speed: 1.25,
	maxRadius: 0.5,
	waveSize: 0.2,
	amplitude: 0.05,
	epicenterX: 0,
	epicenterY: 0,
	epicenterZ: 0,
	triggered: false
};

export function createShockWaveActions(state: ShockWaveState) {
	return {
		toggleShockWave: () => {
			state.enabled = !state.enabled;
		},
		setShockWaveSpeed: (value: number) => {
			state.speed = value;
		},
		setShockWaveMaxRadius: (value: number) => {
			state.maxRadius = value;
		},
		setShockWaveWaveSize: (value: number) => {
			state.waveSize = value;
		},
		setShockWaveAmplitude: (value: number) => {
			state.amplitude = value;
		},
		setShockWaveEpicenter: (x: number, y: number, z: number) => {
			state.epicenterX = x;
			state.epicenterY = y;
			state.epicenterZ = z;
		},
		triggerShockWave: () => {
			state.triggered = true;
		},
		resetShockWave: () => {
			state.speed = defaultShockWaveState.speed;
			state.maxRadius = defaultShockWaveState.maxRadius;
			state.waveSize = defaultShockWaveState.waveSize;
			state.amplitude = defaultShockWaveState.amplitude;
			state.epicenterX = defaultShockWaveState.epicenterX;
			state.epicenterY = defaultShockWaveState.epicenterY;
			state.epicenterZ = defaultShockWaveState.epicenterZ;
		}
	};
}
