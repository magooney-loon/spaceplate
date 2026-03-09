# Game Design & Implementation

Backend: SpacetimeDB TypeScript server (`spacetimedb/src/`, split into `schema.ts` + `index.ts`)
Frontend: Svelte 5 app (`src/`)

---

## Concept

Single level, 2 players vs AI monster, procedural map.

### Player Characters

| Attribute | Player 1 (Scavenger) | Player 2 (Survivor) |
|-----------|---------------------|---------------------|
| **Light Source** | Flashlight | Oil Lamp |
| **Starting Fuel** | 100% battery | 80% oil |
| **Sprint Speed** | 200% | 150% |
| **Sprint Drain** | 33%/s stamina | 16%/s stamina |
| **Fuel Drain** | 2%/s | 5%/s |
| **Starting Sanity** | 100 | 100 |

Sprint stamina recharges when standing still (full in 4s). Stamina hits 0 → forced to walk.

### Light Mechanics

| Light Source | Effect on AI |
|--------------|--------------|
| **Flashlight** | AI stunned 5s when beam hits (Frenzy: immune) |
| **Oil Lamp** | AI flees 10s when within radius (Frenzy: immune) |

- Flashlight: beam cone 45°, up to 8 tiles, must hit AI
- Oil lamp: radius 3 tiles around player
- Fuel hits 0 = light out

### Sanity System

- **Darkness drain**: −1/s when no light within range
- **AI sense**: sanity < 50 → AI always knows player position
- **Downed**: sanity hits 0 → downed state
- **No recovery** (hardcore)

Player is in light if: own fuel > 0, OR within 3 tiles of repaired power panel, OR within 3 tiles of other player's active lamp.

### Noise System

| Action | Radius | AI Reaction |
|--------|--------|-------------|
| Walking | 5 | Ignores (passive) |
| Sprinting | 10 | Investigates |
| Graffiti spray | 10 | Investigates |
| Searching container | 12 | Investigates |
| Breaking debris | 20 | Rushes |
| Emergency alarm | 30 | Attracts all |

Noise lingers 2s. Multiple sources → AI picks loudest/closest.

### Lootable Containers

| Container | Loot Table | Search Time |
|-----------|-----------|-------------|
| Cabinet | 50% battery / 30% oil / 5% sanity vial / 15% nothing | 1s |
| Crate | 40% battery / 50% oil / 3% sanity vial / 7% nothing | 2s |
| Dead Body | 100% oil + 20% sanity vial + 10% key | 2s |
| Locked Box | 80% battery or oil (50/50), requires key | 3s |

- 8–12 containers per map, each lootable once
- Searching = loud noise (radius 12)
- 1 key per map (90% floor, 10% dead body)

### Power System

- 2–3 repair parts spawn per map
- Each part fixes one power panel permanently
- Fixed panels light their area (no sanity drain in range)
- **AI can permanently disable a repaired panel** (once per panel, in Aggressive phase)

### Objectives

- **3 Cores**: 2 solo (one player holds 3s), 1 duo (both players hold 3s simultaneously)
- **Win**: All 3 cores activated
- **Lose**: Both players sanity 0, OR timer expires (5:00)

### Revive System

- Downed player can be revived by the other (stand nearby 5s)
- Each player can only be revived once per game
- Both downed = Game Over

### AI Monster Behavior

**Phases:**

| Phase | Time Remaining | Speed | Behavior |
|-------|---------------|-------|---------|
| Passive | > 2:00 | 1.5 t/s | Wanders, investigates very loud noise only |
| Aggressive | 1:00–2:00 | 3.0 t/s | Hunts noise, senses sanity < 70, slams doors every 30s |
| Frenzy | < 1:00 | 5.0 t/s | Always chases nearest player, ignores light, alarm every 90s |

**Abilities:**
- Flashlight stun: 5s (not in Frenzy)
- Oil lamp flee: 10s (not in Frenzy)
- Contact damage: −50 sanity (cooldown 2s per player)
- Door destruction: 50% chance to turn door into debris when passing through
- Panel disabling: disables repaired panels it passes within 1 tile (Aggressive+)
- Graffiti clawing: 50% chance to scratch graffiti when passing within 1 tile

### Graffiti System

- Each player carries a spray can with 5 uses
- Press G + 1–5 to spray a symbol at current position
- Creates noise radius 10 for 3s (AI investigates spray location)
- Spray refills (restore 3 uses) findable in containers

| Key | Symbol | Meaning |
|-----|--------|---------|
| 1 | → | Go this way |
| 2 | ↑ | Go up |
| 3 | ↓ | Go down |
| 4 | ★ | Found something |
| 5 | ✗ | Don't go here |

Scratched graffiti (AI clawed) = still visible but partially obscured.

---

## Prototype Scope

### In Prototype
- Lobby: create/join by 4-char code
- Role assignment: Scavenger vs Survivor
- Procedural map generation (20×20, server-side)
- Player movement + collision
- Sprint + stamina system (server tick)
- Light sources + fuel drain (server tick)
- Sanity drain in darkness (server tick)
- Lootable containers + key/locked box
- 3 Cores: 2 solo, 1 duo activation
- AI monster: Passive → Aggressive → Frenzy + simple pathfinding
- AI light reactions (stun/flee)
- AI contact damage
- Noise system
- Graffiti (5 uses, 5 symbols, AI claws)
- Power panels (repair parts, AI disables)
- Revive system
- Win/lose conditions
- Game tick: 200ms scheduled reducer

### Deferred (P1)
- Animated sprites / tile atlas (currently colored rectangles)
- Sound effects
- Multiple simultaneous lobbies with browser UI
- Leaderboard / persistent stats
- Mobile input

---

## File Structure

```
spacetimedb/src/
  schema.ts      ← all table definitions + schema export
  index.ts       ← all reducers, lifecycle hooks, scheduled tick

src/
  Root.svelte        ← connection provider
  App.svelte         ← router: Lobby or Game screen
  Lobby.svelte       ← create/join UI
  Game.svelte        ← top-level game layout + input handling
  GameCanvas.svelte  ← renders map, players, monster, cores, items
  HUD.svelte         ← sanity, light, stamina, timer bars
  module_bindings/   ← generated (spacetime generate)
```

---

## Backend Schema (`schema.ts`)

### `lobby`
```
lobbyId: t.string().primaryKey()   ← 4-char uppercase code e.g. "A7KZ"
hostIdentity: t.identity()
status: t.string()                 ← 'waiting' | 'starting' | 'playing' | 'ended'
createdAt: t.timestamp()
```
Options: `public: true`

### `game_state`
```
lobbyId: t.string().primaryKey()
mapWidth: t.u32()
mapHeight: t.u32()
mapTiles: t.string()              ← JSON flat array, index = y*width+x
                                  ← 0=floor 1=wall 2=door_open 3=door_closed 4=debris
timeRemainingUs: t.i64()          ← microseconds remaining (starts at 300_000_000)
phase: t.string()                 ← 'passive' | 'aggressive' | 'frenzy' | 'ended'
outcome: t.string()               ← '' | 'win' | 'lose_time' | 'lose_sanity'
startedAt: t.timestamp()
lastTickAt: t.timestamp()
```
Options: `public: true`

### `player`
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

### `core_node`
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
activationStartUs: t.i64()        ← micros when hold started (0 = not active)
```
Options: `public: true`, indexes: `[{ name: 'core_node_lobby_id', algorithm: 'btree', columns: ['lobbyId'] }]`

### `monster`
```
lobbyId: t.string().primaryKey()
x: t.f32()
y: t.f32()
state: t.string()                 ← 'wandering' | 'investigating' | 'chasing' | 'stunned' | 'fleeing'
stateEndsAtUs: t.i64()            ← micros epoch when state expires (0 = no expiry)
targetX: t.f32()
targetY: t.f32()
targetIdentity: t.identity().optional()
```
Options: `public: true`

### `container`
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

### `item`
```
id: t.u64().primaryKey().autoInc()
lobbyId: t.string()
x: t.i32()
y: t.i32()
itemType: t.string()              ← 'battery' | 'oil' | 'sanity_vial' | 'key' | 'repair_part' | 'spray_refill'
pickedUp: t.bool()
```
Options: `public: true`, indexes: `[{ name: 'item_lobby_id', algorithm: 'btree', columns: ['lobbyId'] }]`

### `power_panel`
```
id: t.u64().primaryKey().autoInc()
lobbyId: t.string()
x: t.i32()
y: t.i32()
repaired: t.bool()
disabled: t.bool()                ← permanently disabled by AI
```
Options: `public: true`, indexes: `[{ name: 'power_panel_lobby_id', algorithm: 'btree', columns: ['lobbyId'] }]`

### `graffiti`
```
id: t.u64().primaryKey().autoInc()
lobbyId: t.string()
x: t.i32()
y: t.i32()
symbol: t.string()                ← 'arrow_right' | 'arrow_up' | 'arrow_down' | 'star' | 'cross'
ownerId: t.identity()
scratched: t.bool()
```
Options: `public: true`, indexes: `[{ name: 'graffiti_lobby_id', algorithm: 'btree', columns: ['lobbyId'] }]`

### `noise_event`
```
id: t.u64().primaryKey().autoInc()
lobbyId: t.string()
x: t.f32()
y: t.f32()
radius: t.f32()
intensity: t.f32()                ← 0–1, higher = AI prioritizes
expiresAtUs: t.i64()
```
Options: `public: true`, indexes: `[{ name: 'noise_event_lobby_id', algorithm: 'btree', columns: ['lobbyId'] }]`

### `game_tick_schedule`
(Scheduled table — drives game loop)
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

## Backend Reducers (`index.ts`)

### `create_lobby`
Params: `{ username: t.string() }`
- Generate random 4-char uppercase code
- Reject if caller already in active lobby
- Insert lobby (status: 'waiting'), insert player (role: 'scavenger', isReady: false)

### `join_lobby`
Params: `{ lobbyId: t.string(), username: t.string() }`
- Reject if lobby not 'waiting' or already has 2 players
- Insert player (role: 'survivor', isReady: false)

### `set_ready`
Params: none
- Toggle `isReady` on caller's player row

### `start_game`
Params: none
- Only host, lobby must be 'waiting' with 2 ready players
- Run procedural map generation (see Map Generation)
- Spawn players at opposite corners
- Place 3 cores (2 solo, 1 duo) ≥ 8 tiles from spawns
- Spawn containers, items, power panels, monster
- Insert game_state (phase: 'passive', timeRemainingUs: 300_000_000)
- Update lobby to 'playing'
- Insert first game_tick_schedule (now + 200ms)

### `move_player`
Params: `{ dx: t.f32(), dy: t.f32(), facingX: t.f32(), facingY: t.f32(), isSprinting: t.bool() }`
- Check player alive, game not ended
- Apply speed: base 3 t/s, scavenger sprint ×2, survivor sprint ×1.5
- Clamp to delta time (timestamp diff from lastUpdatedAt)
- Collision against walls and closed doors
- Update position + facing + isSprinting + lastUpdatedAt
- Emit noise: sprint radius 10, walk radius 5

### `pick_up_item`
Params: `{ itemId: t.u64() }`
- Item must be within 1.5 tiles, not picked up
- battery → +30 (cap 100), oil → +20 (cap 80), sanity_vial → +25 (cap 100), key → hasKey=true, repair_part → +1, spray_refill → +3 uses (cap 5)
- Mark pickedUp

### `search_container`
Params: `{ containerId: t.u64() }`
- Within 1.5 tiles, not looted; locked box requires hasKey
- Roll loot table, spawn item at container position
- Mark looted, emit noise radius 12

### `repair_panel`
Params: `{ panelId: t.u64() }`
- Within 1.5 tiles, not repaired, not disabled
- repairPartsHeld ≥ 1 → decrement, set repaired=true, emit noise

### `interact_core`
Params: `{ coreId: t.u64() }`
- Within 1.5 tiles, not activated
- Solo: set activatingIdentity, activationStartUs = now
- Duo: set activatingIdentity (first) or activatingSecondIdentity (second)

### `release_core`
Params: `{ coreId: t.u64() }`
- Clear caller from activating fields; reset activationStartUs if nobody holding

### `spray_graffiti`
Params: `{ x: t.i32(), y: t.i32(), symbol: t.string() }`
- sprayUses > 0 → decrement, insert graffiti row, emit noise radius 10 for 3s

### `revive_player`
Params: `{ targetIdentity: t.identity() }`
- Target downed, within 2 tiles, caller alive
- Start 5s channel (track reviveStartUs on player)
- On completion (checked in tick): target alive, sanity=25, revivesUsed++

### `leave_lobby`
Params: none
- Delete player row; host leaving ends game; empty lobby → delete lobby + game_state

---

## Game Tick (`tick_game`)

Scheduled reducer, runs every 200ms per active lobby.

```typescript
export const tick_game = spacetimedb.reducer({ arg: GameTickSchedule.rowType }, (ctx, { arg }) => { ... })
```

### 5.1 Compute delta
```
deltaUs  = ctx.timestamp.microsSinceUnixEpoch - gameState.lastTickAt.microsSinceUnixEpoch
deltaSec = Number(deltaUs) / 1_000_000
```

### 5.2 Update timer + phase
- Decrement timeRemainingUs by deltaUs
- ≤ 0 → outcome='lose_time', phase='ended', stop scheduling
- > 120s remaining → 'passive'
- 60–120s → 'aggressive'
- < 60s → 'frenzy'

### 5.3 Update all players (each alive player)
- **Stamina**: sprinting → drain (scavenger −33/s, survivor −16/s); still → regen +25/s; hits 0 → isSprinting=false
- **Light fuel**: scavenger −2/s, survivor −5/s; hits 0 → light out
- **Sanity**: in darkness → −1/s; hits 0 → status='downed'

### 5.4 Check revives
- For each downed player being revived: channel ≥ 5s → revive (sanity=25, status='alive')

### 5.5 Core activation progress
- Solo: activatingIdentity present + player within 1.5 tiles + alive → time held ≥ 3s → activated=true
- Duo: both players within 1.5 tiles → same; either leaves → reset both

### 5.6 Win/lose check
- Win: all 3 cores activated → outcome='win', phase='ended'
- Lose: all players status='lost' → outcome='lose_sanity', phase='ended'

### 5.7 Monster AI
(see Monster AI section)

### 5.8 Expire noise events
- Delete noise_event rows where expiresAtUs < now

### 5.9 Phase map events
- Aggressive: every 30s → close a random open door
- Frenzy: every 15s → flicker all repaired panels (repaired=false for 3s then back)
- Frenzy: every 90s → emergency alarm (noise radius 30)

### 5.10 Schedule next tick
- Insert new game_tick_schedule with scheduledAt = now + 200_000µs

---

## Map Generation (inside `start_game`)

20×20 tile grid encoded as flat JSON array. Tile values: `0`=floor, `1`=wall, `2`=door open, `3`=door closed (blocked), `4`=debris (walkable, blocks light).

```
1. Fill all tiles with wall (1)
2. Generate 5–8 rooms (width 3–6, height 3–6), reject overlaps with 1-tile buffer
3. Connect rooms with L-shaped corridors (floor tiles)
4. Add doors at room entrances (30% chance per entrance)
5. Scatter debris in corridors (10% of corridor tiles)
6. Spawn points: room[0] corner for P1, room[-1] corner for P2
7. Cores: 2 solo in mid-distance rooms, 1 duo in most central room
8. Containers: 1–2 per room, not on spawn/core tiles
9. Items: repair parts (2–3), key (1), on floor tiles
10. Power panels: 1 per room in larger rooms (3–4 total)
```

---

## Monster AI (inside tick)

### Speeds
| Phase | Speed |
|-------|-------|
| Passive | 1.5 t/s |
| Aggressive | 3.0 t/s |
| Frenzy | 5.0 t/s |

### State Machine

**Passive:** wandering → picks random floor tile, moves toward it. Investigates very loud noise (radius ≥ 20). Returns to wandering on arrival.

**Aggressive:** finds loudest noise → investigating. Senses players with sanity < 70 → chasing. Phase event: close a random door every 30s.

**Frenzy:** always chasing nearest player regardless of sanity or noise. Ignores light effects. Emergency alarm every 90s.

**Light interaction (not in Frenzy):**
- Flashlight beam hits monster (45° cone, ≤ 8 tiles, P1 fuel > 0) → stunned 5s
- Monster within 3 tiles of survivor (fuel > 0) → fleeing 10s
- Stunned/fleeing: ignore all other inputs

**Contact damage:** within 0.8 tiles of alive player → −50 sanity (cooldown 2s per player)

**Door destruction:** passing through door → 50% chance tile becomes debris (4)

**Panel disabling:** passes within 1 tile of repaired panel (Aggressive+) → disabled=true (permanent)

**Graffiti clawing:** passes within 1 tile of graffiti → 50% chance scratched=true

### Pathfinding
Direction vector toward target each tick. If blocked by wall: try X-only then Y-only (wall sliding). Sufficient for prototype; A* deferred to P1.

---

## Client Architecture

### App.svelte
- `useTable(tables.player)` → check if own identity has active lobbyId
- No player row → `<Lobby />`
- Player row + phase != 'ended' → `<Game />`
- Phase = 'ended' → win/lose screen

### Lobby.svelte
- Username input
- "Create Game" → `conn.reducers.createLobby({ username })`
- "Join Game" input → `conn.reducers.joinLobby({ lobbyId, username })`
- Show lobby code, connected players, ready status
- "Ready" toggle → `conn.reducers.setReady({})`
- Host: "Start Game" (enabled when both ready) → `conn.reducers.startGame({})`

### Game.svelte
- Keyboard: WASD, Shift (sprint), E (interact), G+1–5 (graffiti), R (repair)
- `requestAnimationFrame` loop → `conn.reducers.movePlayer({ dx, dy, facingX, facingY, isSprinting })`
- Phase indicator, timer countdown, win/lose overlay

### GameCanvas.svelte
Renders via HTML5 Canvas (28px/tile, scrolls to keep player centered):
```
Layers (back to front):
1. Map tiles (floor=dark gray, wall=dark brown, door=tan, debris=gray-brown)
2. Darkness mask with holes for flashlight cone + oil lamp radius
3. Items (colored dots)
4. Containers (colored rectangles)
5. Power panels (lit=yellow, unlit=dark, disabled=red X)
6. Graffiti (white symbols, scratched=faded)
7. Cores (pulsing circle — activated=green, inactive=red)
8. Other player (colored circle)
9. Monster (red triangle)
10. Local player (white circle + facing arrow)
```

### HUD.svelte
- Sanity bar (green → yellow → red)
- Light fuel bar (yellow=battery, orange=oil)
- Stamina bar (blue)
- Timer MM:SS (red < 60s)
- Phase indicator
- Spray uses (5 icons)
- Core status (3 icons)

### Controls
| Key | Action |
|-----|--------|
| WASD | Move |
| Shift | Sprint (hold) |
| E | Interact (core / container / item / revive) |
| G + 1–5 | Spray graffiti symbol |
| R | Repair panel (when adjacent) |

---

## Subscription Strategy

All tables `public: true` for prototype. Subscribe all, filter by lobbyId client-side.

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

---

## Constants

### Timing
| | |
|---|---|
| Game duration | 300s (5:00) |
| Aggressive starts | 120s remaining |
| Frenzy starts | 60s remaining |
| Tick interval | 200ms |
| Core activation (solo) | 3s hold |
| Core activation (duo) | 3s hold (both) |
| Flashlight stun | 5s |
| Oil lamp flee | 10s |
| Revive channel | 5s |
| Noise linger | 2s |
| Stamina regen | 4s to full (standing still) |

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

## Implementation Order

1. `schema.ts` — all tables
2. `index.ts` — `create_lobby`, `join_lobby`, `set_ready`, `start_game` (with map gen), `leave_lobby`
3. `index.ts` — `move_player`, `pick_up_item`, `search_container`, `interact_core`, `release_core`
4. `index.ts` — `tick_game` (timer + phase + stamina + sanity + win/lose)
5. Generate bindings (`spacetime generate`)
6. Frontend — `Root.svelte` + `App.svelte` routing
7. Frontend — `Lobby.svelte`
8. Frontend — `GameCanvas.svelte` (map + players + cores)
9. Frontend — `HUD.svelte`
10. Frontend — `Game.svelte` (input + move loop)
11. `index.ts` — `tick_game` monster AI
12. `index.ts` — `spray_graffiti`, `repair_panel`, `revive_player`
13. Frontend — graffiti rendering + spray UI
14. Test full loop: lobby → start → play → win/lose
15. Polish: darkness mask, phase events, AI light reactions
