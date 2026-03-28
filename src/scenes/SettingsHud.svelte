<script lang="ts">
	import { fly } from 'svelte/transition';
	import {
		settingsState,
		graphicsActions,
		audioActions
	} from '$extensions/settings/settings.svelte';
	import { soundActions } from '$core/GlobalAudio.svelte';
	import { inputState, inputActions } from '$extensions/input/input.svelte';
	import type { InputAction, AnyBinding } from '$extensions/input/types';
	import type { QualityLevel } from '$extensions/settings/settings.svelte';

	type Props = { onBack: () => void };
	let { onBack }: Props = $props();

	type Tab = 'general' | 'audio' | 'controls';
	let activeTab = $state<Tab>('general');

	// --- Controls tab data ---

	type ActionGroup = { label: string; actions: InputAction[] };

	const ACTION_GROUPS: ActionGroup[] = [
		{
			label: 'Movement',
			actions: [
				'moveForward',
				'moveBackward',
				'moveLeft',
				'moveRight',
				'sprint',
				'jump',
				'crouch',
				'prone'
			]
		},
		{
			label: 'Actions',
			actions: ['primaryAction', 'secondaryAction', 'interact', 'reload', 'use', 'drop', 'emote']
		},
		{
			label: 'Slots',
			actions: ['slot1', 'slot2', 'slot3', 'slot4']
		},
		{
			label: 'UI',
			actions: ['pause', 'openSettings', 'toggleUi']
		}
	];

	const ACTION_LABELS: Record<InputAction, string> = {
		moveForward: 'Move Forward',
		moveBackward: 'Move Backward',
		moveLeft: 'Move Left',
		moveRight: 'Move Right',
		jump: 'Jump',
		sprint: 'Sprint',
		interact: 'Interact',
		primaryAction: 'Primary Action',
		secondaryAction: 'Secondary Action',
		reload: 'Reload',
		use: 'Use',
		crouch: 'Crouch',
		drop: 'Drop',
		prone: 'Prone',
		emote: 'Emote',
		slot1: 'Slot 1',
		slot2: 'Slot 2',
		slot3: 'Slot 3',
		slot4: 'Slot 4',
		pause: 'Pause',
		toggleUi: 'Toggle UI',
		openSettings: 'Open Settings'
	};

	const GAMEPAD_BUTTON_LABELS: Record<string, string> = {
		clusterBottom: 'A',
		clusterRight: 'B',
		clusterLeft: 'X',
		clusterTop: 'Y',
		leftBumper: 'LB',
		rightBumper: 'RB',
		leftTrigger: 'LT',
		rightTrigger: 'RT',
		select: 'Select',
		start: 'Start',
		center: 'Home',
		leftStickButton: 'L3',
		rightStickButton: 'R3',
		directionalTop: 'D↑',
		directionalBottom: 'D↓',
		directionalLeft: 'D←',
		directionalRight: 'D→'
	};

	const KEY_CODE_LABELS: Record<string, string> = {
		Space: 'Space',
		Escape: 'Esc',
		Enter: 'Enter',
		Backspace: 'Bksp',
		Tab: 'Tab',
		ArrowUp: '↑',
		ArrowDown: '↓',
		ArrowLeft: '←',
		ArrowRight: '→',
		ShiftLeft: 'L.Shift',
		ShiftRight: 'R.Shift',
		ControlLeft: 'L.Ctrl',
		ControlRight: 'R.Ctrl',
		AltLeft: 'L.Alt',
		AltRight: 'R.Alt',
		Digit0: '0',
		Digit1: '1',
		Digit2: '2',
		Digit3: '3',
		Digit4: '4',
		Digit5: '5',
		Digit6: '6',
		Digit7: '7',
		Digit8: '8',
		Digit9: '9',
		Comma: ',',
		Period: '.',
		Slash: '/',
		Semicolon: ';',
		Quote: "'",
		BracketLeft: '[',
		BracketRight: ']',
		Backslash: '\\',
		Minus: '-',
		Equal: '=',
		Backquote: '`'
	};

	function formatBinding(b: AnyBinding): string {
		if (b.device === 'keyboard') {
			const label = KEY_CODE_LABELS[b.code];
			if (label) return label;
			if (b.code.startsWith('Key')) return b.code.slice(3);
			if (b.code.startsWith('Numpad')) return 'Num' + b.code.slice(6);
			return b.code;
		}
		if (b.device === 'mouse') {
			return b.button === 'left' ? 'LMB' : b.button === 'right' ? 'RMB' : 'MMB';
		}
		if (b.device === 'gamepad') {
			return '🎮 ' + (GAMEPAD_BUTTON_LABELS[b.button] ?? b.button);
		}
		if (b.device === 'gamepad-axis') {
			const dir = b.direction === 'positive' ? '+' : b.direction === 'negative' ? '-' : '';
			return '🕹 ' + b.axis + dir;
		}
		return '?';
	}

	const isCapturing = $derived(inputState.capture.active);
	const captureAction = $derived(inputState.capture.action as InputAction | null);

	function startBind(action: InputAction) {
		soundActions.playClick();
		inputActions.startCapture('player1', action, 'action');
	}

	function removeBinding(action: InputAction, id: string) {
		inputActions.removeBinding('player1', action, id);
	}

	function resetAction(action: InputAction) {
		soundActions.playClick();
		inputActions.resetAction('player1', action);
	}

	function resetAllControls() {
		soundActions.playClick();
		inputActions.resetPlayerBindings('player1');
	}

	function cancelCapture() {
		soundActions.playClick();
		inputActions.cancelCapture();
	}

	function switchTab(tab: Tab) {
		soundActions.playClick();
		if (isCapturing) inputActions.cancelCapture();
		activeTab = tab;
	}
</script>

<div class="pointer-events-auto">
	<div
		transition:fly={{ y: -16, duration: 220 }}
		class="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-md"
	>
		<div
			class="bg-white/8 border border-white/15 rounded-2xl p-8 text-white flex flex-col
				{activeTab === 'controls' ? 'w-150' : 'w-90'}"
		>
			<h2 class="m-0 mb-5 text-2xl font-semibold">Settings</h2>

			<!-- Tab bar -->
			<div class="flex gap-1 mb-6 bg-white/5 rounded-xl p-1">
				{#each [['general', 'General'], ['audio', 'Audio'], ['controls', 'Controls']] as const as [id, label]}
					<button
						onclick={() => switchTab(id)}
						class="flex-1 py-1.5 rounded-lg text-sm font-medium transition-all cursor-pointer
							{activeTab === id ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white/80'}"
					>
						{label}
					</button>
				{/each}
			</div>

			<!-- General tab -->
			{#if activeTab === 'general'}
				<div class="mb-6">
					<p class="m-0 mb-2 opacity-70 text-sm">Graphics Quality</p>
					<div class="flex gap-2">
						{#each ['low', 'high'] as level}
							<button
								onclick={() => {
									soundActions.playClick();
									graphicsActions.setQuality(level as QualityLevel);
								}}
								class="flex-1 px-4 py-2 rounded-lg border transition-all capitalize cursor-pointer
									{settingsState.graphics.quality === level
									? 'border-white/60 bg-white/20'
									: 'border-white/20 bg-transparent hover:bg-white/10'}"
							>
								{level}
							</button>
						{/each}
					</div>
				</div>

				<div class="mb-6 text-sm opacity-50">
					<div class="flex justify-between items-center">
						<span>Toggle HUD</span>
						<kbd class="bg-white/8 border border-white/20 rounded px-2 py-0.5 font-mono text-xs">
							Ctrl+H
						</kbd>
					</div>
				</div>

				<!-- Audio tab -->
			{:else if activeTab === 'audio'}
				<div class="mb-6 flex flex-col gap-4">
					{#each [{ key: 'sfx', label: 'Sound Effects', enabled: settingsState.audio.sfxEnabled, volume: settingsState.audio.sfxVolume, toggle: audioActions.toggleSfx, setVol: audioActions.setSfxVolume }, { key: 'music', label: 'Music', enabled: settingsState.audio.musicEnabled, volume: settingsState.audio.musicVolume, toggle: audioActions.toggleMusic, setVol: audioActions.setMusicVolume }, { key: 'ambience', label: 'Ambient', enabled: settingsState.audio.ambienceEnabled, volume: settingsState.audio.ambienceVolume, toggle: audioActions.toggleAmbience, setVol: audioActions.setAmbienceVolume }] as ch}
						<div class="flex flex-col gap-1.5">
							<label class="flex items-center gap-2 cursor-pointer text-sm">
								<input
									type="checkbox"
									checked={ch.enabled}
									onchange={() => ch.toggle()}
									class="w-4 h-4"
								/>
								{ch.label}
							</label>
							<input
								type="range"
								min="0"
								max="1"
								step="0.01"
								aria-label="{ch.label} volume"
								value={ch.volume}
								oninput={(e) => ch.setVol(+(e.target as HTMLInputElement).value)}
								class="w-full accent-white/80"
							/>
						</div>
					{/each}
				</div>

				<!-- Controls tab -->
			{:else if activeTab === 'controls'}
				<!-- Capture banner -->
				{#if isCapturing && captureAction}
					<div
						class="mb-4 flex items-center justify-between gap-3 bg-white/10 border border-white/20 rounded-xl px-4 py-2.5 text-sm"
					>
						<span class="animate-pulse">
							Binding <strong>{ACTION_LABELS[captureAction]}</strong> — press a key or click…
						</span>
						<button
							onclick={cancelCapture}
							class="text-white/60 hover:text-white transition-colors cursor-pointer text-xs border border-white/20 rounded px-2 py-0.5"
						>
							Cancel
						</button>
					</div>
				{/if}

				<div class="overflow-y-auto max-h-[52vh] flex flex-col gap-5 pr-1">
					{#each ACTION_GROUPS as group}
						<div>
							<p class="m-0 mb-2 text-xs font-semibold uppercase tracking-widest opacity-40">
								{group.label}
							</p>
							<div class="flex flex-col gap-1">
								{#each group.actions as action}
									{@const bindings = inputState.players.player1.actions[action] ?? []}
									{@const capturing = isCapturing && captureAction === action}
									<div
										class="flex items-center gap-2 rounded-lg px-3 py-1.5 transition-colors
											{capturing ? 'bg-white/12 border border-white/25' : 'hover:bg-white/5'}"
									>
										<!-- Action name -->
										<span class="text-sm w-36 shrink-0 opacity-80">{ACTION_LABELS[action]}</span>

										<!-- Binding chips -->
										<div class="flex flex-wrap gap-1 flex-1 min-w-0">
											{#each bindings as b (b.id)}
												<span
													class="inline-flex items-center gap-1 bg-white/10 border border-white/20 rounded px-1.5 py-0.5"
												>
													<kbd class="font-mono text-xs leading-none">{formatBinding(b)}</kbd>
													<button
														onclick={() => removeBinding(action, b.id)}
														class="opacity-40 hover:opacity-100 transition-opacity cursor-pointer leading-none text-xs"
														aria-label="Remove binding">×</button
													>
												</span>
											{/each}

											{#if capturing}
												<span class="text-xs opacity-50 italic self-center">waiting…</span>
											{:else}
												<button
													onclick={() => startBind(action)}
													class="text-xs opacity-40 hover:opacity-80 transition-opacity cursor-pointer border border-white/20 rounded px-1.5 py-0.5 leading-none"
													aria-label="Add binding">+</button
												>
											{/if}
										</div>

										<!-- Reset action -->
										<button
											onclick={() => resetAction(action)}
											title="Reset to default"
											class="opacity-30 hover:opacity-70 transition-opacity cursor-pointer text-sm shrink-0"
											>↺</button
										>
									</div>
								{/each}
							</div>
						</div>
					{/each}
				</div>

				<!-- Reset all -->
				<button
					onclick={resetAllControls}
					class="mt-4 w-full py-1.5 text-sm text-white/50 border border-white/15 rounded-lg hover:bg-white/8 hover:text-white/80 transition-all cursor-pointer"
				>
					Reset All Controls
				</button>
			{/if}

			<!-- Back -->
			<button
				onclick={() => {
					soundActions.playClick();
					if (isCapturing) inputActions.cancelCapture();
					onBack();
				}}
				class="mt-4 w-full px-4 py-2.5 bg-white/15 text-white border border-white/30 rounded-lg cursor-pointer hover:bg-white/20 transition-colors"
			>
				Back
			</button>
		</div>
	</div>
</div>
