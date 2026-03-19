import type { LoggerState, LoggerChannel, LoggerStyle, Logger } from './types';

export type { LoggerState, LoggerChannel, ExtensionState, ExtensionActions, Logger } from './types';

export const loggerState = $state<LoggerState>({
	engine: true,
	settings: true,
	sound: true,
	postprocessing: true
});

const channelStyles: Record<LoggerChannel, LoggerStyle> = {
	engine: { color: '#61afef', bg: 'background:#1e3a5f', text: '⬡' },
	settings: { color: '#98c379', bg: 'background:#2d4a2d', text: '⚙' },
	sound: { color: '#c678dd', bg: 'background:#3d2d4a', text: '♪' },
	postprocessing: { color: '#e5c07b', bg: 'background:#4a4020', text: '◈' }
};

const formatTime = () => {
	const now = new Date();
	return (
		now.toLocaleTimeString('en-US', {
			hour12: false,
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		}) + `.${String(now.getMilliseconds()).padStart(3, '0')}`
	);
};

const createLogger = (prefix: string, channel: LoggerChannel): Logger => {
	const style = channelStyles[channel];
	return {
		info: (...args: unknown[]) => {
			if (!loggerState[channel]) return;
			console.log(
				`%c${style.text} ${formatTime()} %c${prefix.padEnd(14)}%c `,
				`color: ${style.color}; font-weight: bold; ${style.bg}; padding: 2px 6px; border-radius: 3px;`,
				`color: ${style.color}; font-weight: bold;`,
				'color: #abb2bf; font-family: monospace;',
				...args
			);
		},
		warn: (...args: unknown[]) => {
			if (!loggerState[channel]) return;
			console.warn(
				`%c⚠ ${formatTime()} %c${prefix.padEnd(14)}%c `,
				`color: #e5c07b; font-weight: bold; background: #4a4020; padding: 2px 6px; border-radius: 3px;`,
				`color: #e5c07b; font-weight: bold;`,
				'color: #abb2bf; font-family: monospace;',
				...args
			);
		},
		error: (...args: unknown[]) => {
			if (!loggerState[channel]) return;
			console.error(
				`%c✗ ${formatTime()} %c${prefix.padEnd(14)}%c `,
				`color: #e06c75; font-weight: bold; background: #4a2020; padding: 2px 6px; border-radius: 3px;`,
				`color: #e06c75; font-weight: bold;`,
				'color: #abb2bf; font-family: monospace;',
				...args
			);
		}
	};
};

export const logEngine = createLogger('engine', 'engine');
export const logSettings = createLogger('settings', 'settings');
export const logSound = createLogger('sound', 'sound');
export const logPostprocessing = createLogger('postprocessing', 'postprocessing');

export const loggerActions = {
	toggleChannel(channel: LoggerChannel) {
		loggerState[channel] = !loggerState[channel];
	}
};
