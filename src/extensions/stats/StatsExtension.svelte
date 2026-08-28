<script lang="ts">
	import { useThrelte, useTask } from '@threlte/core/webgpu';
	import Stats from 'stats-gl';
	import { TimestampQuery } from 'three/webgpu';
	import { onMount, onDestroy } from 'svelte';
	import type { Snippet } from 'svelte';

	interface Props {
		children?: Snippet;
	}

	let { children }: Props = $props();

	const { renderer } = useThrelte();

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
	let pointsPanel: InfoPanel | undefined;
	let linesPanel: InfoPanel | undefined;
	let geometriesPanel: InfoPanel | undefined;
	let texturesPanel: InfoPanel | undefined;
	let programsPanel: InfoPanel | undefined;

	const drawCallsHistory: number[] = [];
	const trianglesHistory: number[] = [];
	const pointsHistory: number[] = [];
	const linesHistory: number[] = [];
	const geometriesHistory: number[] = [];
	const texturesHistory: number[] = [];
	const programsHistory: number[] = [];

	function pushHistory(arr: number[], value: number) {
		arr.push(value);
		if (arr.length > SAMPLES) arr.shift();
	}

	function updateCustomPanels() {
		const info = renderer.info;
		const dc = info.render.drawCalls;
		const tri = info.render.triangles;
		const pts = info.render.points;
		const ln = info.render.lines;
		const geo = info.memory.geometries;
		const tex = info.memory.textures;
		const prg = info.programs?.length ?? 0;

		pushHistory(drawCallsHistory, dc);
		pushHistory(trianglesHistory, tri);
		pushHistory(pointsHistory, pts);
		pushHistory(linesHistory, ln);
		pushHistory(geometriesHistory, geo);
		pushHistory(texturesHistory, tex);
		pushHistory(programsHistory, prg);

		const maxDc = Math.max(...drawCallsHistory);
		const maxTri = Math.max(...trianglesHistory);
		const maxPts = Math.max(...pointsHistory);
		const maxLn = Math.max(...linesHistory);
		const maxGeo = Math.max(...geometriesHistory);
		const maxTex = Math.max(...texturesHistory);
		const maxPrg = Math.max(...programsHistory);

		drawCallsPanel?.update(dc, maxDc || 1, 0);
		drawCallsPanel?.updateGraph(dc, maxDc || 1);

		trianglesPanel?.update(tri, maxTri || 1, 0);
		trianglesPanel?.updateGraph(tri, maxTri || 1);

		pointsPanel?.update(pts, maxPts || 1, 0);
		pointsPanel?.updateGraph(pts, maxPts || 1);

		linesPanel?.update(ln, maxLn || 1, 0);
		linesPanel?.updateGraph(ln, maxLn || 1);

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
		pointsPanel = stats.addPanel(new PanelCtor('PTS', '#ff8', '#332') as any);
		linesPanel = stats.addPanel(new PanelCtor('LINE', '#8ff', '#233') as any);
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
	// three WebGPURenderer it only ever *reads* `renderer.info.render.timestamp` — it never
	// resolves the queries. The pool then fills up and three warns
	// "WebGPUTimestampQueryPool [render]: Maximum number of queries exceeded".
	// Resolving here both silences that and is what actually populates the value stats-gl
	// reads, so the GPU panel reports real numbers instead of staying at zero.
	// Fire-and-forget: it must not block the frame, and it rejects harmlessly if the
	// device is lost or the feature is unsupported.
	let resolvingTimestamps = false;
	const resolveGpuTimestamps = () => {
		if (resolvingTimestamps || !renderer.backend?.trackTimestamp) return;
		resolvingTimestamps = true;
		renderer
			.resolveTimestampsAsync(TimestampQuery.RENDER)
			.catch(() => {})
			.finally(() => {
				resolvingTimestamps = false;
			});
	};

	useTask(() => {
		stats?.update();
		updateCustomPanels();
		resolveGpuTimestamps();
	});

	onDestroy(() => {
		stats?.dispose();
		stats = undefined;
	});
</script>

{@render children?.()}
