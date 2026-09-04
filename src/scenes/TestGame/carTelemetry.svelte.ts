// The car's instrument feed — the same split the sky uses (`core/skybox`): a
// PLAIN object written by the physics task, and a `$state` MIRROR for the HUD.
//
// Physics runs at a fixed 200 Hz. Writing $state 200×/s means 200 Svelte
// invalidations per second per field for a needle no eye can follow, so the
// mirror is published at ~30 Hz and each field is quantised to what the dial can
// actually show. A value that rounds to the same number is not written at all.

import { GR86 } from './gr86';

/** Written every physics step. Read by CarWheels and the mirror below — never by the HUD. */
export const carSim = {
	/** Signed road speed along the nose, m/s (real metres — not world units). */
	speedMs: 0,
	// `as number`: GR86 is `as const`, so a bare `GR86.idleRpm` would type this
	// field as the literal 800 and reject every reading the engine ever produces.
	rpm: GR86.idleRpm as number,
	/** -1 reverse, 0 neutral, 1…6. */
	gear: 1,
	/** 0…1 wheelspin. */
	slip: 0,
	/** Steering rack, -1…1, left-positive. CarWheels renders this so the visual
	 *  lock matches the speed-sensitive angle the physics actually used. */
	steer: 0,
	throttle: 0,
	brake: 0,
	handbrake: false,
	limiting: false
};

/** The HUD's reactive view. Quantised, ~30 Hz. */
export const carHud = $state({
	kmh: 0,
	mph: 0,
	// `as number`: GR86 is `as const`, so a bare `GR86.idleRpm` would type this
	// field as the literal 800 and reject every reading the engine ever produces.
	rpm: GR86.idleRpm as number,
	gear: 1,
	slip: 0,
	throttle: 0,
	brake: 0,
	handbrake: false,
	limiting: false
});

const HUD_INTERVAL = 1 / 30;
let elapsed = 0;

/** Push `carSim` into `carHud` at most 30×/s, only where a shown value changed. */
export function publishCarHud(dt: number): void {
	elapsed += dt;
	if (elapsed < HUD_INTERVAL) return;
	elapsed = 0;

	const speed = Math.abs(carSim.speedMs);
	const kmh = Math.round(speed * 3.6);
	const mph = Math.round(speed * 2.23694);
	// 20 rpm buckets: ~370 steps across the dial, far finer than a needle reads.
	const rpm = Math.round(carSim.rpm / 20) * 20;
	const slip = Math.round(carSim.slip * 20) / 20;

	if (carHud.kmh !== kmh) carHud.kmh = kmh;
	if (carHud.mph !== mph) carHud.mph = mph;
	if (carHud.rpm !== rpm) carHud.rpm = rpm;
	if (carHud.gear !== carSim.gear) carHud.gear = carSim.gear;
	if (carHud.slip !== slip) carHud.slip = slip;
	if (carHud.throttle !== carSim.throttle) carHud.throttle = carSim.throttle;
	if (carHud.brake !== carSim.brake) carHud.brake = carSim.brake;
	if (carHud.handbrake !== carSim.handbrake) carHud.handbrake = carSim.handbrake;
	if (carHud.limiting !== carSim.limiting) carHud.limiting = carSim.limiting;
}

/** Park the instruments — used when the scene stops driving (scene switch, blur). */
export function resetCarTelemetry(): void {
	carSim.speedMs = 0;
	carSim.rpm = GR86.idleRpm;
	carSim.gear = 1;
	carSim.slip = 0;
	carSim.steer = 0;
	carSim.throttle = 0;
	carSim.brake = 0;
	carSim.handbrake = false;
	carSim.limiting = false;
	elapsed = HUD_INTERVAL;
	publishCarHud(0);
}
