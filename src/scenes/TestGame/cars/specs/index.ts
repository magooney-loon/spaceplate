// Barrel for the three car specs — garage.svelte.ts imports the registry from
// here rather than each spec file individually. Adding a car is still one file
// (cars/specs/<make>_<model>.ts, see CLAUDE.md's "Adding a car") + one export
// here + one entry in garage.svelte.ts's CARS; nothing else changes.

export { toyota_gr86 } from './toyota_gr86';
export { audi_rs3 } from './audi_rs3';
export { nissan_gtir } from './nissan_gtir';
