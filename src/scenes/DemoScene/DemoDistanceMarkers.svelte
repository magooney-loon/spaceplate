<script lang="ts">
	import { HTML } from '@threlte/extras';

	const distances = Array.from({ length: 20 }, (_, i) => (i + 1) * 5);
	// how many Three.js units = 1 meter
	const unitScale = 3;

	const axes: [number, number, number][] = [
		[0, 0, -1], // forward
		[0, 0,  1], // back
		[-1, 0, 0], // left
		[ 1, 0, 0], // right
	];
</script>

{#each axes as axis}
	{#each distances as d}
		<HTML position={[axis[0] * d * unitScale, 0.6, axis[2] * d * unitScale]} center occlude={false}>
			<div class="marker">
				<span class="label" class:major={d % 15 === 0} class:minor={d % 15 !== 0}>{d}m</span>
			</div>
		</HTML>
	{/each}
{/each}

<style>
	.marker {
		display: flex;
		flex-direction: column;
		align-items: center;
		pointer-events: none;
		user-select: none;
	}

	.label {
		font-family: monospace;
		font-weight: 700;
		letter-spacing: 0.08em;
		border-radius: 4px;
		white-space: nowrap;
		text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
	}

	.label.major {
		background: rgba(0, 0, 0, 0.65);
		color: #ffffff;
		font-size: 14px;
		padding: 3px 10px;
		border: 1px solid rgba(255, 255, 255, 0.35);
	}

	.label.minor {
		background: rgba(0, 0, 0, 0.45);
		color: #aaaaaa;
		font-size: 10px;
		padding: 2px 6px;
		border: 1px solid rgba(255, 255, 255, 0.12);
	}
</style>
