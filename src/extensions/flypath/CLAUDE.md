# Camera Fly Path (`flypath/`)

Authored camera paths for cinematic stills and video. Pairs with `capture/`.

## Files

```
types.ts                — extensionScope, FlyPathWaypoint, FlyPathState, FlyPathActions, FlyPathDriver
flypath.svelte.ts       — $state + flyPathActions + localStorage persistence + driver slot
FlyPath.svelte          — the driver: curve, camera drive task, authoring overlay
FlyPathExtension.svelte — Studio toolbar panel (UI only)
index.ts                — barrel
```

Dev-only (`VITE_GAME_ENGINE=true`). Paths persist to `localStorage` under `flypath`.

## The workflow

1. Editor camera **on**. Fly to a shot with the mouse, hit **➕ Add Waypoint Here** — it snapshots position, orientation and FOV from `camera.current`.
2. Adjust: drag/rotate a waypoint's cone marker with Studio's transform gizmo, or **🎯 Re-snapshot** it from a new camera position. Per-waypoint *hold → next* sets pacing.
3. Editor camera **off**, so `camera.current` is the app's own `makeDefault` camera.
4. **▶ Play** to preview, or **🎬 Record Flythrough** to bracket a capture recording around one pass.

## Key behavior

- **Nothing is ever camera-swapped.** Waypoints snapshot `camera.current` and playback drives `camera.current` — the same object either way. That is deliberate: `Renderer.svelte`'s structural effect tracks `$camera` and rebuilds the whole post-processing pipeline when it changes, so a swap mid-recording would hitch the take. The cost is that playing with the editor camera on means Studio's `CameraControls` and the path both write the same object and fight; the panel warns about it.
- **The camera transform is saved on first engage and restored on Stop**, so a flythrough never leaves the scene camera parked somewhere odd. "Engaged" starts at the first play or scrub and ends at Stop.
- **Easing is global, never per segment.** Easing each segment separately drives velocity to zero at every waypoint — a stop-and-go crawl, not a flythrough. So the ease shapes progress across the whole path and the per-waypoint durations shape pacing inside it; the two are independent. A **looping path forces linear**, because easing in and out of every lap makes the wrap visibly hitch.
- **Timing is in parameter space, not arc length.** `CatmullRomCurve3.getPoint` divides its parameter by the segment count, so `(index + local) / segments` lands exactly on segment `index`. Two segments with equal durations but different physical lengths therefore fly at different speeds — that is the point of per-segment durations, but it is worth knowing before blaming the easing.
- **Task order is `{ before: autoRenderTask }`.** Within one frame: move camera → render → Capture's `{ after: autoRenderTask }` grab. That is what makes a recorded flythrough frame-accurate.
- **Playback pins the render loop** via `invalidate()` per frame, same as recording (`renderMode` is on-demand).
- **The end of a path is torn down one tick late** (`finishing` flag): the final frame has to render, and be blitted into the recording, before the take is stopped and the camera restored.
- **Marker drags write back through a task, not an `$effect`.** Studio's gizmo mutates the marker `Object3D` directly; the task diffs it against state with a 1e-4 epsilon and writes the change back. Persisting is deferred ~0.6s after the drag settles rather than run at 60Hz. The markers are deliberately **selectable and visible in the tree** (no `selectable: false`) — that is what makes the gizmo reach them. The tube is not.
- **The overlay is suppressed while playing** — during a flythrough the camera is inside the tube and the markers would be in every frame of the take.
- `progress` is a `$state` write from a 60Hz task, epsilon-gated at 0.002 (plus the exact 0 and 1 endpoints) so playback does not wake the panel every frame. **The Scrub slider must therefore filter `e.detail.origin === 'external'`** — see the tweakpane rule in `extensions/CLAUDE.md`. Without it the slider called `scrub()` back on every one of those writes, and `scrub()` pauses playback: the path stopped one frame after Play (looking like "it only flies to the first waypoint") and the recording never reached its finish path, running until the capture cap. `scrub()` additionally refuses outright while a recording is in flight.
- Orientation modes: `waypoint` slerps the snapshotted quaternions; `lookAt` builds the quaternion from `Matrix4.lookAt(position, target, up)` each frame. FOV lerps between waypoints in both modes, so dolly zoom is available.

## Cross-extension

`recordFlythrough()` calls `captureActions.startRecording()` / `stopRecording()` — the explicit forms exist on `captureActions` for exactly this. It rewinds and poses the camera **before** arming the recorder so frame 0 of the video is frame 0 of the path, warns when the path is longer than the capture cap (or is looping, which only the cap will end), and bails cleanly if `captureState.isRecording` never went true.
