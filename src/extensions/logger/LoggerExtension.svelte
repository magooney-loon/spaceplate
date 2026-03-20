<script lang="ts">
	import { useStudio, ToolbarItem, DropDownPane } from '@threlte/studio/extend';
	import { Folder, Checkbox } from 'svelte-tweakpane-ui';
	import type { Snippet } from 'svelte';
	import { extensionScope, type LoggerChannel } from './types';
	import { loggerState, loggerActions, channelStyles } from '$extensions/logger/logger.svelte';

	interface Props {
		children?: Snippet;
	}

	let { children }: Props = $props();

	const { createExtension } = useStudio();

	createExtension({
		scope: extensionScope,
		state: () => ({}),
		actions: {}
	});

	const channels = $derived(
		Object.entries(channelStyles) as [LoggerChannel, (typeof channelStyles)[LoggerChannel]][]
	);
</script>

<ToolbarItem position="right">
	<DropDownPane icon="mdiConsole" title="Logger">
		<Folder title="Channels" expanded={true}>
			{#each channels as [channel, style]}
				<Checkbox
					label="{style.text} {style.label}"
					value={loggerState[channel]}
					on:change={() => loggerActions.toggleChannel(channel)}
				/>
			{/each}
		</Folder>
	</DropDownPane>
</ToolbarItem>

{@render children?.()}
