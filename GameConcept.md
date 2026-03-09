# Spaceplate: Core Game Loop

## Simplified MVP
Single level, 2 players vs AI monster, procedural map.

---

## Player Characters

| Attribute | Player 1 (Scavenger) | Player 2 (Survivor) |
|-----------|---------------------|---------------------|
| **Light Source** | Flashlight | Oil Lamp |
| **Battery/Oil** | 100% capacity | 80% capacity |
| **Resource Drops** | Rare batteries (1-2/map) | Common oil flasks (4-5/map) |
| **Sprint Speed** | Fast | Slow |
| **Stamina** | Low (drains fast) | High (lasts long) |
| **Sanity** | 100 | 100 |

### Sprint Mechanics
- **Player 1**: Sprint speed 200%, stamina drains in 3s
- **Player 2**: Sprint speed 150%, stamina drains in 6s
- Stamina recharges when standing still (full in 4s)

### Light Mechanics
- **Flashlight** (Player 1): 100 battery, drain 2%/s, beam reaches far
- **Oil Lamp** (Player 2): 80 oil, drain 5%/s, radius around player
- Light sources attract AI — BUT light type affects AI differently:

| Light Source | Effect on AI |
|--------------|---------------|
| **Flashlight** | AI stunned for 5s when beam hits (Frenzy: immune) |
| **Oil Lamp** | AI flees away when in radius (10s flee timer) |
| Both Active | Combined effect |

- Flashlight beam must hit AI to trigger stun
- Oil lamp triggers flee when AI enters radius

### Sanity System
- **Max Sanity**: 100
- **Darkness Drain**: -1 sanity/s when in complete darkness (no light within 3 tiles)
- **AI Attraction**: Sanity < 50 = AI can sense player location
- **Death**: Sanity reaches 0 = player is "lost" (can no longer help)
- **Recovery**: None (hardcore)

---

## Noise System

| Action | Noise Level | AI Reaction |
|--------|-------------|-------------|
| Walking | Low (5m radius) | Ignores |
| Sprinting | Medium (10m radius) | Investigates |
| Talking (chat) | High (15m radius) | Attracts |
| Searching container | High (12m radius) | Investigates |
| Breaking debris | Very High (20m radius) | Rushes toward |

- AI prioritizes louder noises
- Noise lingers for 2s after action stops
- Multiple noise sources = AI picks closest

---

## Lootable Containers

### Container Types
| Container | Contents | Search Time |
|-----------|----------|-------------|
| Cabinet | 50% battery / 30% oil / 5% sanity vial | 1s |
| Crate | 40% battery / 50% oil / 3% sanity vial | 2s |
| Dead Body | Always oil + 20% sanity vial + 10% key | 2s |
| Locked Box | 80% of one resource (requires key) | 3s |

### Spawn Rules
- 8-12 containers per map
- Scattered in rooms, not corridors
- Can only be looted once
- Searching = loud (attracts AI)

### Key System
- 1 key spawns per map
- 90% chance: random room floor
- 10% chance: inside dead body
- Used to open locked boxes

---

## Power System

### Overview
Parts of the map have broken power panels. Players can find repair parts to fix them.

### Repair Parts
- 2-3 repair parts spawn per map (in containers or on floor)
- Each part fixes one power panel
- Fixed panels permanently light up their room section

### AI Interaction
- **AI can permanently disable fixed power panels** (one-time action)
- Once disabled, panel cannot be repaired again
- AI typically does this when players fix a panel (strategic)

### Strategic Value
- Fixed panels = permanent light = no sanity drain in that area
- Players must decide: fix panel (but AI might disable it) or save parts?

---

## Map Generation (Procedural)

### Grid-based dungeon (16x16 to 24x24)
- **Spawn Points**: Opposite corners
- **Core Location**: Random, but at least 8 tiles from either spawn
- **Item Spawns**: 3 power cells scattered randomly
- **Rooms**: 4-8 connected rooms with corridors

### Tiles
| Tile | Walkable | Blocks Light |
|------|----------|--------------|
| Floor | ✓ | No |
| Wall | ✗ | Yes |
| Door (open) | ✓ | No |
| Door (closed) | ✗ | Yes |
| Debris | ✓ | Yes (partial) |

---

## Objectives

### Core System
- **3 Cores** scattered across the map
- **2 Cores** can be activated by a single player (solo activation)
- **1 Core** requires both players to be present simultaneously (duo activation)
- Core locations are fixed (not random) — AI cannot destroy these
- AI cannot disable cores, only players can

### Win Condition
1. Activate **2 cores solo** (each player activates one on their own)
2. Activate **1 core duo** (both players must stand at core and hold interact for 3s)
3. **ALL 3 cores must be active** = POWER RESTORED = WIN
4. Players must coordinate: each take a solo core, then meet for duo

### Lose Condition
- **Both players** sanity reaches 0 (either by death or not reviving)
- Time runs out (5:00)

### Revive System
- When a player reaches 0 sanity, they become "downed"
- Other player can revive them by standing nearby for 5s
- **Each player can only be revived ONCE** per game
- If both players reach 0 sanity = GAME OVER

---

## AI Monster Behavior

### States (Phases)
1. **Passive** (Start - 2:00 remaining)
   - Wander randomly, avoids players
   - Slow movement speed
   - Only investigates very loud noises

2. **Aggressive** (2:00 - 1:00 remaining)
   - Actively hunts nearest player
   - Medium movement speed
   - Investigates any noise
   - Can sense players with sanity < 70
   - **Map Event**: Random doors slam shut every 30s

3. **Frenzy** (1:00 remaining - end)
   - Maximum speed
   - Ignores light (no longer stunned/flees)
   - Can sense all players regardless of sanity
   - Aggressive pursuit
   - **Map Events**: Random power surges + emergency Events (Triggered alarm

### AI Abilities (Passive)
- Moves through dark areas freely
- Faster than player 1, slower than player 2
- Stunned by flashlight (5s), flees from oil lamp (10s) — **disabled in Frenzy**
- **Door Destruction**: 50% chance to destroy door when passing through (leaves debris, visible trail)
- Contact with player = -50 sanity

### Map Events (Triggered by Phase)

| Phase | Event | Effect |
|-------|-------|--------|
| Frenzy | **Power Surge** | Repaired power panels flicker on/off for 3s |
| Frenzy | **Emergency Alarm** | Loud noise across whole map, attracts everyone |

---

## Graffiti System (Attracts AI!)

- Each player carries a **spray can** with 5 uses
- Press hotkey (G) + number to spray premade messages
- Creates **medium noise** (10m radius) for 3 seconds
- AI cannot read messages but **senses the spray location** — investigates
- **AI clawing**: When AI passes near graffiti, it scratches/claws at it, partially obscuring the mark (50% chance per pass)

### Available Graffiti (5 per player)
| Key | Symbol | Meaning |
|-----|--------|---------|
| 1 | → | Go this way |
| 2 | ↑ | Go up |
| 3 | ↓ | Go down |
| 4 | ★ | Found something |
| 5 | ✗ | Don't go here |

- Fresh spray fully visible
- After AI claws: symbol becomes partially scratched (still visible but harder to read)
- Can find **spray refills** in containers (restores 3 uses)
- Strategic: leave trails to find each other, mark danger zones

---

## Game Flow

```
[Create/Join Lobby] → [Loading Screen] → [Spawn Opposite Ends]
        ↓
[Find Each Other] + [Find 3 Power Cells] → [Meet at Core] → [Hold Interact]
        ↓                              ↓
   [Time Runs Out]              [Win - Power On]
        ↓
   [Game Over]
```

---

## MVP Scope Checklist
- [ ] Lobby: create/join by ID
- [ ] 2 distinct players with different stats
- [ ] Procedural map generation
- [ ] Sanity drain in darkness
- [ ] Light sources (flashlight + oil lamp)
- [ ] Flashlight stuns AI (5s), Oil lamp flees AI (10s)
- [ ] Resource pickups (batteries + oil)
- [ ] Sanity vials (slim chance in containers)
- [ ] Key + locked box system
- [ ] Power system (repair parts, AI can disable)
- [ ] 3 Cores (must activate ALL 3 - 2 solo + 1 duo together)
- [ ] Revive system (once per player)
- [ ] Sprint with stamina
- [ ] AI monster pathfinding
- [ ] AI behavior phases (Passive → Aggressive → Frenzy)
- [ ] Map events (door slams, power surges, door chaos, alarm)
- [ ] Win condition (activate all 3 cores)
- [ ] Lose condition (both sanity 0 or time out)
- [ ] Noise system (actions create noise)
- [ ] Lootable containers (search for resources)
- [ ] Graffiti system with spray can (attracts AI)
