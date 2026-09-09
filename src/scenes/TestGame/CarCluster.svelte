<script lang="ts">
	import { currentCar } from './cars';
	import { carHud } from './sim/carTelemetry.svelte';
	import {
		carGearbox,
		carHandling,
		carIgnition,
		carLights,
		carUnits
	} from './sim/carSwitches.svelte';
	import { GLYPHS, SEGMENT_IDS, glyphs, segmentCell, type SegmentCell } from './clusterSegments';

	// Bottom-right instrument cluster: an aftermarket gauge pod — a big tacho with a
	// digital gear window and a backlit LCD speed readout, flanked by a boost/vacuum
	// gauge and an N2O bottle gauge. ONE SVG for the whole pod, not three: the bezels,
	// gradients and glows are shared, and a pod is one physical object.
	//
	// ── What is real ─────────────────────────────────────────────────────────────
	// Everything real is driven by `carHud`, the 30 Hz quantised mirror in
	// carTelemetry.svelte.ts — never `carSim`, which changes every physics step.
	//   tacho / gear / speed  the drivetrain, straight off the mirror
	//   N2O                   the BOTTLE LEVEL, like the pressure gauge on a real
	//                         bottle: full reads full, falls as you spray
	//   BOOST/VAC             manifold pressure DERIVED FROM THE PEDAL (see
	//                         `manifoldBar`) — a display model of a real quantity off
	//                         a real input, not an invented signal. The GR86 is
	//                         naturally aspirated (spec `cluster.hasTurbo`), so the
	//                         needle lives in the vacuum half and the boost half of
	//                         the dial is drawn dead.
	//
	// ── No tweening, anywhere ────────────────────────────────────────────────────
	// No CSS or Svelte transitions (repo convention): the needle moves because the
	// number moved, and at 30 Hz with 20 rpm buckets that already reads smooth.
	// Anything tweened here would also lag the engine note by its own duration. The
	// one animation is the STARTUP SELF-TEST — a keyframed needle sweep and bulb
	// check while the ignition cranks, which is an event, not a smoothed value.
	//
	// ── Why the glows are drawn, not filtered ────────────────────────────────────
	// Blur filters re-rasterize whatever they cover every time it moves. So: the
	// needle, the rev sweep and the LEDs get their halo from a second, wider,
	// translucent copy of the same shape (free — it is just another draw), and
	// `filter: drop-shadow()` is used ONLY on groups that never change (the printed
	// scale) or change a few times a second at most (the gear digit), where the
	// browser's cached raster holds.

	const CAR = currentCar();
	const { maxRpm, redlineRpm, limiterRpm } = CAR.hardware;
	// The rev-match launch window is the car's too (spec `launchWindowMinRpm/MaxRpm`).
	const LAUNCH_MIN = CAR.hardware.launchWindowMinRpm;
	const LAUNCH_MAX = CAR.hardware.launchWindowMaxRpm;
	const HAS_TURBO = CAR.cluster.hasTurbo;

	// ── Pod geometry ─────────────────────────────────────────────────────────────
	// Ring sweep, degrees clockwise from +X. SVG y is down, so 135° is bottom-left
	// and 405° (= 45°) is bottom-right: a 270° gap-at-the-bottom dial. Every gauge in
	// the pod speaks it, so a needle always means the same thing.
	const A0 = 135;
	const SWEEP = 270;

	const CX = 196; // tacho centre
	const CY = 94;
	const R = 74; // the graduated ring
	const BEZEL = 86; // the pod rim around it
	const LED_R = 81; // shift lights, set into the bezel outside the ring

	const MINI_CX = 58;
	const BOOST_CY = 48;
	const N2O_CY = 152;
	const MINI_R = 32;
	const MINI_BEZEL = 39;

	function polarPoint(cx: number, cy: number, angleDeg: number, radius: number) {
		const a = (angleDeg * Math.PI) / 180;
		return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)] as const;
	}

	function arcFrom(cx: number, cy: number, fromDeg: number, toDeg: number, radius: number): string {
		const [x0, y0] = polarPoint(cx, cy, fromDeg, radius);
		const [x1, y1] = polarPoint(cx, cy, toDeg, radius);
		const large = toDeg - fromDeg > 180 ? 1 : 0;
		return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${radius} ${radius} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
	}
	const arc = (fromDeg: number, toDeg: number, radius: number) =>
		arcFrom(CX, CY, fromDeg, toDeg, radius);

	/** Fraction 0..1 of a gauge's sweep → the angle on it. */
	const at = (frac: number) => A0 + SWEEP * Math.min(Math.max(frac, 0), 1);

	// ── The tacho scale ──────────────────────────────────────────────────────────
	const MAJOR = 1000;
	const MINOR = 250; // the fine graduations between the numerals
	const polar = (rpm: number) => at(rpm / maxRpm);
	const point = (angleDeg: number, radius: number) => polarPoint(CX, CY, angleDeg, radius);

	const MAJOR_TICKS = Array.from({ length: maxRpm / MAJOR + 1 }, (_, i) => i * MAJOR);
	const MINOR_TICKS = Array.from({ length: maxRpm / MINOR + 1 }, (_, i) => i * MINOR).filter(
		(rpm) => rpm % MAJOR !== 0
	);

	const trackPath = arc(A0, A0 + SWEEP, R);
	const redlinePath = arc(polar(redlineRpm), A0 + SWEEP, R);

	// The needle is drawn ONCE pointing along +X and rotated — so the startup sweep
	// can be a plain CSS rotation of the same shape, and the live needle costs one
	// transform attribute per update instead of four coordinates.
	const NEEDLE = [
		`M ${CX + R - 10} ${CY}`,
		`L ${CX + 9} ${CY - 3.4}`,
		`L ${CX - 19} ${CY - 2.6}`,
		`L ${CX - 21} ${CY}`,
		`L ${CX - 19} ${CY + 2.6}`,
		`L ${CX + 9} ${CY + 3.4}`,
		'Z'
	].join(' ');

	// ── Shift lights ─────────────────────────────────────────────────────────────
	const SHIFT_LIGHTS = 5;
	const SHIFT_LIGHT_FROM = CAR.cluster.shiftLightFrom;
	const LED_FROM = 214;
	const LED_TO = 326;
	const LEDS = Array.from({ length: SHIFT_LIGHTS }, (_, i) =>
		polarPoint(CX, CY, LED_FROM + ((LED_TO - LED_FROM) * i) / (SHIFT_LIGHTS - 1), LED_R)
	);

	// ── The digital windows ──────────────────────────────────────────────────────
	const GEAR_CELL: SegmentCell = segmentCell(20, 30, 5, 1.6);
	const GEAR_X = CX - 10;
	const GEAR_Y = 104;

	const LCD = { x: CX - 34, y: 138, w: 68, h: 30 };
	const SPEED_CELL: SegmentCell = segmentCell(13, 20, 3.2, 1.1);
	const SPEED_XS = [LCD.x + 6, LCD.x + 24, LCD.x + 42];
	const SPEED_Y = LCD.y + 5;

	// ── Mini gauges ──────────────────────────────────────────────────────────────
	const MINI_TICKS = 8;
	const MINI_TICK_ANGLES = Array.from(
		{ length: MINI_TICKS + 1 },
		(_, i) => A0 + (SWEEP * i) / MINI_TICKS
	);
	const boostTrack = arcFrom(MINI_CX, BOOST_CY, A0, A0 + SWEEP, MINI_R);
	const n2oTrack = arcFrom(MINI_CX, N2O_CY, A0, A0 + SWEEP, MINI_R);
	/** Zero bar sits at the top of the boost dial — vacuum left, boost right. */
	const BOOST_ZERO = A0 + SWEEP / 2;
	/** The three printed marks on the boost dial: −, 0, +. */
	const BOOST_MARKS = [
		{ text: '−', at: polarPoint(MINI_CX, BOOST_CY, A0 + 13, MINI_R - 13), dead: false },
		{ text: '0', at: polarPoint(MINI_CX, BOOST_CY, BOOST_ZERO, MINI_R - 15), dead: false },
		{ text: '+', at: polarPoint(MINI_CX, BOOST_CY, A0 + SWEEP - 13, MINI_R - 13), dead: !HAS_TURBO }
	];
	/** The half of the boost dial this car can never reach — drawn dead, not hidden:
	 *  the scale is the gauge's, and a naturally aspirated car simply never gets there. */
	const boostDeadPath = arcFrom(MINI_CX, BOOST_CY, BOOST_ZERO, A0 + SWEEP, MINI_R);
	/** The bottle's low zone — the bottom fifth of the N2O sweep. */
	const n2oLowPath = arcFrom(MINI_CX, N2O_CY, A0, at(0.2), MINI_R);

	const miniNeedle = (cy: number) =>
		[
			`M ${MINI_CX + MINI_R - 8} ${cy}`,
			`L ${MINI_CX + 4} ${cy - 1.9}`,
			`L ${MINI_CX - 9} ${cy - 1.5}`,
			`L ${MINI_CX - 10} ${cy}`,
			`L ${MINI_CX - 9} ${cy + 1.5}`,
			`L ${MINI_CX + 4} ${cy + 1.9}`,
			'Z'
		].join(' ');
	const BOOST_NEEDLE = miniNeedle(BOOST_CY);
	const N2O_NEEDLE = miniNeedle(N2O_CY);

	// ── Live state ───────────────────────────────────────────────────────────────
	const rpm = $derived(carHud.rpm);
	// A degenerate zero-length arc renders nothing at all with a round linecap, so the
	// sweep never quite closes to zero — idle should still show a sliver of ring.
	const rpmPath = $derived(arc(A0, Math.max(polar(rpm), A0 + 0.6), R));
	const needleAngle = $derived(polar(rpm));

	/** Ignition on but the engine hasn't caught yet — the cluster's SELF-TEST window
	 *  (carSwitches: `on` flips first, `ready` when the crank sound ends, ~1.2 s).
	 *  A real car sweeps the needle and lights every lamp here; so does this one. */
	const booting = $derived(carIgnition.on && !carIgnition.ready);
	/** Backlight. Off = a dead cluster: dark face, blank windows, ghost segments. */
	const lit = $derived(carIgnition.on);

	const gearGlyph = $derived(carHud.gear < 0 ? 'r' : carHud.gear === 0 ? 'n' : String(carHud.gear));
	// The U switch picks WHICH of the two the window shows — the telemetry mirror
	// publishes both numbers either way, so nothing is converted here.
	const speedRead = $derived(carUnits.imperial ? carHud.mph : carHud.kmh);
	const speedGlyphs = $derived(glyphs(speedRead, 3));
	const unitLabel = $derived(carUnits.imperial ? 'MPH' : 'KM/H');

	const shiftLit = $derived(
		Math.max(
			0,
			Math.ceil((SHIFT_LIGHTS * (rpm - SHIFT_LIGHT_FROM)) / (limiterRpm - SHIFT_LIGHT_FROM))
		)
	);
	// Launch meter: in N with the revs in the rev-match window the shift lights
	// moonlight as the catch gauge — GREEN, filling with depth in the window
	// (one light per 400 rpm, five = the 6 k money catch). Overrides the shift
	// indication entirely: in N it has no job, and the window's top 400 rpm
	// (5.6–6 k) would otherwise paint red and read "shift" exactly when the
	// answer is "drop the clutch".
	const launchWindow = $derived(
		carHud.gear === 0 && carHud.rpm >= LAUNCH_MIN && carHud.rpm <= LAUNCH_MAX
	);
	const launchLit = $derived(
		Math.max(1, Math.ceil((SHIFT_LIGHTS * (carHud.rpm - LAUNCH_MIN)) / (LAUNCH_MAX - LAUNCH_MIN)))
	);

	// ── Boost / vacuum ───────────────────────────────────────────────────────────
	// MANIFOLD PRESSURE, bar relative to atmosphere, as a DISPLAY MODEL off the real
	// pedal and rpm: a throttle plate is a restriction, so a closed throttle at high
	// rpm is the deepest vacuum (~-0.85 bar on overrun), idle sits around -0.55, and
	// wide open is barely under atmosphere. Engine off = 0, because a stopped engine
	// pumps nothing. This is not a sim number and must never be fed back into one —
	// the drivetrain models torque, not airflow. It is here because a gauge that
	// answers to your right foot is the whole point of a boost gauge, and the
	// previous parked needle with "N/A" under it answered to nothing.
	const revFrac = $derived(Math.min(carHud.rpm / maxRpm, 1));
	const manifoldBar = $derived(lit ? -(1 - carHud.throttle) * (0.5 + 0.35 * revFrac) : 0);
	/** Full scale each way, so 0 lands exactly at the top of the sweep. */
	const BOOST_FS = 1;
	const boostAngle = $derived(at((manifoldBar / BOOST_FS + 1) / 2));
	const boostFill = $derived(
		Math.abs(boostAngle - BOOST_ZERO) < 0.5
			? ''
			: arcFrom(
					MINI_CX,
					BOOST_CY,
					Math.min(boostAngle, BOOST_ZERO),
					Math.max(boostAngle, BOOST_ZERO),
					MINI_R
				)
	);
	const boostReadout = $derived((Math.round(manifoldBar * 20) / 20).toFixed(2));

	// ── N2O ──────────────────────────────────────────────────────────────────────
	const tank = $derived(Math.min(Math.max(carHud.nitrousTank, 0), 1));
	const n2oAngle = $derived(at(tank));
	const n2oFill = $derived(arcFrom(MINI_CX, N2O_CY, A0, Math.max(n2oAngle, A0 + 0.6), MINI_R));
	const spraying = $derived(carHud.nitrous > 0.05);

	// ── Tell-tales ───────────────────────────────────────────────────────────────
	// TC lamps when the ECU is working — which it never is in Drift: the tune
	// runs `tractionControl: false`, so wheelspin there is the SETUP, not a system
	// intervening, and a blinking lamp would be a lie. Gate on the tune's own flag
	// rather than the mode string — the tune is the truth.
	const slipping = $derived(CAR.tunes[carHandling.mode].tractionControl && carHud.slip > 0.15);
	const setup = $derived(CAR.tunes[carHandling.mode].label);
	// Which half of the gearbox is driving. A LABEL, like the setup chip beside it:
	// it is never a warning, and the digit in the gear window is the same digit
	// either way — this is the only thing on the pod that says who chose it.
	const gearboxLabel = $derived(carGearbox.mode === 'auto' ? 'AUTO' : 'MANUAL');
	// A few degrees of slip angle is just a car cornering. Past ~10° it is a slide, and
	// the number is worth watching: it is what the Drift tune's two yaw terms balance.
	const sliding = $derived(carHud.driftDeg >= 10);

	const label = $derived(`${speedRead} ${unitLabel}, gear ${gearGlyph.toUpperCase()}, ${rpm} rpm`);
</script>

<!-- One seven-segment cell. `kind` picks the window it belongs to as a `class:`
     directive rather than a class string, so the scoped CSS for `.gear` / `.lcd-digit`
     is statically visible to the compiler and never pruned. -->
{#snippet cell(
	glyph: string,
	geom: SegmentCell,
	x: number,
	y: number,
	kind: 'gear' | 'lcd',
	rev = false
)}
	<g
		class:gear={kind === 'gear'}
		class:lcd-digit={kind === 'lcd'}
		class:rev
		transform="translate({x} {y})"
	>
		{#each SEGMENT_IDS as id (id)}
			<polygon class="seg" class:on={lit && GLYPHS[glyph]?.includes(id)} points={geom[id]} />
		{/each}
	</g>
{/snippet}

{#snippet miniScale(cy: number)}
	{#each MINI_TICK_ANGLES as a, i (a)}
		{@const [ox, oy] = polarPoint(MINI_CX, cy, a, MINI_R - 5)}
		{@const [ix, iy] = polarPoint(MINI_CX, cy, a, MINI_R - (i % 2 === 0 ? 11 : 8))}
		<line class="mini-tick" class:major={i % 2 === 0} x1={ox} y1={oy} x2={ix} y2={iy} />
	{/each}
{/snippet}

<div class="cluster" class:limiting={carHud.limiting} class:dark={!lit}>
	<svg class="pod" viewBox="0 0 300 200" role="img" aria-label={label}>
		<defs>
			<radialGradient id="cl-face" cx="50%" cy="32%" r="78%">
				<stop offset="0%" stop-color="#151d28" />
				<stop offset="62%" stop-color="#070b12" />
				<stop offset="100%" stop-color="#010307" />
			</radialGradient>
			<linearGradient id="cl-rim" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0%" stop-color="#67737f" />
				<stop offset="42%" stop-color="#1a212a" />
				<stop offset="100%" stop-color="#3d4753" />
			</linearGradient>
			<linearGradient id="cl-lcd" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0%" stop-color="#cdeef8" />
				<stop offset="55%" stop-color="#84cde2" />
				<stop offset="100%" stop-color="#5fadc6" />
			</linearGradient>
			<radialGradient id="cl-hub" cx="38%" cy="32%" r="70%">
				<stop offset="0%" stop-color="#8c959f" />
				<stop offset="55%" stop-color="#2a323c" />
				<stop offset="100%" stop-color="#11161d" />
			</radialGradient>
			<radialGradient id="cl-bleed" cx="50%" cy="50%" r="50%">
				<stop offset="0%" stop-color="rgba(124, 205, 226, 0.45)" />
				<stop offset="100%" stop-color="rgba(124, 205, 226, 0)" />
			</radialGradient>
		</defs>

		<!-- ── Boost / vacuum ──────────────────────────────────────────────── -->
		<g class="gauge">
			<circle class="face" cx={MINI_CX} cy={BOOST_CY} r={MINI_BEZEL} />
			<circle class="rim" cx={MINI_CX} cy={BOOST_CY} r={MINI_BEZEL} />
			<path class="mini-track" d={boostTrack} />
			{#if !HAS_TURBO}
				<path class="mini-dead" d={boostDeadPath} />
			{/if}
			{#if boostFill}
				<path class="mini-fill boost" d={boostFill} />
			{/if}
			<g class="scale">
				{@render miniScale(BOOST_CY)}
				{#each BOOST_MARKS as mark (mark.text)}
					<text class="mini-mark" class:dead={mark.dead} x={mark.at[0]} y={mark.at[1]}>
						{mark.text}
					</text>
				{/each}
			</g>
			<g transform="rotate({boostAngle} {MINI_CX} {BOOST_CY})">
				<path class="mini-needle-glow" d={BOOST_NEEDLE} />
				<path class="mini-needle" d={BOOST_NEEDLE} />
			</g>
			<circle class="mini-hub" cx={MINI_CX} cy={BOOST_CY} r="3" />
			<text class="mini-value" x={MINI_CX} y={BOOST_CY + 15}>{boostReadout}</text>
			<text class="mini-label" x={MINI_CX} y={BOOST_CY + 25}>
				{HAS_TURBO ? 'BOOST' : 'VAC · BAR'}
			</text>
		</g>

		<!-- ── N2O bottle ──────────────────────────────────────────────────── -->
		<g class="gauge">
			<circle class="face" cx={MINI_CX} cy={N2O_CY} r={MINI_BEZEL} />
			<circle class="rim" cx={MINI_CX} cy={N2O_CY} r={MINI_BEZEL} />
			<path class="mini-track" d={n2oTrack} />
			<path class="mini-low" d={n2oLowPath} />
			<path class="mini-fill n2o" class:spraying d={n2oFill} />
			<g class="scale">{@render miniScale(N2O_CY)}</g>
			<g transform="rotate({n2oAngle} {MINI_CX} {N2O_CY})">
				<path class="mini-needle n2o" d={N2O_NEEDLE} />
			</g>
			<circle class="mini-hub n2o" cx={MINI_CX} cy={N2O_CY} r="3" />
			<text class="mini-value" class:spraying x={MINI_CX} y={N2O_CY + 15}>
				{Math.round(tank * 100)}%
			</text>
			<text class="mini-label" class:spraying x={MINI_CX} y={N2O_CY + 25}>N2O</text>
		</g>

		<!-- ── Tacho ───────────────────────────────────────────────────────── -->
		<g class="gauge">
			<circle class="face" cx={CX} cy={CY} r={BEZEL} />
			<circle class="rim" cx={CX} cy={CY} r={BEZEL} />
			<circle class="inner-rim" cx={CX} cy={CY} r={R + 6} />

			<path class="track" d={trackPath} />
			<path class="redzone-glow" d={redlinePath} />
			<path class="redzone" d={redlinePath} />
			<path class="sweep-glow" class:hot={rpm >= redlineRpm} d={rpmPath} />
			<path class="sweep" class:hot={rpm >= redlineRpm} d={rpmPath} />

			<!-- Shift lights, set into the bezel. Off ones stay visible as dark
			     lenses — an LED strip you cannot see is a strip you cannot read. -->
			{#each LEDS as [lx, ly], i (i)}
				{@const on = booting || (launchWindow ? i < launchLit : i < shiftLit)}
				{@const red = !launchWindow && !booting && i >= SHIFT_LIGHTS - 2}
				<circle
					class="led-glow"
					class:on
					class:red
					class:green={launchWindow}
					cx={lx}
					cy={ly}
					r="6"
				/>
				<circle class="led" class:on class:red class:green={launchWindow} cx={lx} cy={ly} r="3" />
			{/each}

			<!-- The printed scale. Never changes, so this is the one group that can
			     afford a real blur filter — the browser caches its raster. -->
			<g class="scale printed">
				{#each MINOR_TICKS as tick (tick)}
					{@const a = polar(tick)}
					{@const [ox, oy] = point(a, R - 3)}
					{@const [ix, iy] = point(a, R - 8)}
					<line class="tick minor" class:red={tick >= redlineRpm} x1={ox} y1={oy} x2={ix} y2={iy} />
				{/each}
				{#each MAJOR_TICKS as tick (tick)}
					{@const a = polar(tick)}
					{@const [ox, oy] = point(a, R - 3)}
					{@const [ix, iy] = point(a, R - 13)}
					{@const [lx, ly] = point(a, R - 26)}
					<line class="tick" class:red={tick >= redlineRpm} x1={ox} y1={oy} x2={ix} y2={iy} />
					<text class="tick-label" class:red={tick >= redlineRpm} x={lx} y={ly}>
						{tick / MAJOR}
					</text>
				{/each}
				<text class="dial-legend" x={CX} y={CY - 20}>RPM ×1000</text>
			</g>

			<!-- Gear window. -->
			{@render cell(gearGlyph, GEAR_CELL, GEAR_X, GEAR_Y, 'gear', carHud.gear < 0)}

			<!-- LCD speed window — backlight bleed, panel, ghosted cells, digits. -->
			<rect
				class="lcd-bleed"
				x={LCD.x - 10}
				y={LCD.y - 10}
				width={LCD.w + 20}
				height={LCD.h + 20}
				fill="url(#cl-bleed)"
			/>
			<rect class="lcd" x={LCD.x} y={LCD.y} width={LCD.w} height={LCD.h} rx="4" />
			{#each speedGlyphs as glyph, i (i)}
				{@render cell(glyph, SPEED_CELL, SPEED_XS[i], SPEED_Y, 'lcd')}
			{/each}
			<text class="lcd-unit" x={CX} y={LCD.y + LCD.h + 9}>{unitLabel}</text>

			<!-- Needle last: it passes over everything on the face. During the
			     self-test the live one is replaced by the swept one — same shape,
			     rotated by a one-shot keyframe instead of by the revs. -->
			{#if booting}
				<g class="needle-sweep" style:transform-origin="{CX}px {CY}px">
					<path class="needle-glow" d={NEEDLE} />
					<path class="needle" d={NEEDLE} />
				</g>
			{:else}
				<g transform="rotate({needleAngle} {CX} {CY})">
					<path class="needle-glow" d={NEEDLE} />
					<path class="needle" d={NEEDLE} />
				</g>
			{/if}
			<circle class="hub" cx={CX} cy={CY} r="7" />
			<circle class="hub-cap" cx={CX} cy={CY} r="2.6" />
		</g>
	</svg>

	<!-- Pedals + tell-tales. HTML rather than more SVG: they are a row of chips and
	     two bars, and CSS lays those out better than a viewBox does. -->
	<div class="strip">
		<div class="bar throttle"><span style:height="{carHud.throttle * 100}%"></span></div>
		<div class="bar brake"><span style:height="{carHud.brake * 100}%"></span></div>
		<div class="lamps">
			<span class="lamp setup">{setup}</span>
			<span class="lamp box" class:auto={carGearbox.mode === 'auto'}>{gearboxLabel}</span>
			<span class="lamp drift" class:on={sliding || booting}>{carHud.driftDeg}°</span>
			<span class="lamp beam" class:on={carLights.on || booting} class:high={carLights.high}>
				BEAM
			</span>
			<span class="lamp hand" class:on={carHud.handbrake || booting}>HAND</span>
			<span class="lamp slip" class:on={slipping || booting}>TC</span>
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
		align-items: stretch;
		gap: 0.3rem;
		padding: 0.45rem 0.6rem 0.55rem;
		width: 22rem;
		background: linear-gradient(180deg, rgba(10, 14, 20, 0.72), rgba(0, 0, 0, 0.82));
		border: 1px solid rgba(74, 144, 217, 0.35);
		border-radius: 0.6rem;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.06),
			0 6px 20px rgba(0, 0, 0, 0.45);
		color: #fff;
		font-variant-numeric: tabular-nums;
		pointer-events: none;
		user-select: none;
	}

	.cluster.limiting {
		border-color: rgba(255, 78, 78, 0.8);
	}

	/* Ignition off: the backlight dies. The windows blank themselves (the segments
	   gate on `lit`), so this only has to kill the glow and drain the face. */
	.cluster.dark {
		opacity: 0.55;
		filter: saturate(0.35);
	}

	.pod {
		display: block;
		width: 100%;
		overflow: visible;
	}

	/* ── Bezels ───────────────────────────────────────────────────────────── */
	.face {
		fill: url(#cl-face);
	}

	.rim {
		fill: none;
		stroke: url(#cl-rim);
		stroke-width: 2.5;
	}

	.inner-rim {
		fill: none;
		stroke: rgba(255, 255, 255, 0.05);
		stroke-width: 1;
	}

	/* ── Tacho ring ───────────────────────────────────────────────────────── */
	.track,
	.redzone,
	.sweep,
	.redzone-glow,
	.sweep-glow {
		fill: none;
		stroke-linecap: round;
	}

	.track {
		stroke: rgba(150, 200, 255, 0.12);
		stroke-width: 6;
	}

	.redzone {
		stroke: rgba(255, 60, 50, 0.55);
		stroke-width: 6;
	}

	.redzone-glow {
		stroke: rgba(255, 60, 50, 0.16);
		stroke-width: 13;
	}

	.sweep {
		stroke: #4fa8ff;
		stroke-width: 6;
	}

	.sweep-glow {
		stroke: rgba(79, 168, 255, 0.28);
		stroke-width: 13;
	}

	.sweep.hot {
		stroke: #ff3b30;
	}

	.sweep-glow.hot {
		stroke: rgba(255, 59, 48, 0.35);
	}

	/* ── Printed scale ────────────────────────────────────────────────────── */
	.printed {
		filter: drop-shadow(0 0 2.5px rgba(90, 175, 255, 0.55));
	}

	.tick {
		stroke: #9fd8ff;
		stroke-width: 2.4;
		stroke-linecap: round;
	}

	.tick.minor {
		stroke: rgba(159, 216, 255, 0.5);
		stroke-width: 1.2;
	}

	.tick.red {
		stroke: #ff3b30;
	}

	.tick.minor.red {
		stroke: rgba(255, 59, 48, 0.55);
	}

	.tick-label {
		fill: #bfe4ff;
		font-size: 12px;
		font-weight: 700;
		text-anchor: middle;
		dominant-baseline: middle;
	}

	.tick-label.red {
		fill: #ff5a4e;
	}

	.dial-legend {
		fill: rgba(159, 216, 255, 0.55);
		font-size: 6px;
		font-weight: 600;
		letter-spacing: 0.16em;
		text-anchor: middle;
	}

	/* ── Shift lights ─────────────────────────────────────────────────────── */
	.led {
		fill: rgba(255, 255, 255, 0.07);
		stroke: rgba(255, 255, 255, 0.12);
		stroke-width: 0.6;
	}

	.led-glow {
		fill: transparent;
	}

	.led.on {
		fill: #4fa8ff;
		stroke: #bfe4ff;
	}

	.led-glow.on {
		fill: rgba(79, 168, 255, 0.35);
	}

	.led.red.on {
		fill: #ff3b30;
		stroke: #ffb1a8;
	}

	.led-glow.red.on {
		fill: rgba(255, 59, 48, 0.4);
	}

	/* The launch meter's green — see the launchWindow derived. */
	.led.green.on {
		fill: #4ade80;
		stroke: #d3ffe4;
	}

	.led-glow.green.on {
		fill: rgba(74, 222, 128, 0.35);
	}

	/* Fuel cut: the top pair strobes, which is what a bouncing limiter looks like. */
	.cluster.limiting .led.red.on,
	.cluster.limiting .led-glow.red.on {
		animation: limiter 0.12s steps(1) infinite alternate;
	}

	@keyframes limiter {
		to {
			opacity: 0.15;
		}
	}

	/* ── Needle ───────────────────────────────────────────────────────────── */
	.needle {
		fill: #ff3b30;
	}

	.needle-glow {
		fill: none;
		stroke: rgba(255, 59, 48, 0.3);
		stroke-width: 5;
		stroke-linejoin: round;
	}

	.hub {
		fill: url(#cl-hub);
		stroke: rgba(0, 0, 0, 0.6);
		stroke-width: 0.8;
	}

	.hub-cap {
		fill: #ff3b30;
	}

	/* The startup self-test: one full sweep to the stop and back while the engine
	   cranks. An EVENT with a fixed duration, not a smoothed value — the thing the
	   no-transitions rule exists to prevent. */
	.needle-sweep {
		transform-box: view-box;
		animation: self-test 1.15s ease-in-out both;
	}

	@keyframes self-test {
		0% {
			transform: rotate(135deg);
		}
		45% {
			transform: rotate(405deg);
		}
		100% {
			transform: rotate(135deg);
		}
	}

	/* ── Digital windows ──────────────────────────────────────────────────── */
	/* Every cell draws all seven segments. The unlit ones are the ghost that makes
	   a segment display look like one. */
	.seg {
		fill: rgba(255, 255, 255, 0.05);
	}

	.gear .seg.on {
		fill: #ff3b30;
	}

	.gear {
		filter: drop-shadow(0 0 3px rgba(255, 59, 48, 0.75));
	}

	.gear.rev .seg.on {
		fill: #ff9d4e;
	}

	.lcd {
		fill: url(#cl-lcd);
		stroke: rgba(10, 30, 40, 0.65);
		stroke-width: 1.2;
	}

	/* Dark digits on a backlit panel, like the reference pod's LCD — the light comes
	   from behind the glass, so the segments are the only thing blocking it. */
	.lcd-digit .seg {
		fill: rgba(9, 38, 48, 0.1);
	}

	.lcd-digit .seg.on {
		fill: #0c2a35;
	}

	.lcd-unit {
		fill: rgba(159, 216, 255, 0.85);
		font-size: 7px;
		font-weight: 700;
		letter-spacing: 0.18em;
		text-anchor: middle;
	}

	/* ── Mini gauges ──────────────────────────────────────────────────────── */
	.mini-track,
	.mini-fill,
	.mini-low,
	.mini-dead {
		fill: none;
		stroke-linecap: round;
	}

	.mini-track {
		stroke: rgba(150, 200, 255, 0.12);
		stroke-width: 4;
	}

	/* The half of the boost dial a naturally aspirated engine cannot reach. */
	.mini-dead {
		stroke: rgba(255, 255, 255, 0.04);
		stroke-width: 4;
	}

	.mini-low {
		stroke: rgba(255, 60, 50, 0.4);
		stroke-width: 4;
	}

	.mini-fill.boost {
		stroke: rgba(159, 216, 255, 0.55);
		stroke-width: 4;
	}

	.mini-fill.n2o {
		stroke: rgba(95, 208, 255, 0.6);
		stroke-width: 4;
	}

	.mini-fill.n2o.spraying {
		stroke: #5fd0ff;
	}

	.mini-tick {
		stroke: rgba(159, 216, 255, 0.35);
		stroke-width: 1;
	}

	.mini-tick.major {
		stroke: rgba(159, 216, 255, 0.7);
		stroke-width: 1.6;
	}

	.mini-needle {
		fill: #ff3b30;
	}

	.mini-needle-glow {
		fill: none;
		stroke: rgba(255, 59, 48, 0.25);
		stroke-width: 3;
		stroke-linejoin: round;
	}

	/* N2O is the live one of the pair — ice-blue needle, and everything about it
	   lights up while the system sprays (matches the blue exhaust flames). */
	.mini-needle.n2o {
		fill: #5fd0ff;
	}

	.mini-hub {
		fill: #ff3b30;
	}

	.mini-hub.n2o {
		fill: #5fd0ff;
	}

	.mini-mark {
		fill: rgba(159, 216, 255, 0.8);
		font-size: 7px;
		font-weight: 700;
		text-anchor: middle;
		dominant-baseline: middle;
	}

	.mini-mark.dead {
		fill: rgba(255, 255, 255, 0.18);
	}

	.mini-value {
		fill: rgba(230, 245, 255, 0.9);
		font-size: 9px;
		font-weight: 700;
		text-anchor: middle;
	}

	.mini-value.spraying,
	.mini-label.spraying {
		fill: #5fd0ff;
	}

	.mini-label {
		fill: rgba(159, 216, 255, 0.6);
		font-size: 6.5px;
		font-weight: 600;
		letter-spacing: 0.14em;
		text-anchor: middle;
	}

	/* ── Pedals + tell-tales ──────────────────────────────────────────────── */
	.strip {
		display: flex;
		align-items: flex-end;
		gap: 0.35rem;
		width: 100%;
		height: 2.1rem;
	}

	.bar {
		position: relative;
		flex: 0 0 0.4rem;
		height: 100%;
		background: rgba(255, 255, 255, 0.1);
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
		box-shadow: 0 0 6px rgba(95, 217, 138, 0.7);
	}

	.brake span {
		background: #ff4e4e;
		box-shadow: 0 0 6px rgba(255, 78, 78, 0.7);
	}

	/* Two rows of chips — five do not fit the bars' height in one column. */
	.lamps {
		display: flex;
		flex-wrap: wrap;
		gap: 0.2rem;
		margin-left: auto;
		justify-content: flex-end;
		align-content: flex-end;
	}

	.lamp {
		font-size: 0.625rem;
		letter-spacing: 0.08em;
		padding: 0.05rem 0.3rem;
		border-radius: 0.15rem;
		border: 1px solid rgba(255, 255, 255, 0.12);
		color: rgba(255, 255, 255, 0.22);
	}

	/* Always lit — this one is a label, not a warning light. */
	.lamp.setup {
		color: rgba(255, 255, 255, 0.7);
		border-color: rgba(74, 144, 217, 0.6);
	}

	/* The other always-lit label: dim for the manual box the car ships with,
	   amber once the box is shifting for you. */
	.lamp.box {
		color: rgba(255, 255, 255, 0.45);
	}

	.lamp.box.auto {
		color: #ffd24e;
		border-color: rgba(255, 210, 78, 0.6);
	}

	.lamp.drift {
		font-variant-numeric: tabular-nums;
	}

	.lamp.drift.on {
		color: #4ad9d1;
		border-color: #4ad9d1;
	}

	/* Low beam green, main beam blue — the two tell-tales every car has. */
	.lamp.beam.on {
		color: #5fd98a;
		border-color: rgba(95, 217, 138, 0.7);
	}

	.lamp.beam.on.high {
		color: #5fd0ff;
		border-color: rgba(95, 208, 255, 0.8);
		text-shadow: 0 0 6px rgba(95, 208, 255, 0.8);
	}

	.lamp.hand.on {
		color: #ff4e4e;
		border-color: #ff4e4e;
	}

	.lamp.slip.on {
		color: #ffd24e;
		border-color: #ffd24e;
	}
</style>
