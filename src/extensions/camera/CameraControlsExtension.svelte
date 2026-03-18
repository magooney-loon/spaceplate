<script lang="ts">
	import { useStudio, ToolbarItem, DropDownPane } from '@threlte/studio/extend';
	import { Folder, Slider, Checkbox, Button } from 'svelte-tweakpane-ui';
	import { extensionScope } from './types';

	const { createExtension } = useStudio();

	const ext = createExtension({
		scope: extensionScope,
		state: () => ({
			enabled: false,
			minPolarAngle: 0,
			maxPolarAngle: Math.PI,
			minAzimuthAngle: -Infinity,
			maxAzimuthAngle: Infinity,
			minDistance: 0.01,
			maxDistance: 500,
			minZoom: 0,
			maxZoom: 100,
			smoothTime: 0.25,
			draggingSmoothTime: 0.08,
			maxSpeed: 1.0,
			azimuthRotateSpeed: 1.0,
			polarRotateSpeed: 1.0,
			dollySpeed: 1.0,
			truckSpeed: 1.0,
			dollyToCursor: false
		}),
		actions: {
			toggleEnabled({ state }) {
				state.enabled = !state.enabled;
			},
			setMinPolarAngle({ state }, value: number) {
				state.minPolarAngle = value;
			},
			setMaxPolarAngle({ state }, value: number) {
				state.maxPolarAngle = value;
			},
			setMinAzimuthAngle({ state }, value: number) {
				state.minAzimuthAngle = value;
			},
			setMaxAzimuthAngle({ state }, value: number) {
				state.maxAzimuthAngle = value;
			},
			setMinDistance({ state }, value: number) {
				state.minDistance = value;
			},
			setMaxDistance({ state }, value: number) {
				state.maxDistance = value;
			},
			setMinZoom({ state }, value: number) {
				state.minZoom = value;
			},
			setMaxZoom({ state }, value: number) {
				state.maxZoom = value;
			},
			setSmoothTime({ state }, value: number) {
				state.smoothTime = value;
			},
			setDraggingSmoothTime({ state }, value: number) {
				state.draggingSmoothTime = value;
			},
			setMaxSpeed({ state }, value: number) {
				state.maxSpeed = value;
			},
			setAzimuthRotateSpeed({ state }, value: number) {
				state.azimuthRotateSpeed = value;
			},
			setPolarRotateSpeed({ state }, value: number) {
				state.polarRotateSpeed = value;
			},
			setDollySpeed({ state }, value: number) {
				state.dollySpeed = value;
			},
			setTruckSpeed({ state }, value: number) {
				state.truckSpeed = value;
			},
			setDollyToCursor({ state }, value: boolean) {
				state.dollyToCursor = value;
			},
			resetAll({ state }) {
				state.minPolarAngle = 0;
				state.maxPolarAngle = Math.PI;
				state.minAzimuthAngle = -Infinity;
				state.maxAzimuthAngle = Infinity;
				state.minDistance = 0.01;
				state.maxDistance = 500;
				state.minZoom = 0;
				state.maxZoom = 100;
				state.smoothTime = 0.25;
				state.draggingSmoothTime = 0.08;
				state.maxSpeed = 1.0;
				state.azimuthRotateSpeed = 1.0;
				state.polarRotateSpeed = 1.0;
				state.dollySpeed = 1.0;
				state.truckSpeed = 1.0;
				state.dollyToCursor = false;
			}
		}
	});

	const state = ext.state;
</script>

<ToolbarItem position="left">
	<DropDownPane icon="mdiCameraControl" title="Camera Controls">
		<Checkbox value={state.enabled} label="Enabled" on:change={() => ext.toggleEnabled()} />

		{#if state.enabled}
			<Folder title="Rotation Limits" expanded={false}>
				<Slider
					value={state.minPolarAngle}
					label="Min Polar Angle"
					min={0}
					max={Math.PI}
					step={0.01}
					on:change={(e) => ext.setMinPolarAngle(e.detail)}
				/>
				<Slider
					value={state.maxPolarAngle}
					label="Max Polar Angle"
					min={0}
					max={Math.PI}
					step={0.01}
					on:change={(e) => ext.setMaxPolarAngle(e.detail)}
				/>
				<Slider
					value={state.minAzimuthAngle}
					label="Min Azimuth"
					min={-Math.PI}
					max={Math.PI}
					step={0.01}
					on:change={(e) => ext.setMinAzimuthAngle(e.detail)}
				/>
				<Slider
					value={state.maxAzimuthAngle}
					label="Max Azimuth"
					min={-Math.PI}
					max={Math.PI}
					step={0.01}
					on:change={(e) => ext.setMaxAzimuthAngle(e.detail)}
				/>
			</Folder>

			<Folder title="Distance Limits" expanded={false}>
				<Slider
					value={state.minDistance}
					label="Min Distance"
					min={0.01}
					max={100}
					step={0.1}
					on:change={(e) => ext.setMinDistance(e.detail)}
				/>
				<Slider
					value={state.maxDistance}
					label="Max Distance"
					min={1}
					max={1000}
					step={1}
					on:change={(e) => ext.setMaxDistance(e.detail)}
				/>
				<Slider
					value={state.minZoom}
					label="Min Zoom"
					min={0}
					max={10}
					step={0.1}
					on:change={(e) => ext.setMinZoom(e.detail)}
				/>
				<Slider
					value={state.maxZoom}
					label="Max Zoom"
					min={0.1}
					max={100}
					step={0.1}
					on:change={(e) => ext.setMaxZoom(e.detail)}
				/>
			</Folder>

			<Folder title="Speed" expanded={false}>
				<Slider
					value={state.smoothTime}
					label="Smooth Time"
					min={0}
					max={2}
					step={0.01}
					on:change={(e) => ext.setSmoothTime(e.detail)}
				/>
				<Slider
					value={state.draggingSmoothTime}
					label="Drag Smooth Time"
					min={0}
					max={1}
					step={0.01}
					on:change={(e) => ext.setDraggingSmoothTime(e.detail)}
				/>
				<Slider
					value={state.maxSpeed}
					label="Max Speed"
					min={0.1}
					max={10}
					step={0.1}
					on:change={(e) => ext.setMaxSpeed(e.detail)}
				/>
				<Slider
					value={state.azimuthRotateSpeed}
					label="Azimuth Speed"
					min={0.1}
					max={5}
					step={0.1}
					on:change={(e) => ext.setAzimuthRotateSpeed(e.detail)}
				/>
				<Slider
					value={state.polarRotateSpeed}
					label="Polar Speed"
					min={0.1}
					max={5}
					step={0.1}
					on:change={(e) => ext.setPolarRotateSpeed(e.detail)}
				/>
				<Slider
					value={state.dollySpeed}
					label="Dolly Speed"
					min={0.1}
					max={5}
					step={0.1}
					on:change={(e) => ext.setDollySpeed(e.detail)}
				/>
				<Slider
					value={state.truckSpeed}
					label="Truck Speed"
					min={0.1}
					max={5}
					step={0.1}
					on:change={(e) => ext.setTruckSpeed(e.detail)}
				/>
			</Folder>

			<Folder title="Options" expanded={false}>
				<Checkbox
					value={state.dollyToCursor}
					label="Dolly to Cursor"
					on:change={(e) => ext.setDollyToCursor(e.detail)}
				/>
			</Folder>

			<Button title="Reset All" on:click={() => ext.resetAll()} />
		{/if}
	</DropDownPane>
</ToolbarItem>

<slot />
