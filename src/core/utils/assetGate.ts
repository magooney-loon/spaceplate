import { useProgress } from '@threlte/extras';
import { logEngine } from '$extensions/logger';

// THE ASSET GATE — "has the app stopped loading yet?", callable.
//
// three's LoadingManager has no 'queue drained' event worth latching on: an item
// finishing makes `loaded` catch up with `total` transiently BETWEEN items, so the
// first catch-up is not the end of the queue (that is the same trap Loader.svelte's
// `settled` documents at boot). IDLE here therefore means QUIET FOR A GRACE PERIOD —
// the manager inactive for `quietMs` without interruption; any new item restarts the
// wait. The nothing-to-load case falls out of it for free.
//
// It watches the DEFAULT loading manager, which is the one every loader in this app
// ends up on: Threlte's `useGltf`/`useLoader` (the car, the track), the bare
// `TextureLoader`s (the moon, the noise PNGs, the clearcoat maps) and the audio
// buffers alike. THAT is why a scene declares nothing — mounting it starts its loads
// and this sees them. What it cannot see is a promise that never touches the manager;
// wrap that scene's subtree in @threlte/extras' `<Suspense>` and register the promise
// with `useSuspense()` if one ever exists. None does today.
//
// `useProgress()` takes no Threlte context (it patches the manager at module scope and
// hands back module-global stores), so this is callable from plain modules — the scene
// transition lives outside the Canvas.

const { active } = useProgress();

/** Continuous inactivity before the queue counts as drained. */
const QUIET_MS = 350;
/** Hard cap: a dead CDN must not trap the player behind the veil forever. */
const TIMEOUT_MS = 20_000;
const POLL_MS = 50;

export type AssetGateOutcome = 'idle' | 'timeout';

/**
 * Resolves once the loading queue has been quiet for `quietMs`, or when
 * `timeoutMs` expires — the caller enters either way, so this can only ever
 * delay a transition, never block one.
 *
 * Wall-clock (`Date.now`) on purpose: this measures a network wait, not scene
 * time. The engine clock's ban covers things that are ANIMATED off a delta
 * (core/utils/CLAUDE.md) — a load takes as long as it takes, and a below-realtime
 * capture take must not stretch the timeout with it.
 */
export async function waitForAssetsIdle({
	quietMs = QUIET_MS,
	timeoutMs = TIMEOUT_MS
}: { quietMs?: number; timeoutMs?: number } = {}): Promise<AssetGateOutcome> {
	const deadline = Date.now() + timeoutMs;
	let quietSince: number | null = null;

	for (;;) {
		const now = Date.now();

		if (active.current) {
			quietSince = null;
		} else {
			quietSince ??= now;
			if (now - quietSince >= quietMs) return 'idle';
		}

		if (now >= deadline) {
			logEngine.warn(
				`Assets still loading after ${Math.round(timeoutMs / 1000)}s — entering anyway`
			);
			return 'timeout';
		}

		await new Promise<void>((resolve) => setTimeout(resolve, POLL_MS));
	}
}
