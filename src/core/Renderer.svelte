<script lang="ts">
	// TSL/RenderPipeline post-processing (see DOCS/webgpu-migration-roadmap.md, Phase 4).
	// Replaces the old pmndrs/postprocessing EffectComposer, which cannot run against
	// WebGPURenderer at all. Task-ordering rules for Studio compatibility (gizmo/PiP/
	// selection outline vs. autoRenderTask) are carried forward from ./Renderer.md, but
	// those were written against EffectComposer and have not been re-verified against
	// RenderPipeline in-browser — see roadmap §0 for what's still unverified.
	import { useThrelte, useTask } from '@threlte/core/webgpu';
	import * as THREE from 'three/webgpu';
	import {
		pass,
		uniform,
		vec3,
		vec4,
		mix,
		uv,
		time,
		sin,
		oneMinus,
		fract,
		min,
		max,
		step,
		float,
		renderOutput
	} from 'three/tsl';
	import { hue, saturation, posterize } from 'three/tsl';
	import { bloom } from 'three/addons/tsl/display/BloomNode.js';
	import { smaa } from 'three/addons/tsl/display/SMAANode.js';
	import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
	import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
	import { ao } from 'three/addons/tsl/display/GTAONode.js';
	import { outline } from 'three/addons/tsl/display/OutlineNode.js';
	import { godrays } from 'three/addons/tsl/display/GodraysNode.js';
	import { sepia } from 'three/addons/tsl/display/Sepia.js';
	import { dotScreen } from 'three/addons/tsl/display/DotScreenNode.js';
	import { pixelationPass } from 'three/addons/tsl/display/PixelationPassNode.js';
	import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';
	import { film } from 'three/addons/tsl/display/FilmNode.js';
	import { vignette, scanlines, barrelUV, barrelMask } from 'three/addons/tsl/display/CRT.js';
	import { settingsState } from '$extensions/settings/settings.svelte';
	import { logPostprocessing } from '$extensions/logger/logger.svelte';
	import {
		postprocessingState,
		postprocessingPresetsState
	} from '$extensions/postprocessing/postprocessing.svelte';
	import {
		resolveScenePreset,
		resolveGlobalPreset,
		sceneState
	} from '$extensions/scene/scene.svelte';

	const s = $derived.by((): typeof postprocessingState => {
		const { presets } = postprocessingPresetsState;
		const scenePresetId = resolveScenePreset(sceneState.currentScene, 'postprocessing');
		const globalPresetId = resolveGlobalPreset('postprocessing');

		const globalSettings = globalPresetId
			? (presets.find((p) => p.id === globalPresetId)?.settings ?? null)
			: null;
		const sceneSettings = scenePresetId
			? (presets.find((p) => p.id === scenePresetId)?.settings ?? null)
			: null;

		// No presets assigned — use manual postprocessingState
		if (!globalSettings && !sceneSettings) return postprocessingState;
		if (!globalSettings) return sceneSettings!;
		if (!sceneSettings) return globalSettings;

		// Merge global + scene: same effect active in both → warn, scene wins
		const merged = JSON.parse(JSON.stringify(globalSettings)) as typeof postprocessingState;
		const keys = Object.keys(merged) as (keyof typeof postprocessingState)[];
		for (const key of keys) {
			const g = (globalSettings as any)[key] as { enabled: boolean };
			const sc = (sceneSettings as any)[key] as { enabled: boolean };
			if (g.enabled && sc.enabled) {
				logPostprocessing.warn(`Effect "${key}" active in both global & scene preset — scene wins`);
				(merged as any)[key] = sc;
			} else if (sc.enabled) {
				(merged as any)[key] = sc;
			}
			// else: global is already in merged (from JSON.parse of globalSettings)
		}
		return merged;
	});

	const { scene, renderer, camera, autoRender, autoRenderTask } = useThrelte();

	const renderPipeline = new THREE.RenderPipeline(renderer);

	let sunLight: THREE.DirectionalLight | null = null;
	let sunMesh: THREE.Mesh | null = null;

	const ensureSun = (): { light: THREE.DirectionalLight; mesh: THREE.Mesh } => {
		if (!sunLight) {
			sunLight = new THREE.DirectionalLight(0xffffff, 3);
			sunLight.castShadow = true;
			sunLight.shadow.mapSize.set(2048, 2048);
			sunLight.shadow.camera.left = -20;
			sunLight.shadow.camera.right = 20;
			sunLight.shadow.camera.top = 20;
			sunLight.shadow.camera.bottom = -20;
			sunLight.shadow.camera.near = 0.1;
			sunLight.shadow.camera.far = 50;
			scene.add(sunLight);
		}
		if (!sunMesh) {
			const geometry = new THREE.SphereGeometry(0.75, 32, 32);
			const material = new THREE.MeshBasicMaterial({ fog: false });
			sunMesh = new THREE.Mesh(geometry, material);
			scene.add(sunMesh);
		}
		return { light: sunLight, mesh: sunMesh };
	};

	const removeSun = () => {
		if (sunLight) {
			scene.remove(sunLight);
			sunLight.dispose();
			sunLight = null;
		}
		if (sunMesh) {
			scene.remove(sunMesh);
			sunMesh.geometry.dispose();
			(sunMesh.material as THREE.Material).dispose();
			sunMesh = null;
		}
	};

	let disposables: Array<{ dispose?: () => void }> = [];
	const track = <T extends { dispose?: () => void }>(node: T): T => {
		disposables.push(node);
		return node;
	};
	const disposeAll = () => {
		for (const d of disposables) {
			try {
				d.dispose?.();
			} catch {
				/* ignore */
			}
		}
		disposables = [];
	};

	$effect(() => {
		const state = s;
		const cam = $camera;
		const quality = settingsState.graphics.quality;

		disposeAll();

		renderer.toneMapping = state.toneMapping.enabled
			? (state.toneMapping.mode as THREE.ToneMapping)
			: THREE.NoToneMapping;
		renderer.toneMappingExposure = state.toneMapping.enabled ? state.toneMapping.exposure : 1;

		if (quality === 'low') {
			removeSun();
			const scenePass = track(pass(scene, cam));
			renderPipeline.outputColorTransform = true;
			renderPipeline.outputNode = scenePass;
			renderPipeline.needsUpdate = true;
			logPostprocessing.info('Graphics quality: LOW - Post-processing disabled');
			return;
		}

		const deferred = [
			state.glitch.enabled && 'glitch',
			state.shockWave.enabled && 'shockWave',
			state.ascii.enabled && 'ascii',
			state.tiltShift.enabled && 'tiltShift'
		].filter(Boolean);
		if (deferred.length > 0) {
			logPostprocessing.warn(
				`Effect(s) not yet wired into the WebGPU pipeline (Phase 4 follow-up): ${deferred.join(', ')}`
			);
		}

		try {
			let scenePass: any = track(pass(scene, cam));
			let colorNode: any = scenePass;

			if (state.pixelation.enabled) {
				const pixNode = track(
					pixelationPass(
						scene,
						cam,
						state.pixelation.pixelSize,
						state.pixelation.normalEdgeStrength,
						state.pixelation.depthEdgeStrength
					)
				);
				scenePass = pixNode;
				colorNode = pixNode;
			}

			if (state.lensDistortion.enabled) {
				const distortedUV = barrelUV(float(state.lensDistortion.curvature));
				colorNode = scenePass.getTextureNode().sample(distortedUV).mul(barrelMask(distortedUV));
			}

			if (state.ssao.enabled && !state.pixelation.enabled) {
				const depthNode = scenePass.getTextureNode('depth');
				const aoPass = track(ao(depthNode, null as any, cam));
				aoPass.radius.value = state.ssao.radius;
				aoPass.thickness.value = state.ssao.thickness;
				aoPass.scale.value = state.ssao.scale;
				aoPass.samples.value = state.ssao.samples;
				colorNode = colorNode.mul(aoPass.r);
			}

			if (state.depthOfField.enabled && !state.pixelation.enabled) {
				const viewZNode = scenePass.getViewZNode();
				colorNode = track(
					dof(
						colorNode,
						viewZNode,
						float(state.depthOfField.focusDistance),
						float(state.depthOfField.focalLength),
						float(state.depthOfField.bokehScale)
					)
				);
			}

			if (state.chromaticAberration.enabled) {
				colorNode = chromaticAberration(
					colorNode,
					float(state.chromaticAberration.strength),
					null as any,
					float(state.chromaticAberration.scale)
				);
			}

			if (state.dotScreen.enabled) {
				colorNode = dotScreen(colorNode, state.dotScreen.angle, state.dotScreen.scale);
			}

			if (state.noise.enabled) {
				colorNode = film(colorNode, uniform(state.noise.intensity));
			}

			if (state.bloom.enabled) {
				const bloomPass = track(
					bloom(colorNode, state.bloom.strength, state.bloom.radius, state.bloom.threshold)
				);
				colorNode = colorNode.add(bloomPass);
			}

			if (state.godRays.enabled && !state.pixelation.enabled) {
				const { light, mesh } = ensureSun();
				light.position.set(state.godRays.sunX, state.godRays.sunY, state.godRays.sunZ);
				light.color.setHex(state.godRays.sunColor);
				mesh.position.set(state.godRays.sunX, state.godRays.sunY, state.godRays.sunZ);
				(mesh.material as THREE.MeshBasicMaterial).color.setHex(state.godRays.sunColor);

				const depthNode = scenePass.getTextureNode('depth');
				const godraysPass = track(godrays(depthNode, cam, light));
				godraysPass.raymarchSteps.value = state.godRays.samples;
				godraysPass.density.value = state.godRays.density;
				godraysPass.maxDensity.value = state.godRays.maxDensity;
				godraysPass.distanceAttenuation.value = state.godRays.distanceAttenuation;
				godraysPass.resolutionScale = state.godRays.resolutionScale;
				colorNode = colorNode.add(godraysPass);
			} else {
				removeSun();
			}

			if (state.outline.enabled) {
				const outlinePass = track(
					outline(scene, cam, {
						selectedObjects: [],
						edgeThickness: uniform(state.outline.edgeThickness),
						edgeGlow: uniform(state.outline.edgeGlow)
					})
				);
				const { visibleEdge, hiddenEdge } = outlinePass;
				const visibleColorRGB = new THREE.Color(state.outline.visibleEdgeColor);
				const hiddenColorRGB = new THREE.Color(state.outline.hiddenEdgeColor);
				const visibleColor = vec3(visibleColorRGB.r, visibleColorRGB.g, visibleColorRGB.b);
				const hiddenColor = vec3(hiddenColorRGB.r, hiddenColorRGB.g, hiddenColorRGB.b);
				let outlineColor = visibleEdge
					.mul(visibleColor)
					.add(hiddenEdge.mul(hiddenColor))
					.mul(state.outline.edgeStrength);
				if (state.outline.pulseSpeed > 0) {
					const osc = sin(time.mul(state.outline.pulseSpeed)).mul(0.5).add(0.5);
					outlineColor = outlineColor.mul(osc);
				}
				colorNode = outlineColor.add(colorNode);
			}

			// Remaining effects operate on rgb only; carry alpha through separately.
			let rgb = colorNode.rgb;
			const alpha = colorNode.a;

			if (state.hueSaturation.enabled) {
				rgb = saturation(hue(rgb, state.hueSaturation.hue), state.hueSaturation.saturation);
			}

			if (state.brightnessContrast.enabled) {
				const contrastFactor = state.brightnessContrast.contrast + 1;
				rgb = rgb
					.sub(0.5)
					.mul(contrastFactor)
					.add(0.5)
					.add(state.brightnessContrast.brightness);
			}

			if (state.colorDepth.enabled) {
				rgb = posterize(rgb, state.colorDepth.steps);
			}

			if (state.sepia.enabled) {
				const sepiaColor = (sepia(vec4(rgb, 1)) as any).rgb;
				rgb = mix(rgb, sepiaColor, state.sepia.intensity);
			}

			if (state.depthEffect.enabled) {
				let depthVal = scenePass.getLinearDepthNode();
				if (state.depthEffect.inverted) depthVal = oneMinus(depthVal);
				rgb = vec3(depthVal);
			}

			if (state.grid.enabled) {
				const gridUV = uv().mul(state.grid.scale * 20);
				const cell = fract(gridUV);
				const distToEdgeX = min(cell.x, oneMinus(cell.x));
				const distToEdgeY = min(cell.y, oneMinus(cell.y));
				const isLine = max(
					step(distToEdgeX, state.grid.lineWidth),
					step(distToEdgeY, state.grid.lineWidth)
				);
				rgb = mix(rgb, vec3(1, 1, 1), isLine.mul(0.5));
			}

			if (state.vignette.enabled) {
				rgb = vignette(rgb, float(state.vignette.intensity), float(state.vignette.smoothness));
			}

			if (state.scanline.enabled) {
				rgb = scanlines(
					rgb,
					float(state.scanline.intensity),
					float(state.scanline.count),
					float(state.scanline.speed)
				);
			}

			let output: any = vec4(rgb, alpha);

			if (state.smaa.enabled) {
				output = smaa(output);
			}

			if (state.fxaa.enabled) {
				renderPipeline.outputColorTransform = false;
				output = fxaa(renderOutput(output, renderer.toneMapping, renderer.outputColorSpace));
			} else {
				renderPipeline.outputColorTransform = true;
			}

			renderPipeline.outputNode = output;
			renderPipeline.needsUpdate = true;

			logPostprocessing.info('Post-processing pipeline rebuilt');
		} catch (err) {
			logPostprocessing.error('Post-processing pipeline build failed, falling back to plain render:', err);
			disposeAll();
			const fallbackPass = track(pass(scene, cam));
			renderPipeline.outputColorTransform = true;
			renderPipeline.outputNode = fallbackPass;
			renderPipeline.needsUpdate = true;
		}
	});

	$effect(() => {
		const before = autoRender.current;
		autoRender.set(false);
		return () => autoRender.set(before);
	});

	useTask(
		() => {
			renderPipeline.render();
		},
		{ after: autoRenderTask, autoInvalidate: false }
	);

	$effect(() => {
		return () => {
			disposeAll();
			removeSun();
			renderPipeline.dispose();
		};
	});
</script>
