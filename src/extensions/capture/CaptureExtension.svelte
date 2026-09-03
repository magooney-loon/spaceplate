<script lang="ts">
	import { useStudio, ToolbarItem, DropDownPane } from '@threlte/studio/extend';
	import { Folder, Slider, Checkbox, Button, Separator, List } from 'svelte-tweakpane-ui';
	import type { Snippet } from 'svelte';
	import type { Object3D } from 'three/webgpu';
	import {
		captureState,
		captureActions,
		registerStudioObjects,
		unregisterStudioObjects
	} from './capture.svelte';
	import { extensionScope, type CaptureImageFormat } from './types';

	interface Props {
		children?: Snippet;
	}
	let { children }: Props = $props();

	const { createExtension, useExtension } = useStudio();
	createExtension({ scope: extensionScope, state: () => ({}), actions: {} });

	// NOT logic, wiring — and it can only happen here. `useStudio()` resolves only inside
	// <Studio>, while the capture driver (Capture.svelte) is deliberately mounted outside
	// it to win the render-task ordering race against the Gizmo. So this panel is the one
	// place that can hand Studio's own object registry to the driver.
	const registry = useExtension<{ objects: Set<Object3D> }, Record<string, never>>(
		'studio-objects-registry'
	);
	$effect(() => {
		registerStudioObjects(() => registry.state.objects ?? []);
		return unregisterStudioObjects;
	});

	const formatOptions = [
		{ value: 'png', text: 'PNG (lossless)' },
		{ value: 'jpeg', text: 'JPEG' },
		{ value: 'webp', text: 'WebP' }
	];

	const recordTitle = $derived(
		captureState.isRecording
			? `⏹ Stop (${captureState.elapsedSec}s / ${captureState.maxDurationSec}s)`
			: '⏺ Start Recording'
	);
</script>

<ToolbarItem position="left">
	<DropDownPane icon="mdiCamera" title="Capture">
		<span
			style="display:block; font-size:11px; color:#9aa5b1; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.12); border-radius:4px; padding:6px 8px; margin-bottom:4px; line-height:1.6; white-space:normal;"
		>
			{captureState.status}
		</span>

		<Folder title="Image" expanded={true}>
			<List
				label="Format"
				value={captureState.imageFormat}
				options={formatOptions}
				on:change={(e) => captureActions.setImageFormat(e.detail.value as CaptureImageFormat)}
			/>
			{#if captureState.imageFormat !== 'png'}
				<Slider
					label="Quality"
					value={captureState.imageQuality}
					min={0.1}
					max={1}
					step={0.01}
					on:change={(e) => captureActions.setImageQuality(e.detail.value)}
				/>
			{/if}
			<Button title="📸 Screenshot" on:click={() => captureActions.screenshot()} />
		</Folder>

		<Separator />

		<Folder title="Video" expanded={true}>
			<Slider
				label="FPS"
				value={captureState.fps}
				min={12}
				max={60}
				step={1}
				on:change={(e) => captureActions.setFps(e.detail.value)}
			/>
			<Slider
				label="Bitrate Mb/s"
				value={captureState.bitrateMbps}
				min={2}
				max={64}
				step={1}
				on:change={(e) => captureActions.setBitrateMbps(e.detail.value)}
			/>
			<Slider
				label="Max Length s"
				value={captureState.maxDurationSec}
				min={5}
				max={300}
				step={5}
				on:change={(e) => captureActions.setMaxDurationSec(e.detail.value)}
			/>
			<Button title={recordTitle} on:click={() => captureActions.toggleRecording()} />
			<span
				style="display:block; font-size:11px; color:#ffcc44; background:rgba(255,200,0,0.08); border:1px solid rgba(255,200,0,0.25); border-radius:4px; padding:6px 8px; margin-top:4px; line-height:1.6; white-space:normal;"
			>
				⚠️ Recording renders every frame (on-demand is suspended) and auto-stops at the cap.
			</span>
		</Folder>

		<Separator />

		<Checkbox
			label="Hide Studio Objects"
			value={captureState.hideStudioObjects}
			on:change={() => captureActions.setHideStudioObjects(!captureState.hideStudioObjects)}
		/>
	</DropDownPane>
</ToolbarItem>

{@render children?.()}
