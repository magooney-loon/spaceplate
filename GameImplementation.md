# Spaceplate — Core Game Loop Implementation Plan

## Overview

Backend: SpacetimeDB TypeScript server (`spacetimedb/src/`, split into `schema.ts` + `index.ts`)
Frontend: Svelte 5 app (`src/`)
Database: `spaceplate-j29m7` on maincloud

---

## 1. Prototype Scope

### In Prototype (core loop, play a full game end-to-end)
- Lobby: create/join by 4-char code
- Role assignment: Scavenger vs Survivor
- Procedural map generation (20×20 grid, server-side)
- Player movement + collision
- Sprint + stamina system (server tick)
- Light sources (flashlight beam, oil lamp radius) + fuel drain (server tick)
- Sanity drain in darkness (server tick)
- Lootable containers + key/locked box
- 3 Cores: 2 solo, 1 duo activation
- AI monster: Passive → Aggressive → Frenzy phases + simple pathfinding
- AI reactions to light: stun (flashlight beam), flee (oil lamp radius)
- AI contact damage (−50 sanity)
- Noise system (sprint, search, graffiti → AI investigates)
- Graffiti (5 uses, 5 symbols, AI claws them)
- Power panels (repair parts, AI can disable)
- Revive system (once per player, 5s channel)
- Win condition: all 3 cores active
- Lose condition: both players sanity 0 OR timer expires (5:00)
- Game tick: 200ms scheduled reducer

### Deferred (P1)
- Animated sprites / tile atlas (currently colored rectangles)
- Sound effects
- Multiple simultaneous lobbies with a browser UI
- Leaderboard / persistent stats
- Mobile input

---

## 2. File Structure

```
spacetimedb/src/
  schema.ts      ← all table definitions + schema export
  index.ts       ← all reducers, lifecycle hooks, scheduled tick

src/
  Root.svelte    ← connection provider (update DB_NAME)
  App.svelte     ← router: Lobby or Game screen
  Lobby.svelte   ← create/join UI
  Game.svelte    ← top-level game layout
  GameCanvas.svelte  ← renders map, players, monster, cores, items
  HUD.svelte         ← sanity, light, stamina, timer bars
  module_bindings/   ← generated (spacetime generate)
```

---

## 3. Backend Schema (`schema.ts`)

### Table: `lobby`
```
lobbyId: t.string().primaryKey()   ← 4-char uppercase code e.g. "A7KZ"
hostIdentity: t.identity()
status: t.string()                 ← 'waiting' | 'starting' | 'playing' | 'ended'
createdAt: t.timestamp()
```
Options: `public: true`

### Table: `game_state`
```
lobbyId: t.string().primaryKey()
mapWidth: t.u32()
mapHeight: t.u32()
mapTiles: t.string()              ← JSON flat array, index = y*width+x, values: 0=floor 1=wall 2=door_open 3=door_closed 4=debris
timeRemainingUs: t.i64()          ← microseconds remaining (starts at 300_000_000)
phase: t.string()                 ← 'passive' | 'aggressive' | 'frenzy' | 'ended'
outcome: t.string()               ← '' | 'win' | 'lose_time' | 'lose_sanity'
startedAt: t.timestamp()
lastTickAt: t.timestamp()
```
Options: `public: true`

### Table: `player`
```
identity: t.identity().primaryKey()
lobbyId: t.string()
username: t.string()
role: t.string()                  ← 'scavenger' | 'survivor'
x: t.f32()
y: t.f32()
facingX: t.f32()                  ← normalized direction for flashlight beam
facingY: t.f32()
sanity: t.f32()                   ← 0–100
lightFuel: t.f32()                ← 0–100 (battery or oil)
stamina: t.f32()                  ← 0–100
isSprinting: t.bool()
status: t.string()                ← 'alive' | 'downed' | 'lost'
revivesUsed: t.u32()              ← max 1
sprayUses: t.u32()                ← starts at 5
hasKey: t.bool()
repairPartsHeld: t.u32()
isReady: t.bool()
lastUpdatedAt: t.timestamp()
```
Options: `public: true`, indexes: `[{ name: 'player_lobby_id', algorithm: 'btree', columns: ['lobbyId'] }]`

### Table: `core_node`
(Named `core_node` to avoid reserved word conflict)
```
id: t.u64().primaryKey().autoInc()
lobbyId: t.string()
x: t.i32()
y: t.i32()
coreType: t.string()              ← 'solo' | 'duo'
activated: t.bool()
activatingIdentity: t.identity().optional()
activatingSecondIdentity: t.identity().optional()  ← duo only
activationStartUs: t.i64()        ← timestamp micros when hold started (0 = not active)
```
Options: `public: true`, indexes: `[{ name: 'core_node_lobby_id', algorithm: 'btree', columns: ['lobbyId'] }]`

### Table: `monster`
```
lobbyId: t.string().primaryKey()
x: t.f32()
y: t.f32()
state: t.string()                 ← 'wandering' | 'investigating' | 'chasing' | 'stunned' | 'fleeing'
stateEndsAtUs: t.i64()            ← micros epoch when current state expires (0 = no expiry)
targetX: t.f32()                  ← investigation/chase target
targetY: t.f32()
targetIdentity: t.identity().optional()
```
Options: `public: true`

### Table: `container`
```
id: t.u64().primaryKey().autoInc()
lobbyId: t.string()
x: t.i32()
y: t.i32()
containerType: t.string()         ← 'cabinet' | 'crate' | 'dead_body' | 'locked_box'
looted: t.bool()
requiresKey: t.bool()
```
Options: `public: true`, indexes: `[{ name: 'container_lobby_id', algorithm: 'btree', columns: ['lobbyId'] }]`

### Table: `item`
```
id: t.u64().primaryKey().autoInc()
lobbyId: t.string()
x: t.i32()
y: t.i32()
itemType: t.string()              ← 'battery' | 'oil' | 'sanity_vial' | 'key' | 'repair_part' | 'spray_refill'
pickedUp: t.bool()
```
Options: `public: true`, indexes: `[{ name: 'item_lobby_id', algorithm: 'btree', columns: ['lobbyId'] }]`

### Table: `power_panel`
```
id: t.u64().primaryKey().autoInc()
lobbyId: t.string()
x: t.i32()
y: t.i32()
repaired: t.bool()
disabled: t.bool()                ← permanently disabled by AI
```
Options: `public: true`, indexes: `[{ name: 'power_panel_lobby_id', algorithm: 'btree', columns: ['lobbyId'] }]`

### Table: `graffiti`
```
id: t.u64().primaryKey().autoInc()
lobbyId: t.string()
x: t.i32()
y: t.i32()
symbol: t.string()                ← 'arrow_right' | 'arrow_up' | 'arrow_down' | 'star' | 'cross'
ownerId: t.identity()
scratched: t.bool()               ← AI clawed it (partial visibility)
```
Options: `public: true`, indexes: `[{ name: 'graffiti_lobby_id', algorithm: 'btree', columns: ['lobbyId'] }]`

### Table: `noise_event`
```
id: t.u64().primaryKey().autoInc()
lobbyId: t.string()
x: t.f32()
y: t.f32()
radius: t.f32()
intensity: t.f32()                ← 0–1, higher = AI prioritizes this
expiresAtUs: t.i64()
```
Options: `public: true`, indexes: `[{ name: 'noise_event_lobby_id', algorithm: 'btree', columns: ['lobbyId'] }]`

### Table: `game_tick_schedule`
(Scheduled table to drive the game loop)
```
scheduledId: t.u64().primaryKey().autoInc()
scheduledAt: t.scheduleAt()
lobbyId: t.string()
```
Options: `{ name: 'game_tick_schedule', scheduled: () => tick_game }`

### Schema export
```typescript
const spacetimedb = schema({
  lobby, game_state, player, core_node, monster,
  container, item, power_panel, graffiti, noise_event,
  game_tick_schedule
});
export default spacetimedb;
```

---

## 4. Backend Reducers (`index.ts`)

### `create_lobby`
Params: `{ username: t.string() }`
- Generate a random 4-char uppercase code
- Reject if caller already in an active lobby
- Insert lobby row (status: 'waiting')
- Insert player row (role: 'scavenger', status: 'alive', isReady: false)

### `join_lobby`
Params: `{ lobbyId: t.string(), username: t.string() }`
- Find lobby, reject if not 'waiting' or already has 2 players
- Insert player row (role: 'survivor', status: 'alive', isReady: false)
- If lobby now has 2 players, update to still 'waiting' (host must start)

### `set_ready`
Params: none
- Toggle `isReady` on caller's player row

### `start_game`
Params: none
- Only callable by lobby host, lobby must be 'waiting' with 2 ready players
- **Run procedural map generation** (see section 6)
- Spawn players at opposite corners
- Place 3 cores (2 solo, 1 duo) at least 8 tiles from spawns
- Spawn containers, items, power panels
- Spawn monster near center
- Insert `game_state` row (phase: 'passive', timeRemainingUs: 300_000_000)
- Update lobby status to 'playing'
- Insert first `game_tick_schedule` row (scheduledAt: now + 200ms)

### `move_player`
Params: `{ dx: t.f32(), dy: t.f32(), facingX: t.f32(), facingY: t.f32(), isSprinting: t.bool() }`
- Get caller's player, check alive
- Get game_state for lobbyId, check phase != 'ended'
- Apply speed: scavenger sprint=200%, survivor sprint=150%; base = 3 tiles/s
- Clamp movement to delta time (use timestamp diff from lastUpdatedAt)
- Resolve collision against map tiles (wall, closed door = blocked)
- Update position + facing + isSprinting + lastUpdatedAt
- Emit noise event: sprint = radius 10, walk = radius 5

### `pick_up_item`
Params: `{ itemId: t.u64() }`
- Get item, check !pickedUp and within 1.5 tiles of player
- Apply effect: battery += 30 (cap 100), oil += 20 (cap 80), sanity_vial += 25 (cap 100), key = set hasKey, repair_part += 1, spray_refill += 3 spray uses (cap 5)
- Mark item pickedUp

### `search_container`
Params: `{ containerId: t.u64() }`
- Container within 1.5 tiles, not looted
- Locked box requires `player.hasKey`; if used, clear hasKey
- Roll loot table:
  - cabinet: 50% battery | 30% oil | 5% sanity_vial | 15% nothing
  - crate: 40% battery | 50% oil | 3% sanity_vial | 7% nothing
  - dead_body: 100% oil + 20% sanity_vial + 10% key (items stacked)
  - locked_box: 80% of one resource (battery or oil, 50/50)
- Spawn loot as `item` at container position
- Mark container looted
- Emit noise event: radius 12

### `repair_panel`
Params: `{ panelId: t.u64() }`
- Panel within 1.5 tiles, not repaired, not disabled
- Player must have repairPartsHeld >= 1
- Decrement repairPartsHeld, set panel.repaired = true
- Emit noise (nearby)

### `interact_core`
Params: `{ coreId: t.u64() }`
- Core within 1.5 tiles, not yet activated
- For solo core: set activatingIdentity = caller, activationStartUs = now_micros
- For duo core: if no one activating, set activatingIdentity; if one already, set activatingSecondIdentity. Both must be present

### `release_core`
Params: `{ coreId: t.u64() }`
- Clear caller from activatingIdentity or activatingSecondIdentity
- Reset activationStartUs if no one is holding

### `spray_graffiti`
Params: `{ x: t.i32(), y: t.i32(), symbol: t.string() }`
- Player must have sprayUses > 0
- Decrement sprayUses, insert graffiti row
- Emit noise event: radius 10, 3s duration

### `revive_player`
Params: `{ targetIdentity: t.identity() }`
- Target must be 'downed', within 2 tiles, caller alive
- Start 5s channel — tracked via a timestamp field on player (reviveStartUs)
- On completion (checked in tick): set target status to 'alive', sanity = 25, revivesUsed++

### `leave_lobby`
Params: none
- Delete player row
- If host leaves, end game (set status 'ended')
- If lobby empty, delete lobby and game_state

---

## 5. Game Tick (`tick_game`)

Scheduled reducer, runs every 200ms per active lobby.

```
export const tick_game = spacetimedb.reducer({ arg: GameTickSchedule.rowType }, (ctx, { arg }) => { ... })
```

On each tick for the lobby in `arg.lobbyId`:

### 5.1 Compute delta
```
deltaUs = ctx.timestamp.microsSinceUnixEpoch - gameState.lastTickAt.microsSinceUnixEpoch
deltaSec = Number(deltaUs) / 1_000_000
```

### 5.2 Update timer + phase
- Decrement `timeRemainingUs` by deltaUs
- If ≤ 0: set outcome='lose_time', phase='ended', stop scheduling
- Remaining > 60s: phase='passive'
- 60s–120s: phase='aggressive'  ← wait, game concept says Aggressive = 2:00–1:00 remaining
- Actually: remaining > 120s = 'passive', 60–120s = 'aggressive', < 60s = 'frenzy'

### 5.3 Update all players
For each alive player in lobby:

**Stamina regen / drain:**
- If sprinting AND stamina > 0: drain stamina based on role (scavenger: −33/s, survivor: −16/s)
- If not sprinting AND stamina < 100: regen +25/s
- If stamina hits 0: force isSprinting = false

**Light fuel drain:**
- scavenger (flashlight): −2/s; survivor (oil lamp): −5/s
- If fuel hits 0: light is out

**Sanity drain in darkness:**
- Player is in light if:
  - Own light fuel > 0, OR
  - Within 3 tiles of a repaired, non-disabled power panel, OR
  - Within other player's lamp radius (3 tiles) if that player has fuel > 0
- If in complete darkness: sanity −1/s
- If sanity hits 0: status = 'downed'

**AI sense at low sanity:**
- sanity < 50: AI can sense player position regardless of noise

### 5.4 Check revives
- For each downed player being revived: if channel time ≥ 5s → revive

### 5.5 Core activation progress
For each core:
- Solo: activatingIdentity set AND player still within 1.5 tiles AND player alive:
  - Time held = now - activationStartUs
  - If ≥ 3_000_000 µs (3s): activated = true, clear activating fields
  - If player moved away: reset activationStartUs = 0
- Duo: both players must be present within 1.5 tiles
  - If either left: reset both

### 5.6 Win/lose check
- Win: all 3 cores activated → outcome='win', phase='ended'
- Lose: all players status='lost' (downed with no revives remaining) → outcome='lose_sanity', phase='ended'

### 5.7 Monster AI
(see section 7 for full AI logic)

### 5.8 Expire noise events
- Delete noise_event rows where expiresAtUs < now

### 5.9 Phase-specific map events
- Aggressive: every 30s, pick a random open door → close it
- Frenzy: every 15s, flicker all repaired panels (set repaired=false for 3s then back)
- Frenzy: emergency alarm → emit huge noise event radius 30

### 5.10 Schedule next tick
- Insert new `game_tick_schedule` with scheduledAt = now + 200_000 µs (200ms)

---

## 6. Map Generation (server-side, inside `start_game`)

Map is 20×20 tiles encoded as a flat array string (JSON). Tile values:
- `0` = floor
- `1` = wall
- `2` = door (open)
- `3` = door (closed) ← blocked
- `4` = debris (walkable, blocks light)

### Algorithm: Simple Room Placement
```
1. Fill all tiles with wall (1)
2. Generate 5–8 rooms:
   - Each room: width 3–6, height 3–6
   - Place randomly, reject overlaps (with 1-tile buffer)
3. Connect rooms with L-shaped corridors (floor tiles)
4. Add doors at room entrances (30% chance per entrance)
5. Scatter debris in corridors (10% of corridor tiles)
6. Designate spawn points: room[0] corner for P1, room[-1] corner for P2
7. Place cores: 2 solo cores in mid-distance rooms, 1 duo core in most central room
8. Place containers: 1–2 per room, not on spawn/core tiles
9. Place items: repair parts (2–3), keys (1) on floor tiles
10. Place power panels: 1 per room in larger rooms (3–4 total)
11. Return flat tile array as JSON string
```

---

## 7. AI Monster Behavior (inside tick)

### Speed (tiles/s)
- Passive: 1.5
- Aggressive: 3.0
- Frenzy: 5.0
- Scavenger base: 3.0 (monster faster than scavenger in frenzy)
- Survivor base: 2.5 (monster slower than survivor normally)

### State machine per tick:

**Passive phase:**
- State: wandering → pick random floor tile target, move toward it
- If very loud noise (radius ≥ 20): switch to 'investigating' that noise position
- On reaching investigation point: back to wandering

**Aggressive phase:**
- Find loudest active noise event in lobby
- If noise found: state = 'investigating', target = noise position
- If player sanity < 70: can sense that player → state = 'chasing'
- While chasing: move toward target player each tick
- Phase transition event: slam a random closed door (already closed) or close an open door

**Frenzy phase:**
- Always chasing nearest player regardless of sanity or noise
- Ignores stun/flee (light has no effect)
- Emergency alarm: emit noise radius 30 every 90s

**Light interaction (not in frenzy):**
- Flashlight stun: if monster position is within flashlight beam cone (45° arc, up to 8 tiles) AND P1 has fuel > 0 → state = 'stunned', stateEndsAtUs = now + 5_000_000
- Oil lamp flee: if monster within 3 tiles of survivor AND survivor has fuel > 0 → state = 'fleeing', move away from survivor, stateEndsAtUs = now + 10_000_000
- While stunned or fleeing: ignore all inputs

**AI contact damage:**
- If monster within 0.8 tiles of any alive player: −50 sanity to that player
- Cooldown: only once per 2s per player (track lastHitUs on player or derived from sanity value)

**Door destruction:**
- When moving through a door tile: 50% chance to change tile to debris (4) in mapTiles

**Panel disabling:**
- In Aggressive phase: if monster passes within 1 tile of a repaired panel → disable it (one-time)

**Graffiti clawing:**
- When monster passes within 1 tile of a graffiti: 50% chance to set scratched=true

### Pathfinding
Simple for prototype: each tick, compute the direction vector toward target. Move in that direction. If blocked by wall: try sliding along the wall (try X-only then Y-only movement). This is sufficient for the prototype; A* can be added in P1.

---

## 8. Client Architecture

### Connection (Root.svelte)
- Update `DB_NAME` to `'spaceplate-j29m7'`
- `createSpacetimeDBProvider(connectionBuilder)` (existing pattern is correct)

### App.svelte
```svelte
- useSpacetimeDB() → conn
- useTable(tables.player) → players
- Check if $conn identity has a player row with an active lobbyId
- If no: show <Lobby />
- If yes and game_state.phase != 'ended': show <Game />
- If ended: show win/lose screen
```

### Lobby.svelte
- Username input
- "Create Game" button → `create_lobby({ username })`
- "Join Game" input + button → `join_lobby({ lobbyId, username })`
- Show lobby code prominently once in a lobby
- Show connected players + their ready status
- "Ready" toggle button
- Host sees "Start Game" button (enabled when both ready)

### Game.svelte
```svelte
- Layout: canvas (main area) + HUD (overlay/sidebar)
- Handle keyboard input: WASD, Shift (sprint), E (interact), G (graffiti menu)
- Send move_player on animation frame (requestAnimationFrame loop)
- Show phase indicator, timer, win/lose overlay
```

### GameCanvas.svelte
Renders via HTML5 Canvas (not DOM elements — too many tiles):
```
Layers (back to front):
1. Map tiles (floor=dark gray, wall=dark brown, door=tan, debris=gray-brown)
2. Light overlay: darkness mask with holes for flashlight beam and oil lamp radius
3. Items (colored dots with labels)
4. Containers (colored rectangles)
5. Power panels (lit=yellow glow, unlit=dark, disabled=red X)
6. Graffiti symbols (white, scratched=faded)
7. Cores (pulsing circle, activated=green, inactive=red)
8. Other player (different color)
9. Monster (red triangle)
10. Local player (white circle + facing indicator for flashlight)
```
Scale: 28px per tile, canvas scrolls to keep player centered.

### HUD.svelte
```
- Sanity bar (green → yellow → red)
- Light fuel bar (yellow for battery, orange for oil)
- Stamina bar (blue, drains on sprint)
- Timer (MM:SS, red when < 60s)
- Phase indicator text
- Spray uses (5 icons)
- Core status (3 icons: activated=green, inactive=gray)
- Mini-map (optional stretch, show tile layout at small scale)
```

### Controls
| Key | Action |
|-----|--------|
| WASD | Move |
| Shift | Sprint (hold) |
| E | Interact (core, container, item, revive) |
| G + 1–5 | Spray graffiti symbol |
| R | Repair panel (when adjacent) |

`move_player` is called every animation frame with the current directional input (dx/dy normalized, facingX/facingY from last move direction).

---

## 9. Subscription Strategy

All tables are `public: true` for the prototype. Subscribe to all tables filtered by lobbyId client-side.

```typescript
conn.subscriptionBuilder()
  .onApplied(() => setLoaded(true))
  .subscribe([
    'SELECT * FROM lobby',
    'SELECT * FROM game_state',
    'SELECT * FROM player',
    'SELECT * FROM core_node',
    'SELECT * FROM monster',
    'SELECT * FROM container',
    'SELECT * FROM item',
    'SELECT * FROM power_panel',
    'SELECT * FROM graffiti',
    'SELECT * FROM noise_event',
  ]);
```

Client filters by lobbyId to get the relevant rows for the current game.

---

## 10. Constants Reference

### Timing
| Value | Amount |
|-------|--------|
| Game duration | 300s (5 min) |
| Aggressive starts | 120s remaining |
| Frenzy starts | 60s remaining |
| Tick interval | 200ms |
| Core solo activation | 3s hold |
| Core duo activation | 3s hold (both) |
| Flashlight stun | 5s |
| Oil lamp flee | 10s |
| Revive channel | 5s |
| Noise linger | 2s |
| Stamina regen (still) | 4s to full |

### Player Stats
| Stat | Scavenger | Survivor |
|------|-----------|---------|
| Sprint speed | 200% | 150% |
| Sprint drain | 33%/s | 16%/s |
| Light type | Flashlight | Oil Lamp |
| Starting fuel | 100 | 80 |
| Fuel drain | 2%/s | 5%/s |
| Starting sanity | 100 | 100 |

### Noise Radii
| Action | Radius |
|--------|--------|
| Walking | 5 |
| Sprinting | 10 |
| Graffiti | 10 |
| Searching | 12 |
| Breaking debris | 20 |
| Emergency alarm | 30 |

---

## 11. Implementation Order

1. Backend schema.ts (all tables)
2. Backend index.ts: create_lobby, join_lobby, set_ready, start_game (with map gen), leave_lobby
3. Backend index.ts: move_player, pick_up_item, search_container, interact_core, release_core
4. Backend index.ts: tick_game (timer + phase + stamina + sanity + win/lose check)
5. Generate bindings (`spacetime generate`)
6. Frontend: Root.svelte + App.svelte (routing)
7. Frontend: Lobby.svelte (full lobby UI)
8. Frontend: GameCanvas.svelte (map + players + cores rendering)
9. Frontend: HUD.svelte
10. Frontend: Game.svelte (input handling + move_player loop)
11. Backend: tick_game AI monster logic
12. Backend: spray_graffiti, repair_panel, revive_player
13. Frontend: graffiti rendering + spray UI
14. Test full loop: lobby → start → play → win/lose
15. Polish: light overlay darkness mask, phase events, AI reactions to light
