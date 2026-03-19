<script lang="ts">
	import { useStudio, ToolbarItem, DropDownPane } from '@threlte/studio/extend';
	import { Folder, Slider, Checkbox, Button, List } from 'svelte-tweakpane-ui';
	import { extensionScope, type ExtensionState, type ExtensionActions } from './types';
	import { settingsState } from '$core/settings.svelte.js';

	const { createExtension } = useStudio();

	const ext = createExtension<ExtensionState, ExtensionActions>({
		scope: extensionScope,
		state() {
			return {
				masterVolume: 1,
				masterMuted: false,

				sfxVolume: settingsState.audio.sfxVolume,
				sfxMuted: settingsState.audio.sfxMuted,

				musicVolume: settingsState.audio.musicVolume,
				musicMuted: settingsState.audio.musicMuted,

				ambienceVolume: settingsState.audio.ambienceVolume,
				ambienceMuted: settingsState.audio.ambienceMuted,

				refDistance: 5,
				maxDistance: 80,
				rolloffFactor: 1.5,
				panningModel: 'HRTF' as 'HRTF' | 'equalpower',

				listenerEnabled: true
			};
		},
		actions: {
			setMasterVolume({ state }, v) {
				state.masterVolume = v;
			},
			toggleMasterMute({ state }) {
				state.masterMuted = !state.masterMuted;
			},
			setSfxVolume({ state }, v) {
				state.sfxVolume = v;
				settingsState.audio.sfxVolume = v;
			},
			toggleSfxMute({ state }) {
				state.sfxMuted = !state.sfxMuted;
				settingsState.audio.sfxMuted = state.sfxMuted;
			},
			setMusicVolume({ state }, v) {
				state.musicVolume = v;
				settingsState.audio.musicVolume = v;
			},
			toggleMusicMute({ state }) {
				state.musicMuted = !state.musicMuted;
				settingsState.audio.musicMuted = state.musicMuted;
			},
			setAmbientVolume({ state }, v) {
				state.ambienceVolume = v;
				settingsState.audio.ambienceVolume = v;
			},
			toggleAmbientMute({ state }) {
				state.ambienceMuted = !state.ambienceMuted;
				settingsState.audio.ambienceMuted = state.ambienceMuted;
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
			resetAll({ state }) {
				state.masterVolume = 1;
				state.masterMuted = false;
				state.sfxVolume = settingsState.audio.sfxVolume;
				state.sfxMuted = settingsState.audio.sfxMuted;
				state.musicVolume = settingsState.audio.musicVolume;
				state.musicMuted = settingsState.audio.musicMuted;
				state.ambienceVolume = settingsState.audio.ambienceVolume;
				state.ambienceMuted = settingsState.audio.ambienceMuted;
				state.refDistance = 5;
				state.maxDistance = 80;
				state.rolloffFactor = 1.5;
				state.panningModel = 'HRTF';
			}
		}
	});

	const state = ext.state;

	const panningOptions = [
		{ value: 'HRTF', text: 'HRTF (3D)' },
		{ value: 'equalpower', text: 'Equal Power (cheap)' }
	];
</script>

<slot />

<ToolbarItem position="left">
	<DropDownPane icon="mdiVolumeHigh" title="Sound">
		<Folder title="Master" expanded={true}>
			<Slider
				label="Master Volume"
				value={state.masterVolume}
				min={0}
				max={1}
				step={0.01}
				on:change={(e) => ext.setMasterVolume(e.detail.value)}
			/>
			<Checkbox
				label="Master Muted"
				value={state.masterMuted}
				on:change={() => ext.toggleMasterMute()}
			/>
		</Folder>

		<Folder title="Buses" expanded={true}>
			<Slider
				label="SFX"
				value={state.sfxVolume}
				min={0}
				max={1}
				step={0.01}
				on:change={(e) => ext.setSfxVolume(e.detail.value)}
			/>
			<Checkbox label="SFX Muted" value={state.sfxMuted} on:change={() => ext.toggleSfxMute()} />

			<Slider
				label="Music"
				value={state.musicVolume}
				min={0}
				max={1}
				step={0.01}
				on:change={(e) => ext.setMusicVolume(e.detail.value)}
			/>
			<Checkbox
				label="Music Muted"
				value={state.musicMuted}
				on:change={() => ext.toggleMusicMute()}
			/>

			<Slider
				label="Ambient"
				value={state.ambienceVolume}
				min={0}
				max={1}
				step={0.01}
				on:change={(e) => ext.setAmbientVolume(e.detail.value)}
			/>
			<Checkbox
				label="Ambient Muted"
				value={state.ambienceMuted}
				on:change={() => ext.toggleAmbientMute()}
			/>
		</Folder>

		<Folder title="Positional Audio" expanded={false}>
			<List
				label="Panning Model"
				value={state.panningModel}
				options={panningOptions}
				on:change={(e) => ext.setPanningModel(e.detail.value as 'HRTF' | 'equalpower')}
			/>
			<Slider
				label="Ref Distance"
				value={state.refDistance}
				min={0.1}
				max={20}
				step={0.1}
				on:change={(e) => ext.setRefDistance(e.detail.value)}
			/>
			<Slider
				label="Max Distance"
				value={state.maxDistance}
				min={10}
				max={500}
				step={1}
				on:change={(e) => ext.setMaxDistance(e.detail.value)}
			/>
			<Slider
				label="Rolloff Factor"
				value={state.rolloffFactor}
				min={0}
				max={5}
				step={0.01}
				on:change={(e) => ext.setRolloffFactor(e.detail.value)}
			/>
		</Folder>

		<Button title="Reset All" on:click={() => ext.resetAll()} />
	</DropDownPane>
</ToolbarItem>
