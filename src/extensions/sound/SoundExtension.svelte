<script lang="ts">
	import { useStudio, ToolbarItem, DropDownPane } from '@threlte/studio/extend';
	import { Folder, Slider, Checkbox, Button, List } from 'svelte-tweakpane-ui';
	import { extensionScope, type ExtensionState, type ExtensionActions } from './types';

	const { createExtension } = useStudio();

	const ext = createExtension<ExtensionState, ExtensionActions>({
		scope: extensionScope,
		state({ persist }) {
			return {
				masterVolume: persist(0.8),
				masterMuted: persist(false),

				sfxVolume: persist(1.0),
				sfxMuted: persist(false),

				musicVolume: persist(0.5), // music quieter by default, classic arena feel
				musicMuted: persist(false),

				ambientVolume: persist(0.4),
				ambientMuted: persist(false),

				// Positional audio defaults tuned for arena scale
				// arena maps are typically 50-200 units across
				refDistance: persist(5),
				maxDistance: persist(80),
				rolloffFactor: persist(1.5),
				panningModel: persist('HRTF' as 'HRTF' | 'equalpower'),

				listenerEnabled: persist(true)
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
			},
			toggleSfxMute({ state }) {
				state.sfxMuted = !state.sfxMuted;
			},
			setMusicVolume({ state }, v) {
				state.musicVolume = v;
			},
			toggleMusicMute({ state }) {
				state.musicMuted = !state.musicMuted;
			},
			setAmbientVolume({ state }, v) {
				state.ambientVolume = v;
			},
			toggleAmbientMute({ state }) {
				state.ambientMuted = !state.ambientMuted;
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
				state.masterVolume = 0.8;
				state.masterMuted = false;
				state.sfxVolume = 1.0;
				state.musicVolume = 0.5;
				state.ambientVolume = 0.4;
				state.refDistance = 5;
				state.maxDistance = 80;
				state.rolloffFactor = 1.5;
				state.panningModel = 'HRTF';
			}
		},
		keyMap({ shift }) {
			return {
				toggleMasterMute: shift('m')
			};
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
		<!-- Master bus -->
		<Folder title="Master">
			<Slider
				label="Volume"
				value={state.masterVolume}
				min={0}
				max={1}
				step={0.01}
				on:change={(e) => ext.setMasterVolume(e.detail.value)}
			/>
			<Checkbox label="Muted" value={state.masterMuted} on:change={() => ext.toggleMasterMute()} />
		</Folder>

		<!-- Per-bus volumes — consumed by useSound() hook in game code -->
		<Folder title="Buses">
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
				value={state.ambientVolume}
				min={0}
				max={1}
				step={0.01}
				on:change={(e) => ext.setAmbientVolume(e.detail.value)}
			/>
			<Checkbox
				label="Ambient Muted"
				value={state.ambientMuted}
				on:change={() => ext.toggleAmbientMute()}
			/>
		</Folder>

		<!-- Positional audio tuning — applies to all PositionalAudio instances -->
		<!-- via the useSound() hook reading these values -->
		<Folder title="Positional Audio">
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
