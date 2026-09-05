<script lang="ts">
	import { GR86 } from './gr86';
	import { carHud } from './carTelemetry.svelte';
	import { carHandling } from './carInput.svelte';
	import { HANDLING_TUNES } from './handling';

	// Bottom-right instrument cluster: tacho ring, gear, speed.
	//
	// Everything is driven by `carHud`, the 30 Hz quantised mirror in
	// carTelemetry.svelte.ts — never `carSim`, which changes 200×/s. No CSS or
	// Svelte transitions anywhere (repo convention): the needle moves because the
	// number moved, and at 30 Hz with 20 rpm buckets that already reads smooth.
	// Anything tweened here would also lag the engine note by its own duration.

	const CX = 100;
	const CY = 100;
	const R = 78; // tacho ring radius
	// Ring sweep, degrees clockwise from +X. SVG y is down, so 135° is bottom-left
	// and 405° (= 45°) is bottom-right: a 270° gap-at-the-bottom dial.
	const A0 = 135;
	const SWEEP = 270;

	const TICKS = Array.from({ length: GR86.maxRpm / 1000 + 1 }, (_, i) => i * 1000);
	/** Shift lights, evenly spaced from "getting on with it" to the fuel cut. */
	const SHIFT_LIGHT_FROM = 5600;
	const SHIFT_LIGHTS = 5;

	const polar = (rpm: number) => A0 + (SWEEP * Math.min(rpm, GR86.maxRpm)) / GR86.maxRpm;
	const point = (angleDeg: number, radius: number) => {
		const a = (angleDeg * Math.PI) / 180;
		return [CX + radius * Math.cos(a), CY + radius * Math.sin(a)] as const;
	};

	function arc(fromDeg: number, toDeg: number, radius: number): string {
		const [x0, y0] = point(fromDeg, radius);
		const [x1, y1] = point(toDeg, radius);
		const large = toDeg - fromDeg > 180 ? 1 : 0;
		return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${radius} ${radius} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
	}

	const trackPath = arc(A0, A0 + SWEEP, R);
	const redlinePath = arc(polar(GR86.redlineRpm), A0 + SWEEP, R);

	const rpm = $derived(carHud.rpm);
	// A degenerate zero-length arc renders nothing at all with a round linecap, so the
	// sweep never quite closes to zero — idle should still show a sliver of ring.
	const rpmPath = $derived(arc(A0, Math.max(polar(rpm), A0 + 0.6), R));
	const needle = $derived(polar(rpm));
	const needleTail = $derived(point(needle, 18));
	const needleTip = $derived(point(needle, R - 9));

	const gearLabel = $derived(carHud.gear < 0 ? 'R' : carHud.gear === 0 ? 'N' : String(carHud.gear));
	const shiftLit = $derived(
		Math.max(
			0,
			Math.ceil((SHIFT_LIGHTS * (rpm - SHIFT_LIGHT_FROM)) / (GR86.limiterRpm - SHIFT_LIGHT_FROM))
		)
	);
	const spinning = $derived(carHud.slip > 0.15);
	const setup = $derived(HANDLING_TUNES[carHandling.mode].label);
	// A few degrees of slip angle is just a car cornering. Past ~10° it is a slide, and
	// the number is worth watching: it is what the Drift tune's two yaw terms balance.
	const sliding = $derived(carHud.driftDeg >= 10);
</script>

<div class="cluster" class:limiting={carHud.limiting}>
	<div class="lights" aria-hidden="true">
		{#each { length: SHIFT_LIGHTS } as _, i (i)}
			<span class="light" class:on={i < shiftLit} class:red={i >= SHIFT_LIGHTS - 2}></span>
		{/each}
	</div>

	<svg viewBox="0 0 200 190" role="img" aria-label="{carHud.kmh} km/h, gear {gearLabel}, {rpm} rpm">
		<path class="track" d={trackPath} />
		<path class="redzone" d={redlinePath} />
		<path class="sweep" class:hot={rpm >= GR86.redlineRpm} d={rpmPath} />

		{#each TICKS as tick (tick)}
			{@const a = polar(tick)}
			{@const [ix, iy] = point(a, R - 15)}
			{@const [ox, oy] = point(a, R - 21)}
			{@const [lx, ly] = point(a, R - 32)}
			<line class="tick" class:red={tick >= GR86.redlineRpm} x1={ix} y1={iy} x2={ox} y2={oy} />
			<text class="tick-label" x={lx} y={ly}>{tick / 1000}</text>
		{/each}

		<line
			class="needle"
			x1={needleTail[0]}
			y1={needleTail[1]}
			x2={needleTip[0]}
			y2={needleTip[1]}
		/>
		<circle class="hub" cx={CX} cy={CY} r="6" />

		<text class="gear" class:reverse={carHud.gear < 0} x={CX} y="84">{gearLabel}</text>
		<text class="rpm" x={CX} y="103">{rpm} rpm</text>

		<text class="speed" x={CX} y="152">{carHud.kmh}</text>
		<text class="unit" x={CX} y="168">km/h · {carHud.mph} mph</text>
	</svg>

	<div class="pedals">
		<div class="bar throttle"><span style:height="{carHud.throttle * 100}%"></span></div>
		<div class="bar brake"><span style:height="{carHud.brake * 100}%"></span></div>
		<div class="flags">
			<span class="flag setup">{setup}</span>
			<span class="flag drift" class:on={sliding}>{carHud.driftDeg}°</span>
			<span class="flag hand" class:on={carHud.handbrake}>HAND</span>
			<span class="flag slip" class:on={spinning}>TC</span>
		</div>
	</div>
</div>

<style>
	.cluster {
		position: absolute;
		right: 1rem;
		bottom: 1rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.35rem;
		padding: 0.5rem 0.65rem 0.6rem;
		width: 15rem;
		background: rgba(0, 0, 0, 0.5);
		border: 1px solid rgba(74, 144, 217, 0.45);
		border-radius: 0.5rem;
		color: #fff;
		font-variant-numeric: tabular-nums;
		pointer-events: none;
		user-select: none;
	}

	.cluster.limiting {
		border-color: rgba(255, 78, 78, 0.85);
	}

	/* ── Shift lights ─────────────────────────────────────────────────────── */
	.lights {
		display: flex;
		gap: 0.3rem;
	}

	.light {
		width: 0.55rem;
		height: 0.3rem;
		border-radius: 0.1rem;
		background: rgba(255, 255, 255, 0.12);
	}

	.light.on {
		background: #4a90d9;
		box-shadow: 0 0 6px #4a90d9;
	}

	.light.red.on {
		background: #ff4e4e;
		box-shadow: 0 0 8px #ff4e4e;
	}

	/* ── Dial ─────────────────────────────────────────────────────────────── */
	svg {
		width: 100%;
		display: block;
		overflow: visible;
	}

	.track,
	.redzone,
	.sweep {
		fill: none;
		stroke-width: 7;
		stroke-linecap: round;
	}

	.track {
		stroke: rgba(255, 255, 255, 0.13);
	}

	.redzone {
		stroke: rgba(255, 78, 78, 0.35);
	}

	.sweep {
		stroke: #4a90d9;
	}

	.sweep.hot {
		stroke: #ff4e4e;
	}

	.tick {
		stroke: rgba(255, 255, 255, 0.4);
		stroke-width: 2;
	}

	.tick.red {
		stroke: #ff4e4e;
	}

	.tick-label {
		fill: rgba(255, 255, 255, 0.55);
		font-size: 11px;
		text-anchor: middle;
		dominant-baseline: middle;
	}

	.needle {
		stroke: #ff4e4e;
		stroke-width: 2.5;
		stroke-linecap: round;
	}

	.hub {
		fill: #ff4e4e;
	}

	/* ── Readouts ─────────────────────────────────────────────────────────── */
	text {
		text-anchor: middle;
		fill: #fff;
	}

	.gear {
		font-size: 46px;
		font-weight: 700;
		dominant-baseline: middle;
	}

	.gear.reverse {
		fill: #ff9d4e;
	}

	.rpm {
		font-size: 11px;
		fill: rgba(255, 255, 255, 0.5);
	}

	.speed {
		font-size: 40px;
		font-weight: 600;
	}

	.unit {
		font-size: 11px;
		fill: rgba(255, 255, 255, 0.55);
	}

	/* ── Pedals + flags ───────────────────────────────────────────────────── */
	.pedals {
		display: flex;
		align-items: flex-end;
		gap: 0.35rem;
		width: 100%;
		height: 2.25rem;
	}

	.bar {
		position: relative;
		flex: 0 0 0.4rem;
		height: 100%;
		background: rgba(255, 255, 255, 0.12);
		border-radius: 0.2rem;
		overflow: hidden;
	}

	.bar span {
		position: absolute;
		left: 0;
		bottom: 0;
		width: 100%;
	}

	.throttle span {
		background: #5fd98a;
	}

	.brake span {
		background: #ff4e4e;
	}

	/* 2×2 — four chips do not fit the pedals' height in one column. Row-major, so it
	   reads setup / drift angle on top, handbrake / traction under it. */
	.flags {
		display: grid;
		grid-template-columns: repeat(2, auto);
		gap: 0.2rem;
		margin-left: auto;
		justify-items: end;
	}

	.flag {
		font-size: 0.625rem;
		letter-spacing: 0.08em;
		padding: 0.05rem 0.3rem;
		border-radius: 0.15rem;
		border: 1px solid rgba(255, 255, 255, 0.15);
		color: rgba(255, 255, 255, 0.25);
	}

	/* Always lit — this one is a label, not a warning light. */
	.flag.setup {
		color: rgba(255, 255, 255, 0.7);
		border-color: rgba(74, 144, 217, 0.6);
	}

	.flag.drift {
		font-variant-numeric: tabular-nums;
	}

	.flag.drift.on {
		color: #4ad9d1;
		border-color: #4ad9d1;
	}

	.flag.hand.on {
		color: #ff4e4e;
		border-color: #ff4e4e;
	}

	.flag.slip.on {
		color: #ffd24e;
		border-color: #ffd24e;
	}
</style>
