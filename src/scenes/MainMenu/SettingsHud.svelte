<script lang="ts">
	import {
		settingsState,
		graphicsActions,
		audioActions,
		generalActions,
		FPS_CAPS,
		type QualityLevel
	} from '$extensions/settings';
	import { soundActions, capabilityState, telemetryState, WEBGPU_REPORT_URL } from '$core';
	import {
		inputState,
		inputActions,
		registeredMaps,
		bindingsFor,
		bindingKey,
		conflictsFor,
		bindingLabel,
		dirLabel,
		collidesWithStudio,
		type Binding,
		type AxisDir
	} from '$extensions/input';

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
	//
	// FULLY REGISTRY-DRIVEN: this file used to re-declare the engine's action enum,
	// its labels and its grouping, which meant a new action had to be added in three
	// places. Now every row below comes from whatever maps games have declared
	// ($extensions/input), and the label tables live with the engine
	// (bindingLabels.ts) because what a KeyboardEvent.code is called is not a HUD
	// decision.

	const mapIds = $derived(registeredMaps());

	/** Group a map's non-system slots by their declared `group`, preserving declaration order. */
	function groupsOf(mapId: string): Array<{ label: string; slotIds: string[] }> {
		const slots = inputState.maps[mapId]?.slots ?? {};
		const out: Array<{ label: string; slotIds: string[] }> = [];
		for (const [slotId, def] of Object.entries(slots)) {
			if (def.system) continue;
			const label = def.group ?? 'General';
			const existing = out.find((g) => g.label === label);
			if (existing) existing.slotIds.push(slotId);
			else out.push({ label, slotIds: [slotId] });
		}
		return out;
	}

	const hasBindableSlots = $derived(mapIds.some((id) => groupsOf(id).length > 0));

	const isAxis = (mapId: string, slotId: string): boolean =>
		inputState.maps[mapId]?.slots[slotId]?.type === 'axis';

	/** The chip text, with the ± prefix an axis slot's digital bindings need. */
	function chipLabel(b: Binding, axis: boolean): string {
		const dir = dirLabel(b, axis);
		return dir ? `${dir} ${bindingLabel(b)}` : bindingLabel(b);
	}

	const isCapturing = $derived(inputState.capture.active);
	const captureSlotLabel = $derived.by(() => {
		const { mapId, slotId } = inputState.capture;
		if (!mapId || !slotId) return null;
		return inputState.maps[mapId]?.slots[slotId]?.label ?? slotId;
	});

	/** Shown as a hint on the General tab — the engine map owns this one. */
	const settingsKeyLabel = $derived.by(() => {
		const k = bindingsFor('engine', 'openSettings').find((b) => b.device === 'key');
		return k ? bindingLabel(k) : null;
	});

	function startBind(mapId: string, slotId: string, dir: AxisDir = 1) {
		soundActions.playClick();
		inputActions.startCapture(mapId, slotId, dir);
	}

	function removeBinding(mapId: string, slotId: string, b: Binding) {
		inputActions.removeBinding(mapId, slotId, b);
	}

	function resetSlot(mapId: string, slotId: string) {
		soundActions.playClick();
		inputActions.resetSlot(mapId, slotId);
	}

	function resetAllControls() {
		soundActions.playClick();
		inputActions.resetAll();
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
					<p class="section-label">Frame Rate Cap</p>
					<div class="quality-row">
						{#each FPS_CAPS as cap (cap)}
							<button
								onclick={() => {
									soundActions.playClick();
									graphicsActions.setMaxFps(cap);
								}}
								class="quality-button"
								class:selected={settingsState.graphics.maxFps === cap}
							>
								{cap === 0 ? 'VSync' : cap}
							</button>
						{/each}
					</div>
					<p class="section-note">
						VSync (the default) paces the engine at the monitor's refresh rate — the browser always
						composites on vsync, so that is the ceiling anyway. The caps throttle the whole engine
						loop — simulation and rendering — below it; the real rate snaps to whole refresh
						intervals (a 60 cap on a 144 Hz display lands at ~48).
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

				<!-- Controls tab — every row comes from the input registry, nothing is
				     hardcoded here. Inactive maps (a scene that isn't running) are shown
				     dimmed but still rebindable, which the old per-player UI could not do. -->
			{:else if activeTab === 'controls'}
				<!-- Capture banner -->
				{#if isCapturing && captureSlotLabel}
					<div class="capture-banner">
						<span class="pulse">
							Binding <strong>{captureSlotLabel}</strong>
							{#if inputState.capture.dir === -1}(negative){/if} — press a key or click…
						</span>
						<button onclick={cancelCapture} class="cancel-button"> Cancel </button>
					</div>
				{/if}

				<div class="bindings">
					{#if !hasBindableSlots}
						<p class="section-note">
							No rebindable controls yet. Scenes declare their own — Settings lists whatever
							input maps exist, so this fills in as games register theirs.
						</p>
					{/if}
					{#each mapIds as mapId (mapId)}
						{@const map = inputState.maps[mapId]}
						{@const groups = groupsOf(mapId)}
						{#if groups.length > 0}
							<div class="map-block" class:inactive={!map.active}>
								<p class="map-label">
									{map.label}
									{#if !map.active}<span class="map-tag">not running</span>{/if}
								</p>

								{#each groups as group (group.label)}
									<p class="group-label">{group.label}</p>
									<div class="action-list">
										{#each group.slotIds as slotId (slotId)}
											{@const def = map.slots[slotId]}
											{@const axis = isAxis(mapId, slotId)}
											{@const bindings = bindingsFor(mapId, slotId)}
											{@const conflicts = conflictsFor(mapId, slotId)}
											{@const capturing =
												isCapturing &&
												inputState.capture.mapId === mapId &&
												inputState.capture.slotId === slotId}
											<div class="action-row" class:capturing>
												<span class="action-name">
													{def.label}
													{#if conflicts.length > 0}
														<span
															class="warn"
															title="Also bound to: {conflicts
																.map((c) => map.slots[c].label)
																.join(', ')}">⚠</span
														>
													{/if}
												</span>

												<div class="chips">
													{#each bindings as b (bindingKey(b))}
														<span class="chip">
															<kbd class:studio={collidesWithStudio(b)}>
																{chipLabel(b, axis)}
															</kbd>
															<button
																onclick={() => removeBinding(mapId, slotId, b)}
																class="chip-remove"
																aria-label="Remove binding">×</button
															>
														</span>
													{/each}

													{#if capturing}
														<span class="waiting">waiting…</span>
													{:else if axis}
														<!-- An axis slot binds a SIDE: which way this key pushes it. -->
														<button
															onclick={() => startBind(mapId, slotId, -1)}
															class="chip-add"
															title="Bind negative direction"
															aria-label="Add negative binding">+−</button
														>
														<button
															onclick={() => startBind(mapId, slotId, 1)}
															class="chip-add"
															title="Bind positive direction"
															aria-label="Add positive binding">++</button
														>
													{:else}
														<button
															onclick={() => startBind(mapId, slotId)}
															class="chip-add"
															aria-label="Add binding">+</button
														>
													{/if}
												</div>

												<button
													onclick={() => resetSlot(mapId, slotId)}
													title="Reset to default"
													class="action-reset">↺</button
												>
											</div>
										{/each}
									</div>
								{/each}
							</div>
						{/if}
					{/each}
				</div>

				<!-- Gamepad — one pad, one local player. Deadzones are applied in
				     core/input/GamepadInput.svelte with rescaling, so a slow stick
				     stays usable rather than snapping to zero and jumping. -->
				<div class="section gamepad">
					<p class="section-label">Gamepad</p>

					<label class="channel-label">
						<input
							type="checkbox"
							checked={inputState.gamepad.enabled}
							onchange={(e) => inputActions.setGamepadEnabled(e.currentTarget.checked)}
							class="channel-checkbox"
						/>
						<span>Enable gamepad input</span>
					</label>

					<p class="section-note">
						{#if inputState.runtime.connectedGamepads.length === 0}
							No gamepad detected — press a button on one to wake it up.
						{:else}
							{inputState.runtime.connectedGamepads.map((p) => p.id).join(', ')}
						{/if}
					</p>

					{#each [{ side: 'left', label: 'Left Stick Deadzone', value: inputState.gamepad.deadzoneLeftStick }, { side: 'right', label: 'Right Stick Deadzone', value: inputState.gamepad.deadzoneRightStick }] as const as dz (dz.side)}
						<div class="sens-row">
							<span class="sens-label">{dz.label}</span>
							<input
								type="range"
								min="0"
								max="0.5"
								step="0.01"
								value={dz.value}
								oninput={(e) => inputActions.setDeadzone(dz.side, +e.currentTarget.value)}
								class="sens-slider"
							/>
							<span class="sens-value">{dz.value.toFixed(2)}</span>
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
								<span class="sys-value">
									{telemetryState.loopHz} Hz
									{#if settingsState.graphics.maxFps > 0}
										<span class="sys-dim">(capped at {settingsState.graphics.maxFps})</span>
									{/if}
								</span>
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

	.gamepad {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding-top: 0.75rem;
		border-top: 1px solid rgba(255, 255, 255, 0.1);
	}

	.map-block {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	/* A map whose scene isn't running: still rebindable, visibly not live. */
	.map-block.inactive {
		opacity: 0.55;
	}

	.map-label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9375rem;
		font-weight: 600;
		letter-spacing: 0.02em;
	}

	.map-tag {
		padding: 0.0625rem 0.375rem;
		border-radius: 0.25rem;
		background: rgba(255, 255, 255, 0.08);
		font-size: 0.625rem;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		opacity: 0.6;
	}

	.group-label {
		margin-bottom: 0.5rem;
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		opacity: 0.4;
	}

	.warn {
		margin-left: 0.25rem;
		color: #f0b429;
		cursor: help;
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

	/* Studio (dev mode) binds bare w a s z t r c v m — flagged so a collision is
	   noticed at bind time rather than as "why doesn't this key work". */
	.chip kbd.studio {
		color: #f0b429;
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
