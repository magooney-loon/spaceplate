<script lang="ts">
	import { T } from '@threlte/core';
	import Planet from '$lib/PlanetDemo/Planet.svelte';
	import PlanetSmoke from '$lib/PlanetDemo/PlanetSmoke.svelte';
	import { planetDemoState } from '$lib/PlanetDemo/planetDemoState.svelte';
</script>

<!-- Main Menu 3D — procedural planet background -->
<T.Group position={[0, 0, 0]} name="DemoPlanet">
	<Planet planetId={planetDemoState.planetId} temperature={planetDemoState.temperature} />
	<PlanetSmoke planetId={planetDemoState.planetId} temperature={planetDemoState.temperature} />
</T.Group>
