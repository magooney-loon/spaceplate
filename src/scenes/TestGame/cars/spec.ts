// Spec math — the gear/torque questions every car's hardware answers. Generic
// over CarSpec (was gr86.ts's own function section; the functions used to close
// over the GR86 object directly). All pure, all SI.

import type { CarSpec } from './types';
import { G, UNITS_PER_METER } from '../units';

/** Top forward gear index (1-based). */
export function topGear(spec: CarSpec): number {
	return spec.hardware.gearRatios.length;
}

/** Signed ratio for a gear index: -1 reverse, 0 neutral, 1..n forward. */
export function gearRatio(spec: CarSpec, gear: number): number {
	if (gear === 0) return 0;
	if (gear < 0) return -spec.hardware.reverseRatio;
	return spec.hardware.gearRatios[gear - 1] ?? 0;
}

/** Total reduction from crank to wheel, always positive. */
export function totalRatio(spec: CarSpec, gear: number): number {
	return Math.abs(gearRatio(spec, gear)) * spec.hardware.finalDrive;
}

const RPM_PER_RAD_S = 60 / (2 * Math.PI);

/** Engine rpm the given gear imposes at this road speed (m/s). 0 in neutral. */
export function rpmInGear(spec: CarSpec, gear: number, speedMs: number): number {
	const ratio = totalRatio(spec, gear);
	if (ratio === 0) return 0;
	return (Math.abs(speedMs) / spec.hardware.wheelRadius) * RPM_PER_RAD_S * ratio;
}

/** Wide-open-throttle crank torque (Nm) at `rpm`, linearly interpolated over the
 *  spec's curve. Flat outside it (the curve's ends carry the intent). */
export function engineTorque(spec: CarSpec, rpm: number): number {
	const curve = spec.hardware.torqueCurve;
	const last = curve.length - 1;
	if (rpm <= curve[0][0]) return curve[0][1];
	if (rpm >= curve[last][0]) return curve[last][1];
	for (let i = 1; i <= last; i++) {
		if (rpm > curve[i][0]) continue;
		const [r0, t0] = curve[i - 1];
		const [r1, t1] = curve[i];
		return t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0);
	}
	return curve[last][1];
}

/** Closed-throttle drag from the engine itself (Nm, positive = retarding). */
export function engineBrakeTorque(spec: CarSpec, rpm: number): number {
	return spec.hardware.engineBrakeBase + spec.hardware.engineBrakePerRpm * rpm;
}

/**
 * Static + transferred load (N) on the DRIVEN axle(s), layout-aware:
 * - rwd: rear static + rearward transfer under acceleration (accel loads the rear)
 * - fwd: front static MINUS the same transfer (accel unloads the driving front)
 * - awd: the full static weight — both axles are driven, transfer is internal
 * RWD is numerically the original gr86-era formula; FWD/AWD are the plumbing
 * until their handling feel is tuned against real cars.
 */
export function drivenAxleLoad(spec: CarSpec, transferForceN: number): number {
	const hw = spec.hardware;
	const staticLoad = hw.mass * G;
	switch (spec.layout) {
		case 'fwd':
			return Math.max(
				0,
				staticLoad * (1 - hw.rearWeightBias) - (transferForceN * hw.cogHeight) / hw.wheelbase
			);
		case 'awd':
			return staticLoad;
		default:
			return Math.max(
				0,
				staticLoad * hw.rearWeightBias + (transferForceN * hw.cogHeight) / hw.wheelbase
			);
	}
}

/** The four tyre contact patches — FL, FR, RL, RR — as [x, z] in WORLD-UNIT
 *  body space (spec metres × UNITS_PER_METER; nose −Z, +X left). The shared
 *  layout the skid marks and the tyre smoke both lay at; was a duplicated
 *  constant block in both files. */
export function wheelPatches(spec: CarSpec): readonly (readonly [number, number])[] {
	const { halfTrack, frontAxleZ, rearAxleZ } = spec.geometry;
	const x = halfTrack * UNITS_PER_METER;
	return [
		[-x, frontAxleZ * UNITS_PER_METER],
		[x, frontAxleZ * UNITS_PER_METER],
		[-x, rearAxleZ * UNITS_PER_METER],
		[x, rearAxleZ * UNITS_PER_METER]
	];
}
