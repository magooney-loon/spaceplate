<script lang="ts">
	import { useStudio, ToolbarItem, DropDownPane } from '@threlte/studio/extend';
	import { Checkbox } from 'svelte-tweakpane-ui';
	import { extensionScope } from './types';
	import { loggerState, loggerActions } from '$extensions/logger/logger.svelte';

	const { createExtension } = useStudio();

	createExtension({
		scope: extensionScope,
		state: () => ({}),
		actions: {}
	});
</script>

<slot />

<ToolbarItem position="right">
	<DropDownPane icon="mdiConsole" title="Logger">
		<Checkbox
			label="Engine"
			value={loggerState.engine}
			on:change={() => loggerActions.toggleChannel('engine')}
		/>
		<Checkbox
			label="Settings"
			value={loggerState.settings}
			on:change={() => loggerActions.toggleChannel('settings')}
		/>
		<Checkbox
			label="Sound"
			value={loggerState.sound}
			on:change={() => loggerActions.toggleChannel('sound')}
		/>
		<Checkbox
			label="Postprocessing"
			value={loggerState.postprocessing}
			on:change={() => loggerActions.toggleChannel('postprocessing')}
		/>
	</DropDownPane>
</ToolbarItem>
