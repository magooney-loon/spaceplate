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
		type CaptureResolution
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

	// No codec in the label: it is PROBED per machine (encoder.ts), so a webm take may come
	// back vp9, av1 or vp8. The status line reports what actually won.
	const containerOptions = [
		{ value: 'webm', text: 'WebM' },
		{ value: 'mp4', text: 'MP4' }
	];

	const resolutionOptions = CAPTURE_RESOLUTIONS.map(({ value, text }) => ({ value, text }));

	/** Recording, or still writing the file out — either way the settings are locked in. */
	const busy = $derived(captureActions.isBusy());

	const recordTitle = $derived(
		captureState.isFinalizing
			? '⏳ Preparing video…'
			: captureState.isRecording
				? `⏹ Stop (${captureState.elapsedSec}s / ${captureState.maxDurationSec}s)`
				: '⏺ Start Offline Render'
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
		<span
			style="display:block; font-size:11px; color:#9aa5b1; padding:2px 4px; line-height:1.5; white-space:normal;"
		>
			The viewport is cooked while capturing.
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

		<!-- Offline render: the viewport crawls while a take runs — that's the take working. -->
		<Folder title="Video (offline render)" expanded={true}>
			<List
				label="Container"
				value={captureState.container}
				options={containerOptions}
				disabled={busy}
				on:change={(e) => captureActions.setContainer(e.detail.value as CaptureContainer)}
			/>
			<!-- Disabled while busy: the encoder captured both at creation, so a drag here
			     mid-take would move the slider and change nothing. -->
			<Slider
				label="FPS"
				value={captureState.fps}
				min={12}
				max={60}
				step={1}
				disabled={busy}
				on:change={(e) => captureActions.setFps(e.detail.value)}
			/>
			<Slider
				label="Bitrate Mb/s"
				value={captureState.bitrateMbps}
				min={2}
				max={64}
				step={1}
				disabled={busy}
				on:change={(e) => captureActions.setBitrateMbps(e.detail.value)}
			/>
			<!-- Live on purpose: the cap is re-read every frame, so lowering it stops a
			     running take early. -->
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
		</Folder>
	</DropDownPane>
</ToolbarItem>

{@render children?.()}
