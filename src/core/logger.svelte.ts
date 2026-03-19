export interface LoggerState {
	engine: boolean;
	settings: boolean;
	sound: boolean;
	postprocessing: boolean;
}

export const loggerState = $state<LoggerState>({
	engine: true,
	settings: true,
	sound: true,
	postprocessing: true
});

const createLogger = (prefix: string, channel: keyof LoggerState) => ({
	info: (...args: unknown[]) => {
		if (loggerState[channel]) console.log(`[${prefix}]`, ...args);
	},
	warn: (...args: unknown[]) => {
		if (loggerState[channel]) console.warn(`[${prefix}]`, ...args);
	},
	error: (...args: unknown[]) => {
		if (loggerState[channel]) console.error(`[${prefix}]`, ...args);
	}
});

export const logEngine = createLogger('engine', 'engine');
export const logSettings = createLogger('settings', 'settings');
export const logSound = createLogger('sound', 'sound');
export const logPostprocessing = createLogger('postprocessing', 'postprocessing');

export const loggerActions = {
	toggleChannel(channel: keyof LoggerState) {
		loggerState[channel] = !loggerState[channel];
	}
};
