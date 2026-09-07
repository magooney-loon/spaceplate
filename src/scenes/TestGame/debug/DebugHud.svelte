<script lang="ts">
	import { currentCar } from '../cars';
	import { drivenAxles } from '../cars/spec';
	import { carHandling, carView } from '../sim/carInput.svelte';
	import { carDebugHud, carHud } from '../sim/carTelemetry.svelte';

	// The debug rig's other half: the NUMBERS behind `DebugRig.svelte`'s geometry.
	// They sit in the same folder because they are one tool — the rig shows a
	// shape saturating, and only a number says by how much. Read them together;
	// the corner order (FL FR RL RR) and the wheel-ring colours are the rig's.
	//
	// SELF-GATED on `carView.mode`, the same latched B switch the rig is on, so
	// `TestGameHud` stays a shell and mounts this unconditionally. That gate is
	// also carTelemetry's condition for publishing `carDebugHud` at all — the
	// mirror is the panel's, and neither exists without the other.
	//
	// It reads `carDebugHud` (the second 30 Hz quantised mirror) and `carHud`,
	// never `carSim`: one Svelte invalidation per field per physics step, for a
	// figure nobody can read at that rate. No CSS or Svelte transitions (repo
	// convention) — a lagged debug readout is a lying debug readout.
	const CAR = currentCar();
	const [FRONT_DRIVEN, REAR_DRIVEN] = drivenAxles(CAR);
	const CORNERS = ['FL', 'FR', 'RL', 'RR'] as const;
	const CORNER_DRIVEN = [FRONT_DRIVEN, FRONT_DRIVEN, REAR_DRIVEN, REAR_DRIVEN];

	/** The rig's wheel-ring colours, in its own priority order. Duplicated as hex
	 *  here on purpose: the panel is HTML and the rig is THREE.Color — what has to
	 *  match is the LABELS and the ORDER, against the `wheelStatus` function in
	 *  DebugRig.svelte that owns both. */
	const RING_LEGEND = [
		['#b14aff', 'air'],
		['#2f6bff', 'locked'],
		['#ff2244', 'spinning'],
		['#ff8c1a', 'braking'],
		['#22ff88', 'driving'],
		['#39424d', 'coasting']
	] as const;

	const signed = (v: number, places = 2): string => (v >= 0 ? '+' : '') + v.toFixed(places);
</script>

{#if carView.mode !== 'model'}
	<div class="debug">
		<div class="debug-head">
			<span class="tag">{carDebugHud.layout.toUpperCase()}</span>
			<span class="tag">{carHandling.mode.toUpperCase()}</span>
			<span class="tag">{carView.mode.toUpperCase()}</span>
		</div>

		<!-- DRIVELINE: which end is driven, and what it is doing. `spin` is the
		     driven contact patch's overspeed over the road — the number the rig's
		     driven wheels actually roll at. -->
		<h4>driveline</h4>
		<dl>
			<dt>gear</dt>
			<dd>{carHud.gear === 0 ? 'N' : carHud.gear < 0 ? 'R' : carHud.gear}</dd>
			<dt>rpm</dt>
			<dd>{carHud.rpm}</dd>
			<dt>clutch</dt>
			<dd>{carDebugHud.clutch.toFixed(2)}</dd>
			<dt>spin</dt>
			<dd class:hot={carDebugHud.slip > 0.05}>{carDebugHud.spin.toFixed(2)} m/s</dd>
			<dt>slip</dt>
			<dd class:hot={carDebugHud.slip > 0.05}>{carDebugHud.slip.toFixed(2)}</dd>
			<dt>powerLoad</dt>
			<dd class:hot={carDebugHud.powerLoad > 0.95}>{carDebugHud.powerLoad.toFixed(2)}</dd>
		</dl>

		<!-- GRIP: what is left of the tyre, and how much of it this corner is
		     asking for. `latLoad` pinning at 1.00 is the friction circle in the rig
		     closing on its ring. -->
		<h4>grip</h4>
		<dl>
			<dt>gripFactor</dt>
			<dd>{carDebugHud.gripFactor.toFixed(2)}</dd>
			<dt>loose</dt>
			<dd>{carDebugHud.loose.toFixed(2)}</dd>
			<dt>latLoad</dt>
			<dd class:hot={carDebugHud.latLoad > 0.95}>{carDebugHud.latLoad.toFixed(2)}</dd>
			<dt>μ lat</dt>
			<dd>{carDebugHud.muLat.toFixed(2)}</dd>
			<dt>drift</dt>
			<dd>{carHud.driftDeg}°</dd>
			<dt>yaw</dt>
			<dd>{signed(carDebugHud.yawRate, 1)}°/s</dd>
		</dl>

		<!-- FORCES: the model's own numbers, exactly as handed to Rapier — not a
		     finite difference of the body's pose. -->
		<h4>forces</h4>
		<dl>
			<dt>drive</dt>
			<dd>{signed(carDebugHud.driveForce, 0)} N</dd>
			<dt>resist</dt>
			<dd>{signed(carDebugHud.resistForce, 0)} N</dd>
			<dt>accel</dt>
			<dd>{signed(carDebugHud.accelFwd)} g</dd>
			<dt>lateral</dt>
			<dd>{signed(carDebugHud.accelLat)} g</dd>
			<dt>v lat</dt>
			<dd>{signed(carDebugHud.velLat)} m/s</dd>
			<dt>springs</dt>
			<dd>{carDebugHud.springForce} N</dd>
		</dl>

		<!-- CORNERS: the four raycast springs that ARE the car's ground contact.
		     The bar is the PHYSICAL compression (0 slack … 1 bump stop); a corner
		     with no ground under its ray reads AIR. -->
		<h4>corners</h4>
		<div class="corners">
			{#each CORNERS as label, i (label)}
				<div class="corner" class:driven={CORNER_DRIVEN[i]}>
					<span class="corner-label">{label}{CORNER_DRIVEN[i] ? '·' : ''}</span>
					<span class="bar"
						><span class="bar-fill" style="width: {carDebugHud.load[i] * 100}%"></span></span
					>
					{#if carDebugHud.grounded[i]}
						<span class="corner-val">{carDebugHud.load[i].toFixed(2)}</span>
					{:else}
						<span class="corner-val air">AIR</span>
					{/if}
				</div>
			{/each}
		</div>

		<!-- The rig's wheel-ring colours, in its own priority order. -->
		<h4>wheel rings</h4>
		<div class="legend">
			{#each RING_LEGEND as [colour, label] (label)}
				<span class="key"><i style="background: {colour}"></i>{label}</span>
			{/each}
		</div>
	</div>
{/if}

<style>
	/* Bottom-left, growing UPWARD: the corner the scene leaves free (the cluster
	   owns bottom-right, the controls hint bottom-centre, the launch flash the
	   upper middle) — and anchoring the bottom keeps the sections that move most
	   nearest the eye instead of shuffling the whole panel when one grows. */
	.debug {
		position: absolute;
		bottom: 1rem;
		left: 1rem;
		width: 15rem;
		padding: 0.5rem 0.6rem 0.6rem;
		background: rgba(6, 10, 14, 0.78);
		border: 1px solid rgba(63, 208, 255, 0.35);
		border-radius: 0.25rem;
		font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
		font-size: 0.6875rem;
		line-height: 1.45;
		color: #cfe3f0;
		/* A readout, not a control — never eat a drag meant for the camera. */
		pointer-events: none;
		user-select: none;
	}

	.debug-head {
		display: flex;
		gap: 0.3rem;
		margin-bottom: 0.35rem;
	}

	.tag {
		padding: 0.05rem 0.3rem;
		background: rgba(63, 208, 255, 0.14);
		border: 1px solid rgba(63, 208, 255, 0.3);
		border-radius: 0.15rem;
		font-size: 0.625rem;
		letter-spacing: 0.06em;
		color: #8fd6f5;
	}

	h4 {
		margin: 0.5rem 0 0.1rem;
		font-size: 0.625rem;
		font-weight: 600;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: #6f8496;
	}

	/* Two columns: the dt/dd pairs read as a table without being one. */
	dl {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 0 0.5rem;
		margin: 0;
	}

	dt {
		color: #8ca3b5;
	}

	dd {
		margin: 0;
		text-align: right;
		/* Tabular figures: a value that changes must not shuffle the column. */
		font-variant-numeric: tabular-nums;
		color: #e8f4fb;
	}

	dd.hot {
		color: #ff7a5c;
	}

	.corners {
		display: flex;
		flex-direction: column;
		gap: 0.12rem;
	}

	.corner {
		display: grid;
		grid-template-columns: 1.9rem 1fr 2.2rem;
		align-items: center;
		gap: 0.3rem;
		color: #8ca3b5;
	}

	/* The driven corners, marked once in the label — the same fact the rig draws
	   by giving those wheels a diff and half-shafts and the others nothing. */
	.corner.driven .corner-label {
		color: #ffd23f;
	}

	.bar {
		display: block;
		height: 0.4rem;
		background: rgba(255, 255, 255, 0.09);
		border-radius: 0.1rem;
		overflow: hidden;
	}

	.bar-fill {
		display: block;
		height: 100%;
		background: linear-gradient(90deg, #1fe0c0, #ff5a1f);
	}

	.corner-val {
		text-align: right;
		font-variant-numeric: tabular-nums;
		color: #e8f4fb;
	}

	.corner-val.air {
		color: #b14aff;
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.1rem 0.5rem;
		font-size: 0.625rem;
		color: #8ca3b5;
	}

	.key {
		display: inline-flex;
		align-items: center;
		gap: 0.22rem;
	}

	.key i {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
	}
</style>
