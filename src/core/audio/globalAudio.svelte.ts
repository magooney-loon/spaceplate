export const soundTriggers = $state({
	click: 0,
	swoosh: 0
});

export const soundActions = {
	playClick() {
		soundTriggers.click++;
	},
	playSwoosh() {
		soundTriggers.swoosh++;
	}
};
