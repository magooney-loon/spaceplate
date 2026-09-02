import { mount } from 'svelte';
import Root from './Root.svelte';
/* import './__debug'; */

mount(Root, {
	target: document.getElementById('app')!
});
