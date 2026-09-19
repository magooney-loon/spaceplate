<script lang="ts">
	import { onDestroy } from 'svelte';
	import { T, useTask, useThrelte } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import { currentCar } from '../cars';
	import { UNITS_PER_METER } from '../units';
	import { carSim } from '../sim/carTelemetry.svelte';
	import type { CarViewMode } from '../sim/carSwitches.svelte';
	import type { LapTimer } from '../sim/lapTimer';
	import type { Suspension } from '../sim/suspension';

	// The lap gate, drawn — the start/finish segment sim/lapTimer.ts actually
	// tests, world-anchored at the spawn. The rig's one rule holds here too:
	// nothing is re-derived. The centre, heading and width are read off the
	// timer's own `gate` object (what is drawn is what is tested), and the road
	// height — the one number the timer does not carry, its test being XZ-only
	// — is measured by the car's own suspension rays on the first grounded
	// frame after spawn, before the car has left the line.
	//
	// World-anchored, not car-space: it mounts as a scene sibling (outside the
	// car's group) and never moves again. Like the rig's skeleton it shows in
	// both debug views ('rig' and 'both') — B cycles model → rig → both. In
	// 'model' it only poses (once, at spawn — the ground sample cannot wait for
	// a view that may come later) and then idles: a posed gate is static, so it
	// invalidates to pose, to appear, and while a counting flash is running. A
	// counted crossing flashes the whole gate white, so "did that one count?" is
	// answerable from the driving seat.

	let {
		view = 'model',
		lapTimer,
		suspension
	}: { view?: CarViewMode; lapTimer: LapTimer; suspension: Suspension } = $props();

	const spec = currentCar();
	/** Tyre radius, world units — hub minus radius is the road. */
	const R = spec.model.wheelRadiusFallback * UNITS_PER_METER;

	/** s — how long a counted crossing keeps the gate lit. */
	const FLASH_TIME = 0.6;
	/** Post height, world units (~1.2 m): tall enough to find from the chase
	 *  cam, short enough to read as a marker and not scenery. */
	const POST_H = 3;

	// ── Geometry & materials — all disposed on destroy ─────────────────────
	const geos: THREE.BufferGeometry[] = [];
	const mats: THREE.Material[] = [];

	// Built in the GATE'S local frame: +X across the segment (the timer's
	// `right`), −Z the counting direction (the spawn heading). The group is
	// yawed so that frame stands up in the world at pose time.
	const gateGroup = new THREE.Group();
	gateGroup.name = 'LapGate';
	gateGroup.visible = false; // the $effect below owns visibility from the first flush

	// One material for everything — bar, posts and chevron all report the same
	// fact (the gate), and one graph build is one graph build.
	const gateMat = new THREE.MeshBasicNodeMaterial({ color: 0x1fe0c0 });
	mats.push(gateMat);

	// The bar: unit length along X, stretched to the gate's own half-width at
	// pose time — the drawn extent IS the tested extent, not a copy of it.
	const barGeo = new THREE.BoxGeometry(1, 0.07, 1.5);
	geos.push(barGeo);
	const bar = new THREE.Mesh(barGeo, gateMat);
	bar.position.y = 0.05;
	gateGroup.add(bar);

	// End posts at ±halfWidth — the segment's extent reads from any camera
	// angle, not just the top-down one a flat stripe needs.
	const postGeo = new THREE.BoxGeometry(0.3, POST_H, 0.3);
	postGeo.translate(0, POST_H / 2, 0); // rooted at the road
	geos.push(postGeo);
	const postL = new THREE.Mesh(postGeo, gateMat);
	const postR = new THREE.Mesh(postGeo, gateMat);
	gateGroup.add(postL, postR);

	// Which way counts: a flat chevron just before the line on the approach
	// side (local +Z is behind the gate — signed distance is measured along
	// −Z), apex pointing across it. CircleGeometry with three segments is a
	// triangle; θstart π/2 puts the apex at −Z once rotated flat.
	const chevronGeo = new THREE.CircleGeometry(1.4, 3, Math.PI / 2);
	chevronGeo.rotateX(-Math.PI / 2);
	geos.push(chevronGeo);
	const chevron = new THREE.Mesh(chevronGeo, gateMat);
	chevron.position.set(0, 0.05, 2.5);
	gateGroup.add(chevron);

	// ── Pose — once, from the timer's own gate ─────────────────────────────
	const { invalidate, autoRenderTask } = useThrelte();

	/** Set (and made visible) by the task below the frame the gate is first
	 *  drawable; the visibility $effect reads it. */
	let posed = $state(false);
	let flash = 0;
	let lastCount = 0;

	const cTeal = new THREE.Color(0x1fe0c0);
	const cWhite = new THREE.Color(0xffffff);

	useTask(
		(delta) => {
			// Posing runs in EVERY view, not just the debug ones: the ground sample
			// has to be taken while the car is still at the spawn, and B can be
			// pressed any time after. Unposed and invisible, this is a boolean a
			// frame; posed, it is nothing at all.
			if (!lapTimer.gate.armed) return;

			if (!posed) {
				// The road under the spawn line, measured by the car's own rays:
				// a grounded corner's hub sits one tyre radius above what it hit,
				// in body space, and the body's world Y is published the same
				// step. The lowest grounded corner wins — the highest ground the
				// car can see at the line, so the bar never ends up under a camber.
				const g = lapTimer.gate;
				let ground = Infinity;
				for (let i = 0; i < 4; i++) {
					if (!suspension.grounded[i]) continue;
					ground = Math.min(ground, carSim.bodyY + suspension.wheelY[i] - R);
				}
				if (!Number.isFinite(ground)) return; // airborne at spawn: try next frame

				// Yaw that stands the local frame up: −Z → the gate's forward,
				// +X → its right (the across-track axis the segment runs along).
				gateGroup.position.set(g.x, ground, g.z);
				gateGroup.rotation.y = Math.atan2(-g.fwdX, -g.fwdZ);
				bar.scale.x = g.halfWidth * 2;
				postL.position.x = -g.halfWidth;
				postR.position.x = g.halfWidth;
				posed = true; // flips the $effect, which invalidates to show it
			}

			// Hidden in 'model' — the flash is a debug reading, and an invisible
			// one is not worth invalidating for.
			if (view === 'model') return;

			// A counted crossing lights the whole gate white and decays back to
			// teal — the reading is "that one counted", on the thing itself.
			const count = lapTimer.state.lapCount;
			if (count !== lastCount) {
				lastCount = count;
				flash = FLASH_TIME;
			}
			if (flash > 0) {
				flash = Math.max(0, flash - delta);
				gateMat.color.copy(cTeal).lerp(cWhite, flash / FLASH_TIME);
				// Still lit (or just finished) — the tint moved, so redraw.
				invalidate();
			}
		},
		{ before: autoRenderTask, autoInvalidate: false }
	);

	$effect(() => {
		gateGroup.visible = view !== 'model' && posed;
		invalidate();
	});

	onDestroy(() => {
		for (const g of geos) g.dispose();
		for (const m of mats) m.dispose();
	});
</script>

<!-- A world-space sibling of the car, never inside it: the gate stays at the
     spawn whatever the body is doing. -->
<T is={gateGroup} />
