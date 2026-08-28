# SpacetimeDB Core Concepts

SpacetimeDB is a relational database that is also a server. It lets you upload application logic directly into the database via WebAssembly modules, eliminating the traditional web/game server layer entirely.

> ℹ️ **This file is the general SDK reference** for the module in `spacetimedb/`.
> For project layout, commands, and conventions see the root **[`CLAUDE.md`](../CLAUDE.md)**;
> for the frontend (Threlte scenes, HUD, engine core, extensions) see **[`src/CLAUDE.md`](../src/CLAUDE.md)**.
> CLI commands are in **[`CLI.md`](CLI.md)**.

---

## Critical Rules

1. **Reducers are transactional.** They do not return data to callers. Use subscriptions to read data.
2. **Reducers must be deterministic.** No filesystem, network, timers, or random. All state must come from tables.
3. **Read data via tables/subscriptions**, not reducer return values. Clients get data through subscribed queries.
4. **Auto-increment IDs are not sequential.** Gaps are normal, do not use for ordering. Use timestamps or explicit sequence columns.
5. **`ctx.sender` is the authenticated principal.** Never trust identity passed as arguments.

---

## Feature Implementation Checklist

1. **Backend:** Define table(s) to store the data
2. **Backend:** Define reducer(s) to mutate the data
3. **Client:** Subscribe to the table(s)
4. **Client:** Call the reducer(s) from UI
5. **Client:** Render the data from the table(s)

---

## Debugging Checklist

1. Is SpacetimeDB server running? (`spacetime start`)
2. Is the module published? (`spacetime publish`)
3. Are client bindings generated? (`spacetime generate`)
4. Check server logs for errors (`spacetime logs <db-name>`)
5. Is the reducer actually being called from the client?

---

## Tables

- **Private tables** (default): Only accessible by reducers and the database owner.
- **Public tables**: Exposed for client read access through subscriptions. Writes still require reducers.

Organize data by access pattern, not by entity:

```
Player          PlayerState         PlayerStats
id         <--  player_id           player_id
name            position_x          total_kills
                position_y          total_deaths
                velocity_x          play_time
```

## Reducers

Reducers are transactional functions that modify database state. They run atomically, cannot interact with the outside world, and do not return data to callers. See the language-specific server skills for syntax.

## Event Tables

Event tables broadcast reducer-specific data to clients. Rows are never stored in the client cache (`count()` returns `0n`, `iter()` yields nothing); only `onInsert` callbacks fire.

## Subscriptions

Subscriptions replicate database rows to clients in real-time.

1. **Subscribe**: Register SQL queries describing needed data
2. **Receive initial data**: All matching rows are sent immediately
3. **Receive updates**: Real-time updates when subscribed rows change
4. **React to changes**: Use callbacks (`onInsert`, `onDelete`, `onUpdate`)

Best practices:

- Group subscriptions by lifetime
- Subscribe before unsubscribing when updating subscriptions
- Avoid overlapping queries
- Use indexes for efficient queries

## Modules

Modules are WebAssembly bundles containing application logic that runs inside the database.

- **Tables**: Define the data schema
- **Reducers**: Define callable functions that modify state
- **Event Tables**: Broadcast reducer-specific data to clients
- **Views**: Read-only functions that expose computed subsets of data to clients (can declare a primary key for `onUpdate` events)
- **Procedures**: (Stable as of 2.6.0) Functions that can have side effects (`ctx.http.fetch`, `ctx.withTx`)
- **HTTP handlers / webhooks**: (Unstable) Custom HTTP routes served from module code, exposed under `/v1/database/:name/route/{*path}`

Server-side modules can be written in: TypeScript

Lifecycle: Write → Compile → Publish (`spacetime publish`) → Hot-swap (republish without disconnecting clients)

## Identity

- **Identity**: A long-lived, globally unique identifier for a user.
- **ConnectionId**: Identifies a specific client connection.
- Always use `ctx.sender` / `ctx.Sender` / `ctx.sender()` for authorization.

SpacetimeDB works with many OIDC providers, including SpacetimeAuth (built-in), Auth0, Clerk, Keycloak, Google, and GitHub.

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

## Deployment

- **Develop and test against the local server** (`spacetime start`, `http://127.0.0.1:3000`) —
  publish to maincloud only when you actually mean to deploy
- `pnpm spacetime:publish:local` — publish to local
- `pnpm spacetime:publish:local:fresh` — local publish with `--delete-data` (wipes rows)
- `pnpm spacetime:publish` — publish to maincloud
- `spacetime.json` sets the target database (`spaceplate-j29m7`) and default server (`maincloud`)
- For a quick dev loop: `spacetime dev` (auto-rebuild, auto-publish, generates bindings)
- The root `package.json` scripts are the single source of truth — check there for exact commands

---

## Editing Behavior

- Make the smallest change necessary
- Do NOT touch unrelated files, configs, or dependencies
- Do NOT invent new SpacetimeDB APIs — use only what exists in docs or this repo
- Do NOT add restrictions the prompt didn't ask for — if "users can do X", implement X for all users

See [CLI.md](CLI.md) for all SpacetimeDB CLI commands — project init, build, publish, database interaction, server management, and troubleshooting.

# SpacetimeDB TypeScript SDK Reference

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
import { DbConnection, tables, reducers } from "./module_bindings"; // Generated!
import { useTable, useSpacetimeDB, useReducer } from "spacetimedb/svelte";

// ✅ CORRECT REDUCER CALLS — object syntax, not positional!
conn.reducers.doSomething({ value: "test" });
conn.reducers.updateItem({ itemId: 1n, newValue: 42 });

// ✅ CORRECT DATA ACCESS — useTable returns [rows, isReady]
const [items, isReady] = useTable(tables.item);
```

### ⛔ DO NOT:

- **Invent hooks** like `useItems()`, `useData()` — use `useTable(tables.tableName)`
- **Import from fake packages** — only `spacetimedb`, `spacetimedb/svelte`, `./module_bindings`

---

## Imports

```typescript
import { schema, table, t } from "spacetimedb/server";
import { SenderError } from "spacetimedb/server";
import { ScheduleAt } from "spacetimedb"; // for scheduled tables only
```

## Tables

`table(OPTIONS, COLUMNS)` takes two arguments. The `name` field MUST be snake_case:

```typescript
const entity = table(
  { name: "entity", public: true },
  {
    identity: t.identity().primaryKey(),
    name: t.string(),
    active: t.bool(),
  },
);
```

Options: `name` (snake_case, recommended), `public: true`, `event: true`, `scheduled: (): any => reducerRef`, `indexes: [...]`

`ctx.db` accessors use the table's `name` field **exactly as defined** — snake_case stays snake_case.

## Column Types

| Builder               | JS type      | Notes                                                            |
| --------------------- | ------------ | ---------------------------------------------------------------- |
| `t.u64()`             | bigint       | Use `0n` literals                                                |
| `t.i64()`             | bigint       | Use `0n` literals                                                |
| `t.u128()`            | bigint       |                                                                  |
| `t.i128()`            | bigint       |                                                                  |
| `t.u256()`            | bigint       |                                                                  |
| `t.i256()`            | bigint       |                                                                  |
| `t.u32()` / `t.i32()` | number       |                                                                  |
| `t.u16()` / `t.i16()` | number       |                                                                  |
| `t.u8()` / `t.i8()`   | number       |                                                                  |
| `t.f64()` / `t.f32()` | number       | No `.index()`, `.unique()`, `.primaryKey()`                      |
| `t.number()`          | number       | Alias for `t.f64()`. No `.index()`, `.unique()`, `.primaryKey()` |
| `t.bool()`            | boolean      |                                                                  |
| `t.string()`          | string       |                                                                  |
| `t.identity()`        | Identity     |                                                                  |
| `t.connectionId()`    | ConnectionId |                                                                  |
| `t.timestamp()`       | Timestamp    |                                                                  |
| `t.timeDuration()`    | TimeDuration |                                                                  |
| `t.scheduleAt()`      | ScheduleAt   | No `.index()`, `.unique()`, `.primaryKey()`                      |
| `t.uuid()`            | Uuid         |                                                                  |
| `t.byteArray()`       | Uint8Array   | No `.index()`, `.unique()`, `.primaryKey()`                      |

Modifiers: `.primaryKey()`, `.autoInc()`, `.unique()`, `.index('btree')`

Not all types support all modifiers — see Notes column above. Float (`f32`/`f64`/`number`), `scheduleAt`, and `byteArray` only support `.default()` and `.name()`.

Optional columns: `nickname: t.option(t.string())`

Additional type builders: `t.row({...})` (row builder for generated bindings), `t.unit()` (empty product), `t.lazy(() => ...)` (recursive types), `t.result(ok, err)` (Result type), `t.array(element)` (arrays)

### Auto-increment placeholder

```typescript
// ✅ MUST provide 0n placeholder for auto-inc fields
ctx.db.task.insert({
  id: 0n,
  ownerId: ctx.sender,
  title: "New",
  createdAt: ctx.timestamp,
});
```

### Insert returns ROW, not ID

```typescript
// ❌ WRONG
const id = ctx.db.task.insert({ ... });

// ✅ RIGHT
const row = ctx.db.task.insert({ ... });
const newId = row.id;  // Extract .id from returned row
```

### BigInt syntax

```typescript
// All u64, i64, and ID fields use JavaScript BigInt
// Literals: 0n, 1n, 100n (NOT 0, 1, 100)
// Comparisons: row.id === 5n (NOT row.id === 5)
// Arithmetic: row.count + 1n (NOT row.count + 1)
```

### Schema export (CRITICAL)

```typescript
// At end of schema.ts — schema() takes tables object + optional ModuleSettings
const spacetimedb = schema({ table1, table2, table3 });
// With module settings: schema({ table1, table2 }, { CASE_CONVERSION_POLICY: 'SnakeCase' })
export default spacetimedb;

// ❌ WRONG — never pass tables directly or as multiple args
schema(myTable); // WRONG!
schema(t1, t2, t3); // WRONG!
```

## Indexes

Prefer inline `.index('btree')` for single-column. Use named indexes only for multi-column:

```typescript
// Inline (preferred for single-column):
authorId: t.u64().index('btree'),
// Access: ctx.db.post.authorId.filter(authorId);

// Multi-column (named):
indexes: [{ name: 'membership_by_group_user', accessor: 'by_group_user', algorithm: 'btree', columns: ['groupId', 'userId'] }]
// Access: ctx.db.membership.by_group_user.filter([groupId, userId]);
```

When you frequently look up rows by multiple columns, prefer a multi-column index over filtering by one column and looping over the results. Multi-column filter takes an array matching the index column order. You can omit trailing columns to do a prefix scan.

### Naming conventions

**Table names — different rules on server vs client:**

| Side                     | Reference            | Casing                                   |
| ------------------------ | -------------------- | ---------------------------------------- |
| Server (reducer/view)    | `ctx.db.planet_ship` | **snake_case**, exactly as schema `name` |
| Client (`tables` object) | `tables.planet_ship` | **snake_case**, exactly as schema `name` |
| Client row properties    | `row.planetId`       | always **camelCase**                     |

```typescript
// ✅ SERVER — ctx.db uses snake_case table name (exact match of schema name field)
ctx.db.planet_structure.planet_id.filter(id);

// ✅ CLIENT — tables object also uses snake_case table name, rows use camelCase
useTable(tables.planet_structure); // snake_case!
row.planetId; // camelCase row property
row.ownerIdentity;

// ❌ WRONG on both server and client
ctx.db.planetStructure; // does not exist
useTable(tables.planetStructure); // does not exist — use tables.planet_structure
useTable(tables.constructionTask); // does not exist — use tables.construction_task
```

**Index names — NO transformation, use EXACTLY as defined:**

```typescript
// Schema definition
indexes: [{ name: 'canvas_member_canvas_id', algorithm: 'btree', columns: ['canvasId'] }]

// ❌ WRONG — don't assume camelCase transformation
ctx.db.canvas_member.canvasMemberCanvasId.filter(...)

// ✅ RIGHT — use exact name from schema
ctx.db.canvas_member.canvas_member_canvas_id.filter(...)
```

**Index naming pattern — use `{tableName}_{columnName}`:**

```typescript
// ✅ GOOD — unique names across entire module
indexes: [{ name: 'message_room_id', algorithm: 'btree', columns: ['roomId'] }]
indexes: [{ name: 'reaction_message_id', algorithm: 'btree', columns: ['messageId'] }]

// ❌ BAD — will collide if multiple tables use same index name
indexes: [{ name: 'by_owner', ... }]  // in multiple tables — CONFLICT!
```

### Filter vs Find

```typescript
// Filter takes VALUE directly, not object — returns iterator
const rows = [...ctx.db.task.by_owner.filter(ownerId)];

// Unique columns use .find() — returns single row or undefined
const row = ctx.db.player.identity.find(ctx.sender);
```

### ⚠️ Multi-column indexes are BROKEN

```typescript
// ❌ DON'T — causes PANIC or silent empty results
ctx.db.scores.by_player_level.filter(playerId);

// ✅ DO — use single-column index + manual filter
for (const row of ctx.db.scores.by_player.filter(playerId)) {
  if (row.level === targetLevel) {
    /* ... */
  }
}
```

## Schema Export

```typescript
const spacetimedb = schema({ entity, record }); // ONE object, not spread args
export default spacetimedb;
```

## Reducers

Export name becomes the reducer name:

```typescript
export const createEntity = spacetimedb.reducer(
  { name: t.string(), age: t.i32() },
  (ctx, { name, age }) => {
    ctx.db.entity.insert({ identity: ctx.sender, name, age, active: true });
  }
);

// No arguments, just the callback:
export const doReset = spacetimedb.reducer((ctx) => { ... });
```

### Update pattern (CRITICAL)

```typescript
// ✅ CORRECT — spread existing row, override specific fields
const existing = ctx.db.task.id.find(taskId);
if (!existing) throw new SenderError("Task not found");
ctx.db.task.id.update({
  ...existing,
  title: newTitle,
  updatedAt: ctx.timestamp,
});

// ❌ WRONG — partial update nulls out other fields!
ctx.db.task.id.update({ id: taskId, title: newTitle });
```

### Delete pattern

```typescript
// Delete by primary key VALUE (not row object)
ctx.db.task.id.delete(taskId); // taskId is the u64 value
ctx.db.player.identity.delete(ctx.sender); // delete by identity
```

### Snake_case to camelCase conversion

- Server: `export const do_something = spacetimedb.reducer(...)` — name from export
- Client: `conn.reducers.doSomething({ ... })`

### Object syntax required

```typescript
// ❌ WRONG - positional
conn.reducers.doSomething("value");

// ✅ RIGHT - object
conn.reducers.doSomething({ param: "value" });
```

## DB Operations

```typescript
ctx.db.entity.insert({ id: 0n, name: "Sample" }); // Insert (0n for autoInc)
ctx.db.entity.id.find(entityId); // Find by PK → row | null
ctx.db.entity.identity.find(ctx.sender); // Find by unique column
[...ctx.db.item.authorId.filter(authorId)]; // Filter → spread to Array
[...ctx.db.entity.iter()]; // All rows → Array
ctx.db.entity.id.update({ ...existing, name: newName }); // Update (spread + override)
ctx.db.entity.id.delete(entityId); // Delete by PK
```

Note: `iter()` and `filter()` return iterators. Spread to Array for `.sort()`, `.filter()`, `.map()`.

## Lifecycle Hooks

MUST be `export const`. Bare calls are silently ignored:

```typescript
export const init = spacetimedb.init((ctx) => { ... });
export const onConnect = spacetimedb.clientConnected((ctx) => { ... });
export const onDisconnect = spacetimedb.clientDisconnected((ctx) => { ... });
```

## Reducer Context API

`ReducerCtx` is the single source of sender identity, deterministic time, and deterministic randomness inside a reducer. Always go through `ctx` for these. Standard library clocks and random sources are not available in modules.

```typescript
// Auth: ctx.sender is the caller's Identity
if (!row.owner.equals(ctx.sender)) throw new SenderError("unauthorized");

// Identity: ctx.databaseIdentity is the DB's identity
// ctx.identity is deprecated alias for databaseIdentity

// Auth context (JWT claims, etc.)
const jwtClaims = ctx.senderAuth.jwt;

// Server timestamp (deterministic per reducer call)
ctx.db.item.insert({ id: 0n, createdAt: ctx.timestamp });

// Deterministic RNG
const f: number = ctx.random(); // [0.0, 1.0)
const roll: number = ctx.random.integerInRange(1, 6); // inclusive
const bytes: Uint8Array = ctx.random.fill(new Uint8Array(16));

// UUID generation (deterministic)
const id: Uuid = ctx.newUuidV4();
const orderedId: Uuid = ctx.newUuidV7();

// Client: Timestamp → Date
new Date(Number(row.createdAt.microsSinceUnixEpoch / 1000n));
```

## Scheduled Tables

```typescript
const tickTimer = table(
  {
    name: "tick_timer",
    scheduled: (): any => tick, // (): any => breaks circular dep
  },
  {
    scheduled_id: t.u64().primaryKey().autoInc(),
    scheduled_at: t.scheduleAt(),
  },
);

export const tick = spacetimedb.reducer(
  { timer: tickTimer.rowType },
  (ctx, { timer }) => {
    /* timer row auto-deleted after this runs */
  },
);

// One-time: ScheduleAt.time(ctx.timestamp.microsSinceUnixEpoch + delayMicros)
// Repeating: ScheduleAt.interval(60_000_000n)
```

### Splitting scheduled reducers across files (avoid circular imports)

The `scheduled: (): any => reducerRef` thunk only **defers** the lookup — it does
NOT solve a cross-file cycle. If the scheduled table lives in `schema.ts` but the
reducer implementation lives in `reducers/tick.ts`, you get a cycle:
`schema.ts` (table needs reducer ref) → `reducers/tick.ts` (reducer needs the
`spacetimedb` default export from schema) → back to `schema.ts`. Importing the
reducer directly into the schema file hits a Temporal Dead Zone error.

The fix is a **mutable registry + thunks** in the schema file. The thunks close
over the registry, which is populated by the module entry (`index.ts`) AFTER all
modules have finished loading — so by the time SpacetimeDB asks "which reducer
fires for this table?" at runtime, the registry is full.

```typescript
// schema.ts
import { schema, table, t } from "spacetimedb/server";

// Mutable registry — populated by index.ts after every module has loaded.
// Thunks below close over this object so SpacetimeDB resolves reducer refs
// lazily at runtime, avoiding the schema → reducer TDZ.
const _sched: {
  tick?: any;
  // ...one entry per scheduled reducer
} = {};
export function setScheduled(r: typeof _sched): void {
  Object.assign(_sched, r);
}

const tickTimer = table(
  {
    name: "tick_timer",
    scheduled: (): any => _sched.tick, // thunk reads registry lazily
  },
  {
    scheduled_id: t.u64().primaryKey().autoInc(),
    scheduled_at: t.scheduleAt(),
  },
);

const spacetimedb = schema({ tickTimer });
export default spacetimedb;
```

The reducer file imports `spacetimedb` from the schema as usual — no cycle,
because it never touches `_sched`:

```typescript
// reducers/tick.ts
import spacetimedb, { tickTimer } from "../schema";

export const tick = spacetimedb.reducer(
  { timer: tickTimer.rowType },
  (ctx, { timer }) => {
    /* timer row auto-deleted after this runs */
  },
);
```

The module entry wires the registry at the bottom, after every import has
resolved — so no TDZ:

```typescript
// index.ts (module entry — the file with the default export)
import spacetimedb, { setScheduled } from "./schema";
import { tick } from "./reducers/tick";

export default spacetimedb;
export { tick };

// Wire scheduled reducers into the schema thunks. All modules are fully loaded
// by the time this top-level statement runs, so no TDZ risk.
setScheduled({ tick });
```

**Why this works:** SpacetimeDB resolves `scheduled` thunks at _runtime_, not at
module-load time. The thunk defers the registry lookup until then, by which
point `index.ts` has populated `_sched`. Forgetting the `setScheduled({...})`
call means the thunk returns `undefined` and the schedule **silently never
fires** — no error, no log, just nothing happens.

> The `loa` backend uses exactly this pattern: see `_sched` / `setScheduled` in
> [`spacetimedb/src/schema.ts`](spacetimedb/src/schema.ts) and the wiring call
> at the bottom of [`spacetimedb/src/index.ts`](spacetimedb/src/index.ts).

## Custom Types

```typescript
// Product type (struct):
const Position = t.object("Position", { x: t.i32(), y: t.i32() });
const entity = table(
  { name: "entity" },
  {
    id: t.u64().primaryKey().autoInc(),
    pos: Position,
  },
);

// Sum type (tagged union):
const Shape = t.enum("Shape", {
  circle: t.i32(),
  rectangle: t.object("Rect", { w: t.i32(), h: t.i32() }),
});
// Values: { tag: 'circle', value: 10 }
```

## Views

```typescript
// Anonymous view (same for all clients):
export const activeUsers = spacetimedb.anonymousView(
  { name: "active_users", public: true },
  t.array(entity.rowType),
  (ctx) => [...ctx.db.entity.iter()].filter((e) => e.active),
);

// Per-user view (varies by ctx.sender):
export const myProfile = spacetimedb.view(
  { name: "my_profile", public: true },
  t.option(entity.rowType),
  (ctx) => ctx.db.entity.identity.find(ctx.sender) ?? undefined,
);
```

### View primary keys (2.6.0+)

Declare a primary key on the view's row type so subscribed clients receive `onUpdate`
events (instead of delete+insert) when a row changes. Set `.primaryKey()` on the
column of the `t.row(...)`/`rowType` the view returns:

```typescript
const Player = t.row("Player", {
  id: t.u64().primaryKey(),
  owner: t.identity().index("btree"),
  name: t.string(),
});

export const myPlayers = spacetimedb.view(
  { name: "my_players", public: true },
  t.array(Player),
  (ctx) => [...ctx.db.player.owner.filter(ctx.sender)],
);
```

**Gotchas (verified):**

- The PK is only registered when the array element is a `t.row(...)` (a `RowBuilder`). A `t.object(...)` return type silently carries **no** PK — convert `t.object` → `t.row` to opt in.
- At most **one** `.primaryKey()` column per view; the column must be unique within the result. Composite natural keys (e.g. `planet_id` + `structure_id`) need a single synthetic key column instead.
- Views that return a table's `rowType` (e.g. `t.array(message.rowType)`) **inherit that table's PK automatically** after `spacetime generate` — no extra declaration needed.

## Complete Example

````typescript
import { schema, table, t } from 'spacetimedb/server';

const entity = table(
  { name: 'entity', public: true },
  {
    identity: t.identity().primaryKey(),
    name: t.string(),
    active: t.bool(),
  }
);

const record = table(
  {
    name: 'record',
    public: true,
    indexes: [{ accessor: 'by_owner', algorithm: 'btree', columns: ['owner'] }],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    owner: t.identity(),
    value: t.u32(),
  }
);

const spacetimedb = schema({ entity, record });
export default spacetimedb;

export const onConnect = spacetimedb.clientConnected((ctx) => {
  const existing = ctx.db.entity.identity.find(ctx.sender);
  if (existing) ctx.db.entity.identity.update({ ...existing, active: true });
});

export const onDisconnect = spacetimedb.clientDisconnected((ctx) => {
  const existing = ctx.db.entity.identity.find(ctx.sender);
  if (existing) ctx.db.entity.identity.update({ ...existing, active: false });
});

export const createEntity = spacetimedb.reducer(
  { name: t.string() },
  (ctx, { name }) => {
    if (ctx.db.entity.identity.find(ctx.sender)) throw new Error('already exists');
    ctx.db.entity.insert({ identity: ctx.sender, name, active: true });
  }
);

export const addRecord = spacetimedb.reducer(
  { value: t.u32() },
  (ctx, { value }) => {
    if (!ctx.db.entity.identity.find(ctx.sender)) throw new Error('not found');
    ctx.db.record.insert({ id: 0n, owner: ctx.sender, value });
  }
);

---

## Timestamps

### Server-side

```typescript
// Current time
ctx.db.item.insert({ id: 0n, createdAt: ctx.timestamp });

// Future time (add microseconds)
const future = ctx.timestamp.microsSinceUnixEpoch + 300_000_000n;  // 5 minutes
````

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
if (scheduleAt.tag === "Time") {
  const date = new Date(Number(scheduleAt.value.microsSinceUnixEpoch / 1000n));
}
```

---

## Data Visibility & Subscriptions

**`public: true` exposes ALL rows to ALL clients.**

| Scenario                  | Pattern                               |
| ------------------------- | ------------------------------------- |
| Everyone sees all rows    | `public: true`                        |
| Users see only their data | Private table + filtered subscription |

### Subscription patterns (client-side)

```typescript
// Subscribe to ALL public tables (simplest)
conn.subscriptionBuilder().subscribeToAllTables();

// Subscribe to specific tables with SQL
conn
  .subscriptionBuilder()
  .subscribe([
    "SELECT * FROM message",
    "SELECT * FROM room WHERE is_public = true",
  ]);

// Handle subscription lifecycle
conn
  .subscriptionBuilder()
  .onApplied(() => console.log("Initial data loaded"))
  .onError((e) => console.error("Subscription failed:", e))
  .subscribeToAllTables();
```

### Private table + view pattern (RECOMMENDED)

Views are the recommended approach for controlling data visibility:

- Server-side filtering (reduces network traffic)
- Real-time updates when underlying data changes
- Full control over what data clients can access

> ⚠️ **Do NOT use Row Level Security (RLS)** — it is deprecated.
>
> ⚠️ Procedural views can ONLY access data via index lookups, NOT `.iter()`. If you need a view that scans across many rows, return a query built with `ctx.from...`.

```typescript
// Private table with index on ownerId
export const PrivateData = table(
  {
    name: "private_data",
    indexes: [{ name: "by_owner", algorithm: "btree", columns: ["ownerId"] }],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    ownerId: t.identity(),
    secret: t.string(),
  },
);

// ❌ BAD — .iter() causes performance issues (re-evaluates on ANY row change)
spacetimedb.view(
  { name: "my_data_slow", public: true },
  t.array(PrivateData.rowType),
  (ctx) => [...ctx.db.privateData.iter()],
);

// ✅ GOOD — index lookup enables targeted invalidation
spacetimedb.view(
  { name: "my_data", public: true },
  t.array(PrivateData.rowType),
  (ctx) => [...ctx.db.privateData.by_owner.filter(ctx.sender)],
);
```

### Query builder view pattern (can scan)

```typescript
spacetimedb.anonymousView(
  { name: "top_players", public: true },
  t.array(Player.rowType),
  (ctx) => ctx.from.player.where((p) => p.score.gt(1000)),
);
```

### ViewContext vs AnonymousViewContext

```typescript
// ViewContext — has ctx.sender, result varies per user (computed per-subscriber)
spacetimedb.view(
  { name: "my_items", public: true },
  t.array(Item.rowType),
  (ctx) => {
    return [...ctx.db.item.by_owner.filter(ctx.sender)];
  },
);

// AnonymousViewContext — no ctx.sender, same result for everyone (shared, better perf)
spacetimedb.anonymousView(
  { name: "leaderboard", public: true },
  t.array(LeaderboardRow),
  (ctx) => {
    return [...ctx.db.player.by_score.filter(/* top scores */)];
  },
);
```

**Views require explicit subscription:**

```typescript
conn.subscriptionBuilder().subscribe([
  "SELECT * FROM public_table",
  "SELECT * FROM my_data", // Views need explicit SQL!
]);
```

---

## Procedures

Procedures are for side effects (HTTP requests, etc.) that reducers can't do.

> ✅ Stable as of 2.6.0 — no longer behind the `unstable` feature flag. `ctx.http.fetch`, `ctx.withTx`, and scheduled procedures are all available by default. (HTTP handlers/webhooks, views, and RLS remain gated behind unstable.)

### Defining a procedure

```typescript
// ✅ CORRECT — export const name = spacetimedb.procedure(params, ret, fn)
export const fetch_external_data = spacetimedb.procedure(
  { url: t.string() },
  t.string(), // return type
  (ctx, { url }) => {
    const response = ctx.http.fetch(url);
    return response.text();
  },
);
```

### Database access in procedures

> ⚠️ **CRITICAL: Procedures don't have `ctx.db`. Use `ctx.withTx()` for database access.**

```typescript
spacetimedb.procedure({ url: t.string() }, t.unit(), (ctx, { url }) => {
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

| Reducers                    | Procedures                            |
| --------------------------- | ------------------------------------- |
| `ctx.db` available directly | Must use `ctx.withTx(tx => tx.db...)` |
| Automatic transaction       | Manual transaction management         |
| No HTTP/network             | `ctx.http.fetch()` available          |
| No return values to caller  | Can return data to caller             |

---

## Project Structure

### Server (`spacetimedb/`)

```
src/index.ts    → Schema, reducers, lifecycle hooks (currently a single file)
package.json    → { "dependencies": { "spacetimedb": "^2.8.3" } }
tsconfig.json   → Standard config
dist/bundle.js  → Build output (spacetime build)
```

The module is small enough to live in one file. Once it grows, split tables out into
`src/schema.ts` — that's the conventional layout and what the rest of this doc assumes.

### Avoiding circular imports

```
schema.ts → defines tables AND exports spacetimedb
index.ts  → imports spacetimedb from ./schema, defines reducers
```

### Client (`src/`)

Full frontend guide in **[`src/CLAUDE.md`](../src/CLAUDE.md)**. SpacetimeDB-relevant parts:

```
src/module_bindings/ → Generated (pnpm spacetime:generate) — DO NOT EDIT.
src/Root.svelte      → DbConnection builder + createSpacetimeDBProvider; wraps App.
src/SceneHud.svelte  → HUD overlay router — SpacetimeDB UI belongs here (HTML), not in 3D scenes.
```

This is a plain Vite + Svelte app, not SvelteKit: no `routes/`, no `+layout.svelte`.
Connection config comes from `VITE_SPACETIMEDB_HOST` / `VITE_SPACETIMEDB_DB_NAME`.

---

## Hard Requirements

**TypeScript-specific:**

1. **`schema({ table })`** — takes exactly one object (tables) + optional second arg for module settings; never `schema(table)` or `schema(t1, t2, t3)`
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

# SpacetimeDB TypeScript Client

## Provider setup (in this project: `src/Root.svelte`)

Mount the provider once, above everything that reads from the database.

```svelte
<script lang="ts">
  import { createSpacetimeDBProvider, useSpacetimeDB } from 'spacetimedb/svelte';
  import { DbConnection } from './module_bindings';

  const HOST = import.meta.env.VITE_SPACETIMEDB_HOST ?? 'ws://localhost:3000';
  const DB_NAME = import.meta.env.VITE_SPACETIMEDB_DB_NAME ?? 'svelte-ts';

  const connection = DbConnection.builder()
    .withUri(HOST)
    .withDatabaseName(DB_NAME)
    .withToken(localStorage.getItem(`${HOST}/${DB_NAME}/auth_token`) ?? undefined);

  // Provider is a Svelte writable store — subscribe to connection state
  const spacetimeDBStore = createSpacetimeDBProvider(connection);

  // Connection identity — store access via $ prefix; use $derived in runes mode, not `$:`
  const identity = $derived($spacetimeDBStore.identity);
</script>

<!-- SvelteKit would put <slot /> here; this project renders <App /> from Root.svelte -->
<slot />
```

## Component usage (in this project: HUD components under `src/scenes/*Hud.svelte`)

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { useTable, useSpacetimeDB, useReducer } from 'spacetimedb/svelte';
  import { tables, reducers } from './module_bindings';

  // Reactive connection state (returns a Svelte store)
  const spacetimeDB = useSpacetimeDB();
  let isActive = $derived($spacetimeDB.isActive);
  let identity = $derived($spacetimeDB.identity);
  let token = $derived($spacetimeDB.token);
  let getConnection = $derived($spacetimeDB.getConnection);
  let conn = $derived(getConnection());

  // Subscribe manually when connected. Prefer typed query builders over raw SQL
  let subscribed = $state(false);
  $effect(() => {
    if (!conn || !isActive) return;
    conn.subscriptionBuilder()
      .onApplied(() => { subscribed = true; })
      .subscribe([tables.entity, tables.record]);
      // Or with filters: tables.entity.where(r => r.active.eq(true))
      // Or raw SQL:      'SELECT * FROM entity'
  });

  // Reactive data — useTable returns [Readable<rows[]>, Readable<boolean>]
  let [entities, entitiesReady] = useTable(tables.entity);
  let [records, recordsReady] = useTable(tables.record);

  // useTable with row callbacks
  let [onlineUsers] = useTable(
    tables.entity.where(r => r.active.eq(true)),
    {
      onInsert: (user) => console.log('User connected:', user.name),
      onDelete: (user) => console.log('User disconnected:', user.name),
      onUpdate: (oldUser, newUser) => console.log('Updated:', newUser.name),
    }
  );

  // useReducer hook for convenient reducer calls
  const addRecord = useReducer(reducers.addRecord);

  // Call reducers with object syntax
  function handleSubmit() {
    addRecord({ data: someValue });
  }

  // Compare identities
  let isMe = $derived(row.owner.toHexString() === identity?.toHexString());
</script>
```

## Vanilla (no framework hooks)

```typescript
import { DbConnection, tables } from "./module_bindings";

const conn = DbConnection.builder()
  .withUri("wss://maincloud.spacetimedb.com")
  .withDatabaseName("my_module")
  .onConnect((connection, identity, token) => {
    connection
      .subscriptionBuilder()
      .onApplied(() => console.log("Ready"))
      .subscribe([tables.user, tables.message]);
  })
  .build();

// Row callbacks
conn.db.user.onInsert((ctx, user) => console.log("Joined:", user.name));
conn.db.user.onDelete((ctx, user) => console.log("Left:", user.name));
conn.db.user.onUpdate((ctx, oldUser, newUser) =>
  console.log("Updated:", newUser.name),
);
```
