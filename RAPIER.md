# Rapier Physics — Spaceplate Integration Guide

Physics via `@threlte/rapier` (Rust WASM, deterministic, fast).

## Installation

```bash
npm install @threlte/rapier @dimforge/rapier3d-compat
```

---

## Setup

Wrap any scene that needs physics in `<World>`. Everything physics-related must be a child of it.

```svelte
<!-- src/scenes/PhysicsScene.svelte -->
<script lang="ts">
  import { World } from '@threlte/rapier'
  import GameObjects from './GameObjects.svelte'
</script>

<World gravity={{ y: -9.81 }}>
  <GameObjects />
</World>
```

**In Spaceplate:** add `<World>` inside the scene component (e.g. `DemoScene.svelte`), NOT in `Scene.svelte` or `App.svelte` — only scenes that need physics should pay the cost.

### WASM fallback

```svelte
<World gravity={{ y: -9.81 }}>
  <GameObjects />
  {#snippet fallback()}
    <!-- shown if WASM fails to load -->
    <FallbackScene />
  {/snippet}
</World>
```

---

## Core Components

### `<RigidBody>`

The simulated physics body. Attach colliders as children to give it shape.

```svelte
<RigidBody type="dynamic">
  <Collider shape="cuboid" args={[0.5, 0.5, 0.5]} />
  <T.Mesh>
    <T.BoxGeometry />
    <T.MeshStandardMaterial />
  </T.Mesh>
</RigidBody>
```

**Types:**
| Type | Behaviour |
|------|-----------|
| `dynamic` (default) | Fully simulated — affected by forces and collisions |
| `fixed` | Never moves — terrain, walls, floors |
| `kinematicPosition` | You set position each frame, physics reacts to it |
| `kinematicVelocity` | You set velocity each frame |

**Key props:**
```svelte
<RigidBody
  type="dynamic"
  gravityScale={1}
  linearDamping={0.1}
  angularDamping={0.1}
  ccd={false}          <!-- Continuous collision detection — enable for fast objects -->
  canSleep={true}
  lockRotations={false}
  lockTranslations={false}
  dominance={0}
  userData={{ id: 'player' }}
  on:collisionenter={({ detail }) => handleHit(detail)}
  on:sleep={() => console.log('sleeping')}
/>
```

**Binding:**
```svelte
<script>
  import type { RigidBody as RapierRigidBody } from '@dimforge/rapier3d-compat'
  let rb = $state.raw<RapierRigidBody>()
</script>

<RigidBody bind:rigidBody={rb}>
  ...
</RigidBody>
```

---

### `<Collider>`

Defines the collision shape of a rigid body.

```svelte
<!-- Must be a child of <RigidBody> -->
<RigidBody>
  <Collider shape="cuboid" args={[0.5, 0.5, 0.5]} />
</RigidBody>

<!-- Standalone fixed collider (floor) -->
<Collider shape="cuboid" args={[10, 0.1, 10]} />
```

**Shapes and their `args`:**
| Shape | Args |
|-------|------|
| `ball` | `[radius]` |
| `cuboid` | `[halfX, halfY, halfZ]` |
| `capsule` | `[halfHeight, radius]` |
| `cylinder` | `[halfHeight, radius]` |
| `cone` | `[halfHeight, radius]` |
| `trimesh` | `[vertices, indices]` — exact mesh, non-convex, expensive |
| `convexHull` | `[points]` — convex wrap, cheaper than trimesh |
| `heightfield` | `[nrows, ncols, heights, scale]` — terrain |

**Material props:**
```svelte
<Collider
  shape="cuboid"
  args={[0.5, 0.5, 0.5]}
  friction={0.5}
  restitution={0.3}       <!-- bounciness -->
  mass={1}
  sensor={false}          <!-- sensor = detect but don't block -->
/>
```

**Events:**
```svelte
<Collider
  shape="cuboid"
  args={[1, 1, 1]}
  on:collisionenter={({ detail: { targetCollider, targetRigidBody } }) => {}}
  on:collisionexit={({ detail }) => {}}
  on:sensorenter={({ detail }) => {}}   <!-- only fires if sensor=true -->
  on:sensorexit={({ detail }) => {}}
/>
```

---

### `<AutoColliders>`

Generates colliders automatically from child mesh geometry. Best for imported 3D models.

```svelte
<RigidBody>
  <AutoColliders shape="convexHull">
    <T.Mesh geometry={importedGeometry} material={material} />
  </AutoColliders>
</RigidBody>
```

**Shape options:** `cuboid` | `ball` | `capsule` | `trimesh` | `convexHull` (default)

**Refresh after geometry change:**
```svelte
<script>
  let autoColliders: { refresh: () => void }
</script>
<AutoColliders bind:this={autoColliders} shape="convexHull">
  ...
</AutoColliders>
<!-- call autoColliders.refresh() when geometry updates -->
```

---

### `<CollisionGroups>`

Controls which bodies interact with which. All collider children inherit the groups.

```svelte
<!-- Player (group 1) collides with world (group 2) but not other players (group 3) -->
<CollisionGroups memberships={[1]} filter={[2]}>
  <RigidBody>
    <Collider shape="cuboid" args={[0.5, 1, 0.5]} />
  </RigidBody>
</CollisionGroups>

<!-- World geometry — collides with everything -->
<CollisionGroups memberships={[2]} filter={[1, 2, 3]}>
  <Collider shape="cuboid" args={[10, 0.1, 10]} />
</CollisionGroups>
```

Shorthand `groups` sets both `memberships` and `filter` to the same value.

---

### `<Attractor>`

Simulates a gravity source. Pulls nearby rigid bodies toward its center.

```svelte
<Attractor
  strength={10}
  range={20}
  gravityType="newtonian"
  gravitationalConstant={6.673e-11}
/>
```

**Gravity types:**
| Type | Formula |
|------|---------|
| `static` (default) | Constant force = `strength` regardless of distance |
| `linear` | Force = `strength * distance / range` — stronger when closer |
| `newtonian` | `F = G * m1 * m2 / r²` — realistic gravity |

---

### `<Debug>`

Renders wireframe overlays of all active colliders. Use during development only.

```svelte
<World>
  <Debug />   <!-- shows all collider shapes as wireframes -->
  ...
</World>
```

---

## Hooks

### `useRapier`

Direct access to the underlying Rapier world.

```ts
import { useRapier } from '@threlte/rapier'

const { world, rapier } = useRapier()

// Change gravity at runtime
world.gravity = { x: 0, y: -20, z: 0 }

// Raycast
const ray = new rapier.Ray({ x: 0, y: 10, z: 0 }, { x: 0, y: -1, z: 0 })
const hit = world.castRay(ray, 100, true)
if (hit) console.log('hit at t =', hit.timeOfImpact)
```

---

### `useRigidBody`

Access the parent `<RigidBody>`'s underlying Rapier body from a child component.

```ts
import { useRapier, useRigidBody } from '@threlte/rapier'

const { world } = useRapier()
const rigidBody = useRigidBody()  // undefined if no parent <RigidBody>

// Apply impulse
rigidBody?.applyImpulse({ x: 0, y: 5, z: 0 }, true)
```

---

### `usePhysicsTask`

Runs a callback every physics step, **before** the world is stepped. Use this instead of `createPhysicsTask` from `tasks.ts` when inside a `<World>` — it automatically slots into the correct simulation stage.

```ts
import { usePhysicsTask } from '@threlte/rapier'

usePhysicsTask((delta) => {
  // Runs before each physics step
  // delta is fixed (e.g. 0.005) if World framerate is fixed
  // delta varies (~0.016) if World framerate is 'varying'
  rigidBody?.applyImpulse({ x: input.x, y: 0, z: input.z }, true)
})
```

> **Note for Spaceplate:** `usePhysicsTask` replaces `createPhysicsTask` for logic that runs *inside* a `<World>`. Use `createPhysicsTask` (from `tasks.ts`) for game logic outside the physics world (AI, non-physics animations, etc.).

---

### `useCollisionGroups`

Apply collision groups programmatically to manually created colliders.

```ts
import { useRapier, useCollisionGroups } from '@threlte/rapier'

const { world } = useRapier()
const { registerColliders, removeColliders } = useCollisionGroups()

const collider = world.createCollider(colliderDesc)
registerColliders([collider])

onDestroy(() => removeColliders([collider]))
```

---

## Joints

Joints constrain the relative motion of two rigid bodies. Use hooks — not components — because a joint acts on two separate bodies which may not share a parent in the component tree.

**All joint hooks return:**
```ts
{
  joint: Writable<JointType>,
  rigidBodyA: Writable<RAPIER.RigidBody>,  // bind: <RigidBody bind:rigidBody={$rigidBodyA}>
  rigidBodyB: Writable<RAPIER.RigidBody>
}
```

### `useFixedJoint` — no relative movement
```ts
const { joint, rigidBodyA, rigidBodyB } = useFixedJoint(
  anchorA,  // Position — anchor on body A
  frameA,   // Rotation — frame on body A
  anchorB,  // Position — anchor on body B
  frameB    // Rotation — frame on body B
)
```

### `useRevoluteJoint` — hinge, rotates around one axis
```ts
const { joint, rigidBodyA, rigidBodyB } = useRevoluteJoint(
  anchorA,          // Position
  anchorB,          // Position
  axis,             // [x, y, z] — axis of rotation
  limits            // [min, max] radians | undefined
)
```

### `usePrismaticJoint` — slides along one axis
```ts
const { joint, rigidBodyA, rigidBodyB } = usePrismaticJoint(
  anchorA,  // Position
  anchorB,  // Position
  axis,     // [x, y, z] — slide direction
  limits    // [min, max] | undefined
)
```

### `useSphericalJoint` — ball-in-socket, free rotation
```ts
const { joint, rigidBodyA, rigidBodyB } = useSphericalJoint(
  anchorA,  // Position
  anchorB   // Position
)
```

### `useRopeJoint` — max distance constraint
```ts
const { joint, rigidBodyA, rigidBodyB } = useRopeJoint(
  anchorA,  // Position
  anchorB,  // Position
  length    // max distance between bodies
)
```

### `useJoint` — custom / low-level
```ts
const { joint, rigidBodyA, rigidBodyB } = useJoint((rbA, rbB, { world, rapier }) => {
  const params = rapier.JointData.revolute(anchorA, anchorB, axis)
  return world.createImpulseJoint(params, rbA, rbB, true)
})
```

---

## Physics Framerate

Set on `<World framerate={...}>`.

| Value | Behaviour |
|-------|-----------|
| `'varying'` (default) | Steps with render delta — not deterministic, simplest |
| `60` / `120` / `200` | Fixed steps per second — deterministic, same result every run |

```svelte
<!-- Deterministic at 200hz — good for competitive games -->
<World framerate={200}>
  ...
</World>
```

With a fixed framerate Threlte runs the physics simulation ahead of rendering by sub-stepping, then interpolates the visual position back to match render time. This gives smooth visuals at any monitor refresh rate while keeping physics deterministic.

---

## Spaceplate Integration Pattern

### Scene with physics

```svelte
<!-- src/scenes/PhysicsScene.svelte -->
<script lang="ts">
  import { World, RigidBody, Collider, Debug } from '@threlte/rapier'
  import { T } from '@threlte/core'
</script>

<World gravity={{ y: -9.81 }}>
  {#if import.meta.env.VITE_GAME_ENGINE === 'true'}
    <Debug />
  {/if}

  <!-- Static floor -->
  <Collider shape="cuboid" args={[20, 0.1, 20]} />

  <!-- Dynamic body -->
  <RigidBody type="dynamic">
    <Collider shape="cuboid" args={[0.5, 0.5, 0.5]} />
    <T.Mesh castShadow>
      <T.BoxGeometry />
      <T.MeshStandardMaterial color="tomato" />
    </T.Mesh>
  </RigidBody>
</World>
```

### Controlling a body from input

```svelte
<script lang="ts">
  import { usePhysicsTask } from '@threlte/rapier'
  import type { RigidBody as RapierRigidBody } from '@dimforge/rapier3d-compat'

  let rb = $state.raw<RapierRigidBody>()
  let inputX = $state(0)
  let inputZ = $state(0)

  usePhysicsTask(() => {
    if (!rb) return
    rb.applyImpulse({ x: inputX * 10, y: 0, z: inputZ * 10 }, true)
  })
</script>

<RigidBody bind:rigidBody={rb} linearDamping={2}>
  <Collider shape="capsule" args={[0.8, 0.3]} />
  <T.Mesh>...</T.Mesh>
</RigidBody>
```

### Sensors / trigger zones

```svelte
<script lang="ts">
  let triggered = $state(false)
</script>

<Collider
  shape="cuboid"
  args={[2, 2, 2]}
  sensor={true}
  on:sensorenter={() => triggered = true}
  on:sensorexit={() => triggered = false}
/>
```

### Ragdoll / articulated character (joints)

```svelte
<script lang="ts">
  import { useRevoluteJoint, RigidBody, Collider } from '@threlte/rapier'

  const { rigidBodyA: torso, rigidBodyB: head } = useRevoluteJoint(
    { x: 0, y: 0.5, z: 0 },   // anchor on torso
    { x: 0, y: -0.2, z: 0 },  // anchor on head
    [0, 0, 1],                 // rotation axis (Z)
    [-0.5, 0.5]                // angle limits in radians
  )
</script>

<RigidBody bind:rigidBody={$torso}>
  <Collider shape="cuboid" args={[0.3, 0.5, 0.2]} />
</RigidBody>

<RigidBody bind:rigidBody={$head}>
  <Collider shape="ball" args={[0.2]} />
</RigidBody>
```

---

## Common Mistakes

| Wrong | Right |
|-------|-------|
| Physics components outside `<World>` | Wrap scene in `<World>` first |
| `useTask` for physics logic inside World | Use `usePhysicsTask` instead |
| Mutating `rigidBody.translation()` directly | Use `rb.setTranslation({ x, y, z }, true)` |
| `trimesh` on dynamic bodies | `trimesh` is for static/fixed only — use `convexHull` on dynamic bodies |
| `bind:rigidBody` with `$state()` | Use `$state.raw<RapierRigidBody>()` — avoids Svelte Proxy wrapping Rapier WASM object |
| `<Debug>` in production | Gate with `import.meta.env.VITE_GAME_ENGINE === 'true'` |
| One `<World>` for entire app | One `<World>` per scene that needs physics — unmount with scene |

---

## physicsStage vs usePhysicsTask

| | `createPhysicsTask` (tasks.ts) | `usePhysicsTask` (@threlte/rapier) |
|---|---|---|
| Requires `<World>` | No | Yes |
| Runs before physics step | No (runs before render) | Yes (guaranteed before world step) |
| Respects fixed framerate | No | Yes |
| Use for | Non-physics game logic, AI, animations | Forces, impulses, kinematic control |
