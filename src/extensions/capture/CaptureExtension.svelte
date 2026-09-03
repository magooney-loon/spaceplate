<script lang="ts">
	import { useStudio, ToolbarItem, DropDownPane } from '@threlte/studio/extend';
	import { Folder, Slider, Button, Separator, List } from 'svelte-tweakpane-ui';
	import type { Snippet } from 'svelte';
	import { captureState, captureActions } from './capture.svelte';
	import {
		CAPTURE_RESOLUTIONS,
		extensionScope,
		type CaptureContainer,
		type CaptureImageFormat,
		type CaptureResolution,
		type CaptureVideoMode
	} from './types';

	interface Props {
		children?: Snippet;
	}
	let { children }: Props = $props();

	const { createExtension } = useStudio();
	createExtension({ scope: extensionScope, state: () => ({}), actions: {} });

	const formatOptions = [
		{ value: 'png', text: 'PNG (lossless)' },
		{ value: 'jpeg', text: 'JPEG' },
		{ value: 'webp', text: 'WebP' }
	];

	const modeOptions = [
		{ value: 'realtime', text: 'Realtime (live)' },
		{ value: 'offline', text: 'Offline (exact)' }
	];

	const containerOptions = [
		{ value: 'webm', text: 'WebM (VP9)' },
		{ value: 'mp4', text: 'MP4 (H.264)' }
	];

	const resolutionOptions = CAPTURE_RESOLUTIONS.map(({ value, text }) => ({ value, text }));

	const offline = $derived(captureState.videoMode === 'offline');
	const fixedResolution = $derived(captureState.resolution !== 'viewport');

	/** Recording, or still writing the file out — either way the settings are locked in. */
	const busy = $derived(captureState.isRecording || captureState.isFinalizing);

	const recordTitle = $derived(
		captureState.isFinalizing
			? '⏳ Preparing video…'
			: captureState.isRecording
				? `⏹ Stop (${captureState.elapsedSec}s / ${captureState.maxDurationSec}s)`
				: offline
					? '⏺ Start Offline Render'
					: '⏺ Start Recording'
	);
</script>

<ToolbarItem position="center">
	<DropDownPane icon="mdiCamera" title="Capture">
		<span
			style="display:block; font-size:11px; color:#9aa5b1; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.12); border-radius:4px; padding:6px 8px; margin-bottom:4px; line-height:1.6; white-space:normal;"
		>
			{captureState.status}
		</span>

		<!-- Deliberately above both folders: it applies to stills and video alike. -->
		<List
			label="Resolution"
			value={captureState.resolution}
			options={resolutionOptions}
			disabled={busy}
			on:change={(e) => captureActions.setResolution(e.detail.value as CaptureResolution)}
		/>
		{#if fixedResolution}
			<span
				style="display:block; font-size:11px; color:#9aa5b1; padding:2px 4px; line-height:1.5; white-space:normal;"
			>
				The scene is re-rendered at this exact size, so it does not depend on the window — but the
				viewport is stretched to it while a capture runs, and 4K costs what 4K costs.
			</span>
		{:else}
			<span
				style="display:block; font-size:11px; color:#9aa5b1; padding:2px 4px; line-height:1.5; white-space:normal;"
			>
				Output is the canvas as it is: window size × device pixel ratio.
			</span>
		{/if}

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
			<List
				label="Mode"
				value={captureState.videoMode}
				options={modeOptions}
				disabled={busy}
				on:change={(e) => captureActions.setVideoMode(e.detail.value as CaptureVideoMode)}
			/>
			<List
				label="Container"
				value={captureState.container}
				options={containerOptions}
				disabled={busy}
				on:change={(e) => captureActions.setContainer(e.detail.value as CaptureContainer)}
			/>
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
			<Button
				title={recordTitle}
				disabled={captureState.isFinalizing}
				on:click={() => captureActions.toggleRecording()}
			/>
			<span
				style="display:block; font-size:11px; color:#ffcc44; background:rgba(255,200,0,0.08); border:1px solid rgba(255,200,0,0.25); border-radius:4px; padding:6px 8px; margin-top:4px; line-height:1.6; white-space:normal;"
			>
				{#if offline}
					⚠️ Offline renders frame-by-frame at exactly {captureState.fps}fps — perfectly smooth
					however slowly it draws, but the viewport is not realtime and the length shown is encoded
					time. A take owns the engine clock, so the sky, physics and every shader advance one frame
					per encoded frame too. Drive the camera with 🎬 Record Flythrough.
				{:else}
					⚠️ Recording renders every frame (on-demand is suspended) and auto-stops at the cap. A
					frame the browser delivers late is encoded late — switch to Offline if a take must be
					perfectly smooth.
				{/if}
			</span>
		</Folder>
	</DropDownPane>
</ToolbarItem>

{@render children?.()}
