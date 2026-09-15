# project-radar

A personal web dashboard for context switching: one always-up-to-date view across all of
your projects (Linear, Notion, manual projects, local git repos) plus per-project "resume
where I left off" state.

**Zero dependencies** — pure Node.js standard library, no `npm install` needed.

## Setup

```bash
cp .env.example .env
```

Edit `.env`:

- `LINEAR_API_KEY` — optional, enables the Linear adapter (create a key at
  [Linear → Settings → API](https://linear.app/settings/api)).
- `NOTION_API_KEY` — optional, enables the Notion adapter (create an internal
  integration at [notion.so/profile/integrations](https://www.notion.so/profile/integrations)
  and share the project pages with it).
- `SCAN_DIRS` — optional, comma-separated dirs to scan for git repos for local-activity.
- If no API keys are set, project-radar still runs with manually created projects.

### Data sources config

Optionally edit `data/config.json` to change which sources are enabled, the
stale/quiet thresholds, and which items to sync. See `data/config.example.json`.

- `linear.projectIds` — sync only these Linear projects (UUIDs). The example file
  is prefilled with the projects behind the three program hubs.
- `notion.pageIds` — sync only these Notion pages (the three program hub pages,
  prefilled in the example).

## Run

```bash
npm run dev        # or: node server/dev.js — dashboard at http://localhost:3131
```

The server refreshes all sources on start and then every 15 minutes
(`SYNC_INTERVAL_MINUTES`).

CLI equivalents:

```bash
npm run sync                 # refresh all projects now
npm run switch -- <name>      # mark a project as active and show its resume note
```

## Features

- **Radar view** (`/`): every project in one glance — status chips, blockers, stale
  counts, recent activity (issues from Linear, pages from Notion, commits from local
  repos), grouped by health: Needs attention / Active / Stale / Quiet.
- **Resume/context switch** (`/project/<name>`): write what you were doing and where you
  left off; the note plus the latest activity are always on top when you come back.
  The active project is shown in the "Currently on" banner.
- **Auto sync**: background refresh keeps the view current; projects with nothing
  happening go "Quiet" after a chosen threshold.
- **Manual projects**: add any project with just a name and status, no external tool
  required.

## Architecture

- `server/` — zero-dependency Node server, JSON file store (`data/radar.json`), sync
  engine, adapters (linear, notion, manual, local git scan), REST API.
- `public/` — zero-dependency vanilla JS frontend.
- See `docs/ARCHITECTURE.md` for details.

## Tests

```bash
npm test
```
