import { useStage, useTask, useThrelte, type Task } from '@threlte/core';
import { useSceneManager } from './SceneManager.svelte.ts';

// ============================================================================
// Game Task Stages
// ============================================================================
// The render pipeline is organized into stages that execute in order:
// 1. physicsStage - Update physics, game logic (BEFORE render)
// 2. renderStage - Render the 3D scene (default Threlte stage)
// 3. uiStage - Update UI elements (AFTER render)
// 4. audioStage - Update audio (AFTER UI)
// ============================================================================

export interface GameStages {
	physicsStage: ReturnType<typeof useStage>;
	renderStage: ReturnType<typeof useStage>;
	uiStage: ReturnType<typeof useStage>;
	audioStage: ReturnType<typeof useStage>;
}

export interface GameTasks {
	stages: GameStages;
	createPhysicsTask: (callback: (delta: number) => void, options?: TaskOptions) => TaskReturn;
	createUiTask: (callback: (delta: number) => void, options?: TaskOptions) => TaskReturn;
	createAudioTask: (callback: (delta: number) => void, options?: TaskOptions) => TaskReturn;
}

export interface TaskOptions {
	key?: string;
	autoInvalidate?: boolean;
	running?: () => boolean;
}

export interface TaskReturn {
	task: Task;
	started: any; // Readable<boolean>
}

// ============================================================================
// Main Hook: useGameTasks
// ============================================================================

export const useGameTasks = (): GameTasks => {
	const { renderStage } = useThrelte();
	const { state: sceneState } = useSceneManager();

	// Create specialized stages
	const physicsStage = useStage('physics', {
		before: renderStage,
		callback: (_delta, runTasks) => {
			// Only run physics in demo scene (pause in menus)
			if (sceneState.currentScene === 'demoScene') {
				runTasks();
			}
		}
	});

	const uiStage = useStage('ui', {
		after: renderStage,
		callback: (_delta, runTasks) => {
			// UI runs in all scenes except when transitioning
			if (!sceneState.isTransitioning) {
				runTasks();
			}
		}
	});

	const audioStage = useStage('audio', {
		after: uiStage,
		callback: (_delta, runTasks) => {
			// Audio always runs (background music, etc.)
			runTasks();
		}
	});

	// Helper functions to create tasks in specific stages
	const createPhysicsTask = (
		callback: (delta: number) => void,
		options?: TaskOptions
	): TaskReturn => {
		const result = useTask(callback, {
			stage: physicsStage,
			autoInvalidate: options?.autoInvalidate ?? false,
			running: options?.running
		});

		return { task: result.task, started: result.started };
	};

	const createUiTask = (callback: (delta: number) => void, options?: TaskOptions): TaskReturn => {
		const result = useTask(callback, {
			stage: uiStage,
			autoInvalidate: options?.autoInvalidate ?? false,
			running: options?.running
		});

		return { task: result.task, started: result.started };
	};

	const createAudioTask = (
		callback: (delta: number) => void,
		options?: TaskOptions
	): TaskReturn => {
		const result = useTask(callback, {
			stage: audioStage,
			autoInvalidate: options?.autoInvalidate ?? false,
			running: options?.running
		});

		return { task: result.task, started: result.started };
	};

	return {
		stages: {
			physicsStage,
			renderStage,
			uiStage,
			audioStage
		},
		createPhysicsTask,
		createUiTask,
		createAudioTask
	};
};

// ============================================================================
// Performance Profiling Helper
// ============================================================================

export const usePerformanceProfiler = () => {
	const { mainStage, renderStage } = useThrelte();

	const beforeMainStage = useStage('profiler-begin', {
		before: mainStage
	});

	const afterRenderStage = useStage('profiler-end', {
		after: renderStage
	});

	let perfData = $state({
		frameTime: 0,
		lastFrameTime: 0
	});

	useTask(
		() => {
			perfData.lastFrameTime = performance.now();
		},
		{ stage: beforeMainStage }
	);

	useTask(
		() => {
			perfData.frameTime = performance.now() - perfData.lastFrameTime;
		},
		{ stage: afterRenderStage }
	);

	return {
		perfData,
		stages: { beforeMainStage, afterRenderStage }
	};
};
