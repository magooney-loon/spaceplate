# Name Plugin

## Goal

Provide a small Threlte plugin that makes Studio hierarchy names easier to control without modifying Threlte Studio internals.

The plugin should let us assign readable names to scene objects from normal `<T>` usage and have those names show up in the Studio hierarchy automatically via `object.name`.

## Why

Right now the hierarchy tree label is driven by `THREE.Object3D.name`.

That means:

- if an object has a good `name`, Studio already shows it
- if it has no `name`, the hierarchy falls back to generic object types
- physics wrappers and helper objects can make the tree harder to read

We do not need to patch Studio just to improve labels. We only need a reliable way to set `object.name`.

## Proposed Approach

Use `injectPlugin` from `@threlte/core` to create a naming plugin that runs on descendant `<T>` components.

The plugin should:

- accept one custom prop for naming, likely `studioName`
- write that value into `args.ref.name`
- update reactively if the prop changes
- leave normal Three/Threlte behavior alone otherwise

Studio will then pick up the updated `object.name` automatically.

## Proposed API

### Plugin prop

Use a single custom prop:

- `studioName?: string`

Example intended usage:

```svelte
<T.Group studioName="Player Spawn">
	...
</T.Group>
```

This should result in:

```ts
ref.name === 'Player Spawn'
```

### Optional future prop

If needed later, we can add:

- `studioNamePrefix?: string`
- `autoName?: boolean`

But the first version should stay minimal and only support explicit naming.

## Behavior Rules

### Explicit wins

If `studioName` is provided, it should overwrite `ref.name`.

### Empty values

If `studioName` is `undefined`, do nothing.

If `studioName` is an empty string, decide one of:

- treat as "clear the name"
- treat as "ignore"

Recommended first version:

- `undefined` means ignore
- `''` means clear `ref.name`

This is predictable and easy to reason about.

### Reactive updates

If `studioName` changes, `ref.name` should update too.

### Scope

The plugin should only affect the subtree where it is injected.

That keeps naming local and avoids surprising changes elsewhere in the scene graph.

## Where It Helps

This plugin is a good fit for:

- `T.Group`
- `T.Mesh`
- `T.Object3D`
- imported root scene objects rendered with `<T is={...}>`

## Limits

This will not automatically rename every child node inside a GLTF just because the root is rendered through `<T is={$gltf.scene}>`.

Why:

- the plugin runs on Threlte `<T>` instances
- internal GLTF child nodes are regular Three.js descendants, not separate `<T>` declarations

So first version behavior should be:

- rename the object bound to the current `<T>`
- do not traverse descendants

If we ever want recursive GLTF child renaming, that should be a separate feature with its own rules.

## Recommended First Version

Keep v1 as small as possible:

- plugin name: something clear like `studio-name`
- one prop: `studioName`
- one job: set `ref.name`
- no Studio patching
- no recursive traversal
- no fallback auto-generated names

## Open Questions

1. Plugin prop name:
   `studioName` is explicit, but `name` is shorter. `studioName` is safer because it avoids ambiguity with native object props.

2. Injection location:
   Should this be injected once near the root canvas, or wrapped in a reusable helper component for targeted subtrees?

3. Naming conventions:
   Do we want plain labels like `Player Spawn`, or scoped labels like `Gameplay / Player Spawn`?

## Recommendation

Build the plugin around `studioName`, not `name`.

Reason:

- avoids collisions with existing props and expectations
- makes intent obvious
- keeps migration low-risk

Once that exists, we can use it anywhere we want better hierarchy labels without depending on Studio internals.
