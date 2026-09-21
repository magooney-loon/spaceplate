<script lang="ts">
	import { carIgnition } from '../sim/carSwitches.svelte';
	import { carHud } from '../sim/carTelemetry.svelte';
	import { trackMapState } from './trackMapState.svelte';
	import { worldToMap } from './trackMap';

	// Bottom-left minimap: the circuit from above, with the car on it.
	//
	// NO PANEL CHROME — the same call CarCluster.svelte makes ("the gauges
	// float"). It had a bezelled plate for a while and the plate was the problem:
	// the cluster's gauges each carry their own dark face because a NEEDLE needs
	// a dial behind it, and a map does not. What replaces the plate as the thing
	// that keeps it legible is the SHADOW pass below — a wide dark copy of the
	// road under the glow, so the outline holds against bright asphalt and sky
	// alike without boxing the corner off.
	//
	// ── What is real ─────────────────────────────────────────────────────────
	// The OUTLINE is the track GLB's Asphalt meshes, rasterized and contoured
	// once at load (world/trackMap.ts) and handed over through
	// world/trackMapState.svelte — it is the road, not an artist's impression of
	// it. The CAR is `carHud.mapX/mapZ/mapYaw`, the 30 Hz quantised mirror, never
	// `carSim`. Both are in the same world frame, so the marker cannot drift from
	// the map.
	//
	// NORTH-UP, fixed: the path is static markup the browser rasterizes once and
	// only the marker moves. A car-up map would be one more transform per frame
	// and would spin the compass and the label with it.

	const map = $derived(trackMapState.map);

	// ── Layout ───────────────────────────────────────────────────────────────
	// The map's own box is 100 units square (trackMap.ts's `size`), and the
	// viewBox is that box plus a head for the compass and a foot for the label —
	// no margin beyond them, since there is no longer a plate edge to clear.
	const HEAD = 9;
	const FOOT = 9;
	const BOX = 100;

	/** Where the car sits, in map units — clamped inside the box rather than
	 *  allowed to leave it. The map is fitted to the ASPHALT, and the car can
	 *  drive off it (the dirt plane runs 460 m past the circuit), so an unclamped
	 *  marker would wander off the instrument and disappear. Riding the edge is
	 *  the honest reading: "off the map, that way". */
	const marker = $derived.by(() => {
		if (!map) return null;
		const [mx, my] = worldToMap(map, carHud.mapX, carHud.mapZ);
		const x = Math.min(BOX - 4, Math.max(4, mx));
		const y = Math.min(BOX - 4, Math.max(4, my));
		return { x, y, off: x !== mx || y !== my };
	});

	/** The marker, drawn nose-up at the origin — rotated into place below. */
	const ARROW = 'M0 -5.2 L3.4 4.2 L0 2.2 L-3.4 4.2 Z';

	/** Backlight, exactly as the cluster's: ignition off is a dead instrument. */
	const lit = $derived(carIgnition.on);

	// SVG's rotate() is clockwise because its y axis points down, and the map's
	// +y is world +Z — so the body's yaw (counter-clockwise about world +Y, as
	// the telemetry publishes it) becomes a NEGATIVE svg rotation. The one place
	// that conversion is allowed to live: the telemetry publishes the yaw, the
	// picture decides what a picture needs.
	const markerAngle = $derived(-carHud.mapYaw);
</script>

<div class="minimap" class:dark={!lit}>
	<svg class="map" viewBox="0 0 {BOX} {HEAD + BOX + FOOT}" role="img" aria-label="Track map">
		<!-- North marker. The map is north-up, so this never moves; it is here to
		     say that it never moves. -->
		<line class="compass-tick" x1={BOX / 2} y1="1" x2={BOX / 2} y2="4.5" />
		<text class="compass" x={BOX / 2} y="8.5">N</text>

		{#if map}
			<g transform="translate(0 {HEAD})">
				<!-- The circuit, in four passes, all of them the SAME path drawn again
				     — the cluster's rule: no blur filters, they re-rasterize whatever
				     they cover every time it moves. Dark shadow for contrast against
				     the scene (this is what the plate used to do), then the halo,
				     then a faint body fill, then the bright edge. `evenodd` is what
				     punches the infield out: the contour pass emits holes as their
				     own closed rings with no winding bookkeeping. -->
				<path class="road-shadow" d={map.d} />
				<path class="road-glow" d={map.d} />
				<path class="road-fill" d={map.d} />
				<path class="road" d={map.d} />

				{#if marker}
					<g transform="translate({marker.x} {marker.y}) rotate({markerAngle})">
						<path class="car-shadow" d={ARROW} />
						<path class="car-glow" d={ARROW} />
						<path class="car" class:off={marker.off} d={ARROW} />
					</g>
				{/if}
			</g>
		{:else}
			<text class="placeholder" x={BOX / 2} y={HEAD + BOX / 2}>NO MAP</text>
		{/if}

		<text class="label" x={BOX / 2} y={HEAD + BOX + FOOT - 2}>TRACK</text>
	</svg>
</div>

<style>
	/* Bottom-left is shared with the debug readout — TestGameHud stacks the two
	   in one column rather than either of them owning the corner. */
	.minimap {
		/* THE SIZE KNOB, the cluster's pattern: the SVG has a viewBox and follows
		   the width for free. Sized to carry the same visual weight as the pod
		   across the screen, which is what the missing plate cost it. */
		width: 14em;
		font-size: 1.35rem;
		color: #fff;
		pointer-events: none;
		user-select: none;
	}

	/* Ignition off: the backlight dies, exactly as the cluster's face does. */
	.minimap.dark {
		opacity: 0.55;
		filter: saturate(0.35);
	}

	.map {
		display: block;
		width: 100%;
		overflow: visible;
	}

	/* ── The circuit ──────────────────────────────────────────────────────── */
	/* The widest, darkest pass, and the one doing the job the plate used to:
	   without it the cyan outline disappears into pale asphalt and into a bright
	   sky the moment the camera pitches up. */
	.road-shadow {
		fill: none;
		stroke: rgba(0, 0, 0, 0.55);
		stroke-width: 4.5;
		stroke-linejoin: round;
	}

	.road-glow {
		fill: none;
		stroke: rgba(79, 168, 255, 0.28);
		stroke-width: 3;
		stroke-linejoin: round;
	}

	.road-fill {
		fill: rgba(10, 22, 38, 0.55);
		fill-rule: evenodd;
		stroke: none;
	}

	.road {
		fill: none;
		stroke: #4fa8ff;
		stroke-width: 0.9;
		stroke-linejoin: round;
	}

	/* ── The car ──────────────────────────────────────────────────────────── */
	.car {
		fill: #ff3b30;
	}

	/* Riding the edge means the car is off the asphalt the map is fitted to —
	   the arrow is a DIRECTION then, not a position, and says so. */
	.car.off {
		fill: rgba(255, 59, 48, 0.55);
	}

	.car-glow {
		fill: none;
		stroke: rgba(255, 59, 48, 0.3);
		stroke-width: 3;
		stroke-linejoin: round;
	}

	.car-shadow {
		fill: none;
		stroke: rgba(0, 0, 0, 0.5);
		stroke-width: 4.5;
		stroke-linejoin: round;
	}

	/* ── Printed chrome ───────────────────────────────────────────────────── */
	/* `paint-order` puts the dark stroke UNDER the fill, so the text carries its
	   own contrast without a drop-shadow filter — the same reason the road has a
	   shadow pass instead of one. */
	.compass,
	.label,
	.placeholder {
		paint-order: stroke fill;
		stroke: rgba(0, 0, 0, 0.55);
		stroke-width: 1.6;
		stroke-linejoin: round;
		text-anchor: middle;
	}

	.compass-tick {
		stroke: rgba(159, 216, 255, 0.7);
		stroke-width: 1.2;
	}

	.compass {
		fill: rgba(159, 216, 255, 0.85);
		font-size: 6px;
		font-weight: 700;
	}

	.label {
		fill: rgba(159, 216, 255, 0.65);
		font-size: 6.5px;
		font-weight: 600;
		letter-spacing: 0.14em;
	}

	.placeholder {
		fill: rgba(159, 216, 255, 0.3);
		font-size: 8px;
		font-weight: 700;
		letter-spacing: 0.18em;
	}
</style>
