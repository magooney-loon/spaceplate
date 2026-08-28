# SpacetimeDB CLI

Use this when you need help with the `spacetime` CLI tool — initializing projects, building modules, publishing databases, querying data, managing servers, or troubleshooting CLI issues.

## Quick Reference

### Project Initialization & Development

```bash
# Initialize new project
spacetime init my-project --lang typescript
spacetime init my-project --template <template-id>

# Build module
spacetime build                    # release build
spacetime build --debug            # faster iteration, slower runtime

# Dev mode (auto-rebuild, auto-publish, generates bindings)
spacetime dev
spacetime dev --client-lang typescript --module-bindings-path ./client/src/module_bindings
spacetime dev --server-only        # run only the server, skip client
spacetime dev --skip-generate      # skip binding generation
spacetime dev --skip-publish       # skip publishing step

# Generate client bindings
spacetime generate --lang typescript --out-dir ./bindings --module-path ./server
```

### Publishing & Deployment

```bash
# Publish to Maincloud (default)
spacetime publish my-database --yes

# Publish to local server
spacetime publish my-database --server local --yes

# Clear database and republish
spacetime publish my-database --delete-data always --yes

# Allow breaking client changes
spacetime publish my-database --break-clients --yes
```

### Database Interaction

```bash
# SQL queries (database name optional if configured in spacetime.json)
spacetime sql "SELECT * FROM users"
spacetime sql my-database "SELECT * FROM users"
spacetime sql --interactive         # REPL mode (UNSTABLE)

# Call reducers/functions (each argument is a JSON literal)
spacetime call my-database my_reducer '"value"' '123'

# Subscribe to changes (UNSTABLE)
spacetime subscribe my-database "SELECT * FROM users" --num-updates 10

# View logs
spacetime logs                      # all logs
spacetime logs -f                   # follow logs
spacetime logs -n 100               # up to 100 log lines
spacetime logs --level warn         # filter by severity

# Describe schema (UNSTABLE)
spacetime describe my-database --json
```

### Database Management

```bash
# List databases (UNSTABLE)
spacetime list

# Delete database
spacetime delete my-database

# Rename database
spacetime rename <database-identity> --to new-name
```

### Server Management

```bash
# List configured servers
spacetime server list

# Add server
spacetime server add local --url http://localhost:3000 --default
spacetime server add myserver --url https://my-spacetime.example.com

# Set default server
spacetime server set-default local

# Test connectivity
spacetime server ping local

# Start local instance
spacetime start

# Clear all local database data
spacetime server clear
```

### Authentication

```bash
# Login (opens browser)
spacetime login

# Login with token
spacetime login --spacetimedb-token <token>

# Show login status
spacetime login show

# Logout
spacetime logout
```

## Default Servers

| Name        | URL                         | Protocol | Description                |
| ----------- | --------------------------- | -------- | -------------------------- |
| `maincloud` | `maincloud.spacetimedb.com` | `https`  | Production cloud (default) |
| `local`     | `127.0.0.1:3000`            | `http`   | Local development server   |

## Common Flags

| Flag            | Short | Description                                  |
| --------------- | ----- | -------------------------------------------- |
| `--server`      | `-s`  | Target server (nickname, hostname, or URL)   |
| `--yes`         | `-y`  | Non-interactive mode (skip confirmations)    |
| `--anonymous`   |       | Use anonymous identity                       |
| `--module-path` | `-p`  | Path to module project                       |
| `--delete-data` | `-c`  | Clear data: `always`, `on-conflict`, `never` |

## Troubleshooting

### "Not logged in"

```bash
spacetime login
# Or use --anonymous for public operations
```

### "Server not responding"

```bash
spacetime server ping <server>
# For local: ensure spacetime start is running
```

### "Schema conflict"

```bash
# Clear data and republish
spacetime publish my-db --delete-data always --yes
```

### "Build failed"

```bash
# Check TypeScript toolchain
npx tsc --noEmit
# Ensure dependencies are installed
npm install
```

## Stability Notes

Several CLI commands are marked UNSTABLE and may change:

- `sql`, `call`, `subscribe`, `describe`, `list`, `server` subcommands

Stick to `build`, `publish`, `dev`, `generate`, `init`, `start`, `login`, `logout` for stable workflows.
