import { useProgress } from '@threlte/extras';
import { logEngine } from '$extensions/logger';

// The asset gate — "has the app stopped loading yet?", callable.
//
// three's LoadingManager has no 'queue drained' event: an item finishing makes
// `loaded` catch up with `total` transiently between items, so idle here means quiet
// for a grace period instead — the manager inactive for `quietMs` without
// interruption; any new item restarts the wait.
//
// It watches the default loading manager, which every loader in this app ends up on
// (useGltf/useLoader, bare TextureLoaders, audio buffers), so a scene declares
// nothing — mounting it starts its loads and this sees them. What it can't see is a
// promise that never touches the manager; wrap that subtree in `<Suspense>` +
// `useSuspense()` if one ever exists (none does today).
//
// `useProgress()` takes no Threlte context, so this is callable from plain modules —
// the scene transition lives outside the Canvas.

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
