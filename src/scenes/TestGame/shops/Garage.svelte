<script lang="ts">
	import { engineSounds } from '$core';
	import { CARS, carGarage } from '../cars';
	import type { CarId, CarSpec } from '../cars';
	import { garageShop } from '../sim/garageShop.svelte';

	// The garage — a TOP BAR, same shape as PaintShop.svelte: no backdrop, the
	// world stays interactive around it, only the bar itself catches clicks.
	// One row of car cards, each showing exactly what's IN the spec (nothing
	// invented here) — picking one writes carGarage.currentId, which
	// TestGame.svelte keys its <PlayerCar /> on, so the pick remounts the car
	// fresh against the new spec (the track stays up).
	//
	// THE FIRST CAR IS A CHOICE: until carGarage.picked the bar holds itself
	// open (open || !picked below) and shows no close — there is nothing to go
	// back TO — so the session starts with the player taking delivery, not with
	// a defaulted spawn. NO CARD IS SELECTED on that first screen (the highlight
	// is gated on `picked` below, not on the registry default `currentId`
	// carries), and every card is an equal take-delivery; after that the shop is
	// an ordinary toggle and the highlight means "what you're driving".

	const RPM_PER_RAD_S = 60 / (2 * Math.PI);

	/** kW at the torque curve's hardest-working authored point — the curve's
	 *  peaks sit exactly at its own points (see cars/specs/toyota_gr86.ts's header), so this
	 *  needs no interpolation between them. */
	function peakPowerKw(spec: CarSpec): number {
		let peak = 0;
		for (const [rpm, nm] of spec.hardware.torqueCurve) {
			const watts = nm * (rpm / RPM_PER_RAD_S);
			if (watts > peak) peak = watts;
		}
		return peak / 1000;
	}

	function peakTorqueNm(spec: CarSpec): number {
		return spec.hardware.torqueCurve.reduce((max, [, nm]) => Math.max(max, nm), 0);
	}

	const LAYOUT_LABEL: Record<CarSpec['layout'], string> = {
		rwd: 'RWD',
		fwd: 'FWD',
		awd: 'AWD'
	};

	const close = () => {
		engineSounds.click.play();
		garageShop.open = false;
	};

	function pick(id: CarId) {
		// The same-car early-out is for the post-first-pick case only (picking the
		// car you're driving just closes the bar): before the first pick even the
		// default's card is a real take-delivery, so it must not short-circuit.
		if (carGarage.picked && id === carGarage.currentId) {
			close();
			return;
		}
		engineSounds.click.play();
		carGarage.currentId = id;
		carGarage.picked = true;
		garageShop.open = false;
	}
</script>

{#if garageShop.open || !carGarage.picked}
	<div class="shop" role="dialog" aria-label="Garage">
		<div class="head">
			<h2>{carGarage.picked ? 'Garage' : 'Choose your car'}</h2>
			{#if carGarage.picked}
				<button class="close" onclick={close} aria-label="Close garage">✕</button>
			{/if}
		</div>

		<div class="cars">
			{#each Object.entries(CARS) as [id, spec] (id)}
				<!-- SELECTED means "the car you are driving", so it needs the pick as
				     well as the id: `currentId` carries a default (cars/garage.svelte.ts
				     keeps it non-null for the module-load readers), and on its own it
				     lit that car's card up on the very first screen — the GR86 reading
				     as already chosen on a bar whose whole point is that nothing is. -->
				<button
					class="option"
					class:selected={carGarage.picked && id === carGarage.currentId}
					onclick={() => pick(id as CarId)}
				>
					<img class="logo" src={spec.logo} alt="" width="320" height="320" />
					<span class="label">{spec.modelLabel}</span>
					<span class="layout">{LAYOUT_LABEL[spec.layout]}</span>
					<span class="stats">
						{Math.round(peakPowerKw(spec))} kW / {Math.round(peakPowerKw(spec) * 1.34102)} hp
						<br />
						{Math.round(peakTorqueNm(spec))} Nm / {Math.round(peakTorqueNm(spec) * 0.737562)} lb-ft
						<br />
						{Math.round(spec.hardware.mass)} kg / {Math.round(spec.hardware.mass * 2.20462)} lb
						<br />
						{Math.round(spec.hardware.topSpeed * 3.6)} km/h / {Math.round(
							spec.hardware.topSpeed * 2.23694
						)} mph
						<br />
						{spec.hardware.gearRatios.length}-speed
					</span>
				</button>
			{/each}
		</div>
	</div>
{/if}

<style>
	.shop {
		position: absolute;
		top: 9rem;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		max-width: min(92vw, 66rem);
		padding: 0.625rem 1rem 0.75rem;
		background: rgba(7, 11, 18, 0.92);
		border: 1px solid #4a90d9;
		border-radius: 0.375rem;
		color: #fff;
	}

	.head {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	h2 {
		margin: 0;
		font-size: 0.9375rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.close {
		padding: 0.25rem 0.5rem;
		margin-left: auto;
		background: none;
		color: #8fb6dd;
		border: none;
		font-size: 1rem;
		cursor: pointer;
	}

	.close:hover {
		color: #fff;
	}

	.cars {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.75rem;
	}

	.option {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		min-width: 11rem;
		padding: 0.625rem 0.875rem;
		background: rgba(0, 0, 0, 0.35);
		border: 1px solid rgba(74, 144, 217, 0.35);
		border-radius: 0.25rem;
		color: #8fb6dd;
		cursor: pointer;
		text-align: center;
	}

	.option:hover {
		color: #fff;
		border-color: rgba(74, 144, 217, 0.6);
	}

	.option.selected {
		color: #fff;
		border-color: #4a90d9;
		box-shadow: 0 0 12px rgba(74, 144, 217, 0.4);
	}

	.logo {
		width: 3.75rem;
		height: 3.75rem;
		object-fit: contain;
	}

	.label {
		font-size: 0.8125rem;
		font-weight: 700;
		letter-spacing: 0.03em;
		white-space: nowrap;
	}

	.layout {
		font-size: 0.6875rem;
		letter-spacing: 0.1em;
		opacity: 0.75;
	}

	.stats {
		margin-top: 0.25rem;
		font-size: 0.6875rem;
		line-height: 1.5;
		opacity: 0.9;
	}
</style>
