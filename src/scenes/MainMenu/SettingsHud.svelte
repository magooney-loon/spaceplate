<script lang="ts">
	import {
		settingsState,
		graphicsActions,
		audioActions,
		generalActions,
		type QualityLevel
	} from '$extensions/settings';
	import { soundActions, capabilityState, telemetryState, WEBGPU_REPORT_URL } from '$core';
	import { inputState, inputActions, type InputAction, type AnyBinding } from '$extensions/input';

	type Props = { onBack: () => void };
	let { onBack }: Props = $props();

	type Tab = 'general' | 'audio' | 'controls' | 'system';
	let activeTab = $state<Tab>('general');

	// --- System tab data ---
	// Static half from the boot probe (core/utils/capabilities.svelte.ts), live half
	// from the in-canvas sampler (core/utils/telemetry.svelte.ts, ~2 Hz).

	const backendLabel = $derived(
		{ webgpu: 'WebGPU', webgl: 'WebGL 2', unknown: 'unknown' }[telemetryState.backend]
	);

	const gpuKind = $derived.by(() => {
		if (capabilityState.tier !== 'webgpu') return 'unknown';
		if (capabilityState.fallbackAdapter) return 'software (fallback adapter)';
		if (capabilityState.discreteGpu === true) return 'discrete';
		if (capabilityState.discreteGpu === false) return 'integrated';
		return 'unknown';
	});

	/** Browsers legitimately report empty strings here — Chrome masks device/description. */
	const shown = (value: string | number): string =>
		value === '' || value === 0 ? '—' : `${value}`;

	const mark = (ok: boolean): string => (ok ? '✓' : '✕');

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
		}
	];

	// Engine-reserved actions (toggleUi, openSettings) are intentionally not
	// listed here — they are routed by the engine and cannot be rebound from the UI.
	const ACTION_LABELS: Partial<Record<InputAction, string>> = {
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
		slot4: 'Slot 4'
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

	const settingsKeyLabel = $derived.by(() => {
		const bindings = inputState.players.player1.actions.openSettings ?? [];
		const keyboard = bindings.find((b) => b.device === 'keyboard');
		return keyboard ? formatBinding(keyboard) : null;
	});

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

<div class="hud">
	<div class="overlay">
		<div class="panel" class:wide={activeTab === 'controls' || activeTab === 'system'}>
			<h2>Settings</h2>

			<!-- Tab bar -->
			<div class="tabs">
				{#each [['general', 'General'], ['audio', 'Audio'], ['controls', 'Controls'], ['system', 'System']] as const as [id, label] (id)}
					<button onclick={() => switchTab(id)} class="tab" class:active={activeTab === id}>
						{label}
					</button>
				{/each}
			</div>

			<!-- General tab -->
			{#if activeTab === 'general'}
				<div class="section">
					<p class="section-label">Graphics Quality</p>
					<div class="quality-row">
						{#each ['low', 'high'] as level (level)}
							<button
								onclick={() => {
									soundActions.playClick();
									graphicsActions.setQuality(level as QualityLevel);
								}}
								class="quality-button"
								class:selected={settingsState.graphics.quality === level}
							>
								{level}
							</button>
						{/each}
					</div>
				</div>

				<div class="section">
					<p class="section-label">Render Scale</p>
					<div class="sens-row">
						<span class="sens-label">Resolution</span>
						<input
							type="range"
							min="0.5"
							max="1"
							step="0.05"
							value={settingsState.graphics.renderScale}
							oninput={(e) =>
								graphicsActions.setRenderScale(parseFloat((e.target as HTMLInputElement).value))}
							class="sens-slider"
						/>
						<span class="sens-value">
							{Math.round(settingsState.graphics.renderScale * 100)}%
						</span>
					</div>
					<p class="section-note">
						{#if telemetryState.bufferWidth > 0}
							Drawing at {telemetryState.bufferWidth}×{telemetryState.bufferHeight}.
						{/if}
						Lower this first when the framerate drops — it is the only setting that costs sharpness rather
						than content, and halving it quarters the work.
					</p>
				</div>

				<div class="section">
					<p class="section-label">Mouse Sensitivity</p>
					<div class="sens-row">
						<span class="sens-label">Look</span>
						<input
							type="range"
							min="0.05"
							max="1"
							step="0.01"
							value={settingsState.general.mouseSensitivity}
							oninput={(e) =>
								generalActions.setMouseSensitivity(
									parseFloat((e.target as HTMLInputElement).value)
								)}
							class="sens-slider"
						/>
						<span class="sens-value">
							{Math.round(settingsState.general.mouseSensitivity * 100)}
						</span>
					</div>
					<div class="sens-row">
						<span class="sens-label">Aim</span>
						<input
							type="range"
							min="0.05"
							max="1"
							step="0.01"
							value={settingsState.general.aimSensitivity}
							oninput={(e) =>
								generalActions.setAimSensitivity(parseFloat((e.target as HTMLInputElement).value))}
							class="sens-slider"
						/>
						<span class="sens-value">
							{Math.round(settingsState.general.aimSensitivity * 100)}
						</span>
					</div>
				</div>

				<div class="section">
					<p class="section-label">Engine Shortcuts</p>
					{#if settingsKeyLabel}
						<div class="hint-row">
							<span>Settings</span>
							<kbd>{settingsKeyLabel}</kbd>
						</div>
					{/if}
					<div class="hint-row">
						<span>Toggle HUD</span>
						<kbd>Ctrl+H</kbd>
					</div>
					<p class="section-note">Reserved engine shortcuts. Not rebindable.</p>
				</div>

				<!-- Audio tab -->
			{:else if activeTab === 'audio'}
				<div class="audio-section">
					{#each [{ key: 'sfx', label: 'Sound Effects', enabled: settingsState.audio.sfxEnabled, volume: settingsState.audio.sfxVolume, toggle: audioActions.toggleSfx, setVol: audioActions.setSfxVolume }, { key: 'music', label: 'Music', enabled: settingsState.audio.musicEnabled, volume: settingsState.audio.musicVolume, toggle: audioActions.toggleMusic, setVol: audioActions.setMusicVolume }, { key: 'ambience', label: 'Ambient', enabled: settingsState.audio.ambienceEnabled, volume: settingsState.audio.ambienceVolume, toggle: audioActions.toggleAmbience, setVol: audioActions.setAmbienceVolume }] as ch (ch.key)}
						<div class="channel">
							<label class="channel-label">
								<input
									type="checkbox"
									checked={ch.enabled}
									onchange={() => ch.toggle()}
									class="channel-checkbox"
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
								class="volume"
							/>
						</div>
					{/each}
				</div>

				<!-- Controls tab -->
			{:else if activeTab === 'controls'}
				<!-- Capture banner -->
				{#if isCapturing && captureAction}
					<div class="capture-banner">
						<span class="pulse">
							Binding <strong>{ACTION_LABELS[captureAction]}</strong> — press a key or click…
						</span>
						<button onclick={cancelCapture} class="cancel-button"> Cancel </button>
					</div>
				{/if}

				<div class="bindings">
					{#each ACTION_GROUPS as group (group.label)}
						<div>
							<p class="group-label">
								{group.label}
							</p>
							<div class="action-list">
								{#each group.actions as action (action)}
									{@const bindings = inputState.players.player1.actions[action] ?? []}
									{@const capturing = isCapturing && captureAction === action}
									<div class="action-row" class:capturing>
										<!-- Action name -->
										<span class="action-name">{ACTION_LABELS[action]}</span>

										<!-- Binding chips -->
										<div class="chips">
											{#each bindings as b (b.id)}
												<span class="chip">
													<kbd>{formatBinding(b)}</kbd>
													<button
														onclick={() => removeBinding(action, b.id)}
														class="chip-remove"
														aria-label="Remove binding">×</button
													>
												</span>
											{/each}

											{#if capturing}
												<span class="waiting">waiting…</span>
											{:else}
												<button
													onclick={() => startBind(action)}
													class="chip-add"
													aria-label="Add binding">+</button
												>
											{/if}
										</div>

										<!-- Reset action -->
										<button
											onclick={() => resetAction(action)}
											title="Reset to default"
											class="action-reset">↺</button
										>
									</div>
								{/each}
							</div>
						</div>
					{/each}
				</div>

				<!-- Reset all -->
				<button onclick={resetAllControls} class="reset-all"> Reset All Controls </button>

				<!-- System tab -->
			{:else if activeTab === 'system'}
				<div class="system">
					<div>
						<p class="group-label">Support</p>
						<div class="sys-list">
							<div class="sys-row">
								<span class="sys-key">WebGPU</span>
								<span class="sys-value" class:off={capabilityState.tier !== 'webgpu'}>
									{mark(capabilityState.tier === 'webgpu')}
									{capabilityState.tier === 'webgpu' ? 'adapter available' : 'no adapter'}
								</span>
							</div>
							<div class="sys-row">
								<span class="sys-key">WebGL 2</span>
								<span class="sys-value" class:off={!capabilityState.webgl2}>
									{mark(capabilityState.webgl2)}
									{capabilityState.webgl2 ? 'available' : 'unavailable'}
								</span>
							</div>
							<div class="sys-row">
								<span class="sys-key">WebAssembly</span>
								<span class="sys-value" class:off={!capabilityState.wasm}>
									{mark(capabilityState.wasm)}
									{capabilityState.wasm ? 'available' : 'unavailable'}
								</span>
							</div>
						</div>
						{#if capabilityState.tier === 'webgl'}
							<p class="sys-note">
								Running on the WebGL 2 fallback — WebGPU features and performance are unavailable.
							</p>
						{/if}
					</div>

					<div>
						<p class="group-label">GPU</p>
						<div class="sys-list">
							<div class="sys-row">
								<span class="sys-key">Vendor</span>
								<span class="sys-value">{shown(capabilityState.adapter?.vendor ?? '')}</span>
							</div>
							<div class="sys-row">
								<span class="sys-key">Architecture</span>
								<span class="sys-value">{shown(capabilityState.adapter?.architecture ?? '')}</span>
							</div>
							<div class="sys-row">
								<span class="sys-key">Device</span>
								<span class="sys-value">{shown(capabilityState.adapter?.device ?? '')}</span>
							</div>
							<div class="sys-row">
								<span class="sys-key">Description</span>
								<span class="sys-value">{shown(capabilityState.adapter?.description ?? '')}</span>
							</div>
							<div class="sys-row">
								<span class="sys-key">Type</span>
								<span class="sys-value">{gpuKind}</span>
							</div>
						</div>
						<p class="sys-note">
							Browsers mask most adapter fields unless developer flags are on, so blanks here are
							normal.
						</p>
					</div>

					<div>
						<p class="group-label">Renderer</p>
						<div class="sys-list">
							<div class="sys-row">
								<span class="sys-key">Backend</span>
								<span class="sys-value">{backendLabel}</span>
							</div>
							<div class="sys-row">
								<span class="sys-key">Preset</span>
								<span class="sys-value">{settingsState.graphics.quality}</span>
							</div>
							<div class="sys-row">
								<span class="sys-key">Backbuffer</span>
								<span class="sys-value">
									{telemetryState.bufferWidth} × {telemetryState.bufferHeight} @ {telemetryState.pixelRatio}x
								</span>
							</div>
							<div class="sys-row">
								<span class="sys-key">FPS (rendered)</span>
								<span class="sys-value">
									{telemetryState.fps}
									<span class="sys-dim">({telemetryState.frameMs} ms)</span>
								</span>
							</div>
							<div class="sys-row">
								<span class="sys-key">Frame loop</span>
								<span class="sys-value">{telemetryState.loopHz} Hz</span>
							</div>
							<div class="sys-row">
								<span class="sys-key">Draw calls / triangles</span>
								<span class="sys-value">
									{telemetryState.drawCalls} / {telemetryState.triangles.toLocaleString()}
								</span>
							</div>
							<div class="sys-row">
								<span class="sys-key">Geometries / textures / programs</span>
								<span class="sys-value">
									{telemetryState.geometries} / {telemetryState.textures} / {telemetryState.programs}
								</span>
							</div>
						</div>
						<p class="sys-note">
							Rendering is on-demand, so FPS is not the display refresh rate. Frame loop is how
							often the loop ran at all: loop high with FPS low means renders were skipped because
							nothing changed; both falling together means the frames themselves got slower.
						</p>
					</div>

					<div>
						<p class="group-label">Device</p>
						<div class="sys-list">
							<div class="sys-row">
								<span class="sys-key">CPU threads</span>
								<span class="sys-value">{shown(capabilityState.device.threads)}</span>
							</div>
							<div class="sys-row">
								<span class="sys-key">Memory</span>
								<span class="sys-value">
									{capabilityState.device.memoryGb ? `${capabilityState.device.memoryGb} GB+` : '—'}
								</span>
							</div>
							<div class="sys-row">
								<span class="sys-key">Platform</span>
								<span class="sys-value">{shown(capabilityState.device.platform)}</span>
							</div>
						</div>
					</div>

					{#if capabilityState.features.length > 0}
						<div>
							<p class="group-label">WebGPU features ({capabilityState.features.length})</p>
							<div class="feature-chips">
								{#each capabilityState.features as feature (feature)}
									<span class="feature-chip">{feature}</span>
								{/each}
							</div>
						</div>
					{/if}

					<a class="sys-link" href={WEBGPU_REPORT_URL} target="_blank" rel="noopener noreferrer">
						Full browser report → webgpureport.org
					</a>
				</div>
			{/if}

			<!-- Back -->
			<button
				onclick={() => {
					soundActions.playClick();
					if (isCapturing) inputActions.cancelCapture();
					onBack();
				}}
				class="back-button"
			>
				Back
			</button>
		</div>
	</div>
</div>

<style>
	.hud {
		pointer-events: auto;
	}

	.overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.6);
		backdrop-filter: blur(12px);
	}

	.panel {
		display: flex;
		flex-direction: column;
		width: 22.5rem;
		padding: 2rem;
		color: #fff;
		background: rgba(255, 255, 255, 0.08);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 1rem;
	}

	.panel.wide {
		width: 37.5rem;
	}

	h2 {
		margin-bottom: 1.25rem;
		font-size: 1.5rem;
		font-weight: 600;
	}

	/* Tab bar */
	.tabs {
		display: flex;
		gap: 0.25rem;
		margin-bottom: 1.5rem;
		padding: 0.25rem;
		background: rgba(255, 255, 255, 0.05);
		border-radius: 0.75rem;
	}

	.tab {
		flex: 1;
		padding: 0.375rem 0;
		font-size: 0.875rem;
		font-weight: 500;
		color: rgba(255, 255, 255, 0.5);
		border-radius: 0.5rem;
	}

	.tab:hover {
		color: rgba(255, 255, 255, 0.8);
	}

	.tab.active {
		background: rgba(255, 255, 255, 0.2);
		color: #fff;
	}

	/* General tab */
	.section {
		margin-bottom: 1.5rem;
	}

	.section-label {
		margin-bottom: 0.5rem;
		font-size: 0.875rem;
		opacity: 0.7;
	}

	.quality-row {
		display: flex;
		gap: 0.5rem;
	}

	.quality-button {
		flex: 1;
		padding: 0.5rem 1rem;
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 0.5rem;
		text-transform: capitalize;
	}

	.quality-button:hover {
		background: rgba(255, 255, 255, 0.1);
	}

	.quality-button.selected {
		border-color: rgba(255, 255, 255, 0.6);
		background: rgba(255, 255, 255, 0.2);
	}

	.hint-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 0.875rem;
		opacity: 0.5;
	}

	.hint-row kbd {
		padding: 0.125rem 0.5rem;
		font-family:
			ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
			monospace;
		font-size: 0.75rem;
		background: rgba(255, 255, 255, 0.08);
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 0.25rem;
	}

	.section-note {
		margin-top: 0.5rem;
		font-size: 11px;
		opacity: 0.3;
	}

	.sens-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.sens-row + .sens-row {
		margin-top: 0.5rem;
	}

	.sens-label {
		width: 2.5rem;
		font-size: 0.875rem;
		opacity: 0.7;
	}

	.sens-slider {
		flex: 1;
		accent-color: rgba(255, 255, 255, 0.8);
	}

	.sens-value {
		min-width: 2rem;
		font-size: 0.75rem;
		text-align: right;
		opacity: 0.5;
	}

	/* Audio tab */
	.audio-section {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	.channel {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.channel-label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
		cursor: pointer;
	}

	.channel-checkbox {
		width: 1rem;
		height: 1rem;
	}

	.volume {
		width: 100%;
		accent-color: rgba(255, 255, 255, 0.8);
	}

	/* Controls tab */
	.capture-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 1rem;
		padding: 0.625rem 1rem;
		font-size: 0.875rem;
		background: rgba(255, 255, 255, 0.1);
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 0.75rem;
	}

	.pulse {
		animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.5;
		}
	}

	.cancel-button {
		padding: 0.125rem 0.5rem;
		font-size: 0.75rem;
		color: rgba(255, 255, 255, 0.6);
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 0.25rem;
	}

	.cancel-button:hover {
		color: #fff;
	}

	.bindings {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		max-height: 52vh;
		overflow-y: auto;
		padding-right: 0.25rem;
	}

	.group-label {
		margin-bottom: 0.5rem;
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		opacity: 0.4;
	}

	.action-list {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.action-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.375rem 0.75rem;
		border-radius: 0.5rem;
		border: 1px solid transparent;
	}

	.action-row:not(.capturing):hover {
		background: rgba(255, 255, 255, 0.05);
	}

	.action-row.capturing {
		background: rgba(255, 255, 255, 0.12);
		border-color: rgba(255, 255, 255, 0.25);
	}

	.action-name {
		flex-shrink: 0;
		width: 9rem;
		font-size: 0.875rem;
		opacity: 0.8;
	}

	.chips {
		display: flex;
		flex: 1;
		flex-wrap: wrap;
		gap: 0.25rem;
		min-width: 0;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.125rem 0.375rem;
		background: rgba(255, 255, 255, 0.1);
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 0.25rem;
	}

	.chip kbd {
		font-family:
			ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
			monospace;
		font-size: 0.75rem;
		line-height: 1;
	}

	.chip-remove {
		font-size: 0.75rem;
		line-height: 1;
		opacity: 0.4;
	}

	.chip-remove:hover {
		opacity: 1;
	}

	.waiting {
		align-self: center;
		font-size: 0.75rem;
		font-style: italic;
		opacity: 0.5;
	}

	.chip-add {
		padding: 0.125rem 0.375rem;
		font-size: 0.75rem;
		line-height: 1;
		opacity: 0.4;
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 0.25rem;
	}

	.chip-add:hover {
		opacity: 0.8;
	}

	.action-reset {
		flex-shrink: 0;
		font-size: 0.875rem;
		opacity: 0.3;
	}

	.action-reset:hover {
		opacity: 0.7;
	}

	.reset-all {
		margin-top: 1rem;
		width: 100%;
		padding: 0.375rem 0;
		font-size: 0.875rem;
		color: rgba(255, 255, 255, 0.5);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 0.5rem;
	}

	.reset-all:hover {
		background: rgba(255, 255, 255, 0.08);
		color: rgba(255, 255, 255, 0.8);
	}

	/* System tab */
	.system {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		max-height: 52vh;
		overflow-y: auto;
		padding-right: 0.25rem;
	}

	.sys-list {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.sys-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		font-size: 0.8125rem;
	}

	.sys-key {
		opacity: 0.5;
	}

	.sys-value {
		font-family:
			ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
			monospace;
		font-size: 0.75rem;
		text-align: right;
		word-break: break-word;
		opacity: 0.85;
	}

	.sys-value.off {
		opacity: 0.4;
	}

	.sys-dim {
		opacity: 0.5;
	}

	.sys-note {
		margin-top: 0.5rem;
		font-size: 0.6875rem;
		line-height: 1.5;
		opacity: 0.35;
	}

	.feature-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}

	.feature-chip {
		padding: 0.125rem 0.375rem;
		font-family:
			ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
			monospace;
		font-size: 0.625rem;
		background: rgba(255, 255, 255, 0.08);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 0.25rem;
		opacity: 0.6;
	}

	.sys-link {
		align-self: flex-start;
		font-size: 0.75rem;
		color: #fff;
		opacity: 0.5;
		text-decoration: underline;
		text-underline-offset: 0.25em;
	}

	.sys-link:hover {
		opacity: 0.9;
	}

	.back-button {
		margin-top: 1rem;
		width: 100%;
		padding: 0.625rem 1rem;
		background: rgba(255, 255, 255, 0.15);
		border: 1px solid rgba(255, 255, 255, 0.3);
		border-radius: 0.5rem;
	}

	.back-button:hover {
		background: rgba(255, 255, 255, 0.2);
	}
</style>
