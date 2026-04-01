# Lobby System Design

## Overview

The game supports two lobby modes — **Private** and **Public (Quickplay)**. All lobby state lives in SpacetimeDB; the Svelte 5 client subscribes to lobby/player tables and reacts in real time.

- **Public** is always FFA Deathmatch — no teams, no mode selection
- **Private** supports all three game modes

---

## Game Modes

| Mode | Teams | Default Time Limit | Default Win Condition |
|------|-------|--------------------|-----------------------|
| `deathmatch` | None (FFA) | 10 min | 25 kills |
| `team_deathmatch` | 2 teams | 15 min | 50 kills |
| `capture_the_flag` | 2 teams | 20 min | 3 captures |

- **No friendly fire** — ever, in any mode or lobby type

---

## Win Conditions

### Public
Always FFA Deathmatch. Fixed 10-minute time limit, 25-kill limit. Players cannot change anything.

### Private
The lobby leader can configure before the match starts:

| Mode | Configurable |
|------|-------------|
| Deathmatch | Kill limit (required); time limit (optional, can be disabled) |
| Team Deathmatch | Kill limit (required); time limit (optional, can be disabled) |
| Capture the Flag | Capture limit (required); time limit (optional, can be disabled) |

- At least one win condition must be active (kill/cap limit OR time limit — both can be on simultaneously)
- If only time limit is on: highest kills/caps at expiry wins
- If only kill/cap limit is on: match runs until someone hits the limit (no time cap)
- If both are on: whichever triggers first ends the match

**Configurable ranges:**

| Setting | Min | Max | Default |
|---------|-----|-----|---------|
| Kill limit (DM / TDM) | 5 | 100 | 25 / 50 |
| Capture limit (CTF) | 1 | 10 | 3 |
| Time limit | 2 min | 60 min | mode default |

---

## Lobby Types

### Public Lobby (Quickplay)

- **Always FFA Deathmatch** — no teams, no mode selection, no settings
- No lobby leader
- On queue: player joins an existing public lobby with an open slot; if none exist, a new lobby is created
- Late joining is allowed — players can join mid-match as long as a slot is open (max 8)
- Map is **randomized by the server**
- No ready system — all players are implicitly ready
- Match **auto-starts** after a **2-minute timer** once at least **2 players** are present
  - Timer resets if player count drops below 2
  - If the lobby fills to 8, timer shortens to **10 seconds**
- When a match ends, the lobby immediately rolls a new random mode + map and returns to `WAITING` — the same players stay in the lobby and a new match begins after the timer
- Players can leave at any time; new players can fill vacated slots

### Private Lobby

- Created by a player who becomes the **Lobby Leader**
- A unique **invite code** (6-char alphanumeric) is generated on creation, e.g. `X4KQ2R`
- Other players join by entering the code
- Max **8 players**
- Leader controls:
  - Game mode selection
  - Map selection
  - Kill/capture limit
  - Time limit (and whether it's enabled)
  - Kicking players
  - Starting the match (requires min 2 players; players need not all be ready)
- Non-leader players can:
  - Toggle their **ready** status
  - Switch teams freely (team modes only, pre-match only)
  - Leave the lobby
- When the match ends, lobby returns to `WAITING` with the same settings and players — leader decides when to play again
- No late-joining during an active private match

---

## AFK System

Applies in both lobby types, both in the waiting room and during matches.

- A player is considered AFK if no input is detected for **60 seconds**
- Input tracking: any keyboard, mouse, or gamepad event resets the AFK timer
- On AFK kick:
  - Player is removed from the lobby immediately
  - A system chat message is broadcast: `"[PlayerName] was removed for being AFK"`
  - In public lobbies their slot opens for late join
  - In private lobbies the slot stays empty (leader can reinvite)
  - If the AFK-kicked player was the lobby leader, leadership automatically transfers to the next oldest member

AFK detection runs server-side via a heartbeat. The client sends a heartbeat reducer call whenever input is detected (throttled to at most once per 10 seconds). If the server receives no heartbeat from a player for 60 seconds, they are kicked.

---

## Teams

Applies to `team_deathmatch` and `capture_the_flag` in **private lobbies only**.

- Two teams: **Alpha** and **Bravo**
- Players switch teams freely before the match starts; locked during match
- On join, player is auto-assigned to the team with fewer players (tie → Alpha)

---

## Lobby State Machine

### Public

```
WAITING
  │  (≥2 players → 2-min countdown; drops below 2 → resets)
  │  (lobby fills to 8 → countdown shortens to 10s)
  ▼
COUNTDOWN
  ▼
IN_GAME       (late join allowed if slot open)
  │  (win condition or time limit reached)
  ▼
POST_GAME     (scoreboard ~10s)
  │  (auto-rolls new random mode + map)
  ▼
WAITING       (same players, new game)
```

### Private

```
WAITING
  │  (leader clicks Start, ≥2 players)
  ▼
COUNTDOWN     (3 seconds)
  ▼
IN_GAME       (no late join)
  │  (win condition or time limit reached)
  ▼
POST_GAME     (scoreboard, leader dismisses or 30s auto-dismiss)
  ▼
WAITING       (same lobby, same settings)
```

---

## Player State in Lobby

| Field | Type | Notes |
|-------|------|-------|
| `identity` | Identity | SpacetimeDB identity |
| `displayName` | string | |
| `team` | `alpha \| bravo \| none` | `none` for deathmatch |
| `isReady` | boolean | Private only; always true in public |
| `isLeader` | boolean | Private only |
| `joinedAt` | Timestamp | Used for leader transfer order |
| `lastHeartbeatAt` | Timestamp | Updated on any client input; used for AFK detection |

---

## Invite Codes (Private)

- 6-character alphanumeric (e.g. `X4KQ2R`), case-insensitive on input
- Generated server-side on lobby creation
- Expires when the lobby is disbanded
- Not reused

---

## Lobby Cleanup (Disbanded)

When a lobby is disbanded, the server hard-deletes:
- The `Lobby` row
- All `LobbyMember` rows for that lobby
- All `LobbyChat` rows for that lobby

Nothing is archived or soft-deleted. A lobby is disbanded when:
- **Private**: all players have left (or been kicked/AFK'd out)
- **Public**: all players have left at any point (regardless of match state)

---

## Lobby Chat

- Text only, max **100 characters** per message
- Only the **10 most recent messages** are kept — oldest is dropped when a new one comes in
- System messages for: player joined/left, ready status changes, settings changes, automatic leader transfer, AFK kicks
- Completely wiped when the lobby is disbanded (see above)

---

## SpacetimeDB Tables (Planned)

```
Lobby
  id: u64 (PK, auto-inc)
  lobbyType: "private" | "public"
  gameMode: "deathmatch" | "team_deathmatch" | "capture_the_flag"  -- public always "deathmatch"
  state: "waiting" | "countdown" | "in_game" | "post_game"
  inviteCode: string (nullable, private only)
  leaderId: Identity (nullable, private only)
  mapId: string
  killCapLimit: u32
  timeLimitSecs: u32 (0 = disabled)
  countdownEndsAt: Timestamp (nullable)
  createdAt: Timestamp

LobbyMember
  id: u64 (PK, auto-inc)
  lobbyId: u64 (index)
  identity: Identity (index)
  displayName: string
  team: "alpha" | "bravo" | "none"
  isReady: bool
  isLeader: bool
  joinedAt: Timestamp
  lastHeartbeatAt: Timestamp

LobbyChat
  id: u64 (PK, auto-inc)
  lobbyId: u64 (index)
  senderIdentity: Identity (nullable — null = system message)
  senderName: string
  message: string
  sentAt: Timestamp
```

---

## Reducers (Planned)

| Reducer | Args | Notes |
|---------|------|-------|
| `create_private_lobby` | gameMode, mapId | Creates lobby, sets caller as leader |
| `join_lobby_by_code` | inviteCode | Joins private lobby |
| `join_quickplay` | — | Joins existing open FFA public lobby or creates new one |
| `leave_lobby` | — | Removes caller from current lobby |
| `set_ready` | isReady | Private lobby non-leaders only |
| `switch_team` | team | Private lobby, team modes, pre-match only |
| `update_lobby_settings` | gameMode, mapId, killCapLimit, timeLimitSecs | Leader only |
| `kick_player` | targetIdentity | Leader only |
| `start_match` | — | Leader only, min 2 players |
| `send_chat` | message | Any lobby member |
| `heartbeat` | — | Client sends on input (throttled); updates lastHeartbeatAt |
