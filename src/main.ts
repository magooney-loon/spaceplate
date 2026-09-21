import { mount } from 'svelte';
import Root from './Root.svelte';
import { probeCapabilities } from '$core';
import { seedGraphicsQuality } from '$extensions/settings';
/* import './__debug'; */

// Probe WebGPU / WebGL2 / WASM before mounting so App.svelte and Loader.svelte read
// a settled verdict synchronously (capabilities.svelte.ts). Costs one requestAdapter
// round-trip — a few ms — and never rejects. The graphics preset is seeded from it
// here, before the first render, for users who have never picked one themselves.
probeCapabilities().then(() => {
	seedGraphicsQuality();
	mount(Root, {
		target: document.getElementById('app')!
	});
});
