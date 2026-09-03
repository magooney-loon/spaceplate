// Development-only debugging probes. NOT app code — nothing here is imported by
// anything under `core/`, `extensions/` or `scenes/`.
//
// Wiring is a single line in `main.ts`, normally commented out:
//
//     /* import './__debug'; */
//
// Uncomment to arm every probe; comment it back when done. That import is the only
// reference, so commented-out means fully out of the production bundle.
//
// Adding a probe: one module exporting an `install*()` that is safe to call twice,
// plus a call here. Keep it self-contained and write down WHY it exists and what
// its output means — a probe with no explanation is worse than none. Delete a
// probe once its bug is closed; git log is the archive. Prefer patching a
// three/Threlte prototype (as mrtProbe does) over editing an engine file: a
// threaded-through hook rots and leaves a plausible-looking seam in real code.

import { installMrtProbe } from './mrtProbe';
import { installPostProcessingBridge } from './ppBridge';

installMrtProbe();
installPostProcessingBridge();
