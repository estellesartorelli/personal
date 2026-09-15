import { LinearAdapter } from './adapters/linear.js';
import { NotionAdapter } from './adapters/notion.js';
import { LocalScanAdapter } from './adapters/localScan.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export function computeHealth(project, { now = Date.now(), staleDays = 7, quietDays = 21 } = {}) {
  if (project.status === 'completed') return 'completed';
  const lastMs = project.lastActivityAt ? Date.parse(project.lastActivityAt) : null;
  const daysSince = lastMs == null || Number.isNaN(lastMs) ? null : (now - lastMs) / DAY_MS;
  if (project.blockedCount > 0) return 'needs-attention';
  if (daysSince == null || daysSince > quietDays) return 'quiet';
  if (daysSince > staleDays) return 'stale';
  return 'active';
}

export class SyncEngine {
  constructor({ store, config, env, adapters = {}, now = Date.now } = {}) {
    this.store = store;
    this.config = config;
    this.env = env;
    this.now = now;
    this.linear = adapters.linear ?? null;
    this.notion = adapters.notion ?? null;
    this.localScan = adapters.localScan ?? null;
    this.running = false;
  }

  buildAdapters() {
    if (this.config.sources?.linear && this.env.LINEAR_API_KEY) {
      this.linear = new LinearAdapter({
        apiKey: this.env.LINEAR_API_KEY,
        projectIds: this.config.linear?.projectIds ?? []
      });
    }
    if (this.config.sources?.notion && this.env.NOTION_API_KEY) {
      this.notion = new NotionAdapter({
        apiKey: this.env.NOTION_API_KEY,
        pageIds: this.config.notion?.pageIds ?? []
      });
    }
    if (this.config.sources?.localScan && this.localScan === null) {
      const scanDirs = (this.env.SCAN_DIRS ?? '').split(',').map((d) => d.trim()).filter(Boolean);
      if (scanDirs.length > 0) {
        this.localScan = new LocalScanAdapter({
          scanDirs,
          ignoreBranches: this.config.localScan?.ignoreBranches,
          maxDirsPerScan: this.config.localScan?.maxDirsPerScan
        });
      }
    }
  }

  async #syncLinear() {
    if (!this.linear) return;
    const projects = await this.linear.fetchProjects();
    for (const p of projects) {
      this.store.upsertProject(p);
      const rawId = p.id.replace(/^linear:/, '');
      const issues = await this.linear.fetchIssues(rawId);
      this.store.replaceItems(p.id, issues);
    }
    this.store.pruneMissingProjects('linear', projects.map((p) => p.id));
  }

  async #syncNotion() {
    if (!this.notion) return;
    const projects = await this.notion.fetchProjects();
    for (const p of projects) {
      this.store.upsertProject(p);
    }
    this.store.pruneMissingProjects('notion', projects.map((p) => p.id));
  }

  async #syncLocalScan() {
    if (!this.localScan) return;
    const repos = await this.localScan.scan();
    for (const repo of repos) {
      const id = `local:${repo.name.toLowerCase()}`;
      this.store.upsertProject({
        id,
        source: 'manual',
        name: repo.name,
        status: 'active',
        description: repo.lastCommit ? `last commit: ${repo.lastCommit}` : null,
        url: repo.dir,
        lastActivityAt: repo.lastActivityAt
      });
      if (repo.lastActivityAt) {
        this.store.replaceItems(id, [
          {
            id: `${id}:commit`,
            kind: 'commit',
            title: repo.lastCommit ?? 'recent commit',
            url: null,
            state: null,
            assignee: null,
            blocked: false,
            updatedAt: repo.lastActivityAt
          }
        ]);
      }
    }
  }

  #recordSource(name, status) {
    const key = `source_${name}`;
    const prev = this.store.getState(key);
    this.store.setState(key, {
      status,
      syncedAt: status === 'ok' ? new Date().toISOString() : prev?.syncedAt ?? null
    });
    return status;
  }

  #recomputeHealth() {
    const nowMs = this.now();
    const staleDays = this.config.staleDays ?? 7;
    const quietDays = this.config.quietDays ?? 21;
    for (const p of this.store.listProjects()) {
      const health = computeHealth(
        { ...p, status: p.status, lastActivityAt: p.last_activity_at, blockedCount: p.blocked_count },
        { now: nowMs, staleDays, quietDays }
      );
      this.store.setHealth(p.id, health);
    }
  }

  async sync() {
    if (this.running) return { skipped: true };
    this.running = true;
    const startedAt = new Date().toISOString();
    const results = { linear: 'skipped', notion: 'skipped', localScan: 'skipped' };
    try {
      this.buildAdapters();
      if (this.linear) {
        try {
          await this.#syncLinear();
          results.linear = this.#recordSource('linear', 'ok');
        } catch (err) {
          results.linear = this.#recordSource('linear', `error: ${err.message}`);
        }
      }
      if (this.notion) {
        try {
          await this.#syncNotion();
          results.notion = this.#recordSource('notion', 'ok');
        } catch (err) {
          results.notion = this.#recordSource('notion', `error: ${err.message}`);
        }
      }
      if (this.localScan) {
        try {
          await this.#syncLocalScan();
          results.localScan = this.#recordSource('localScan', 'ok');
        } catch (err) {
          results.localScan = this.#recordSource('localScan', `error: ${err.message}`);
        }
      }
      this.#recomputeHealth();
      this.store.setState('last_synced_at', new Date().toISOString());
      results.syncedAt = startedAt;
      return results;
    } finally {
      this.running = false;
    }
  }
}
