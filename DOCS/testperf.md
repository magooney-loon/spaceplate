# TestGame Performance — findings, fixes and the remaining queue

The performance reference for `src/scenes/TestGame/`, the driving tech demo.
`DOCS/best-practices.md` is the general rule set (§4 is the one new scene content
must obey) and `DOCS/webgpu-notes.md` is the renderer gotcha list; **this file is
the scene-specific audit** — what the demo actually spends its frame on, what was
fixed, and what is deliberately still open.

Scope note: nothing here is engine architecture. TestGame is scene content
(`src/scenes/TestGame/CLAUDE.md`), and every fix below lives in that directory.

---

## 0. The asset facts everything else follows from

Read straight out of the two GLBs' JSON chunks (accessor counts, node transforms
— no Draco decode needed):

| Asset                             | Meshes | Triangles | Notes                                         |
| --------------------------------- | ------ | --------- | --------------------------------------------- |
| `track.glb` (31 MB)               | 5      | 313 725   | Ground, Asphalt, Decals, Leafs_Mat, **Metal** |
| `2023_toyota_gr86_compressed.glb` | 29     | 324 640   | full interior + engine modelled               |

Per-material, the parts that matter:

```
CITY                          CAR (interior/engine — never in the silhouette)
190 681  60.8%  Metal          30 568  Engine          22 747  Leather
 71 982  22.9%  Leafs_Mat      29 037  Interior_Plastic 21 698  Leather_2
 31 572  10.1%  Decals          5 088  Seat             4 216  Interior_Accents
 19 488   6.2%  Asphalt         1 552  Speaker          + Carpet/Screen/Mirror/Belt
      2   0.0%  Ground         ────────────────────────────────────────────────
                               117 176 tris (36% of the car) across 14 meshes
```

And the geometry that broke the shadow fit — `Metal`'s node is
`scale 5.336, t (-64.5, -1.2, 236.5)` over a mesh spanning `x ∈ [-249, 122]`,
`z ∈ [-68, 249]`, under a City group at `scale 1.5`:

```
Metal, world:  ~2 970 × 2 540 units      caster-bounds centre ≈ (-1086, 25, -118)
car spawn:     (1.46, 8.66, -3.40)       distance from that centre ≈ 1 094 units
```

Hold on to that 1 094 — it is §1.1.

---

## 1. Fixed

### 1.1 The whole city cast shadows, and the car got none (the big one)

**Symptom bucket:** steady-state cost, plus "the car has no shadow".

`TestGame.svelte` set `castShadow = receiveShadow = true` on every mesh in both
GLBs. `SkyLight` (`core/skybox/SkyLight.svelte`) fits its **one** shadow cascade
to the bounding sphere of the visible **casters**, quantised to `shadowRadius`
(20) and capped at `maxShadowRadius` (400). With the city in the caster set:

- the fitted sphere radius was ~1 950 units, so the fit **saturated at 400**, and
- its centre landed on the city's bounds, **~1 094 units from the car**.

±400 around a point 1 094 units away does not contain the car. So the car cast no
shadow, the asphalt received none, and there were **no sun shadows anywhere the
player could drive** — while `light.shadow.needsUpdate` is armed every frame (the
car moves), so all 313 725 city triangles across 5 draw calls were re-rendered
into the 2048² map every frame to produce exactly that.

**Fix** (`TestGame.svelte`): `CITY_CASTS_SHADOWS = false`, plus a
`CAR_NON_CASTERS` set for the car's interior and engine materials. Everything
still _receives_.

|                        | before                      | after                       |
| ---------------------- | --------------------------- | --------------------------- |
| shadow-pass triangles  | 313 725 + 324 640           | 207 464 (car exterior only) |
| shadow-pass draw calls | 34                          | 15                          |
| fitted shadow radius   | 400 (saturated, off-centre) | 20 (the floor, on the car)  |
| shadow texel           | 39 cm                       | **2 cm**                    |
| shadow the player sees | none                        | a sharp one under the car   |

This is the rare change that is a large win on both axes at once. The cost is
building and tree shadows, which were **already not being drawn**. Getting them
back is not a flag flip: one cascade cannot serve a 3 km city and a 4 m car, and
`CSMShadowNode` (`best-practices.md` §2.6) is the honest answer.

### 1.2 Smoke pools were N meshes with N materials — the first-puff hitch

**Symptom bucket:** the reported "first time tyre smoke / exhaust flame is drawn,
big spike".

`TireSmoke` was 32 `THREE.Mesh`es with **32 material instances**; the exhaust
smoke another 16. The design note said identical node graphs share a compiled
program, and that is true — three keys `ProgrammableStage` by generated WGSL
source and the render pipeline by `(vertex id, fragment id, backend state)`
(`three/src/renderers/common/Pipelines.js`, `getForRender`), so 48 identical
graphs collapse to one pipeline. **What does not collapse is everything upstream
of it:**

- each material builds its **own node graph** the first time it renders — a
  main-thread NodeBuilder analyze + WGSL generation, per material, paid on the
  frame that material first becomes visible. A burnout spawns ~40 puffs/s, so 31
  of those builds landed inside the first second of the first slide;
- each mesh is its own draw call, its own bind group, and its own entry in the
  transparent sort.

The existing boot-warm windows made this look solved without being solved: each
warmed **one** slot (`puffs[POOL - 1]`), so 31 of 32 and 15 of 16 builds were
still waiting for the player.

**Fix:** `fx/puffPool.ts` — one mesh, one material, one draw call, the SkidMarks
pattern. `count` quads in a single `BufferGeometry`; positions are world space and
written per frame; per-puff values ride a per-vertex `aPuff` (birth, life,
strength, seed) written once at spawn and aged shader-side against `uTime`.
Billboarding is CPU-side against the camera's right/up basis — the same
arithmetic as the old `quaternion.copy(camera.quaternion)`, minus 48 matrix
compositions and 48 world-matrix updates a frame.

|                                       | before                | after                  |
| ------------------------------------- | --------------------- | ---------------------- |
| first-render node builds              | 48 (31 + 15 unwarmed) | 2, both at scene entry |
| transparent draw calls, burnout + pop | up to 48              | 2                      |
| materials                             | 48                    | 2                      |
| boot-warm machinery                   | two timed windows     | **deleted**            |

The warm windows are gone because they became unnecessary: the pool's mesh is
permanently in the graph, so its one pipeline compiles on the scene's **first
rendered frame**, behind the entry veil, for free. Dead puffs are degenerate
(four verts on a point) rather than hidden, so an idle pool is one draw call and
zero fragments.

_(The flame TIPS still warm — six materials across two tips that are invisible
until the first pop. That window stays.)_

**One accepted difference:** puffs within a pool no longer depth-sort against
each other, because they are one mesh. At these alphas it reads as more stable
(no sort popping as puffs cross), not wrong — the same trade SkidMarks already
makes.

### 1.3 Visual work was running at the physics rate

**Symptom bucket:** steady-state CPU, and a flame-animation pulse.

`CarExhaustFlames` did **everything** in `usePhysicsTask`. Threlte's simulation
stage takes `ceil(accumulator / rate)` substeps per frame
(`@threlte/rapier/lib/createPhysicsStages.js`), so at the 200 Hz the scene ran on
then, against 60 fps, it ran **4/3/3/4/3/3…**. That meant the uniform writes, the tip group
scale, the entire 16-puff transform loop, 16 billboard quaternion copies and an
`invalidate()` were all paid **3–4× per drawn frame** for one frame's worth of
visible change. And `uTime` advanced by the substep TOTAL — 20 ms, 15 ms, 15 ms
on consecutive frames — so the flame's noise animation pulsed on a 20 Hz beat.

**Fix:** split. The **trigger** stays in the physics task, because a limiter
bounce is a rising edge of `carSim.limiting` that can come and go inside one
rendered frame and polling it per frame drops bangs. Everything visual moved to a
`{ before: autoRenderTask }` task — the render stage, after Rapier's
synchronization, so the tips are scaled and the puffs billboarded against the
pose and camera that are about to be drawn.

### 1.4 The wheels stuttered against their own car

**Symptom bucket:** the reported "only the actual car stutters a bit".

`CarWheels` integrated `uRoll` in a `usePhysicsTask`. By the same 4/3/3 substep
pattern, that advanced the wheels by **20 ms, then 15 ms, then 15 ms** of
rotation on consecutive frames — a **±17% pulse in wheel rotation on a 20 Hz
beat** — while the chassis underneath was being smoothly _interpolated_ to the
frame's own time by Rapier's synchronization stage
(`createPhysicsTasks`, `lastPosition.lerp(currentPosition, offset)`). Body
smooth, wheels pulsing, on the one object the player is staring at.

**Fix:** a `{ before: autoRenderTask }` task using the frame's delta. It also
now owns an `invalidate()` for "the wheels turned", gated on the car actually
moving or steering. The cost is that `carSim` is up to one 5 ms substep old
rather than exactly current — invisible, where the pulse was not.

> **The general rule this scene keeps re-learning:** a physics task is for
> reading and writing simulation state at the simulation's rate. Anything whose
> output is a _pixel_ belongs in a render-stage task, integrated with the frame's
> delta. Physics-time integration of a visual quantity is a stutter generator
> whenever the substep count per frame is not constant — and with `ceil()`
> accumulation it never is.

### 1.5 Skid marks never stopped drawing

`SkidMarks` submits a fixed ring of 8 192 quads / 16 384 triangles with
`frustumCulled = false`, and it did so **every frame, for ever**. An expired mark
is not free: `transparent` + `depthWrite: false` means the quad is still
rasterised and still blended — a _lit_ `MeshStandardNodeMaterial` with two
texture fetches — writing alpha 0 over the road. One slide bought that cost for
the rest of the session.

**Fix:** the mesh leaves the render list once the last mark is past `LIFETIME`
(the task already tracked `lastLay` for its `invalidate()` gate — it now drives
`visible` too), and `setDrawRange` follows the ring until it first wraps, so a
fresh scene submits 0 triangles instead of 16 384 degenerate ones.

### 1.6 Five texture loads for two files

`SkidMarks`, `TireSmoke` and `CarExhaustFlames` each constructed their own
`TextureLoader` for `perlin.png` / `voronoi.png` — five fetches, five GPU
textures, and five `dispose()` calls racing on scene exit.

**Fix:** `fx/noiseTextures.ts`, the scene-local version of the cache
`best-practices.md` §3.3 describes. **Nothing disposes them** — §3.3's own
caveat: a shared texture must never be freed by one consumer's cleanup.

---

## 2. Known and deliberately open

Ranked by (value × how cheap), same as `best-practices.md` §3.

### 2.1 Scene entry is a synchronous stall

`buildCityColliders` walks the 31 MB track GLB, allocates a baked `Float32Array`
per mesh and transforms **313 725 triangles' worth of vertices** in JS, and then
Rapier builds a BVH per trimesh — all on the main thread, all inside one
`$derived`, all while the player waits. This is the entry hitch, and it is
separate from every frame-path item above.

The honest fixes are a worker (`best-practices.md` §3.5 — this is exactly the
"anything that would otherwise produce a visible hitch at scene entry" case it
names) or precomputing the collider arrays offline and shipping them as a binary
next to the GLB. Neither is a small change. **Do not confuse this with the
in-frame stutters**; they have different symptoms — this one is a single freeze
at the loading veil.

Cheaper half-measure available first: `Decals` (31 572 tris, painted flat on the
road) and possibly `Leafs_Mat` (71 982) almost certainly do not need to be
collidable at all. That is a third of the collider build and a third of the
static BVH, for a gameplay question someone has to answer.

### 2.2 The car is 324 640 triangles in 29 draw calls

Twenty-nine meshes, twenty-nine materials, a fully modelled interior and engine
that are only ever seen through tinted glass. §1.1 took them out of the shadow
pass; the main pass still pays for all of it. Options, in order of
value-per-risk: `mergeGeometries` over the meshes that share a material,
distance-based LOD on the interior group, or an interior cull once the chase
camera is beyond some distance. All are look decisions.

### 2.3 `useFollow` pins the render loop at full rate

`@threlte/extras`' `useFollow` calls `invalidate()` unconditionally at the end of
its task whenever it has a target and controls. While TestGame is mounted the
on-demand renderer is therefore always drawing, and every `invalidate()`
discipline elsewhere in the scene buys nothing _in this scene_ (they still
matter — the components are also correct in isolation, and a future scene may not
run a follow rig). This is the same shape as the `<InstancedMesh>` trap in
`best-practices.md` §2.7: an extras component that sets `autoInvalidate: false`
and then invalidates in the body. Worth an upstream issue; not worth patching
locally.

### 2.4 Physics dropped from 200 Hz to 60 — DRIVE-TEST OWED

_(Moved out of §1: the change is made, the numbers are certain, the FEEL is not
yet confirmed. It sits here until someone has driven it.)_

`physicsState.framerate` was 200, so Rapier stepped 3–4× per rendered frame
against the city's static trimesh set and every `usePhysicsTask` ran that many
times. It is now **60** — one step per frame at 60 fps.

**This was never about determinism.** Any fixed number is deterministic; only
`'varying'` is not, and this project has never used it. The Studio panel used to
label 200 as "deterministic" and `'varying'` as "(default)", and both labels were
wrong — fixed now.

**Why it is safe to move at all:** nothing in the sim integrates a per-step
fraction or counts steps. Every damping constant goes through
`damp(rate, dt) = 1 - exp(-rate · dt)` (`sim/carMath.ts`, verified across
`controller.ts` and `drivetrain.ts` — there are no other integration sites), and
every timer is in seconds: the limiter's `limiterCut` (0.05 s), the 0.28 s shift
cut, the nitrous bottle, `publishCarHud`'s 1/30 s. So the tune, the 0-60, the
limiter's bounce cadence and the HUD rate all carry across unchanged **by
construction** rather than by luck.

**What to actually watch on the drive-test**, i.e. the parts that are coarser
rather than equivalent:

- **Kerbs, barriers and the known `Ground`/`Asphalt` 1.1 cm seam lip.** Contact
  resolution and penetration recovery get 3.3× fewer opportunities per second.
  Tunnelling is not the risk (the chassis is ~10.75 units long and moves 2.6
  units/step at the 140 mph governor, and `ccd` is on anyway) — _catching_ is.
- **Launches and wheelspin onset**, where the traction limit is doing the most
  work per step.
- **Limiter overshoot.** The cut arms on `rpm >= limiterRpm`, so a coarser step
  overshoots further before it engages. Bounded by the existing
  `clamp(rpm, idle, limiterRpm + 150)`, but the bounce may read chunkier.

If any of that is worse, the Studio physics panel switches it live (Physics ▸
World ▸ Framerate) — 120 is the middle ground. Nothing else needs changing to go
back.

**Note that this makes §1.3 and §1.4 more important, not less.** The substep
count per frame is `ceil`, so it is never constant at any rate — and at 60 Hz on
a high-refresh display it is **0 or 1**, meaning frames where a physics-time
integration does not advance the visual at all. A 100% pulse where 200 Hz gave a
17% one.

### 2.5 The skid ring is lit, transparent and double-sided

16 384 triangles of `MeshStandardNodeMaterial` with two texture fetches, blended
with `depthWrite: false`, is a heavy fragment shader for what is conceptually a
decal. §1.5 stopped it running when there is nothing to show; it did not make it
cheaper when there is. The material being LIT is load-bearing (see the scene's
`CLAUDE.md` — unlit marks read as chalk after dark), so the lever here is the
ring size (`SEGS_PER_WHEEL`), which is a look decision.

---

## 3. How to measure this scene

The general playbook is `best-practices.md` §6; these are the scene-specific
readings.

1. **Settings ▸ System** (`core/utils/Telemetry.svelte`) — `drawCalls`,
   `triangles`, `programs`. Take a reading while parked, then during a burnout,
   then after a downshift, and diff. `programs` climbing during a burnout is the
   §1.2 disease returning.
2. **Triangles prove instancing worked, draw calls alone do not** — the lesson
   from `best-practices.md` §3.2. The puff pools should move draw calls by +2 and
   triangles by at most `2 × count × 2`, never by `count` draw calls.
3. **Separate the three symptoms before chasing any of them.** They have
   different signatures:
   - _entry freeze_ — one long stall at the veil, §2.1;
   - _first-effect spike_ — a single hitch the first time an effect is drawn in a
     session, and never again. That is pipeline/node-build work (§1.2);
   - _periodic micro-stutter while driving_ — recurring, tied to motion. That is
     frame-path work: substep-integrated visuals (§1.3, §1.4), or fill rate.
4. **A cost that vanishes at low resolution is fill rate**, not CPU
   (`best-practices.md` §3.6's method, which is worth reusing verbatim here):
   drop `settingsState.graphics.renderScale` and see whether the symptom
   survives. If it does, it is on the main thread.
5. **`src/__debug/`** and the headless-Firefox harness (`webgpu-notes.md` §5) for
   anything that needs evidence rather than inference.

---

## 4. Rules for new TestGame content

The scene's own additions to `best-practices.md` §4, each earned above:

- **Visual quantities integrate with the FRAME delta, in a render-stage task.**
  `usePhysicsTask` is for simulation state only. (§1.3, §1.4)
- **A pool is one mesh and one material.** Per-instance variation goes in a
  per-vertex or per-instance attribute, never in a material instance — the draw
  calls are the visible cost and the per-material node build is the invisible
  one. (§1.2)
- **`castShadow` is a decision per mesh, never a traverse-and-set-true.** Ask
  what the mesh contributes to a silhouette, and remember that one oversized
  caster moves the cascade for everything else. (§1.1)
- **A transparent mesh with nothing to show must leave the frame.** Alpha 0 is
  not free. (§1.5)
- **Shared assets are loaded once and disposed never.** (§1.6)
