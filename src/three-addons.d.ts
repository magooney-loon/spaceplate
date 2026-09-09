// Ambient declarations for three.js addons that `@types/three` does not carry yet.
//
// `@types/three` is published from DefinitelyTyped and lags the library: it stops at
// 0.185.x while this app runs three 0.186. Everything declared here is code that ships
// in `node_modules/three/examples/jsm` and is fully typed there in JSDoc — this file
// exists only so `tsc` can see it. **Delete an entry as soon as `@types/three` catches
// up**, and check the real source (not this file) for the authoritative signature.

declare module 'three/addons/lights/SunLight.js' {
	import { Color, Light, OrthographicCamera, LightShadow } from 'three/webgpu';

	/**
	 * Cascaded shadow for a {@link SunLight}: two cascades fitted to the view camera's
	 * frustum and rendered into one atlas. `camera.far` caps the shadow distance;
	 * `camera.left/right/top/bottom` are ignored (each cascade fits its own).
	 */
	export class SunLightShadow extends LightShadow<OrthographicCamera> {
		readonly isSunLightShadow: true;
		/** The shadow camera of the given cascade — fitted, so valid after the first render. */
		getCamera(cascadeIndex?: number): OrthographicCamera;
	}

	/**
	 * A directional light with cascaded shadow maps. Unlike `DirectionalLight` it has no
	 * target: its direction is its position, pointing at the origin.
	 */
	export class SunLight extends Light {
		constructor(color?: Color | string | number, intensity?: number);
		readonly isSunLight: true;
		shadow: SunLightShadow;
	}
}

declare module 'three/addons/lights/SunLightNode.js' {
	/**
	 * The node implementation of `SunLight`. Register it before use:
	 * `renderer.library.addLight(SunLightNode, SunLight)`.
	 */
	export class SunLightNode {}
}
