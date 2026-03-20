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
	activeAnimation: string | null;
	animationSpeed: number;
	loop: boolean;
	playing: boolean;
	visible: boolean;
};

export type GltfViewerState = {
	models: GltfViewerModel[];
	selectedId: string | null;
};
