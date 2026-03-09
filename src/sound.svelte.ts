// Sound trigger state — increment a counter to fire a one-shot sound.
// The actual <Audio> components that consume these live in Sound.svelte.

export const soundTriggers = $state({
  swoosh: 0,
  click: 0,
});

export const soundActions = {
  playSwoosh() {
    soundTriggers.swoosh++;
  },

  playClick() {
    soundTriggers.click++;
  },
};
