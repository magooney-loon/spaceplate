export const extensionScope = 'gltf-viewer' as const;

export type GltfViewerModel = {
	id: string;
	name: string;
	url: string;
	isBlobUrl: boolean;
	position: [number, number, number];
	rotation: [number, number, number]; // euler degrees X/Y/Z
	scale: number; // uniform
	animationClips: string[]; // populated after GLTF loads
	activeAnimations: string[]; // clips currently enabled (can be multiple)
	playState: 'playing' | 'paused' | 'stopped';
	animationSpeed: number;
	crossfadeDuration: number; // seconds — 0 = instant
	loop: boolean;
	visible: boolean;
};

export type GltfViewerState = {
	models: GltfViewerModel[];
	selectedId: string | null;
};
