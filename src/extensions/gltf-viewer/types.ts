export const extensionScope = 'gltf-viewer' as const;

export type GltfColliderShape = 'trimesh' | 'convexHull' | 'cuboid' | 'ball' | 'capsule';

export type GltfViewerModel = {
	id: string;
	name: string;
	url: string;
	isBlobUrl: boolean;
	colliderEnabled: boolean;
	colliderShape: GltfColliderShape;
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
