<script lang="ts">
	import { useStudio, ToolbarItem, DropDownPane } from '@threlte/studio/extend';
	import { Folder, Slider, Button } from 'svelte-tweakpane-ui';
	import { extensionScope } from './types';

	const { createExtension } = useStudio();

	const ext = createExtension({
		scope: extensionScope,
		state: () => ({
			// Camera settings
			positionX: 0,
			positionY: 0,
			positionZ: 10,
			fov: 60,
			near: 0.001,
			far: 144,
			// Controls settings
			minPolarAngle: 0,
			maxPolarAngle: Math.PI,
			minAzimuthAngle: -Math.PI,
			maxAzimuthAngle: Math.PI,
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
			setPositionX({ state }, value: number) {
				state.positionX = value;
			},
			setPositionY({ state }, value: number) {
				state.positionY = value;
			},
			setPositionZ({ state }, value: number) {
				state.positionZ = value;
			},
			setFov({ state }, value: number) {
				state.fov = value;
			},
			setNear({ state }, value: number) {
				state.near = value;
			},
			setFar({ state }, value: number) {
				state.far = value;
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
				state.positionX = 0;
				state.positionY = 0;
				state.positionZ = 10;
				state.fov = 60;
				state.near = 0.001;
				state.far = 144;
				state.minPolarAngle = 0;
				state.maxPolarAngle = Math.PI;
				state.minAzimuthAngle = -Math.PI;
				state.maxAzimuthAngle = Math.PI;
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
		<Folder title="Camera" expanded={false}>
			<Slider
				value={state.positionX}
				label="Position X"
				min={-50}
				max={50}
				step={0.1}
				on:change={(e) => ext.setPositionX(e.detail.value)}
			/>
			<Slider
				value={state.positionY}
				label="Position Y"
				min={-50}
				max={50}
				step={0.1}
				on:change={(e) => ext.setPositionY(e.detail.value)}
			/>
			<Slider
				value={state.positionZ}
				label="Position Z"
				min={-50}
				max={50}
				step={0.1}
				on:change={(e) => ext.setPositionZ(e.detail.value)}
			/>
			<Slider
				value={state.fov}
				label="Field of View"
				min={10}
				max={120}
				step={1}
				on:change={(e) => ext.setFov(e.detail.value)}
			/>
			<Slider
				value={state.near}
				label="Near Clip"
				min={0.001}
				max={10}
				step={0.001}
				on:change={(e) => ext.setNear(e.detail.value)}
			/>
			<Slider
				value={state.far}
				label="Far Clip"
				min={10}
				max={1000}
				step={1}
				on:change={(e) => ext.setFar(e.detail.value)}
			/>
		</Folder>

		<Folder title="Rotation Limits" expanded={false}>
			<Slider
				value={state.minPolarAngle}
				label="Min Polar Angle"
				min={0}
				max={Math.PI}
				step={0.01}
				on:change={(e) => ext.setMinPolarAngle(e.detail.value)}
			/>
			<Slider
				value={state.maxPolarAngle}
				label="Max Polar Angle"
				min={0}
				max={Math.PI}
				step={0.01}
				on:change={(e) => ext.setMaxPolarAngle(e.detail.value)}
			/>
			<Slider
				value={state.minAzimuthAngle}
				label="Min Azimuth"
				min={-Math.PI}
				max={Math.PI}
				step={0.01}
				on:change={(e) => ext.setMinAzimuthAngle(e.detail.value)}
			/>
			<Slider
				value={state.maxAzimuthAngle}
				label="Max Azimuth"
				min={-Math.PI}
				max={Math.PI}
				step={0.01}
				on:change={(e) => ext.setMaxAzimuthAngle(e.detail.value)}
			/>
		</Folder>

		<Folder title="Distance Limits" expanded={false}>
			<Slider
				value={state.minDistance}
				label="Min Distance"
				min={0.01}
				max={100}
				step={0.1}
				on:change={(e) => ext.setMinDistance(e.detail.value)}
			/>
			<Slider
				value={state.maxDistance}
				label="Max Distance"
				min={1}
				max={1000}
				step={1}
				on:change={(e) => ext.setMaxDistance(e.detail.value)}
			/>
			<Slider
				value={state.minZoom}
				label="Min Zoom"
				min={0}
				max={10}
				step={0.1}
				on:change={(e) => ext.setMinZoom(e.detail.value)}
			/>
			<Slider
				value={state.maxZoom}
				label="Max Zoom"
				min={0.1}
				max={100}
				step={0.1}
				on:change={(e) => ext.setMaxZoom(e.detail.value)}
			/>
		</Folder>

		<Folder title="Speed" expanded={false}>
			<Slider
				value={state.smoothTime}
				label="Smooth Time"
				min={0}
				max={2}
				step={0.01}
				on:change={(e) => ext.setSmoothTime(e.detail.value)}
			/>
			<Slider
				value={state.draggingSmoothTime}
				label="Drag Smooth Time"
				min={0}
				max={1}
				step={0.01}
				on:change={(e) => ext.setDraggingSmoothTime(e.detail.value)}
			/>
			<Slider
				value={state.maxSpeed}
				label="Max Speed"
				min={0.1}
				max={10}
				step={0.1}
				on:change={(e) => ext.setMaxSpeed(e.detail.value)}
			/>
			<Slider
				value={state.azimuthRotateSpeed}
				label="Azimuth Speed"
				min={0.1}
				max={5}
				step={0.1}
				on:change={(e) => ext.setAzimuthRotateSpeed(e.detail.value)}
			/>
			<Slider
				value={state.polarRotateSpeed}
				label="Polar Speed"
				min={0.1}
				max={5}
				step={0.1}
				on:change={(e) => ext.setPolarRotateSpeed(e.detail.value)}
			/>
			<Slider
				value={state.dollySpeed}
				label="Dolly Speed"
				min={0.1}
				max={5}
				step={0.1}
				on:change={(e) => ext.setDollySpeed(e.detail.value)}
			/>
			<Slider
				value={state.truckSpeed}
				label="Truck Speed"
				min={0.1}
				max={5}
				step={0.1}
				on:change={(e) => ext.setTruckSpeed(e.detail.value)}
			/>
		</Folder>

		<Folder title="Options" expanded={false}>
			<Slider
				value={state.dollyToCursor ? 1 : 0}
				label="Dolly to Cursor"
				min={0}
				max={1}
				step={1}
				on:change={(e) => ext.setDollyToCursor(e.detail.value === 1)}
			/>
		</Folder>

		<Button title="Reset All" on:click={() => ext.resetAll()} />
	</DropDownPane>
</ToolbarItem>

<slot />
