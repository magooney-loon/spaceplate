import { sceneActions } from '$extensions/scene/scene.svelte';
import { logGltf } from '$extensions/logger/logger.svelte';
import type { GltfViewerModel, GltfViewerState } from './types';

export type { GltfViewerModel, GltfViewerState } from './types';

const makeModel = (name: string, url: string, isBlobUrl: boolean): GltfViewerModel => ({
	id: crypto.randomUUID(),
	name,
	url,
	isBlobUrl,
	animationClips: [],
	activeAnimations: [],
	playState: 'stopped',
	animationSpeed: 1,
	crossfadeDuration: 0.3,
	loop: true,
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
		logGltf.info('Load from file:', name, `(${file.name}, ${(file.size / 1024).toFixed(1)} KB)`);
		sceneActions.setScene('demoScene');
	},

	loadFromPath(path: string) {
		const name = path.split('/').pop()?.replace(/\.(gltf|glb)$/i, '') ?? path;
		const model = makeModel(name, path, false);
		gltfViewerState.models.push(model);
		gltfViewerState.selectedId = model.id;
		logGltf.info('Load from path:', name, `(${path})`);
		sceneActions.setScene('demoScene');
	},

	removeModel(id: string) {
		const model = find(id);
		if (!model) return;
		logGltf.info('Remove model:', model.name, `(${id})`);
		if (model.isBlobUrl) URL.revokeObjectURL(model.url);
		gltfViewerState.models = gltfViewerState.models.filter((m) => m.id !== id);
		if (gltfViewerState.selectedId === id) {
			const remaining = gltfViewerState.models;
			gltfViewerState.selectedId = remaining.length > 0 ? remaining[remaining.length - 1].id : null;
		}
	},

	clearAll() {
		logGltf.info('Clear all models:', gltfViewerState.models.length, 'removed');
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
		if (!m) return;
		m.animationClips = clips;
		logGltf.info('Clips discovered for', m.name + ':', clips.length > 0 ? clips.join(', ') : '(none)');
	},

	toggleAnimation(id: string, clipName: string) {
		const m = find(id);
		if (!m) return;
		const idx = m.activeAnimations.indexOf(clipName);
		if (idx === -1) {
			m.activeAnimations = [...m.activeAnimations, clipName];
			if (m.playState === 'stopped') m.playState = 'playing';
			logGltf.info('Animation on:', m.name, '→', clipName);
		} else {
			m.activeAnimations = m.activeAnimations.filter((c) => c !== clipName);
			if (m.activeAnimations.length === 0) m.playState = 'stopped';
			logGltf.info('Animation off:', m.name, '→', clipName);
		}
	},

	setPlayState(id: string, state: 'playing' | 'paused' | 'stopped') {
		const m = find(id);
		if (m) m.playState = state;
	},

	setSpeed(id: string, speed: number) {
		const m = find(id);
		if (m) m.animationSpeed = speed;
	},

	setCrossfadeDuration(id: string, duration: number) {
		const m = find(id);
		if (m) m.crossfadeDuration = duration;
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
