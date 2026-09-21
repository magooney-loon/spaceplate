// Development-only debugging probes — NOT app code. Wiring is the single
// `import './__debug'` in main.ts, normally commented out.
//
// Adding a probe: export an `install*()` safe to call twice, call it here, and
// write down WHY it exists — a probe with no explanation is worse than none.
// Delete it once its bug is closed; git log is the archive. Prefer patching a
// three/Threlte prototype (as mrtProbe does) over editing an engine file.

import { installMrtProbe } from './mrtProbe';
import { installPostProcessingBridge } from './ppBridge';

installMrtProbe();
installPostProcessingBridge();
