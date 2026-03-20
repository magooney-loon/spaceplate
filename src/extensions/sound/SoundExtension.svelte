<script lang="ts">
	import { useStudio, ToolbarItem, DropDownPane } from '@threlte/studio/extend';
	import { Folder, Slider, Checkbox, Button, List, Separator } from 'svelte-tweakpane-ui';
	import type { Snippet } from 'svelte';
	import { extensionScope, type ExtensionState, type ExtensionActions } from './types';
	import { settingsState } from '$extensions/settings/settings.svelte';

	interface Props {
		children?: Snippet;
	}

	let { children }: Props = $props();

	const { createExtension } = useStudio();

	const ext = createExtension<ExtensionState, ExtensionActions>({
		scope: extensionScope,
		state: () => ({
			refDistance: 5,
			maxDistance: 80,
			rolloffFactor: 1.5,
			panningModel: 'HRTF' as 'HRTF' | 'equalpower',
			listenerEnabled: true
		}),
		actions: {
			setSfxVolume(_state, v) {
				settingsState.audio.sfxVolume = v;
			},
			toggleSfx() {
				settingsState.audio.sfxEnabled = !settingsState.audio.sfxEnabled;
			},
			setMusicVolume(_state, v) {
				settingsState.audio.musicVolume = v;
			},
			toggleMusic() {
				settingsState.audio.musicEnabled = !settingsState.audio.musicEnabled;
			},
			setAmbienceVolume(_state, v) {
				settingsState.audio.ambienceVolume = v;
			},
			toggleAmbience() {
				settingsState.audio.ambienceEnabled = !settingsState.audio.ambienceEnabled;
			},
			setRefDistance({ state }, v) {
				state.refDistance = v;
			},
			setMaxDistance({ state }, v) {
				state.maxDistance = v;
			},
			setRolloffFactor({ state }, v) {
				state.rolloffFactor = v;
			},
			setPanningModel({ state }, v) {
				state.panningModel = v;
			},
			resetPositional({ state }) {
				state.refDistance = 5;
				state.maxDistance = 80;
				state.rolloffFactor = 1.5;
				state.panningModel = 'HRTF';
			}
		}
	});

	const extState = ext.state;

	const panningOptions = [
		{ value: 'HRTF', text: 'HRTF (3D)' },
		{ value: 'equalpower', text: 'Equal Power (cheap)' }
	];
</script>

<ToolbarItem position="left">
	<DropDownPane icon="mdiVolumeHigh" title="Sound">
		<Folder title="Buses" expanded={true}>
			<Folder title="SFX" expanded={true}>
				<Checkbox label="Enabled" bind:value={settingsState.audio.sfxEnabled} />
				<Slider
					label="Volume"
					value={settingsState.audio.sfxVolume}
					min={0}
					max={1}
					step={0.01}
					on:change={(e) => ext.setSfxVolume(e.detail.value)}
				/>
			</Folder>

			<Folder title="Music" expanded={true}>
				<Checkbox label="Enabled" bind:value={settingsState.audio.musicEnabled} />
				<Slider
					label="Volume"
					value={settingsState.audio.musicVolume}
					min={0}
					max={1}
					step={0.01}
					on:change={(e) => ext.setMusicVolume(e.detail.value)}
				/>
			</Folder>

			<Folder title="Ambient" expanded={true}>
				<Checkbox label="Enabled" bind:value={settingsState.audio.ambienceEnabled} />
				<Slider
					label="Volume"
					value={settingsState.audio.ambienceVolume}
					min={0}
					max={1}
					step={0.01}
					on:change={(e) => ext.setAmbienceVolume(e.detail.value)}
				/>
			</Folder>
		</Folder>

		<Separator />

		<Folder title="Positional Audio" expanded={false}>
			<List
				label="Panning Model"
				value={extState.panningModel}
				options={panningOptions}
				on:change={(e) => ext.setPanningModel(e.detail.value as 'HRTF' | 'equalpower')}
			/>
			<Slider
				label="Ref Distance"
				value={extState.refDistance}
				min={0.1}
				max={20}
				step={0.1}
				on:change={(e) => ext.setRefDistance(e.detail.value)}
			/>
			<Slider
				label="Max Distance"
				value={extState.maxDistance}
				min={10}
				max={500}
				step={1}
				on:change={(e) => ext.setMaxDistance(e.detail.value)}
			/>
			<Slider
				label="Rolloff Factor"
				value={extState.rolloffFactor}
				min={0}
				max={5}
				step={0.01}
				on:change={(e) => ext.setRolloffFactor(e.detail.value)}
			/>
			<Button title="Reset to Default" on:click={() => ext.resetPositional()} />
		</Folder>
	</DropDownPane>
</ToolbarItem>

{@render children?.()}
