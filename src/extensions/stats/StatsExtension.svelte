<script lang="ts">
	import { useThrelte, useTask } from '@threlte/core/webgpu';
	import Stats from 'stats-gl';
	import { TimestampQuery } from 'three/webgpu';
	import { onMount, onDestroy } from 'svelte';
	import type { Snippet } from 'svelte';
	import { captureState } from '$extensions/capture';

	interface Props {
		children?: Snippet;
	}

	let { children }: Props = $props();

	const { renderer, autoRenderTask } = useThrelte();

	const SAMPLES = 40;

	interface InfoPanel {
		canvas: HTMLCanvasElement;
		update(value: number, maxValue: number, decimals?: number, suffix?: string): void;
		updateGraph(valueGraph: number, maxGraph: number): void;
	}
	const PanelCtor: new (name: string, fg: string, bg: string) => InfoPanel = (Stats as any).Panel;

	let stats: Stats | undefined;

	let drawCallsPanel: InfoPanel | undefined;
	let trianglesPanel: InfoPanel | undefined;
	let computePanel: InfoPanel | undefined;
	let rtPanel: InfoPanel | undefined;
	let geometriesPanel: InfoPanel | undefined;
	let texturesPanel: InfoPanel | undefined;
	let programsPanel: InfoPanel | undefined;

	const drawCallsHistory: number[] = [];
	const trianglesHistory: number[] = [];
	const computeHistory: number[] = [];
	const rtHistory: number[] = [];
	const geometriesHistory: number[] = [];
	const texturesHistory: number[] = [];
	const programsHistory: number[] = [];

	function pushHistory(arr: number[], value: number) {
		arr.push(value);
		if (arr.length > SAMPLES) arr.shift();
	}

	// three zeroes info.render.* at the START of every frame — Animation.js runs
	// info.reset() inside Threlte's setAnimationLoop callback, BEFORE the scheduler
	// (and therefore before renderer.render) — so the per-frame counters must be sampled
	// AFTER the render task to read the frame's accumulated values.
	//
	// render.calls and compute.calls are LIFETIME counts (of renderer.render() and
	// renderer.compute() invocations) that reset() never touches — they double as the
	// on-demand skip detectors: on frames where neither changed, nothing ran, so the
	// panels hold their previous value instead of dipping to a bogus 0. Compute gets
	// its own detector because a compute pass (Birds.svelte) can run on a frame whose
	// render was skipped.
	let lastRenderCalls = -1;
	let lastComputeCalls = -1;

	function updateCustomPanels() {
		const info = renderer.info;
		const rendered = info.render.calls !== lastRenderCalls;
		const computed = info.compute.calls !== lastComputeCalls;
		if (!rendered && !computed) return; // no render and no compute since last sample
		lastRenderCalls = info.render.calls;
		lastComputeCalls = info.compute.calls;
		const dc = info.render.drawCalls;
		const tri = info.render.triangles;
		// CMP: this frame's compute passes (Birds.svelte runs two while the flock is
		// airborne). frameCalls is zeroed with the render counters at frame start.
		const cmp = info.compute.frameCalls;
		// RT: active render targets — env bake, cube captures, the floor reflector, the
		// height-field target, the lens layers' framebuffer copies. Lifetime memory
		// accounting, like GEO/TEX.
		const rt = info.memory.renderTargets;
		const geo = info.memory.geometries;
		const tex = info.memory.textures;
		// WebGPU's info has no `programs` array (that is WebGL's shape) — the count of
		// active programs lives in memory.programs.
		const prg = info.memory.programs;

		pushHistory(drawCallsHistory, dc);
		pushHistory(trianglesHistory, tri);
		pushHistory(computeHistory, cmp);
		pushHistory(rtHistory, rt);
		pushHistory(geometriesHistory, geo);
		pushHistory(texturesHistory, tex);
		pushHistory(programsHistory, prg);

		const maxDc = Math.max(...drawCallsHistory);
		const maxTri = Math.max(...trianglesHistory);
		const maxCmp = Math.max(...computeHistory);
		const maxRt = Math.max(...rtHistory);
		const maxGeo = Math.max(...geometriesHistory);
		const maxTex = Math.max(...texturesHistory);
		const maxPrg = Math.max(...programsHistory);

		drawCallsPanel?.update(dc, maxDc || 1, 0);
		drawCallsPanel?.updateGraph(dc, maxDc || 1);

		trianglesPanel?.update(tri, maxTri || 1, 0);
		trianglesPanel?.updateGraph(tri, maxTri || 1);

		computePanel?.update(cmp, maxCmp || 1, 0);
		computePanel?.updateGraph(cmp, maxCmp || 1);

		rtPanel?.update(rt, maxRt || 1, 0);
		rtPanel?.updateGraph(rt, maxRt || 1);

		geometriesPanel?.update(geo, maxGeo || 1, 0);
		geometriesPanel?.updateGraph(geo, maxGeo || 1);

		texturesPanel?.update(tex, maxTex || 1, 0);
		texturesPanel?.updateGraph(tex, maxTex || 1);

		programsPanel?.update(prg, maxPrg || 1, 0);
		programsPanel?.updateGraph(prg, maxPrg || 1);
	}

	onMount(async () => {
		stats = new Stats({
			trackGPU: true,
			trackCPT: true,
			trackHz: true,
			logsPerSecond: 30,
			graphsPerSecond: 30,
			horizontal: false
		});
		await stats.init(renderer);

		drawCallsPanel = stats.addPanel(new PanelCtor('DC', '#f80', '#320') as any);
		trianglesPanel = stats.addPanel(new PanelCtor('TRI', '#88f', '#223') as any);
		computePanel = stats.addPanel(new PanelCtor('CMP', '#ff8', '#332') as any);
		rtPanel = stats.addPanel(new PanelCtor('RT', '#8ff', '#233') as any);
		geometriesPanel = stats.addPanel(new PanelCtor('GEO', '#f0f', '#303') as any);
		texturesPanel = stats.addPanel(new PanelCtor('TEX', '#0f8', '#032') as any);
		programsPanel = stats.addPanel(new PanelCtor('PRG', '#fa0', '#320') as any);

		document.body.appendChild(stats.dom);

		// stats-gl hardcodes `position: fixed; top: 0; left: 0` in its own `initializeDOM`,
		// which parks the panel under the Studio toolbar. Move it to the right edge,
		// vertically centred — clear of both the toolbar and the bottom-right Default
		// Camera preview.
		//
		// The container has to be given a size first. stats-gl lays every panel out as
		// `position: absolute` inside it (`left: 0; top: id * 48px`, see `resizePanel`),
		// so the div itself measures 0x0. That goes unnoticed at `top: 0; left: 0`, but it
		// makes right/centre anchoring meaningless: the right edge of a zero-width box sits
		// at the viewport edge and every child then starts *outside* it, and
		// `translateY(-50%)` of zero height shifts nothing. Measuring the children keeps
		// this correct as panels are added or removed above.
		//
		// Set as individual properties rather than `cssText` so stats-gl's own `opacity`
		// and `z-index` survive. Nothing rewrites them later: `initializeDOM` runs once
		// from the constructor, and the resize handler only resizes the panel canvases.
		const panels = Array.from(stats.dom.children) as HTMLElement[];
		const contentWidth = panels.reduce((max, p) => Math.max(max, p.offsetLeft + p.offsetWidth), 0);
		const contentHeight = panels.reduce((max, p) => Math.max(max, p.offsetTop + p.offsetHeight), 0);

		stats.dom.style.width = `${contentWidth}px`;
		stats.dom.style.height = `${contentHeight}px`;
		stats.dom.style.left = 'auto';
		stats.dom.style.right = '0';
		stats.dom.style.top = '50%';
		stats.dom.style.transform = 'translateY(-50%)';
	});

	// stats-gl turns on `renderer.backend.trackTimestamp` for trackGPU/trackCPT, but on a
	// three WebGPURenderer it only ever *reads* `renderer.info.<queue>.timestamp` — it never
	// resolves the queries. A pool's `currentQueryIndex` is only rewound inside
	// `_resolveQueries`, so an unresolved pool fills up and three warns
	// "WebGPUTimestampQueryPool [<queue>]: Maximum number of queries exceeded".
	// Resolving here both silences that and is what actually populates the values stats-gl
	// reads.
	//
	// BOTH QUEUES, and the compute one is not optional merely because compute is. three
	// keeps a SEPARATE POOL PER TYPE -- the render context's uid picks it, `c:` prefix for
	// compute -- so resolving RENDER never touches the compute pool, and any compute
	// work (Birds.svelte) fills that one on its own until it warns.
	//
	// Tracked per queue rather than under one flag, so a slow queue cannot hold up the
	// other's turn. Resolving a queue that ran no passes this frame is a no-op inside three
	// (`currentQueryIndex === 0` returns the last value), so the compute call costs
	// nothing on frames with no compute passes.
	//
	// Fire-and-forget: it must not block the frame, and it rejects harmlessly if the
	// device is lost or the feature is unsupported.
	const TIMESTAMP_QUEUES = [TimestampQuery.RENDER, TimestampQuery.COMPUTE] as const;
	const resolving = new Set<string>();
	const resolveGpuTimestamps = () => {
		if (!renderer.backend?.trackTimestamp) return;
		for (const queue of TIMESTAMP_QUEUES) {
			if (resolving.has(queue)) continue;
			resolving.add(queue);
			renderer
				.resolveTimestampsAsync(queue)
				.catch(() => {})
				.finally(() => {
					resolving.delete(queue);
				});
		}
	};

	// --- pause while capture is recording ------------------------------------------
	//
	// All of the measurement lands on the main thread inside the same frame a recording
	// is trying to blit and hand to the encoder: per-pass timestamp queries
	// (`backend.trackTimestamp`), two async resolves, and ten small 2D canvas repaints
	// (stats-gl's three panels plus the seven custom ones). None of it is visible in the
	// output anyway — the panels are HTML siblings of the canvas. trackTimestamp is
	// cleared too rather than just skipping the task: the per-pass query writes happen
	// inside the renderer, well upstream of anything this task does. The DOM is left
	// alone — hiding it would reflow, and it is not in the capture.
	let trackTimestampBefore: boolean | undefined;

	$effect(() => {
		if (!captureState.isRecording) return;
		const backend = renderer.backend;
		if (!backend) return;
		trackTimestampBefore = backend.trackTimestamp;
		backend.trackTimestamp = false;
		return () => {
			backend.trackTimestamp = trackTimestampBefore ?? false;
			// The panels held their last value for the whole take; the lifetime counters
			// moved on regardless, so re-arm the detectors instead of reporting a jump.
			lastRenderCalls = -1;
			lastComputeCalls = -1;
		};
	});

	// AFTER the render task (see updateCustomPanels) and autoInvalidate OFF: a stats
	// read must not itself defeat on-demand rendering.
	useTask(
		() => {
			if (captureState.isRecording) return;
			stats?.update();
			updateCustomPanels();
			resolveGpuTimestamps();
		},
		{ after: autoRenderTask, autoInvalidate: false }
	);

	onDestroy(() => {
		stats?.dispose();
		stats = undefined;
	});
</script>

{@render children?.()}
