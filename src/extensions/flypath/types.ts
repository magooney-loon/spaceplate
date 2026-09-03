export const extensionScope = 'flypath';

/**
 * One camera pose on the path. Position and quaternion are snapshotted from whatever
 * camera is current when the waypoint is added — the editor camera while authoring — and
 * can be nudged afterwards with Studio's transform gizmo (the markers are selectable).
 */
export type FlyPathWaypoint = {
	id: string;
	name: string;
	position: [number, number, number];
	quaternion: [number, number, number, number];
	/** Vertical FOV in degrees, interpolated along the path. Dolly-zoom lives here. */
	fov: number;
	/** Seconds to travel from THIS waypoint to the next. Unused on the last one (unless looping). */
	duration: number;
};

/** `waypoint` slerps the snapshotted orientations; `lookAt` aims at `lookAtTarget` throughout. */
export type FlyPathOrientationMode = 'waypoint' | 'lookAt';

export type FlyPathEasing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';

export type FlyPathState = {
	waypoints: FlyPathWaypoint[];
	selectedId: string | null;
	orientationMode: FlyPathOrientationMode;
	lookAtTarget: [number, number, number];
	/** Applied to progress across the WHOLE path, not per segment — see flypath.svelte.ts. */
	easing: FlyPathEasing;
	/** Global multiplier over every segment duration. */
	speed: number;
	/** CatmullRom tension, 0 = slack, 1 = tight. */
	tension: number;
	loop: boolean;
	/** Draw the tube + waypoint markers. Always suppressed while playing. */
	showPath: boolean;

	// --- driver-written, read-only from the panel's point of view ---
	isPlaying: boolean;
	/** 0..1 along the whole path. Also the scrub position. */
	progress: number;
	status: string;
};

export type FlyPathActions = {
	addWaypoint(): void;
	/** Re-snapshots an existing waypoint from the current camera. */
	updateWaypoint(id: string): void;
	removeWaypoint(id: string): void;
	moveWaypoint(id: string, delta: number): void;
	selectWaypoint(id: string | null): void;
	setWaypointDuration(id: string, seconds: number): void;
	setWaypointFov(id: string, fov: number): void;
	clear(): void;

	setOrientationMode(mode: FlyPathOrientationMode): void;
	setLookAtTarget(target: [number, number, number]): void;
	/** Snapshots the current camera's position as the look-at target. */
	setLookAtFromCamera(): void;
	setEasing(easing: FlyPathEasing): void;
	setSpeed(speed: number): void;
	setTension(tension: number): void;
	setLoop(loop: boolean): void;
	setShowPath(show: boolean): void;

	play(): void;
	pause(): void;
	stop(): void;
	scrub(progress: number): void;
	/** Rewinds, starts a capture recording, plays once, stops the recording at the end. */
	recordFlythrough(): void;
};

/**
 * Implemented by `FlyPath.svelte` — everything that needs the camera, the curve or a
 * frame task lives inside <Canvas>, while the panel does not. Same register/unregister
 * shape as the capture extension's driver and scenes/DemoScene/mirrorFloor.ts.
 */
export type FlyPathDriver = {
	captureWaypoint(): { position: [number, number, number]; quaternion: [number, number, number, number]; fov: number } | null;
	cameraPosition(): [number, number, number] | null;
	play(): void;
	pause(): void;
	stop(): void;
	scrub(progress: number): void;
	recordFlythrough(): void;
};
