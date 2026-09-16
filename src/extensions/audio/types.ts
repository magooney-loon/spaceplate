// The only thing this extension owns. Everything else it touches lives in core/audio/
// (the mixer, the registry, the positional fallbacks) or settingsState.audio — see
// CLAUDE.md for why this is panel-only.

export const extensionScope = 'audio' as const;
