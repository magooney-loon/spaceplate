export const extensionScope = 'gltf-viewer' as const;

export type GltfViewerColliderShape = 'cuboid' | 'ball' | 'capsule' | 'trimesh' | 'convexHull';

export type GltfViewerModel = {
	id: string;
	name: string;
	url: string;
	isBlobUrl: boolean;
	animationClips: string[]; // populated after GLTF loads
	activeAnimations: string[]; // clips currently enabled (can be multiple)
	playState: 'playing' | 'paused' | 'stopped';
	animationSpeed: number;
	crossfadeDuration: number; // seconds — 0 = instant
	loop: boolean;
	visible: boolean;
	colliderShape: GltfViewerColliderShape;
};

export type GltfViewerState = {
	models: GltfViewerModel[];
	selectedId: string | null;
};
