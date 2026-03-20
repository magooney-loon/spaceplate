import { sceneActions } from '$extensions/scene/scene.svelte';
import type { GltfViewerModel, GltfViewerState } from './types';

export type { GltfViewerModel, GltfViewerState } from './types';

const makeModel = (name: string, url: string, isBlobUrl: boolean): GltfViewerModel => ({
	id: crypto.randomUUID(),
	name,
	url,
	isBlobUrl,
	position: [0, 0, 0],
	rotation: [0, 0, 0],
	scale: 1,
	animationClips: [],
	activeAnimation: null,
	animationSpeed: 1,
	loop: true,
	playing: false,
	visible: true
});

export const gltfViewerState = $state<GltfViewerState>({
	models: [],
	selectedId: null
});

const find = (id: string): GltfViewerModel | undefined =>
	gltfViewerState.models.find((m) => m.id === id);

export const gltfViewerActions = {
	loadFromFile(file: File) {
		const url = URL.createObjectURL(file);
		const name = file.name.replace(/\.(gltf|glb)$/i, '');
		const model = makeModel(name, url, true);
		gltfViewerState.models.push(model);
		gltfViewerState.selectedId = model.id;
		sceneActions.setScene('demoScene');
	},

	loadFromPath(path: string) {
		const name = path.split('/').pop()?.replace(/\.(gltf|glb)$/i, '') ?? path;
		const model = makeModel(name, path, false);
		gltfViewerState.models.push(model);
		gltfViewerState.selectedId = model.id;
		sceneActions.setScene('demoScene');
	},

	removeModel(id: string) {
		const model = find(id);
		if (!model) return;
		if (model.isBlobUrl) URL.revokeObjectURL(model.url);
		gltfViewerState.models = gltfViewerState.models.filter((m) => m.id !== id);
		if (gltfViewerState.selectedId === id) {
			const remaining = gltfViewerState.models;
		gltfViewerState.selectedId = remaining.length > 0 ? remaining[remaining.length - 1].id : null;
		}
	},

	clearAll() {
		for (const m of gltfViewerState.models) {
			if (m.isBlobUrl) URL.revokeObjectURL(m.url);
		}
		gltfViewerState.models = [];
		gltfViewerState.selectedId = null;
	},

	selectModel(id: string) {
		gltfViewerState.selectedId = id;
	},

	// Called by GltfViewerInstance once the GLTF loads and animations are known
	setModelClips(id: string, clips: string[]) {
		const m = find(id);
		if (m) m.animationClips = clips;
	},

	setPosition(id: string, x: number, y: number, z: number) {
		const m = find(id);
		if (m) m.position = [x, y, z];
	},

	setRotation(id: string, x: number, y: number, z: number) {
		const m = find(id);
		if (m) m.rotation = [x, y, z];
	},

	setScale(id: string, v: number) {
		const m = find(id);
		if (m) m.scale = v;
	},

	setAnimation(id: string, clipName: string | null) {
		const m = find(id);
		if (!m) return;
		m.activeAnimation = clipName;
		m.playing = clipName !== null;
	},

	setPlaying(id: string, playing: boolean) {
		const m = find(id);
		if (m) m.playing = playing;
	},

	setSpeed(id: string, speed: number) {
		const m = find(id);
		if (m) m.animationSpeed = speed;
	},

	setLoop(id: string, loop: boolean) {
		const m = find(id);
		if (m) m.loop = loop;
	},

	setVisible(id: string, visible: boolean) {
		const m = find(id);
		if (m) m.visible = visible;
	}
};
