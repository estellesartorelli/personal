import fs from 'node:fs';
import path from 'node:path';

const DONE_STATES = new Set(['done', 'completed', 'canceled', 'cancelled', 'closed', 'shipped']);

const byUpdatedDesc = (a, b) =>
  (Date.parse(b.updated_at ?? '') || 0) - (Date.parse(a.updated_at ?? '') || 0);

export class Store {
  constructor(file) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let parsed = null;
    if (fs.existsSync(file)) {
      try {
        parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        parsed = null;
      }
    }
    this.data = {
      projects: parsed?.projects ?? {},
      items: parsed?.items ?? {},
      notes: parsed?.notes ?? {},
      state: parsed?.state ?? {}
    };
  }

  save() {
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  upsertProject(p, { syncedAt = new Date().toISOString() } = {}) {
    const prev = this.data.projects[p.id] ?? { created_at: new Date().toISOString() };
    this.data.projects[p.id] = {
      ...prev,
      id: p.id,
      name: p.name,
      source: p.source,
      status: p.status ?? 'active',
      health: p.health ?? prev.health ?? 'active',
      description: p.description ?? null,
      url: p.url ?? null,
      last_activity_at: p.lastActivityAt ?? prev.last_activity_at ?? null,
      synced_at: syncedAt
    };
  }

  setStatus(projectId, status) {
    if (this.data.projects[projectId]) this.data.projects[projectId].status = status;
  }

  setHealth(projectId, health) {
    if (this.data.projects[projectId]) this.data.projects[projectId].health = health;
  }

  pruneMissingProjects(source, ids) {
    const keep = new Set(ids);
    for (const id of Object.keys(this.data.projects)) {
      if (this.data.projects[id].source === source && !keep.has(id)) {
        delete this.data.projects[id];
        delete this.data.items[id];
        delete this.data.notes[id];
      }
    }
  }

  replaceItems(projectId, items) {
    this.data.items[projectId] = items.map((it) => ({
      id: it.id,
      kind: it.kind,
      title: it.title,
      url: it.url ?? null,
      state: it.state ?? null,
      assignee: it.assignee ?? null,
      blocked: Boolean(it.blocked),
      updated_at: it.updatedAt ?? null
    }));
  }

  #withCounts(p, itemLimit) {
    const items = (this.data.items[p.id] ?? []).slice().sort(byUpdatedDesc);
    const all = items.length;
    const open = items.filter((it) => it.state === null || !DONE_STATES.has(it.state)).length;
    const blocked = items.filter((it) => it.blocked).length;
    return {
      ...p,
      note: this.data.notes[p.id] ?? null,
      items: items.slice(0, itemLimit),
      open_count: open,
      blocked_count: blocked,
      item_total: all
    };
  }

  listProjects() {
    return Object.values(this.data.projects)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => this.#withCounts(p, 10));
  }

  getProject(idOrName) {
    const byId = this.data.projects[idOrName];
    const p =
      byId ??
      Object.values(this.data.projects).find(
        (x) => x.name.toLowerCase() === String(idOrName).toLowerCase()
      );
    return p ? this.#withCounts(p, 20) : null;
  }

  saveNote(projectId, note) {
    this.data.notes[projectId] = note;
  }

  getActiveProjectId() {
    return this.data.state.active_project ?? null;
  }

  setActiveProject(projectId) {
    this.data.state.active_project = projectId;
  }

  getState(key) {
    return this.data.state[key] ?? null;
  }

  setState(key, value) {
    this.data.state[key] = value;
  }

  close() {
    this.save();
  }
}
