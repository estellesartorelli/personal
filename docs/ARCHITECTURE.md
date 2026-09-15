# Architecture

```
┌────────────┐     fetch/poll      ┌──────────────────┐
│  Linear    │◄───────────────────┤                  │     upsert     ┌────────┐
│  Notion    │                    │   SyncEngine     │◄───────────────►│ JSON   │
│  local git │───────────────────►│  (every 15 min)  │                │ store  │
└────────────┘   projects/items   └────────┬─────────┘                └───┬────┘
                                            │                              │
                                   REST API │ /api/projects…               │
                                            ▼                              ▼
                                     ┌─────────────┐              ┌─────────────┐
                                     │  Node http   │◄─────────────│ Web UI      │
                                     │  server     │   JSON/HTTP  │ (vanilla JS)│
                                     └─────────────┘              └─────────────┘
```

## Components

- **`server/config.js`** — loads `.env` and `data/config.json` (sources on/off, stale/quiet thresholds).
- **`server/store.js`** — JSON file store (`data/radar.json`), pure Node fs. Collections: `projects`, `items`, `notes`, `state`.
- **`server/adapters/`** — one adapter per source, each normalizing data into a common shape:
  - `linear.js` — GraphQL API; projects + issues (state, assignee, blocked-by).
  - `notion.js` — REST API; shared pages become projects, `last_edited_time` is activity.
  - `localScan.js` — scans `SCAN_DIRS` for git repos; latest commit on non-default branches is activity.
- **`server/sync.js`** — the sync engine: runs adapters, upserts to the store, prunes deleted projects, computes health. Failures per source are captured, not fatal.
- **`server/app.js`** — REST API + static frontend on Node's built-in `http` server (no Express).
- **`public/`** — dependency-free frontend (radar overview + project detail).

## Health model

Per project, recomputed on every sync and on writes:

| health | meaning |
|---|---|
| `needs-attention` | has blocked issues |
| `active` | activity within `staleDays` (default 7) |
| `stale` | no activity for 7–21 days |
| `quiet` | no activity for > `quietDays` (default 21) or no data |
| `completed` | status is completed |

## Context switching

- Each project has a free-text **resume note** (`notes`) — what you were doing and the next step.
- The **active project** (`state.active_project`) powers the "Currently on" banner and the CLI `switch` command.
- The dashboard polls every 60s and the server syncs every 15 min, so the view stays current.

## API

| method | path | purpose |
|---|---|---|
| GET | `/api/projects` | all projects + active id + last sync time |
| GET | `/api/projects/:idOrName` | one project with items |
| POST | `/api/projects` | create manual project |
| PATCH | `/api/projects/:idOrName` | update status and/or resume note |
| POST | `/api/projects/:idOrName/activate` | mark active (context switch) |
| POST | `/api/sync` | trigger sync now |

## Adding a new source

1. Create `server/adapters/<name>.js` exposing `fetchProjects()` → `[{ id: '<name>:…', source, name, status, url, lastActivityAt }]` and optionally item fetching.
2. Register it in `SyncEngine.buildAdapters()` behind `config.sources.<name>` and an env key.
3. Add a key to the sync results object and the UI source chip renders automatically.
