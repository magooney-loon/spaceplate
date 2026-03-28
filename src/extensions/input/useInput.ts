import { inputState, inputActions, inputQueries } from './input.svelte';
import type { InputActions, InputQueries } from './types';

export type UseInputResult = {
	state: typeof inputState;
	actions: InputActions;
	queries: InputQueries;
};

export const useInput = (): UseInputResult => {
	return { state: inputState, actions: inputActions, queries: inputQueries };
};
