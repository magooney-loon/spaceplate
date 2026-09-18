<script lang="ts">
	import { engineSounds } from '$core';
	import { currentCar } from './cars';
	import type { PaintFinish } from './cars/types';
	import { carPaint, paintShop, selectFinish, selectPaint } from './sim/carPaint.svelte';

	// The paint shop — a TOP BAR, not a modal: no backdrop, the world stays
	// interactive around it, and only the bar itself catches clicks. One row of
	// swatches (the spec's order sheet), finish chips beside the title, and the
	// HUD's Paint Shop button is the only way in or out (no key — pointer UI).
	//
	// Selecting applies instantly (TestGame.svelte's paint effect watches
	// carPaint.id/finish) and picks up the code's FACTORY finish; the chips
	// then override the finish without touching the colour — Solar Shift's
	// flip on Yuzu yellow is one chip away.
	//
	// No transitions (repo rule): the bar appears and disappears, the chips and
	// rings snap — the car re-painting underneath is the animation.

	const paints = currentCar().model.paints;

	const FINISHES: readonly { id: PaintFinish; label: string }[] = [
		{ id: 'solid', label: 'Solid' },
		{ id: 'metallic', label: 'Metallic' },
		{ id: 'pearl', label: 'Pearl' },
		{ id: 'shift', label: 'Shift' }
	];

	const selected = $derived(paints.find((paint) => paint.id === carPaint.id) ?? paints[0]);

	const close = () => {
		engineSounds.click.play();
		paintShop.open = false;
	};
</script>

{#if paintShop.open}
	<div class="shop" role="dialog" aria-label="Paint shop">
		<div class="head">
			<h2>Paint</h2>
			<span class="model">{currentCar().label}</span>

			<div class="finishes" role="group" aria-label="Finish">
				{#each FINISHES as finish (finish.id)}
					<button
						class="chip"
						class:selected={carPaint.finish === finish.id}
						onclick={() => {
							engineSounds.click.play();
							selectFinish(finish.id);
						}}
					>
						{finish.label}
					</button>
				{/each}
			</div>

			<button class="close" onclick={close} aria-label="Close paint shop">✕</button>
		</div>

		<div class="swatches">
			{#each paints as paint (paint.id)}
				<button
					class="option"
					class:selected={paint.id === carPaint.id}
					onclick={() => {
						engineSounds.click.play();
						selectPaint(paint.id);
					}}
				>
					<span class="dot" style:background={paint.hex}></span>
					<span class="label">{paint.label}</span>
				</button>
			{/each}
		</div>

		<p class="readout">
			{selected.label} · {selected.code} · {carPaint.finish}
			{#if carPaint.finish !== selected.finish}<span class="factory">· factory {selected.finish}</span>{/if}
		</p>
	</div>
{/if}

<style>
	.shop {
		position: absolute;
		top: 18rem;
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

	.model {
		color: #8fb6dd;
		font-size: 0.8125rem;
	}

	.finishes {
		display: flex;
		gap: 0.25rem;
		margin-left: auto;
	}

	.chip {
		padding: 0.2rem 0.6rem;
		background: rgba(0, 0, 0, 0.5);
		color: #8fb6dd;
		border: 1px solid rgba(74, 144, 217, 0.35);
		border-radius: 999px;
		font-size: 0.75rem;
		cursor: pointer;
	}

	.chip:hover {
		color: #fff;
	}

	.chip.selected {
		color: #fff;
		border-color: #4a90d9;
		box-shadow: 0 0 8px rgba(74, 144, 217, 0.35);
	}

	.close {
		padding: 0.25rem 0.5rem;
		margin-left: 0.5rem;
		background: none;
		color: #8fb6dd;
		border: none;
		font-size: 1rem;
		cursor: pointer;
	}

	.close:hover {
		color: #fff;
	}

	.swatches {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.25rem 0.75rem;
	}

	.option {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		padding: 0.25rem 0.375rem;
		background: none;
		border: none;
		color: #8fb6dd;
		cursor: pointer;
	}

	.option:hover .label {
		color: #fff;
	}

	.dot {
		width: 1.875rem;
		height: 1.875rem;
		border-radius: 50%;
		border: 1px solid rgba(255, 255, 255, 0.25);
	}

	.option.selected .dot {
		border-color: #fff;
		box-shadow:
			0 0 0 2px #4a90d9,
			0 0 12px rgba(74, 144, 217, 0.5);
	}

	.label {
		font-size: 0.6875rem;
		letter-spacing: 0.03em;
		white-space: nowrap;
	}

	.option.selected .label {
		color: #fff;
	}

	.readout {
		margin: 0;
		text-align: center;
		color: #8fb6dd;
		font-size: 0.75rem;
		letter-spacing: 0.05em;
	}

	.factory {
		opacity: 0.7;
	}
</style>
