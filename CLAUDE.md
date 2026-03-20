# Spaceplate — Svelte 5 + Threlte + SpacetimeDB Boilerplate

## Project Overview

Spaceplate is a boilerplate for real-time 3D web apps. It combines:
- **Svelte 5** (runes: `$state`, `$derived`, `$effect`, `.svelte.ts` reactive modules)
- **Threlte** (Three.js for Svelte — `@threlte/core`, `@threlte/extras`)
- **SpacetimeDB** (real-time relational DB with server-side reducers)

## File Structure

```
src/
  App.svelte          — Root: Canvas + SceneHud + Loader siblings; loads Studio extensions
  Root.svelte         — SpacetimeDB provider wrapper (wraps App)
  main.ts             — Entry point
  Scene.svelte        — 3D scene router (inside Canvas, Threlte context)
  SceneHud.svelte     — HTML overlay router (sibling to Canvas)
  module_bindings/    — Generated SpacetimeDB client bindings (do not edit)

  core/
    Camera.svelte     — PerspectiveCamera + AudioListener
    GlobalAudio.svelte — All Audio components + soundTriggers/soundActions exports
    Loader.svelte     — Asset loading screen (useProgress, shown until finishedOnce)
    Renderer.svelte   — Post-processing (25+ effects, quality-gated)
    Skybox.svelte     — Sky + dual-layer stars (state-driven)
    tasks.ts          — Task pipeline: physicsStage, renderStage, uiStage, audioStage

  scenes/
    MainMenu.svelte    — Example 3D scene 1 (inside Canvas)
    MainMenuHud.svelte — HTML overlay for main menu (SpacetimeDB example)
    DemoScene.svelte   — Example 3D scene 2 (inside Canvas)
    DemoSceneHud.svelte — HTML overlay for demo scene
    SettingsHud.svelte — Settings overlay

  extensions/
    scene/
      scene.svelte.ts      — Scene state machine + SCENES config array
      SceneExtension.svelte — Studio toolbar buttons for scene switching
      types.ts
    settings/
      settings.svelte.ts   — Persistent settings state (audio, graphics, general)
      types.ts
    sound/
      soundState.svelte.ts — Positional audio state
      SoundExtension.svelte — Studio extension
      useSound.ts
      types.ts
    skybox/
      skybox.svelte.ts     — Sky/stars presets + animated transitions
      SkyboxExtension.svelte — Studio extension
      types.ts
    postprocessing/
      postprocessing.svelte.ts — 25+ effects state + preset management
      PostProcessingExtension.svelte — Studio extension
      types.ts
      usePostProcessing.ts
    logger/
      logger.svelte.ts     — Multi-channel styled logging
      LoggerExtension.svelte — Studio extension
      types.ts
```

## Architecture Rules

### HUD vs 3D Scene
- **3D content** (meshes, lights, cameras) belongs inside `<Canvas>` — use `Scene.svelte` → scene components
- **HTML overlays** (buttons, panels, forms) cannot live inside Canvas — use `SceneHud.svelte` → HUD components
- HUD components are siblings to Canvas in a `position: relative` wrapper div

### Sound System
- `core/GlobalAudio.svelte` owns all `<Audio>` Threlte components — never unmounts (no race conditions)
- `soundTriggers` and `soundActions` are exported from `<script module>` in `GlobalAudio.svelte` — shared singleton
- Import: `import { soundActions } from '../core/GlobalAudio.svelte'`
- `soundActions.playSwoosh()` — polyphonic (clone per call → overlapping instances)
- `soundActions.playClick()` — one-shot (stop+restart)
- `$state.raw<ThreeAudio>()` — prevents Svelte 5 Proxy wrapping THREE.js class instances

### Scene State Machine (`extensions/scene/scene.svelte.ts`)
- Scenes defined in `SCENES: SceneConfig[]` — each entry has `id`, `label`, `icon`
- Adding a new scene = one new entry in `SCENES` (+ add its `id` to `SceneType`)
- `sceneActions.setScene(scene)` transitions scene (plays swoosh, logs)
- Convenience: `sceneActions.goToMainMenu()` / `goToDemoScene()` / `goBack()`
- Read current scene via `sceneState.currentScene`
- `sceneState.isTransitioning` — set during animated transitions (`sceneActions.transitionTo`)

### Task Pipeline (`core/tasks.ts`)
- Four ordered stages per frame: `physicsStage` (BEFORE render) → `renderStage` (default) → `uiStage` (AFTER) → `audioStage` (AFTER ui)
- `useGameTasks()` returns `{ stages, createPhysicsTask, createUiTask, createAudioTask }`
- `physicsStage` only active in DemoScene; `uiStage` paused during transitions; `audioStage` always runs
- Use tasks instead of raw `useTask` to ensure correct execution order

### Skybox System (`extensions/skybox/skybox.svelte.ts`)
- **Sky presets**: 11 time-of-day options (dawn, day, dusk, night, sunset, sunrise, cloudy, overcast, aurora, vacuum)
- **Star presets**: 5 configurations (dense, sparse, twinkle, nebula, milkyway) — each sky preset embeds a star preset
- `skyboxActions.applyPreset(id)` — instant or animated transition via `requestAnimationFrame`
- Individual setters: `setTurbidity`, `setAzimuth`, `setElevation`, etc.
- `skyboxState` / `starsState` / `transitionState` — all reactive, drive `core/Skybox.svelte`

### Post-Processing System (`extensions/postprocessing/postprocessing.svelte.ts`)
- 25+ effects: SMAA, FXAA, Bloom, Tone Mapping, God Rays, SSAO, Chromatic Aberration, Lens Distortion, Glitch, ASCII, Pixelation, Outline, Depth of Field, and more
- All effects disabled when `graphics.quality === 'low'` (render pass only)
- `postprocessingActions.savePreset(name)` / `loadPreset(id)` / `deletePreset(id)` — persisted to localStorage
- `postprocessingActions.resetAll()` / `resetEffect(name)` — restore defaults

### Extensions System (`src/extensions/`)

**Core principle:** State in `.svelte.ts` modules is always reactive and works everywhere — in production, in components, in hooks. Threlte Studio is a **dev-only editor** (`VITE_GAME_ENGINE=true`) that provides a UI panel to tweak that same state at runtime. Never put logic in `*Extension.svelte` files — only UI.

#### Extension folder structure

```
extensions/my-feature/
  types.ts                 — extensionScope constant + all types
  myFeature.svelte.ts      — $state + actions (always active, works without Studio)
  MyFeatureExtension.svelte — Studio toolbar UI only (dev mode)
  useMyFeature.ts          — (optional) Studio-aware hook with fallback
```

#### types.ts pattern
```typescript
export const extensionScope = 'my-feature';
export type MyFeatureState = { enabled: boolean; value: number };
export type MyFeatureActions = { setEnabled(v: boolean): void; setValue(v: number): void };
```

#### myFeature.svelte.ts pattern
```typescript
import { logSettings } from '$extensions/logger/logger.svelte';
import type { MyFeatureState, MyFeatureActions } from './types';

export type { MyFeatureState, MyFeatureActions } from './types';

export const myFeatureState = $state<MyFeatureState>({ enabled: true, value: 0.5 });

export const myFeatureActions: MyFeatureActions = {
  setEnabled(v) { myFeatureState.enabled = v; logSettings.info('Enabled:', v); },
  setValue(v)   { myFeatureState.value = v; },
};
```

#### MyFeatureExtension.svelte pattern (Studio UI only)
```svelte
<script lang="ts">
  import { useStudio, ToolbarItem, DropDownPane } from '@threlte/studio/extend';
  import { Folder, Slider, Checkbox } from 'svelte-tweakpane-ui';
  import { myFeatureState, myFeatureActions } from './myFeature.svelte';
  import { extensionScope } from './types';

  const { createExtension } = useStudio();
  createExtension({ scope: extensionScope, state: () => ({}) });
</script>

<ToolbarItem position="left">
  <DropDownPane icon="mdiStar" title="My Feature">
    <Folder title="Settings" expanded={true}>
      <Checkbox label="Enabled" value={myFeatureState.enabled}
        on:change={() => myFeatureActions.setEnabled(!myFeatureState.enabled)} />
      <Slider label="Value" value={myFeatureState.value} min={0} max={1} step={0.01}
        on:change={(e) => myFeatureActions.setValue(e.detail.value)} />
    </Folder>
  </DropDownPane>
</ToolbarItem>

<slot />
```

**`ToolbarButton` uses `onclick` prop (Svelte 5), NOT `on:click`** — using `on:click` silently does nothing.

#### useX.ts fallback hook pattern (for Studio-aware access)
```typescript
import { useStudio } from '@threlte/studio/extend';
import { myFeatureState, myFeatureActions } from './myFeature.svelte';
import { extensionScope } from './types';

export const useMyFeature = () => {
  try {
    const { useExtension } = useStudio();
    return useExtension(extensionScope);
  } catch {
    return { state: myFeatureState, ...myFeatureActions };
  }
};
```

#### Registering extensions in App.svelte
```svelte
{#await import('@threlte/studio') then { Studio }}
  <Studio extensions={[SceneExtension, LoggerExtension, PostProcessingExtension, SoundExtension, SkyboxExtension]}>
    <!-- app content -->
  </Studio>
{/await}
```

#### Existing extensions and their exports

| Extension | State export | Actions export | Has Studio UI |
|-----------|-------------|----------------|---------------|
| `scene` | `sceneState` | `sceneActions` | `SceneExtension.svelte` |
| `settings` | `settingsState` | `audioActions`, `graphicsActions`, `generalActions` | none (state-only) |
| `logger` | `loggerState` | `toggleChannel(ch)` | `LoggerExtension.svelte` |
| `postprocessing` | `postprocessingState`, `postprocessingPresetsState` | `postprocessingActions` | `PostProcessingExtension.svelte` |
| `skybox` | `skyboxState`, `starsState`, `transitionState` | `skyboxActions` | `SkyboxExtension.svelte` |
| `sound` | `soundState` | (via `settingsState.audio`) | `SoundExtension.svelte` |

**Logger named exports:** `logEngine`, `logSettings`, `logSound`, `logPostprocessing`, `logSkybox`
```typescript
import { logEngine, logSettings } from '$extensions/logger/logger.svelte';
logEngine.info('Scene:', scene);   // console.log
logSettings.warn('Bad value');     // console.warn
logEngine.error('Failed:', err);   // console.error
```

#### Common patterns

**localStorage persistence** — write inside actions, not `$effect`:
```typescript
const MY_KEY = 'my-key';
export const myState = $state({ value: parseFloat(localStorage.getItem(MY_KEY) ?? '0.5') });
export const myActions = {
  setValue(v: number) { myState.value = v; localStorage.setItem(MY_KEY, String(v)); }
};
```

**Audio defaults must be `false`** — browser autoplay policy requires audio to start disabled:
```typescript
musicEnabled: false,  // Always off by default — never true
sfxEnabled: false,
ambienceEnabled: false,
```

**Use `on:change` not `bind:` for toggles** — `bind:` bypasses actions:
```svelte
<!-- ❌ Bypasses actions -->
<Checkbox bind:value={state.enabled} />
<!-- ✅ Triggers action -->
<Checkbox value={state.enabled} on:change={() => actions.toggleEnabled()} />
```

**Cross-extension state access** — import directly, no wrappers needed:
```typescript
import { settingsState } from '$extensions/settings/settings.svelte';
// Read or mutate directly — runes are reactive across modules
settingsState.audio.sfxVolume = 0.8;
```

**Post-processing effect disposal** — track `isUpdatingEffects` to prevent render mid-rebuild:
```typescript
let isUpdatingEffects = false;
$effect(() => {
  isUpdatingEffects = true;
  disposeAllEffects();
  // rebuild...
  isUpdatingEffects = false;
});
useTask((delta) => { if (composer && !isUpdatingEffects) composer.render(delta); });
```

#### UI components (`svelte-tweakpane-ui`)
| Component | Use case |
|-----------|----------|
| `Checkbox` | Boolean toggles — use `on:change` |
| `Slider` | Numeric values — `min/max/step` props |
| `Button` | Actions — `on:click` |
| `Folder` | Group related controls — `expanded={true}` |
| `DropDownPane` | Main extension panel in toolbar |
| `List` | Select from options — `options={[{value, text}]}` |
| `Separator` | Visual divider |

### Settings (`extensions/settings/settings.svelte.ts`)
- All settings persist to localStorage automatically
- Audio: `musicVolume/musicEnabled`, `ambienceVolume/ambienceEnabled`, `sfxVolume/sfxEnabled`, `effectsVolume`
- Graphics: `quality` (`"low"` | `"high"`) — affects DPR and whether post-processing runs
- General: `uiVisible` (toggled with `Ctrl+H`)
- Actions: `audioActions.toggleMusic/Ambience/Sfx()`, `setMusicVolume(v)`, `graphicsActions.setQuality(q)`, `generalActions.toggleUiVisible()`
- **`BASE_URL`** — always import and use this for static asset paths; never hardcode `/` or relative paths
  ```ts
  import { BASE_URL } from '$extensions/settings/settings.svelte';
  const src = `${BASE_URL}sounds/click.mp3`;
  ```

### SpacetimeDB Client
- Connection is set up in `Root.svelte` via `DbConnection.builder()` + `createSpacetimeDBProvider`
- Module bindings are in `src/module_bindings/` — regenerate with `pnpm spacetime:generate`
- Use `useTable(tables.x)` from `spacetimedb/svelte` — returns `[rows, isLoading]`
- SpacetimeDB UI lives in HUD components (HTML), not 3D scene components

### Key Svelte 5 Patterns Used
- `$state.raw<T>()` for Three.js class instances (avoids Proxy breakage)
- All extension state lives in `.svelte.ts` modules — exported as `fooState` / `fooActions` singletons
- `transition:fly` on each HUD component's root element — `transition:fade` on the uiVisible wrapper
- Separate `{#if}` blocks (not `{:else if}`) for scene HUD routing — ensures transitions fire on switch

### Debug Logging (`extensions/logger/logger.svelte.ts`)

Styled multi-channel logging with timestamp + color-coded channel prefix.

**Channels:** `engine` (blue), `settings` (green), `sound` (purple), `postprocessing` (yellow), `skybox` (cyan)

```ts
import { logger } from '../extensions/logger/logger.svelte.js';

logger.engine.info('Scene:', scene);   // console.log — general info
logger.sound.warn('Missing asset');    // console.warn — recoverable issues
logger.settings.error('Failed:', err); // console.error — failures
```

**Adding a new channel:**
```ts
// In logger.svelte.ts — add to the channels map with a color
channels.set('game', createChannel('game', '#ff6b6b'));
```

**Where logs are used in the boilerplate:**
- `Root.svelte` — SpacetimeDB connect / disconnect / error
- `Renderer.svelte` — graphics quality applied
- `core/GlobalAudio.svelte` — each audio file loaded
- `Loader.svelte` — all assets finished loading
- `extensions/scene/scene.svelte.ts` — every scene transition (`mainMenu → demoScene`)
- `extensions/settings/settings.svelte.ts` — quality changes, volume changes, HUD toggle
- `extensions/skybox/skybox.svelte.ts` — preset applied

---

# SpacetimeDB Rules (All Languages)

## Migrating from 1.0 to 2.0?

**If you are migrating existing SpacetimeDB 1.0 code to 2.0, apply `spacetimedb-migration-2.0.mdc` first.** It documents breaking changes (reducer callbacks → event tables, `name`→`accessor`, `sender()` method, etc.) and should be considered before other rules.

---

## Language-Specific Rules

| Language | Rule File |
|----------|-----------|
| **TypeScript/React** | `spacetimedb-typescript.mdc` (MANDATORY) |
| **Rust** | `spacetimedb-rust.mdc` (MANDATORY) |
| **C#** | `spacetimedb-csharp.mdc` (MANDATORY) |
| **Migrating 1.0 → 2.0** | `spacetimedb-migration-2.0.mdc` |

---

## Core Concepts

1. **Reducers are transactional** — they do not return data to callers
2. **Reducers must be deterministic** — no filesystem, network, timers, or random
3. **Read data via tables/subscriptions** — not reducer return values
4. **Auto-increment IDs are not sequential** — gaps are normal, don't use for ordering
5. **`ctx.sender` is the authenticated principal** — never trust identity args

---

## Feature Implementation Checklist

When implementing a feature that spans backend and client:

1. **Backend:** Define table(s) to store the data
2. **Backend:** Define reducer(s) to mutate the data
3. **Client:** Subscribe to the table(s)
4. **Client:** Call the reducer(s) from UI — **don't forget this step!**
5. **Client:** Render the data from the table(s)

**Common mistake:** Building backend tables/reducers but forgetting to wire up the client to call them.

---

## Index System

SpacetimeDB automatically creates indexes for:
- Primary key columns
- Columns marked as unique

You can add explicit indexes on non-unique columns for query performance.

**Index names must be unique across your entire module (all tables).** If two tables have indexes with the same declared name → conflict error.

**Schema ↔ Code coupling:**
- Your query code references indexes by name
- If you add/remove/rename an index in the schema, update all code that uses it
- Removing an index without updating queries causes runtime errors

---

## Commands

```bash
# Login to allow remote database deployment e.g. to maincloud
spacetime login

# Start local SpacetimeDB
spacetime start

# Publish module
spacetime publish <db-name> --module-path <module-path>

# Clear and republish
spacetime publish <db-name> --clear-database -y --module-path <module-path>

# Generate client bindings
spacetime generate --lang <lang> --out-dir <out> --module-path <module-path>

# View logs
spacetime logs <db-name>
```

---

## Deployment

- Maincloud is the spacetimedb hosted cloud and the default location for module publishing
- The default server marked by *** in `spacetime server list` should be used when publishing
- If the default server is maincloud you should publish to maincloud
- Publishing to maincloud is free of charge
- When publishing to maincloud the database dashboard will be at the url: https://spacetimedb.com/@<username>/<database-name>
- The database owner can view utilization and performance metrics on the dashboard

---

## Debugging Checklist

1. Is SpacetimeDB server running? (`spacetime start`)
2. Is the module published? (`spacetime publish`)
3. Are client bindings generated? (`spacetime generate`)
4. Check server logs for errors (`spacetime logs <db-name>`)
5. **Is the reducer actually being called from the client?**

---

## Editing Behavior

- Make the smallest change necessary
- Do NOT touch unrelated files, configs, or dependencies
- Do NOT invent new SpacetimeDB APIs — use only what exists in docs or this repo
- Do NOT add restrictions the prompt didn't ask for — if "users can do X", implement X for all users


# SpacetimeDB TypeScript SDK

## ⛔ HALLUCINATED APIs — DO NOT USE

**These APIs DO NOT EXIST. LLMs frequently hallucinate them.**

```typescript
// ❌ WRONG PACKAGE — does not exist
import { SpacetimeDBClient } from "@clockworklabs/spacetimedb-sdk";

// ❌ WRONG — these methods don't exist
SpacetimeDBClient.connect(...);
SpacetimeDBClient.call("reducer_name", [...]);
connection.call("reducer_name", [arg1, arg2]);

// ❌ WRONG — positional reducer arguments
conn.reducers.doSomething("value");  // WRONG!

// ❌ WRONG — static methods on generated types don't exist
User.filterByName('alice');
Message.findById(123n);
tables.user.filter(u => u.name === 'alice');  // No .filter() on tables object!
```

### ✅ CORRECT PATTERNS:

```typescript
// ✅ CORRECT IMPORTS
import { DbConnection, tables } from './module_bindings';  // Generated!
import { SpacetimeDBProvider, useTable, Identity } from 'spacetimedb/react';

// ✅ CORRECT REDUCER CALLS — object syntax, not positional!
conn.reducers.doSomething({ value: 'test' });
conn.reducers.updateItem({ itemId: 1n, newValue: 42 });

// ✅ CORRECT DATA ACCESS — useTable returns [rows, isLoading]
const [items, isLoading] = useTable(tables.item);
```

### ⛔ DO NOT:
- **Invent hooks** like `useItems()`, `useData()` — use `useTable(tables.tableName)`
- **Import from fake packages** — only `spacetimedb`, `spacetimedb/react`, `./module_bindings`

---

## 1) Common Mistakes Table

### Server-side errors

| Wrong | Right | Error |
|-------|-------|-------|
| Missing `package.json` | Create `package.json` | "could not detect language" |
| Missing `tsconfig.json` | Create `tsconfig.json` | "TsconfigNotFound" |
| Entrypoint not at `src/index.ts` | Use `src/index.ts` | Module won't bundle |
| `indexes` in COLUMNS (2nd arg) | `indexes` in OPTIONS (1st arg) | "reading 'tag'" error |
| Index without `algorithm` | `algorithm: 'btree'` | "reading 'tag'" error |
| `filter({ ownerId })` | `filter(ownerId)` | "does not exist in type 'Range'" |
| `.filter()` on unique column | `.find()` on unique column | TypeError |
| `insert({ ...without id })` | `insert({ id: 0n, ... })` | "Property 'id' is missing" |
| `const id = table.insert(...)` | `const row = table.insert(...)` | `.insert()` returns ROW, not ID |
| `.unique()` + explicit index | Just use `.unique()` | "name is used for multiple entities" |
| Index on `.primaryKey()` column | Don't — already indexed | "name is used for multiple entities" |
| Same index name in multiple tables | Prefix with table name | "name is used for multiple entities" |
| `.indexName.filter()` after removing index | Use `.iter()` + manual filter | "Cannot read properties of undefined" |
| Import spacetimedb from index.ts | Import from schema.ts | "Cannot access before initialization" |
| Multi-column index `.filter()` | **⚠️ BROKEN** — use single-column | PANIC or silent empty results |
| `JSON.stringify({ id: row.id })` | Convert BigInt first: `{ id: row.id.toString() }` | "Do not know how to serialize a BigInt" |
| `ScheduleAt.Time(timestamp)` | `ScheduleAt.time(timestamp)` (lowercase) | "ScheduleAt.Time is not a function" |
| `ctx.db.foo.myIndexName.filter()` | Use exact name: `ctx.db.foo.my_index_name.filter()` | "Cannot read properties of undefined" |
| `.iter()` in views | Use index lookups | Severe performance issues (re-evaluates on any change) |
| `ctx.db` in procedures | `ctx.withTx(tx => tx.db...)` | Procedures need explicit transactions |
| `ctx.myTable` in procedure tx | `tx.db.myTable` | Wrong context variable |

### Client-side errors

| Wrong | Right | Error |
|-------|-------|-------|
| `@spacetimedb/sdk` | `spacetimedb` | 404 / missing subpath |
| `conn.reducers.foo("val")` | `conn.reducers.foo({ param: "val" })` | Wrong reducer syntax |
| Inline `connectionBuilder` | `useMemo(() => ..., [])` | Reconnects every render |
| `const rows = useTable(table)` | `const [rows, isLoading] = useTable(table)` | Tuple destructuring |
| Optimistic UI updates | Let subscriptions drive state | Desync issues |
| `<SpacetimeDBProvider builder={...}>` | `connectionBuilder={...}` | Wrong prop name |

---

## 2) Table Definition (CRITICAL)

**`table()` takes TWO arguments: `table(OPTIONS, COLUMNS)`**

```typescript
import { schema, table, t } from 'spacetimedb/server';

// ❌ WRONG — indexes in COLUMNS causes "reading 'tag'" error
export const Task = table({ name: 'task' }, {
  id: t.u64().primaryKey().autoInc(),
  ownerId: t.identity(),
  indexes: [{ name: 'by_owner', algorithm: 'btree', columns: ['ownerId'] }]  // ❌ WRONG!
});

// ✅ RIGHT — indexes in OPTIONS (first argument)
export const Task = table({ 
  name: 'task',
  public: true,
  indexes: [{ name: 'by_owner', algorithm: 'btree', columns: ['ownerId'] }]
}, {
  id: t.u64().primaryKey().autoInc(),
  ownerId: t.identity(),
  title: t.string(),
  createdAt: t.timestamp(),
});
```

### Column types
```typescript
t.identity()           // User identity (primary key for per-user tables)
t.u64()                // Unsigned 64-bit integer (use for IDs)
t.string()             // Text
t.bool()               // Boolean
t.timestamp()          // Timestamp (use ctx.timestamp for current time)
t.scheduleAt()         // For scheduled tables only

// Product types (nested objects) — use t.object, NOT t.struct
const Point = t.object('Point', { x: t.i32(), y: t.i32() });

// Sum types (tagged unions) — use t.enum, NOT t.sum
const Shape = t.enum('Shape', { circle: t.i32(), rectangle: Point });
// Values use { tag: 'circle', value: 10 } or { tag: 'rectangle', value: { x: 1, y: 2 } }

// Modifiers
t.string().optional()           // Nullable
t.u64().primaryKey()            // Primary key
t.u64().primaryKey().autoInc()  // Auto-increment primary key
```

> ⚠️ **BIGINT SYNTAX:** All `u64`, `i64`, and ID fields use JavaScript BigInt.
> - Literals: `0n`, `1n`, `100n` (NOT `0`, `1`, `100`)
> - Comparisons: `row.id === 5n` (NOT `row.id === 5`)
> - Arithmetic: `row.count + 1n` (NOT `row.count + 1`)

### Auto-increment placeholder
```typescript
// ✅ MUST provide 0n placeholder for auto-inc fields
ctx.db.task.insert({ id: 0n, ownerId: ctx.sender, title: 'New', createdAt: ctx.timestamp });
```

### Insert returns ROW, not ID
```typescript
// ❌ WRONG
const id = ctx.db.task.insert({ ... });

// ✅ RIGHT
const row = ctx.db.task.insert({ ... });
const newId = row.id;  // Extract .id from returned row
```

### Schema export (CRITICAL)
```typescript
// At end of schema.ts — schema() takes exactly ONE argument: an object
const spacetimedb = schema({ table1, table2, table3 });
export default spacetimedb;

// ❌ WRONG — never pass tables directly or as multiple args
schema(myTable);      // WRONG!
schema(t1, t2, t3);   // WRONG!
```

---

## 3) Index Access

### TypeScript Query Patterns

```typescript
// 1. PRIMARY KEY — use .pkColumn.find()
const user = ctx.db.user.identity.find(ctx.sender);
const msg = ctx.db.message.id.find(messageId);

// 2. EXPLICIT INDEX — use .indexName.filter(value)
const msgs = [...ctx.db.message.message_room_id.filter(roomId)];

// 3. NO INDEX — use .iter() + manual filter
for (const m of ctx.db.roomMember.iter()) {
  if (m.roomId === roomId) { /* ... */ }
}
```

### Index Definition Syntax

```typescript
// In table OPTIONS (first argument), not columns
export const Message = table({ 
  name: 'message',
  public: true,
  indexes: [{ name: 'message_room_id', algorithm: 'btree', columns: ['roomId'] }]
}, {
  id: t.u64().primaryKey().autoInc(),
  roomId: t.u64(),
  // ...
});
```

### Naming conventions

**Table names — automatic transformation:**
- Schema: `table({ name: 'my_messages' })` 
- Access: `ctx.db.myMessages` (automatic snake_case → camelCase)

**Index names — NO transformation, use EXACTLY as defined:**
```typescript
// Schema definition
indexes: [{ name: 'canvas_member_canvas_id', algorithm: 'btree', columns: ['canvasId'] }]

// ❌ WRONG — don't assume camelCase transformation
ctx.db.canvasMember.canvasMember_canvas_id.filter(...)  // WRONG!
ctx.db.canvasMember.canvasMemberCanvasId.filter(...)    // WRONG!

// ✅ RIGHT — use exact name from schema
ctx.db.canvasMember.canvas_member_canvas_id.filter(...)
```

> ⚠️ **Index names are used VERBATIM** — pick a convention (snake_case or camelCase) and stick with it.

**Index naming pattern — use `{tableName}_{columnName}`:**
```typescript
// ✅ GOOD — unique names across entire module
indexes: [{ name: 'message_room_id', algorithm: 'btree', columns: ['roomId'] }]
indexes: [{ name: 'reaction_message_id', algorithm: 'btree', columns: ['messageId'] }]

// ❌ BAD — will collide if multiple tables use same index name
indexes: [{ name: 'by_owner', ... }]  // in Task table
indexes: [{ name: 'by_owner', ... }]  // in Note table — CONFLICT!
```

**Client-side table names:**
- Check generated `module_bindings/index.ts` for exact export names
- Usage: `useTable(tables.MyMessages)` or `tables.myMessages` (varies by SDK version)

### Filter vs Find
```typescript
// Filter takes VALUE directly, not object — returns iterator
const rows = [...ctx.db.task.by_owner.filter(ownerId)];

// Unique columns use .find() — returns single row or undefined
const row = ctx.db.player.identity.find(ctx.sender);
```

### ⚠️ Multi-column indexes are BROKEN
```typescript
// ❌ DON'T — causes PANIC
ctx.db.scores.by_player_level.filter(playerId);

// ✅ DO — use single-column index + manual filter
for (const row of ctx.db.scores.by_player.filter(playerId)) {
  if (row.level === targetLevel) { /* ... */ }
}
```

---

## 4) Reducers

### Definition syntax (CRITICAL)
**Reducer name comes from the export — NOT from a string argument.** Use `reducer(params, fn)` or `reducer(fn)`.

```typescript
import spacetimedb from './schema';
import { t, SenderError } from 'spacetimedb/server';

// ✅ CORRECT — export const name = spacetimedb.reducer(params, fn)
export const reducer_name = spacetimedb.reducer({ param1: t.string(), param2: t.u64() }, (ctx, { param1, param2 }) => {
  // Validation
  if (!param1) throw new SenderError('param1 required');
  
  // Access tables via ctx.db
  const row = ctx.db.myTable.primaryKey.find(param2);
  
  // Mutations
  ctx.db.myTable.insert({ ... });
  ctx.db.myTable.primaryKey.update({ ...row, newField: value });
  ctx.db.myTable.primaryKey.delete(param2);
});

// No params: export const init = spacetimedb.reducer((ctx) => { ... });
```

```typescript
// ❌ WRONG — reducer('name', params, fn) does NOT exist
spacetimedb.reducer('reducer_name', { param1: t.string() }, (ctx, { param1 }) => { ... });
```

### Update pattern (CRITICAL)
```typescript
// ✅ CORRECT — spread existing row, override specific fields
const existing = ctx.db.task.id.find(taskId);
if (!existing) throw new SenderError('Task not found');
ctx.db.task.id.update({ ...existing, title: newTitle, updatedAt: ctx.timestamp });

// ❌ WRONG — partial update nulls out other fields!
ctx.db.task.id.update({ id: taskId, title: newTitle });
```

### Delete pattern
```typescript
// Delete by primary key VALUE (not row object)
ctx.db.task.id.delete(taskId);          // taskId is the u64 value
ctx.db.player.identity.delete(ctx.sender);  // delete by identity
```

### Lifecycle hooks
```typescript
spacetimedb.clientConnected((ctx) => {
  // ctx.sender is the connecting identity
  // Create/update user record, set online status, etc.
});

spacetimedb.clientDisconnected((ctx) => {
  // Clean up: set offline status, remove ephemeral data, etc.
});
```

### Snake_case to camelCase conversion
- Server: `export const do_something = spacetimedb.reducer(...)` — name from export
- Client: `conn.reducers.doSomething({ ... })`

### Object syntax required
```typescript
// ❌ WRONG - positional
conn.reducers.doSomething('value');

// ✅ RIGHT - object
conn.reducers.doSomething({ param: 'value' });
```

---

## 5) Scheduled Tables

```typescript
// 1. Define table first (scheduled: () => reducer — pass the exported reducer)
export const CleanupJob = table({ 
  name: 'cleanup_job', 
  scheduled: () => run_cleanup  // reducer defined below
}, {
  scheduledId: t.u64().primaryKey().autoInc(),
  scheduledAt: t.scheduleAt(),
  targetId: t.u64(),  // Your custom data
});

// 2. Define scheduled reducer (receives full row as arg)
export const run_cleanup = spacetimedb.reducer({ arg: CleanupJob.rowType }, (ctx, { arg }) => {
  // arg.scheduledId, arg.targetId available
  // Row is auto-deleted after reducer completes
});

// Schedule a job
import { ScheduleAt } from 'spacetimedb';
const futureTime = ctx.timestamp.microsSinceUnixEpoch + 60_000_000n; // 60 seconds
ctx.db.cleanupJob.insert({ 
  scheduledId: 0n, 
  scheduledAt: ScheduleAt.time(futureTime),
  targetId: someId 
});

// Cancel a job by deleting the row
ctx.db.cleanupJob.scheduledId.delete(jobId);
```

---

## 6) Timestamps

### Server-side
```typescript
import { Timestamp, ScheduleAt } from 'spacetimedb';

// Current time
ctx.db.item.insert({ id: 0n, createdAt: ctx.timestamp });

// Future time (add microseconds)
const future = ctx.timestamp.microsSinceUnixEpoch + 300_000_000n;  // 5 minutes
```

### Client-side (CRITICAL)
**Timestamps are objects, not numbers:**
```typescript
// ❌ WRONG
const date = new Date(row.createdAt);
const date = new Date(Number(row.createdAt / 1000n));

// ✅ RIGHT
const date = new Date(Number(row.createdAt.microsSinceUnixEpoch / 1000n));
```

### ScheduleAt on client
```typescript
// ScheduleAt is a tagged union
if (scheduleAt.tag === 'Time') {
  const date = new Date(Number(scheduleAt.value.microsSinceUnixEpoch / 1000n));
}
```

---

## 7) Data Visibility & Subscriptions

**`public: true` exposes ALL rows to ALL clients.**

| Scenario | Pattern |
|----------|---------|
| Everyone sees all rows | `public: true` |
| Users see only their data | Private table + filtered subscription |

### Subscription patterns (client-side)
```typescript
// Subscribe to ALL public tables (simplest)
conn.subscriptionBuilder().subscribeToAll();

// Subscribe to specific tables with SQL
conn.subscriptionBuilder().subscribe([
  'SELECT * FROM message',
  'SELECT * FROM room WHERE is_public = true',
]);

// Handle subscription lifecycle
conn.subscriptionBuilder()
  .onApplied(() => console.log('Initial data loaded'))
  .onError((e) => console.error('Subscription failed:', e))
  .subscribeToAll();
```

### Private table + view pattern (RECOMMENDED)

**Views are the recommended approach** for controlling data visibility. They provide:
- Server-side filtering (reduces network traffic)
- Real-time updates when underlying data changes
- Full control over what data clients can access

> ⚠️ **Do NOT use Row Level Security (RLS)** — it is deprecated.

> ⚠️ **CRITICAL:** Procedural views (views that compute results in code) can ONLY access data via index lookups, NOT `.iter()`.
> If you need a view that scans/filters across many rows (including the entire table), return a **query** built with the query builder (`ctx.from...`).

```typescript
// Private table with index on ownerId
export const PrivateData = table(
  { name: 'private_data',
    indexes: [{ name: 'by_owner', algorithm: 'btree', columns: ['ownerId'] }]
  },
  {
    id: t.u64().primaryKey().autoInc(),
    ownerId: t.identity(),
    secret: t.string()
  }
);

// ❌ BAD — .iter() causes performance issues (re-evaluates on ANY row change)
spacetimedb.view(
  { name: 'my_data_slow', public: true },
  t.array(PrivateData.rowType),
  (ctx) => [...ctx.db.privateData.iter()]  // Works but VERY slow at scale
);

// ✅ GOOD — index lookup enables targeted invalidation
spacetimedb.view(
  { name: 'my_data', public: true },
  t.array(PrivateData.rowType),
  (ctx) => [...ctx.db.privateData.by_owner.filter(ctx.sender)]
);
```

### Query builder view pattern (can scan)

```typescript
// Query-builder views return a query; the SQL engine maintains the result incrementally.
// This can scan the whole table if needed (e.g. leaderboard-style queries).
spacetimedb.anonymousView(
  { name: 'top_players', public: true },
  t.array(Player.rowType),
  (ctx) =>
    ctx.from.player
      .where(p => p.score.gt(1000))
);
```

### ViewContext vs AnonymousViewContext
```typescript
// ViewContext — has ctx.sender, result varies per user (computed per-subscriber)
spacetimedb.view({ name: 'my_items', public: true }, t.array(Item.rowType), (ctx) => {
  return [...ctx.db.item.by_owner.filter(ctx.sender)];
});

// AnonymousViewContext — no ctx.sender, same result for everyone (shared, better perf)
spacetimedb.anonymousView({ name: 'leaderboard', public: true }, t.array(LeaderboardRow), (ctx) => {
  return [...ctx.db.player.by_score.filter(/* top scores */)];
});
```

**Views require explicit subscription:**
```typescript
conn.subscriptionBuilder().subscribe([
  'SELECT * FROM public_table',
  'SELECT * FROM my_data',  // Views need explicit SQL!
]);
```

---

## 8) React Integration

### Key patterns
```typescript
// Memoize connectionBuilder to prevent reconnects on re-render
const builder = useMemo(() => 
  DbConnection.builder()
    .withUri(SPACETIMEDB_URI)
    .withDatabaseName(MODULE_NAME)
    .withToken(localStorage.getItem('auth_token') || undefined)
    .onConnect(onConnect)
    .onConnectError(onConnectError),
  []  // Empty deps - only create once
);

// useTable returns tuple [rows, isLoading]
const [rows, isLoading] = useTable(tables.myTable);

// Compare identities using toHexString()
const isOwner = row.ownerId.toHexString() === myIdentity.toHexString();
```

---

## 9) Procedures (Beta)

**Procedures are for side effects (HTTP requests, etc.) that reducers can't do.**

⚠️ Procedures are currently in beta. API may change.

### Defining a procedure
**Procedure name comes from the export — NOT from a string argument.** Use `procedure(params, ret, fn)` or `procedure(ret, fn)`.

```typescript
// ✅ CORRECT — export const name = spacetimedb.procedure(params, ret, fn)
export const fetch_external_data = spacetimedb.procedure(
  { url: t.string() },
  t.string(),  // return type
  (ctx, { url }) => {
    const response = ctx.http.fetch(url);
    return response.text();
  }
);
```

### Database access in procedures

⚠️ **CRITICAL: Procedures don't have `ctx.db`. Use `ctx.withTx()` for database access.**

```typescript
spacetimedb.procedure({ url: t.string() }, t.unit(), (ctx, { url }) => {
  // Fetch external data (outside transaction)
  const response = ctx.http.fetch(url);
  const data = response.text();

  // ❌ WRONG — ctx.db doesn't exist in procedures
  ctx.db.myTable.insert({ ... });

  // ✅ RIGHT — use ctx.withTx() for database access
  ctx.withTx(tx => {
    tx.db.myTable.insert({
      id: 0n,
      content: data,
      fetchedAt: tx.timestamp,
      fetchedBy: tx.sender,
    });
  });

  return {};
});
```

### Key differences from reducers
| Reducers | Procedures |
|----------|------------|
| `ctx.db` available directly | Must use `ctx.withTx(tx => tx.db...)` |
| Automatic transaction | Manual transaction management |
| No HTTP/network | `ctx.http.fetch()` available |
| No return values to caller | Can return data to caller |

---

## 10) Project Structure

### Server (`backend/spacetimedb/`)
```
src/schema.ts   → Tables, export spacetimedb
src/index.ts    → Reducers, lifecycle, import schema
package.json    → { "type": "module", "dependencies": { "spacetimedb": "^1.11.0" } }
tsconfig.json   → Standard config
```

### Avoiding circular imports
```
schema.ts → defines tables AND exports spacetimedb
index.ts  → imports spacetimedb from ./schema, defines reducers
```

### Client (`client/`)
```
src/module_bindings/ → Generated (spacetime generate)
src/main.tsx         → Provider, connection setup
src/App.tsx          → UI components
src/config.ts        → MODULE_NAME, SPACETIMEDB_URI
```

---

## 11) Commands

```bash
# Start local server
spacetime start

# Publish module
spacetime publish <module-name> --module-path <backend-dir>

# Clear database and republish
spacetime publish <module-name> --clear-database -y --module-path <backend-dir>

# Generate bindings
spacetime generate --lang typescript --out-dir <client>/src/module_bindings --module-path <backend-dir>

# View logs
spacetime logs <module-name>
```

---

## 12) Hard Requirements

**TypeScript-specific:**

1. **`schema({ table })`** — takes exactly one object; never `schema(table)` or `schema(t1, t2, t3)`
2. **Reducer/procedure names from exports** — `export const name = spacetimedb.reducer(params, fn)`; never `reducer('name', ...)`
3. **Reducer calls use object syntax** — `{ param: 'value' }` not positional args
4. **Import `DbConnection` from `./module_bindings`** — not from `spacetimedb`
5. **DO NOT edit generated bindings** — regenerate with `spacetime generate`
6. **Indexes go in OPTIONS (1st arg)** — not in COLUMNS (2nd arg) of `table()`
7. **Use BigInt for u64/i64 fields** — `0n`, `1n`, not `0`, `1`
8. **Reducers are transactional** — they do not return data
9. **Reducers must be deterministic** — no filesystem, network, timers, random
10. **Views should use index lookups** — `.iter()` causes severe performance issues
11. **Procedures need `ctx.withTx()`** — `ctx.db` doesn't exist in procedures
12. **Sum type values** — use `{ tag: 'variant', value: payload }` not `{ variant: payload }`
