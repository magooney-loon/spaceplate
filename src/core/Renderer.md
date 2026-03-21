# Renderer.svelte — Post-Processing & Threlte Studio Compatibility

## Overview

`Renderer.svelte` owns the custom render pipeline using the `postprocessing` library (`EffectComposer`).
It replaces Threlte's built-in auto-render with a composer-based pipeline that supports SMAA, Bloom,
Vignette, and more.

---

## Problem: EffectComposer Breaks Threlte Studio

When a custom `EffectComposer` is active, Threlte Studio features stop working:

- **Orientation gizmo** (bottom-left corner) disappears or gets overwritten
- **Default Camera PiP** panel shows duplicate renders / ghost images
- **Selection outline** (yellow) doesn't stay fixed on objects when moving the camera

All three issues stem from **task registration order** and **task placement** in Threlte's frame DAG.

---

## How Threlte's Task DAG Works

Threlte schedules work via a DAG (Directed Acyclic Graph) that runs inside the `renderStage`.
Tasks can declare ordering constraints: `before: someTask` or `after: someTask`.

**Key tasks in renderStage (in execution order):**

| Task | Owner | Constraint |
|------|-------|-----------|
| DefaultCamera PiP render | `@threlte/studio` | `before: autoRenderTask` |
| Selection texture pre-render | `@threlte/studio` | `before: autoRenderTask` |
| `autoRenderTask` | Threlte core | — (stopped when `autoRender=false`) |
| Gizmo render | `@threlte/extras` | `after: autoRenderTask` |

The DAG uses **Kahn's topological sort** (FIFO queue). For tasks with the same constraint level
(e.g. multiple `before: autoRenderTask` tasks), **registration order determines execution order**.
Earlier-registered tasks run first.

---

## Bug 1 — Gizmo Gets Overwritten

**Cause:** Using `{ stage: renderStage }` with no `before`/`after` makes the task *isolated*
in the DAG. Isolated tasks run **after all connected tasks** — including the Gizmo's
`after: autoRenderTask` task. Our composer rendered last and cleared the gizmo.

**Fix:** Use `{ before: autoRenderTask, autoInvalidate: false }`. This places our task in
`renderStage` as a connected node that runs *before* `autoRenderTask`, so the Gizmo renders
on top of our output afterward.

```ts
// ❌ Wrong — isolated task, runs after Gizmo
useTask((delta) => composer.render(delta), { stage: renderStage, autoInvalidate: false })

// ✅ Correct — connected task, runs before Gizmo
useTask((delta) => composer.render(delta), { before: autoRenderTask, autoInvalidate: false })
```

---

## Bug 2 — Default Camera PiP Duplicated (including on camera re-entry) / Bug 3 — Selection Outline Drifts

All three caused by the same root issue: **task registration order relative to Studio's tasks**.

`<Renderer />` was placed outside the Studio `{#await}` block in `App.svelte`, so it mounted
synchronously before Studio's dynamic imports resolved. This meant our task registered *first*
in the DAG, so it ran *first* — before DefaultCamera and RenderSelectedObjects had a chance to run.

**DefaultCamera PiP**: DefaultCamera renders the game-camera view to the WebGL canvas in a
small viewport and copies it to an HTML canvas element. If our composer runs *before* DefaultCamera,
DefaultCamera renders on top of our full-scene output in that small viewport region —
producing the duplicate/ghost image in the main view.

**Selection outline**: `RenderSelectedObjects` pre-renders selected objects to a `WebGLRenderTarget`
texture that the outline shader samples. If our composer runs *before* this pre-render, the
outline shader samples stale texture data from the previous frame — causing the outline to
appear at the object's old screen position when the camera moves.

**Why `before: autoRenderTask` isn't enough**: Studio's DefaultCamera *unmounts and re-mounts*
when the user exits and re-enters editor camera mode. On re-mount it re-registers its task. If
our task was already registered, the new DefaultCamera task ends up AFTER ours in the insertion
order — so our task runs first again, breaking PiP every time the user toggles editor camera.
Any `before: autoRenderTask` approach is fragile against Studio's dynamic task re-registration.

**The stable fix**: Use `after: autoRenderTask` and place `<Renderer />` **first** in `<Canvas>`.

- `after: autoRenderTask` means we *always* run after `before: autoRenderTask` tasks (DefaultCamera,
  RenderSelectedObjects) regardless of when they register or re-register. This is structurally
  guaranteed by the DAG — no insertion-order dependency.
- Placing `<Renderer />` first in Canvas means our task registers before the Gizmo's
  `after: autoRenderTask` task. Since both are `after: autoRenderTask` with no ordering between
  them, Kahn's sort processes them in insertion order — our task runs first, then Gizmo renders
  on top. ✓

```svelte
<!-- ✅ Correct — Renderer first, uses after: autoRenderTask -->
<Canvas>
  <Renderer />   <!-- registers task first, with after: autoRenderTask -->
  <!-- Studio / Scene (registers DefaultCamera, RSO, Gizmo tasks) -->
</Canvas>
```

**Resulting task execution order (stable across all Studio interactions):**

1. DefaultCamera PiP render (`before: autoRenderTask`) → copies to HTML canvas ✓
2. RenderSelectedObjects (`before: autoRenderTask`) → populates selection renderTarget ✓
3. *(autoRenderTask — no-op, stopped)*
4. **Our EffectComposer** (`after: autoRenderTask`, registered first) → samples fresh renderTarget ✓
5. Gizmo (`after: autoRenderTask`, registered after) → renders on top of our output ✓

This order holds even after DefaultCamera re-mounts, because its new task is always
`before: autoRenderTask` — structurally before our `after: autoRenderTask` task.

---

## Bug 4 — OutlineEffect Conflicts with Studio Selection

The `postprocessing` library's `OutlineEffect` conflicts with Studio's own selection outline
system (`RenderSelectedObjects`). Having both active produces visual artifacts.

**Fix:** Remove `OutlineEffect` from the post-processing pipeline entirely. Studio's built-in
yellow outline is sufficient for editor use. The `outline` effect should be removed from
`postprocessing.svelte.ts` defaults and from `PostProcessingExtension.svelte` UI.

---

## autoRender — Correct Pattern

Disable Threlte's built-in render task reactively via `$effect` inside Renderer, **not** via
`autoRender={false}` on `<Canvas>`. Setting it on Canvas affects Studio initialization timing.

```ts
// ✅ Correct — disable inside Renderer via $effect
const { autoRender } = useThrelte()
$effect(() => {
  const before = autoRender.current
  autoRender.set(false)
  return () => autoRender.set(before)
})
```

```svelte
<!-- ❌ Wrong — affects Studio initialization before it mounts -->
<Canvas autoRender={false}>
```

---

## Camera on RenderPass — Reactive Pattern

Pass camera to `setupEffectComposer` inside a `$effect` so it re-runs when Studio switches
between editor camera and game camera:

```ts
// ✅ Camera updates reactively when Studio switches cameras
$effect(() => {
  setupEffectComposer($camera)
})
```

---

## Summary of Rules

| Rule | Reason |
|------|--------|
| Task: `{ after: autoRenderTask, autoInvalidate: false }` | Structurally after DefaultCamera/RSO regardless of re-registration |
| `<Renderer />` first in `<Canvas>` (before Studio) | Task registers before Gizmo → runs before Gizmo among `after:` tasks |
| `$effect` to disable `autoRender`, not Canvas prop | Avoids affecting Studio initialization timing |
| No `OutlineEffect` in post-processing pipeline | Conflicts with Studio's selection outline |
| Camera set reactively via `$effect` on `setupEffectComposer` | Tracks Studio camera switches |
