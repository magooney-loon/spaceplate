import type { EnvTextureEntry, CubeTextureEntry } from './types';
import { BASE_URL } from '$extensions/settings/settings.svelte';

// ─────────────────────────────────────────────────────────────────────────────
// Equirectangular / HDR / EXR textures  →  used with <Environment>
// Drop files into: public/textures/skybox/hdr/   (*.hdr)
//                  public/textures/skybox/exr/   (*.exr)
//                  public/textures/skybox/equi_env/  (*.jpg / *.png)
// Then add an entry below.
// ─────────────────────────────────────────────────────────────────────────────
export const ENV_TEXTURES: EnvTextureEntry[] = [
	{
		id: 'aerodynamics_workshop',
		name: 'Aerodynamics Workshop',
		url: `${BASE_URL}textures/skybox/hdr/aerodynamics_workshop_1k.hdr`
	},
	{
		id: 'blouberg_sunrise',
		name: 'Blouberg Sunrise',
		url: `${BASE_URL}textures/skybox/hdr/blouberg_sunrise_2_1k.hdr`
	},
	{
		id: 'industrial_sunset',
		name: 'Industrial Sunset',
		url: `${BASE_URL}textures/skybox/hdr/industrial_sunset_puresky_1k.hdr`
	},
	{
		id: 'mpumalanga_veld',
		name: 'Mpumalanga Veld',
		url: `${BASE_URL}textures/skybox/hdr/mpumalanga_veld_puresky_1k.hdr`
	},
	{
		id: 'shanghai_riverside',
		name: 'Shanghai Riverside',
		url: `${BASE_URL}textures/skybox/hdr/shanghai_riverside_1k.hdr`
	},
	{
		id: 'piz_compressed',
		name: 'Piz Compressed (EXR)',
		url: `${BASE_URL}textures/skybox/exr/piz_compressed.exr`
	},
	{
		id: 'ruined_room',
		name: 'Ruined Room',
		url: `${BASE_URL}textures/skybox/equi_env/equirect_ruined_room.jpg`
	}
];

// ─────────────────────────────────────────────────────────────────────────────
// Cube map textures  →  used with <CubeEnvironment>
// Drop 6 face files into: public/textures/skybox/cube/<set-name>/
// Face order: [px, nx, py, ny, pz, nz]  (pos/neg X Y Z)
// ─────────────────────────────────────────────────────────────────────────────
export const CUBE_TEXTURES: CubeTextureEntry[] = [
	{
		id: 'pisa',
		name: 'Pisa (HDR)',
		urls: [
			`${BASE_URL}textures/skybox/cube/pisa/px.hdr`,
			`${BASE_URL}textures/skybox/cube/pisa/nx.hdr`,
			`${BASE_URL}textures/skybox/cube/pisa/py.hdr`,
			`${BASE_URL}textures/skybox/cube/pisa/ny.hdr`,
			`${BASE_URL}textures/skybox/cube/pisa/pz.hdr`,
			`${BASE_URL}textures/skybox/cube/pisa/nz.hdr`
		]
	},
	{
		id: 'bridge',
		name: 'Bridge',
		urls: [
			`${BASE_URL}textures/skybox/cube/bridge/posx.jpg`,
			`${BASE_URL}textures/skybox/cube/bridge/negx.jpg`,
			`${BASE_URL}textures/skybox/cube/bridge/posy.jpg`,
			`${BASE_URL}textures/skybox/cube/bridge/negy.jpg`,
			`${BASE_URL}textures/skybox/cube/bridge/posz.jpg`,
			`${BASE_URL}textures/skybox/cube/bridge/negz.jpg`
		]
	}
];
