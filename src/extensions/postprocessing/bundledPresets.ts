import type { PostProcessingPreset } from './types';

/**
 * Bundled post-processing presets — committed to git, available in all environments.
 * To add a preset: create it in Studio, click "Copy as Code", paste here, commit.
 */
export const BUNDLED_PP_PRESETS: PostProcessingPreset[] = [
	// Example (remove or replace with real presets):
	// {
	//   id: 'bundled-cinematic',
	//   name: 'Cinematic',
	//   createdAt: 0,
	//   settings: { bloom: { enabled: true, intensity: 1.5, ... }, ... }
	// }
];
