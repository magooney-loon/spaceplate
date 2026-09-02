// Development-only debugging probes. NOT app code — nothing here is imported by
// anything under `core/`, `extensions/` or `scenes/`.
//
// Wiring is a single line in `main.ts`, normally commented out:
//
//     /* import './__debug'; */
//
// Uncomment to arm every probe below; comment it back out when you are done. Because
// that is the only reference, a commented import keeps all of this out of the bundle —
// there is no env flag to remember and no dead weight in production.
//
// ## Adding a probe
//
// One module per probe, exporting an `install*()` that is safe to call twice, then a
// call here. Keep each one self-contained and write down WHY it exists and what its
// output means — a probe with no explanation is worse than no probe, because the next
// person cannot tell a real finding from noise. Probes are meant to be deleted
// individually once the bug they chase is closed; `git log` is the archive.
//
// Prefer patching a three/Threlte prototype (as `mrtProbe` does) over editing an engine
// file: a probe that requires threading an instance through `Renderer.svelte` will rot,
// and worse, leaves a plausible-looking hook behind in real code when it is removed.

import { installMrtProbe } from './mrtProbe';
import { installPostProcessingBridge } from './ppBridge';

installMrtProbe();
installPostProcessingBridge();
