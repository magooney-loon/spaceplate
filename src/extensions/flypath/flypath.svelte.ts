// Camera flypath state + actions.
//
// The state and all the authoring logic live here (always reactive, works without Studio,
// per the extension rules in extensions/CLAUDE.md). Anything that needs the camera, the
// curve or a frame task is in `FlyPath.svelte` and reached through the driver slot.
//
// EASING IS GLOBAL, NOT PER SEGMENT. Easing each segment separately would drive velocity
// to zero at every waypoint — a stop-and-go crawl rather than a flythrough. So the ease
// shapes progress across the whole path, and the per-waypoint durations shape pacing
// within it. The two are independent knobs.

import { logEngine } from '$extensions/logger';
import type {
	FlyPathActions,
	FlyPathDriver,
	FlyPathEasing,
	FlyPathState,
	FlyPathWaypoint
} from './types';

export type {
	FlyPathActions,
	FlyPathDriver,
	FlyPathEasing,
	FlyPathOrientationMode,
	FlyPathState,
	FlyPathWaypoint
} from './types';

const STORAGE_KEY = 'flypath';

const DEFAULTS: FlyPathState = {
	waypoints: [],
	selectedId: null,
	orientationMode: 'waypoint',
	lookAtTarget: [0, 0, 0],
	easing: 'easeInOut',
	speed: 1,
	tension: 0.5,
	loop: false,
	showPath: true,
	isPlaying: false,
	progress: 0,
	status: 'No waypoints'
};

/** Persisted fields only — the driver-written ones are runtime state. */
type PersistedFlyPath = Pick<
	FlyPathState,
	| 'waypoints'
	| 'orientationMode'
	| 'lookAtTarget'
	| 'easing'
	| 'speed'
	| 'tension'
	| 'loop'
	| 'showPath'
>;

const load = (): FlyPathState => {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return { ...DEFAULTS };
		const saved = JSON.parse(raw) as Partial<PersistedFlyPath>;
		return {
			...DEFAULTS,
			...saved,
			// A malformed waypoint would break the curve on the first frame; drop the lot
			// rather than half-load it.
			waypoints: Array.isArray(saved.waypoints) ? saved.waypoints : []
		};
	} catch (error) {
		logEngine.warn('FlyPath: could not read saved path, starting empty', error);
		return { ...DEFAULTS };
	}
};

export const flyPathState = $state<FlyPathState>(load());

const persist = () => {
	try {
		const snapshot: PersistedFlyPath = {
			waypoints: $state.snapshot(flyPathState.waypoints),
			orientationMode: flyPathState.orientationMode,
			lookAtTarget: $state.snapshot(flyPathState.lookAtTarget),
			easing: flyPathState.easing,
			speed: flyPathState.speed,
			tension: flyPathState.tension,
			loop: flyPathState.loop,
			showPath: flyPathState.showPath
		};
		localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
	} catch (error) {
		logEngine.warn('FlyPath: could not persist path', error);
	}
};

/**
 * For the driver: dragging a marker with Studio's transform gizmo writes straight into
 * `flyPathState.waypoints`, bypassing the actions above. It persists once the drag
 * settles rather than at 60 Hz.
 */
export const persistFlyPath = (): void => persist();

// --- driver slot -------------------------------------------------------------

let driver: FlyPathDriver | null = null;

export const registerFlyPathDriver = (value: FlyPathDriver): void => {
	driver = value;
};

export const unregisterFlyPathDriver = (): void => {
	driver = null;
};

const requireDriver = (what: string): FlyPathDriver | null => {
	if (!driver) {
		logEngine.warn(`FlyPath: ${what} ignored — no driver mounted`);
		flyPathState.status = 'No driver mounted';
	}
	return driver;
};

// --- derived helpers (pure, shared with the driver) ---------------------------

/** Segments the curve is divided into: one per gap, plus the closing gap when looping. */
export const segmentCount = (state: FlyPathState): number =>
	state.waypoints.length < 2 ? 0 : state.loop ? state.waypoints.length : state.waypoints.length - 1;

/** Total run time in seconds, after the global speed multiplier. */
export const totalDuration = (state: FlyPathState): number => {
	const segments = segmentCount(state);
	if (segments === 0) return 0;
	let total = 0;
	for (let i = 0; i < segments; i++) total += Math.max(0.01, state.waypoints[i].duration);
	return total / Math.max(0.01, state.speed);
};

export const EASINGS: Record<FlyPathEasing, (t: number) => number> = {
	linear: (t) => t,
	easeIn: (t) => t * t,
	easeOut: (t) => 1 - (1 - t) * (1 - t),
	easeInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) * (-2 * t + 2)) / 2)
};

const find = (id: string): FlyPathWaypoint | undefined =>
	flyPathState.waypoints.find((w) => w.id === id);

const describe = () => {
	const count = flyPathState.waypoints.length;
	if (count === 0) return 'No waypoints';
	if (count === 1) return '1 waypoint — add another to fly';
	return `${count} waypoints · ${totalDuration(flyPathState).toFixed(1)}s`;
};

const refreshStatus = () => {
	if (!flyPathState.isPlaying) flyPathState.status = describe();
};

// --- actions -----------------------------------------------------------------

export const flyPathActions: FlyPathActions = {
	addWaypoint() {
		const pose = requireDriver('addWaypoint')?.captureWaypoint();
		if (!pose) return;
		const waypoint: FlyPathWaypoint = {
			id: crypto.randomUUID().slice(0, 8),
			name: `Shot ${flyPathState.waypoints.length + 1}`,
			position: pose.position,
			quaternion: pose.quaternion,
			fov: pose.fov,
			duration: 3
		};
		flyPathState.waypoints.push(waypoint);
		flyPathState.selectedId = waypoint.id;
		persist();
		refreshStatus();
		logEngine.info(`FlyPath: added ${waypoint.name} at`, pose.position);
	},

	updateWaypoint(id) {
		const waypoint = find(id);
		const pose = requireDriver('updateWaypoint')?.captureWaypoint();
		if (!waypoint || !pose) return;
		waypoint.position = pose.position;
		waypoint.quaternion = pose.quaternion;
		waypoint.fov = pose.fov;
		persist();
		logEngine.info(`FlyPath: re-snapshotted ${waypoint.name}`);
	},

	removeWaypoint(id) {
		const index = flyPathState.waypoints.findIndex((w) => w.id === id);
		if (index === -1) return;
		flyPathState.waypoints.splice(index, 1);
		if (flyPathState.selectedId === id) flyPathState.selectedId = null;
		persist();
		refreshStatus();
	},

	moveWaypoint(id, delta) {
		const index = flyPathState.waypoints.findIndex((w) => w.id === id);
		const next = index + delta;
		if (index === -1 || next < 0 || next >= flyPathState.waypoints.length) return;
		const [waypoint] = flyPathState.waypoints.splice(index, 1);
		flyPathState.waypoints.splice(next, 0, waypoint);
		persist();
	},

	selectWaypoint(id) {
		flyPathState.selectedId = id;
	},

	setWaypointDuration(id, seconds) {
		const waypoint = find(id);
		if (!waypoint) return;
		waypoint.duration = seconds;
		persist();
		refreshStatus();
	},

	setWaypointFov(id, fov) {
		const waypoint = find(id);
		if (!waypoint) return;
		waypoint.fov = fov;
		persist();
	},

	clear() {
		driver?.stop();
		flyPathState.waypoints = [];
		flyPathState.selectedId = null;
		flyPathState.progress = 0;
		persist();
		refreshStatus();
		logEngine.info('FlyPath: cleared');
	},

	setOrientationMode(mode) {
		flyPathState.orientationMode = mode;
		persist();
	},

	setLookAtTarget(target) {
		flyPathState.lookAtTarget = target;
		persist();
	},

	setLookAtFromCamera() {
		const position = requireDriver('setLookAtFromCamera')?.cameraPosition();
		if (!position) return;
		flyPathState.lookAtTarget = position;
		persist();
		logEngine.info('FlyPath: look-at target set to', position);
	},

	setEasing(easing) {
		flyPathState.easing = easing;
		persist();
	},

	setSpeed(speed) {
		flyPathState.speed = speed;
		persist();
		refreshStatus();
	},

	setTension(tension) {
		flyPathState.tension = tension;
		persist();
	},

	setLoop(loop) {
		flyPathState.loop = loop;
		persist();
		refreshStatus();
	},

	setShowPath(show) {
		flyPathState.showPath = show;
		persist();
	},

	play() {
		if (segmentCount(flyPathState) === 0) {
			flyPathState.status = 'Need at least 2 waypoints';
			return;
		}
		requireDriver('play')?.play();
	},

	pause() {
		driver?.pause();
	},

	stop() {
		driver?.stop();
	},

	scrub(progress) {
		if (segmentCount(flyPathState) === 0) return;
		requireDriver('scrub')?.scrub(progress);
	},

	recordFlythrough() {
		if (segmentCount(flyPathState) === 0) {
			flyPathState.status = 'Need at least 2 waypoints';
			return;
		}
		requireDriver('recordFlythrough')?.recordFlythrough();
	}
};
