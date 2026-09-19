// Lap timing — a start/finish GATE at the car's own spawn, not authored
// track data: a FINITE segment across the road through the spawn pose,
// running wing-tip to wing-tip (perpendicular to the spawn heading),
// captured once by the controller the same step it captures the Restart
// pose (see controller.ts's `spawnCaptured` block). No checkpoint
// sequence exists (world/trackMap.ts builds a visual outline only,
// nothing measured for gameplay), so one nose-first crossing of that
// segment is the whole rule — which means a driver COULD cut the course
// and it would not be caught, and is not meant to catch that.
//
// WHY FINITE. The crossing test is against a plane, and a plane is
// infinite: a bare test scored a forward pass ANYWHERE on the spawn's
// line, and a circuit that crosses that line at the spawn must cross it
// somewhere else too (a closed loop crosses any line an even number of
// times) — so the infinite version counted phantom laps half a track
// away from the start. `GATE_HALF_WIDTH` bounds the crossing to the road
// at the spawn; debug/LapGate.svelte draws the exact segment on the B
// view, so the width can be checked against the road it spans by eye.
// `MIN_LAP_TIME` is the stand-in for "you actually went around" until
// real checkpoints exist: without it the reverse-then-pull-away wiggle
// right off the line (the car sits just behind the gate, creeps back
// over it, then launches forward across it again) reads as an instant
// lap.

import { clamp } from './carMath';

/** World units — half the gate's extent across the road. The asphalt at the
 *  spawn is ~13–16 units wide (trackMap.ts's own measurement: a road is "a
 *  dozen-odd cells" at ~1.1 units per cell), so 20 spans it with runoff to
 *  spare while staying far from the circuit's every OTHER crossing of the
 *  spawn line. Eyeball it against the drawn gate (B view) before trusting a
 *  change: too narrow steals laps taken wide, too wide lets the phantom
 *  crossings back in. */
export const GATE_HALF_WIDTH = 20;

/** s — a crossing sooner than this after the last one is the line-tap wiggle,
 *  not a lap: this track has no authored length to check against, and a
 *  genuine lap here is tens of seconds at minimum, so the floor is nowhere
 *  near a real time and only ever rejects noise at the line. */
const MIN_LAP_TIME = 10;

export interface LapState {
	/** s — running since the last valid crossing (or since spawn/restart). Keeps
	 *  counting regardless of the pedals — a stopwatch does not pause because
	 *  the car did. */
	lapTime: number;
	/** s — the last completed lap. -1 = none yet this session. */
	lastLapTime: number;
	/** s — the best completed lap. -1 = none yet (persisted across sessions by
	 *  the caller — see controller.ts's localStorage read/write). */
	bestLapTime: number;
	/** Valid crossings this session. */
	lapCount: number;
}

export type LapTimer = ReturnType<typeof createLapTimer>;

/** The gate's world pose — `step` tests it and debug/LapGate.svelte draws it,
 *  so both read THIS object and cannot disagree about where the line is. */
export interface LapGatePose {
	/** False until `setGate` runs once — before that there is no spawn to build
	 *  a gate from (the controller captures it on its first physics step). */
	armed: boolean;
	/** World XZ of the gate's centre — the spawn. */
	x: number;
	z: number;
	/** Unit nose direction at spawn, XZ. A crossing counts only nose-first. */
	fwdX: number;
	fwdZ: number;
	/** Unit across-track direction, XZ — the segment runs ±`halfWidth` along
	 *  it. The heading turned a quarter way in the ground plane. */
	rightX: number;
	rightZ: number;
	/** Half the gate's extent along `right`, world units. */
	halfWidth: number;
}

/** `bestLapTime` seeds from the caller (localStorage) — everything else always
 *  starts fresh, a best lap is the one thing worth carrying in. */
export function createLapTimer(bestLapTime = -1) {
	const state: LapState = { lapTime: 0, lastLapTime: -1, bestLapTime, lapCount: 0 };

	const gate: LapGatePose = {
		armed: false,
		x: 0,
		z: 0,
		fwdX: 0,
		fwdZ: -1,
		rightX: 1,
		rightZ: 0,
		halfWidth: GATE_HALF_WIDTH
	};

	/** Signed distance along the gate's heading at the LAST step — the edge
	 *  a crossing is a rising edge of. */
	let prevSigned = 0;

	/** Called once, the same step the controller captures the spawn pose. The
	 *  gate's normal is the spawn heading in the XZ plane — `forwardX/Z` should
	 *  be the (already unit-length, but re-normalised here defensively) nose
	 *  direction at spawn. */
	function setGate(x: number, z: number, forwardX: number, forwardZ: number): void {
		gate.x = x;
		gate.z = z;
		const len = Math.hypot(forwardX, forwardZ) || 1;
		gate.fwdX = forwardX / len;
		gate.fwdZ = forwardZ / len;
		gate.rightX = -gate.fwdZ;
		gate.rightZ = gate.fwdX;
		prevSigned = 0;
		gate.armed = true;
	}

	/** Advance one physics step with the car's current world XZ. */
	function step(delta: number, x: number, z: number): void {
		state.lapTime += delta;
		if (!gate.armed) return;
		const signed = (x - gate.x) * gate.fwdX + (z - gate.z) * gate.fwdZ;
		if (prevSigned < 0 && signed >= 0 && state.lapTime >= MIN_LAP_TIME) {
			// A nose-first crossing of the plane — but only a crossing of the
			// SEGMENT is a lap: the lateral offset along the gate has to be
			// inside the half-width. `prevSigned` flips either way, so a pass
			// wide of the gate still re-arms the edge for the next one.
			const lateral = (x - gate.x) * gate.rightX + (z - gate.z) * gate.rightZ;
			if (Math.abs(lateral) <= gate.halfWidth) {
				state.lastLapTime = state.lapTime;
				if (state.bestLapTime < 0 || state.lastLapTime < state.bestLapTime) {
					state.bestLapTime = state.lastLapTime;
				}
				state.lapCount++;
				state.lapTime = 0;
			}
		}
		prevSigned = signed;
	}

	/** Restart: back on the spawn line, so the clock and the crossing edge
	 *  reset — but a lap already banked (`lastLapTime`/`lapCount`) and the
	 *  best stay exactly what "restart the attempt" should mean. */
	function reset(): void {
		state.lapTime = 0;
		prevSigned = 0;
	}

	/** Unmount: a fresh mount starts this session clean, same as the
	 *  drivetrain/nitrous locals — but the persisted best is not session
	 *  state, so it is left alone (the caller reseeds it from storage anyway
	 *  on the next mount). */
	function park(): void {
		state.lapTime = 0;
		state.lastLapTime = -1;
		state.lapCount = 0;
		prevSigned = 0;
	}

	return { state, gate, setGate, step, reset, park };
}

const BEST_LAP_PREFIX = 'testgame.bestLap.';

/** -1 if nothing is stored, or the stored value is unreadable. */
export function loadBestLap(carId: string): number {
	const raw = localStorage.getItem(BEST_LAP_PREFIX + carId);
	const value = raw === null ? NaN : Number(raw);
	return Number.isFinite(value) ? clamp(value, 0, Infinity) : -1;
}

export function saveBestLap(carId: string, seconds: number): void {
	localStorage.setItem(BEST_LAP_PREFIX + carId, String(seconds));
}
