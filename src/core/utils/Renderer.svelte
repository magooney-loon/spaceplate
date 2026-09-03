<script lang="ts">
	// The post-processing pipeline — details in src/core/postprocessing/CLAUDE.md.
	// Owns exactly one THREE.RenderPipeline for its lifetime and swaps its
	// outputNode as the *structural key* changes (enabled set + quality + structural
	// params); param drags never rebuild — they write uniform values in place via
	// the hot effect. The graph itself is built by $core/postprocessing/build.ts.
	//
	// Studio task ordering per DOCS/webgpu-notes.md §2: registered
	// `{ after: autoRenderTask, autoInvalidate: false }`, and this component must
	// stay the FIRST child inside <Canvas> so it draws before the Gizmo. Tone
	// mapping is NOT written here — Threlte's renderer context owns it.

	import { useThrelte, useTask } from '@threlte/core/webgpu';
	import { untrack } from 'svelte';
	import * as THREE from 'three/webgpu';
	import { settingsState } from '$extensions/settings';
	import { logEngine, logPostprocessing } from '$extensions/logger';
	import { postprocessingState } from '$extensions/postprocessing';
	import { buildPipeline, type PipelineBuild } from '$core/postprocessing/build';
	import { EFFECTS, structuralKeyOf } from '$core/postprocessing/registry';
	import type { EffectValues } from '$core/postprocessing/types';
	import { bootState } from './boot.svelte';

	const { scene, renderer, camera, autoRenderTask, invalidate } = useThrelte();

	// Plain const, never $state — three.js instances stay raw (webgpu-notes §3.2).
	const renderPipeline = new THREE.RenderPipeline(renderer);
	let build: PipelineBuild | null = null;

	// --- structural key -------------------------------------------------------
	// Effects depend on primitive values only (webgpu-notes §3.1): the enabled
	// flags, the quality tier and the structural params collapse into one string.
	// A param drag that is not structural does not change it, so no rebuild fires.

	/** Only structural params, tracked — a non-structural drag must not touch the key. */
	const structuralValues = (): EffectValues => {
		const values: EffectValues = {};
		for (const def of EFFECTS) {
			if (!def.structural?.length) continue;
			const s = (postprocessingState as any)[def.id];
			if (s?.enabled) {
				const entry: Record<string, number> = {};
				for (const key of def.structural) entry[key] = s[key];
				values[def.id] = entry;
			}
		}
		return values;
	};

	/** Current param values of enabled effects — read UNTRACKED by the structural path. */
	const currentValues = (): EffectValues => {
		const values: EffectValues = {};
		for (const def of EFFECTS) {
			const s = (postprocessingState as any)[def.id];
			if (!s?.enabled) continue;
			// Declared numeric params only — `enabled` and stray keys must not become uniforms.
			const entry: Record<string, number> = { ...def.params() };
			for (const key of Object.keys(entry)) {
				if (typeof s[key] === 'number') entry[key] = s[key];
			}
			values[def.id] = entry;
		}
		return values;
	};

	const enabledIds = $derived(
		EFFECTS.filter((def) => (postprocessingState as any)[def.id]?.enabled).map((def) => def.id)
	);
	const quality = $derived(settingsState.graphics.quality);
	const structuralKey = $derived(quality + '|' + structuralKeyOf(enabledIds, structuralValues()));

	/**
	 * Low quality bypasses the pipeline ENTIRELY rather than building an empty one:
	 * a *built* pipeline is not free just because its graph is — the base `pass()`
	 * still allocates a full-resolution RGBA16Float target + Depth24Plus buffer and
	 * pays a fullscreen blit per frame, for a graph that does nothing. Low is the
	 * tier where that VRAM and bandwidth is scarce. At low we build nothing, hold no
	 * render target, and the task below renders straight to the canvas (tone mapping
	 * then being the renderer's own, as `outputColorTransform` would have done).
	 */
	const bypass = $derived(quality === 'low');

	// --- structural effect: rebuild the graph ---------------------------------

	$effect(() => {
		// Tracked reads: the key (hence the enabled set, quality, structural params), the
		// bypass flag and the camera — Studio's editor/game camera switch must follow.
		void structuralKey;
		const skip = bypass;
		const cam = $camera;
		if (!cam) return;

		untrack(() => {
			build?.dispose();
			build = null;

			// Disposing the build disposed the base pass and its render target — the
			// only large one we own — so dropping to low actually releases the memory.
			if (skip) {
				logPostprocessing.info('Post-processing bypassed: quality is low');
				invalidate();
				return;
			}

			build = buildPipeline({
				pipeline: renderPipeline,
				scene,
				camera: cam,
				renderer,
				enabled: enabledIds,
				values: currentValues(),
				quality
			});

			const report = build.report;
			if (!report.ok) {
				logPostprocessing.error(
					'Pipeline build failed — falling back to a plain pass:',
					report.error
				);
			} else if (report.active.length > 0 || report.basePassId !== 'default') {
				logPostprocessing.info(
					`Pipeline rebuilt: base=${report.basePassId}` +
						(report.mrt.length > 0 ? ` mrt=[${report.mrt.join(', ')}]` : '') +
						` effects=[${report.active.join(', ')}]`
				);
			}
			for (const { id, reason } of report.dropped) {
				logPostprocessing.warn(`Effect "${id}" dropped: ${reason}`);
			}

			// Make the new graph visible next frame even if nothing else is invalidating
			// (renderMode is on-demand; this task deliberately does not auto-invalidate).
			invalidate();
		});
	});

	// --- uniform effect: hot path, no rebuild ---------------------------------

	$effect(() => {
		// Tracked reads: the enabled ids and every enabled effect's param values.
		// Writes go to uniform nodes owned by the current build — no disposal, no
		// graph change, no round trip through the structural effect.
		for (const id of enabledIds) {
			const bag = build?.uniforms.get(id);
			if (!bag) continue;
			const values = (postprocessingState as any)[id];
			let wrote = false;
			for (const key of Object.keys(bag)) {
				if (key in values) {
					bag[key].value = values[key];
					wrote = true;
				}
			}
			if (wrote) invalidate();
		}
	});

	// --- teardown -------------------------------------------------------------

	$effect(() => {
		return () => {
			build?.dispose();
			build = null;
			renderPipeline.dispose();
		};
	});

	// --- boot warmup -----------------------------------------------------------

	// On-demand rendering draws only when something invalidates, so a quiet scene
	// behind the loading screen stays cold: everything (the base pass under its
	// private contextNode, all post effects, the mounted scenes' materials) would
	// compile at the first frame AFTER the loader hides — the stall a warm frame
	// removes. Each bootState.warmVersion bump (the warmup sweep, driven from
	// Loader.svelte) renders once through the real graph while a cover still hides
	// the canvas; renderer.init() is idempotent, and render() kicks three's async
	// compilation, which lands during the sweep's grace delays.
	//
	// Deliberately NOT renderer.compileAsync(scene, camera): it compiles under the
	// default context with no MRT — the wrong variants for this graph (see the
	// shader-cache trap in postprocessing/CLAUDE.md). Warming goes through the
	// pipeline itself.
	let warming = false;
	$effect(() => {
		const version = bootState.warmVersion;
		if (version === 0 || warming) return;
		warming = true;
		void (async () => {
			try {
				await renderer.init();
				if (bypass) {
					const cam = camera.current;
					if (cam) renderer.render(scene, cam);
					else return;
				} else if (build) {
					renderer.getSize(size);
					if (size.width > 0 && size.height > 0) build.setAspect(size.width / size.height);
					renderPipeline.render();
				} else {
					return;
				}
				logEngine.info(`Warm frame rendered (v${version}) — pipelines compiling in background`);
			} catch (error) {
				logEngine.warn('Pipeline warmup failed:', error);
			} finally {
				warming = false;
			}
		})();
	});

	// --- the render task ---------------------------------------------------------

	const size = new THREE.Vector2();

	useTask(
		() => {
			// `autoRender` is off (App.svelte), so this task is the ONLY thing that draws.
			// In bypass there is no pipeline to drive, and skipping the frame entirely
			// would render a blank canvas rather than an unprocessed one.
			if (bypass) {
				const cam = camera.current;
				if (cam) renderer.render(scene, cam);
				return;
			}
			if (!build) return;
			// Aspect for the vignette's roundness correction — cheap, per frame.
			renderer.getSize(size);
			if (size.width > 0 && size.height > 0) build.setAspect(size.width / size.height);
			renderPipeline.render();
		},
		{ after: autoRenderTask, autoInvalidate: false }
	);
</script>
