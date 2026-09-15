import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

export class Store {
  constructor(dbFile) {
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    this.db = new Database(dbFile);
    this.db.pragma('journal_mode = WAL');
    this.#migrate();
  }

  #migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        source TEXT NOT NULL,                -- linear | notion | manual
        status TEXT NOT NULL DEFAULT 'active',
        health TEXT NOT NULL DEFAULT 'active',
        description TEXT,
        url TEXT,
        last_activity_at TEXT,
        synced_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,                  -- issue | page | commit
        title TEXT NOT NULL,
        url TEXT,
        state TEXT,                          -- open/done etc
        assignee TEXT,
        blocked INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_items_project ON items(project_id);
      CREATE TABLE IF NOT EXISTS context_notes (
        project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        note TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS state (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);
  }

  upsertProject(p, { syncedAt = new Date().toISOString() } = {}) {
    this.db
      .prepare(
        `INSERT INTO projects (id, name, source, status, health, description, url, last_activity_at, synced_at)
         VALUES (@id, @name, @source, @status, @health, @description, @url, @lastActivityAt, @syncedAt)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name, source=excluded.source, status=excluded.status,
           health=excluded.health, description=excluded.description, url=excluded.url,
           last_activity_at=excluded.last_activity_at, synced_at=excluded.synced_at`
      )
      .run({
        id: p.id,
        name: p.name,
        source: p.source,
        status: p.status ?? 'active',
        health: p.health ?? 'active',
        description: p.description ?? null,
        url: p.url ?? null,
        lastActivityAt: p.lastActivityAt ?? null,
        syncedAt
      });
  }

  setStatus(projectId, status) {
    this.db.prepare('UPDATE projects SET status = ? WHERE id = ?').run(status, projectId);
  }

  setHealth(projectId, health) {
    this.db.prepare('UPDATE projects SET health = ? WHERE id = ?').run(health, projectId);
  }

  updateLastActivity(projectId, iso) {
    this.db.prepare('UPDATE projects SET last_activity_at = ? WHERE id = ?').run(iso, projectId);
  }

  pruneMissingProjects(source, ids) {
    const keep = new Set(ids);
    const rows = this.db.prepare('SELECT id FROM projects WHERE source = ?').all(source);
    for (const { id } of rows) {
      if (!keep.has(id)) {
        this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
      }
    }
  }

  replaceItems(projectId, items) {
    const del = this.db.prepare('DELETE FROM items WHERE project_id = ?');
    const ins = this.db.prepare(
      `INSERT INTO items (id, project_id, kind, title, url, state, assignee, blocked, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const tx = this.db.transaction(() => {
      del.run(projectId);
      for (const it of items) {
        ins.run(
          it.id,
          projectId,
          it.kind,
          it.title,
          it.url ?? null,
          it.state ?? null,
          it.assignee ?? null,
          it.blocked ? 1 : 0,
          it.updatedAt ?? null
        );
      }
    });
    tx();
  }

  listProjects() {
    const projects = this.db
      .prepare(
        `SELECT p.*, (SELECT note FROM context_notes WHERE project_id = p.id) AS note
         FROM projects p ORDER BY p.name`
      )
      .all();
    const itemsStmt = this.db.prepare(
      'SELECT * FROM items WHERE project_id = ? ORDER BY updated_at DESC LIMIT 10'
    );
    const countsStmt = this.db.prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(blocked) AS blocked,
         SUM(CASE WHEN state IS NULL OR state NOT IN ('done','completed','canceled','cancelled','closed','shipped') THEN 1 ELSE 0 END) AS open_count
       FROM items WHERE project_id = ?`
    );
    for (const p of projects) {
      p.items = itemsStmt.all(p.id);
      const c = countsStmt.get(p.id);
      p.open_count = c.open_count || 0;
      p.blocked_count = c.blocked || 0;
    }
    return projects;
  }

  getProject(idOrName) {
    const p = this.db
      .prepare(
        `SELECT p.*, (SELECT note FROM context_notes WHERE project_id = p.id) AS note
         FROM projects p WHERE p.id = ? OR p.name = ? COLLATE NOCASE`
      )
      .get(idOrName, idOrName);
    if (!p) return null;
    p.items = this.db
      .prepare('SELECT * FROM items WHERE project_id = ? ORDER BY updated_at DESC LIMIT 20')
      .all(p.id);
    return p;
  }

  saveNote(projectId, note) {
    this.db
      .prepare(
        `INSERT INTO context_notes (project_id, note, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(project_id) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at`
      )
      .run(projectId, note);
  }

  getActiveProjectId() {
    const row = this.db.prepare("SELECT value FROM state WHERE key = 'active_project'").get();
    return row?.value ?? null;
  }

  setActiveProject(projectId) {
    this.db
      .prepare(
        `INSERT INTO state (key, value) VALUES ('active_project', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(projectId);
  }

  getState(key) {
    const row = this.db.prepare('SELECT value FROM state WHERE key = ?').get(key);
    return row?.value ?? null;
  }

  setState(key, value) {
    this.db
      .prepare('INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  close() {
    this.db.close();
  }
}
