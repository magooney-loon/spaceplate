// Shared state for the procedural planet shown on the main menu

const randomId = () => Math.random().toString(36).slice(2, 10);
const randomTemp = () => Math.floor(Math.random() * 160) - 60; // -60 to 100°C (all biomes)

export const planetDemoState = $state({
	planetId: randomId(),
	temperature: randomTemp(),
	faviconUri: ''
});

export const planetDemoActions = {
	randomize() {
		planetDemoState.planetId = randomId();
		planetDemoState.temperature = randomTemp();
	}
};
