// Device capability probe. Runs ONCE from main.ts before the app mounts, so every
// consumer reads a plain synchronous verdict.
//
// Why probe: `navigator.gpu` existing proves nothing — requestAdapter() returns null
// on blocklisted drivers, in VMs/headless and on builds with the feature compiled in
// but off; only an adapter proves WebGPU works. Without one, WebGPURenderer silently
// falls back to WebGL2 (App.svelte) — this probe makes that difference visible.
// WASM rides the same verdict: Rapier is WASM and Scene.svelte lives inside <World>,
// so no WASM means no app either.
//
// Three outcomes:
//   'webgpu' — real adapter; the full path.
//   'webgl'  — no adapter but WebGL2 exists; the renderer's own fallback. The app
//              runs, Loader.svelte shows a dismissible badge.
//   'none'   — neither; nothing can render. Loader.svelte blocks with a link to
//              WEBGPU_REPORT_URL and App.svelte never mounts the <Canvas>.
//
// Also seeds the graphics preset (seedGraphicsQuality) and fills Settings ▸ System
// together with telemetry.svelte.ts.

/** Where users are sent to see what their browser actually reports. */
export const WEBGPU_REPORT_URL = 'https://webgpureport.org/';

// GPUAdapter / GPUAdapterInfo come from TypeScript's lib.dom — no @webgpu/types needed.
// Older browsers predate the current shape, hence the shim below.

/**
 * Plain copy of GPUAdapterInfo. The platform object is never stored in `$state`
 * directly — Svelte's deep proxy has no business wrapping a host object.
 */
export type AdapterSnapshot = {
	vendor: string;
	architecture: string;
	device: string;
	description: string;
};

/** Pre-2024 shape: info was async, and isFallbackAdapter sat on the adapter itself. */
type LegacyAdapter = GPUAdapter & {
	isFallbackAdapter?: boolean;
	requestAdapterInfo?: () => Promise<GPUAdapterInfo>;
};

export type RenderTier = 'webgpu' | 'webgl' | 'none';

export const capabilityState = $state({
	/** False until probeCapabilities() has resolved; nothing below is meaningful before that. */
	probed: false,
	tier: 'none' as RenderTier,
	webgl2: false,
	wasm: false,
	/** Adapter identity, as far as the browser reveals it — Chrome masks device/description. */
	adapter: null as AdapterSnapshot | null,
	/** The WebGPU adapter is a software rasteriser: it works, it is not fast. */
	fallbackAdapter: false,
	/** true = discrete GPU present, false = integrated only, null = can't tell. */
	discreteGpu: null as boolean | null,
	/** WebGPU features the adapter reports, sorted — listed in Settings ▸ System. */
	features: [] as string[],
	/** Machine-level facts the browser is willing to share. */
	device: {
		/** navigator.hardwareConcurrency — logical cores, 0 when withheld. */
		threads: 0,
		/** navigator.deviceMemory in GB — Chromium only, 0 elsewhere. */
		memoryGb: 0,
		platform: ''
	}
});

/** Nothing can render, or WASM is missing — either way there is no app to show. */
export function isBlocked(): boolean {
	if (!capabilityState.probed) return false;
	return capabilityState.tier === 'none' || !capabilityState.wasm;
}

function probeWasm(): boolean {
	try {
		if (typeof WebAssembly !== 'object') return false;
		// The 8-byte empty module. Compiling it proves the engine is really there and
		// permitted, rather than just the namespace object existing.
		const probe = new WebAssembly.Module(Uint8Array.of(0x00, 0x61, 0x73, 0x6d, 0x01, 0, 0, 0));
		return probe instanceof WebAssembly.Module;
	} catch {
		return false;
	}
}

function probeWebGL2(): boolean {
	try {
		const gl = document.createElement('canvas').getContext('webgl2');
		if (!gl) return false;
		// Hand the context straight back — browsers cap how many are live at once, and
		// the one that matters is created moments later by the renderer's fallback.
		gl.getExtension('WEBGL_lose_context')?.loseContext();
		return true;
	} catch {
		return false;
	}
}

async function infoOf(adapter: GPUAdapter): Promise<AdapterSnapshot | null> {
	const legacy = adapter as LegacyAdapter;
	let info: GPUAdapterInfo | undefined = adapter.info;
	if (!info) {
		try {
			info = await legacy.requestAdapterInfo?.();
		} catch {
			info = undefined;
		}
	}
	if (!info) return null;
	return {
		vendor: info.vendor ?? '',
		architecture: info.architecture ?? '',
		device: info.device ?? '',
		description: info.description ?? ''
	};
}

/** Software rasteriser (SwiftShader-class): it renders, it is not fast. */
function isFallbackAdapter(adapter: GPUAdapter): boolean {
	const legacy = adapter as LegacyAdapter;
	return adapter.info?.isFallbackAdapter === true || legacy.isFallbackAdapter === true;
}

function identityOf(info: AdapterSnapshot | null): string {
	if (!info) return '';
	return [info.vendor, info.architecture, info.device, info.description].filter(Boolean).join('|');
}

export async function probeCapabilities(): Promise<void> {
	if (capabilityState.probed) return;

	capabilityState.wasm = probeWasm();
	capabilityState.webgl2 = probeWebGL2();
	capabilityState.device = {
		threads: navigator.hardwareConcurrency ?? 0,
		// Chromium-only, and quantised to 0.25/0.5/1/2/4/8 — an upper bound, not the truth.
		memoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 0,
		platform: navigator.platform ?? ''
	};

	// lib.dom types navigator.gpu as always present; it very much isn't.
	const gpu = navigator.gpu as GPU | undefined;
	if (gpu) {
		try {
			// 'high-performance' matches what App.svelte's WebGPURenderer asks for, so
			// this reports the adapter the app will actually run on.
			const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
			if (adapter) {
				const info = await infoOf(adapter);
				const fallback = isFallbackAdapter(adapter);
				capabilityState.tier = 'webgpu';
				capabilityState.adapter = info;
				capabilityState.fallbackAdapter = fallback;
				capabilityState.features = [...adapter.features].sort();
				capabilityState.discreteGpu = fallback ? false : await hasDiscreteGpu(gpu, info);
			}
		} catch {
			// requestAdapter() rejects outright on some hardened builds — treat as absent.
		}
	}

	if (capabilityState.tier !== 'webgpu') {
		capabilityState.tier = capabilityState.webgl2 ? 'webgl' : 'none';
	}
	capabilityState.probed = true;
}

// Hybrid laptops expose two adapters, so ask for both ends of the power scale and
// compare identities: different ones mean a discrete GPU. Chrome masks
// device/description, so vendor+architecture is usually all there is — when neither
// side reports anything, say null rather than guessing.
async function hasDiscreteGpu(gpu: GPU, highPerf: AdapterSnapshot | null): Promise<boolean | null> {
	try {
		const lowPower = await gpu.requestAdapter({ powerPreference: 'low-power' });
		if (!lowPower) return null;
		const a = identityOf(highPerf);
		const b = identityOf(await infoOf(lowPower));
		if (!a || !b) return null;
		return a !== b;
	} catch {
		return null;
	}
}
