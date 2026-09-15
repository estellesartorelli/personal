import express from 'express';
import path from 'node:path';
import { ROOT_DIR } from './config.js';
import { computeHealth } from './sync.js';

const STATUS_VALUES = new Set(['active', 'paused', 'completed']);

export function createApp({ store, syncEngine }) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(ROOT_DIR, 'public')));

  const recomputeHealthFor = (projectId) => {
    const p = store.getProject(projectId);
    if (!p) return null;
    const health = computeHealth(
      { status: p.status, lastActivityAt: p.last_activity_at, blockedCount: p.blocked_count },
      { now: Date.now() }
    );
    store.setHealth(p.id, health);
    return health;
  };

  app.get('/api/projects', (req, res) => {
    const projects = store.listProjects();
    const activeId = store.getActiveProjectId();
    res.json({ projects, activeProjectId: activeId, lastSyncedAt: store.getState('last_synced_at') });
  });

  app.get('/api/projects/:idOrName', (req, res) => {
    const project = store.getProject(req.params.idOrName);
    if (!project) return res.status(404).json({ error: 'project not found' });
    res.json({ project });
  });

  app.post('/api/projects', (req, res) => {
    const { name, status, description } = req.body ?? {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (store.getProject(name.trim())) {
      return res.status(409).json({ error: 'project already exists' });
    }
    const id = `manual:${name.trim().toLowerCase().replace(/\s+/g, '-')}`;
    store.upsertProject({
      id,
      source: 'manual',
      name: name.trim(),
      status: STATUS_VALUES.has(status) ? status : 'active',
      description: description ?? null,
      url: null,
      lastActivityAt: new Date().toISOString()
    });
    recomputeHealthFor(id);
    res.status(201).json({ project: store.getProject(id) });
  });

  app.patch('/api/projects/:idOrName', (req, res) => {
    const project = store.getProject(req.params.idOrName);
    if (!project) return res.status(404).json({ error: 'project not found' });
    const { status, note } = req.body ?? {};
    if (status !== undefined) {
      if (!STATUS_VALUES.has(status)) {
        return res.status(400).json({ error: `status must be one of ${[...STATUS_VALUES].join(', ')}` });
      }
      store.setStatus(project.id, status);
    }
    if (note !== undefined) {
      if (typeof note !== 'string') return res.status(400).json({ error: 'note must be a string' });
      store.saveNote(project.id, note);
    }
    recomputeHealthFor(project.id);
    res.json({ project: store.getProject(project.id) });
  });

  app.post('/api/projects/:idOrName/activate', (req, res) => {
    const project = store.getProject(req.params.idOrName);
    if (!project) return res.status(404).json({ error: 'project not found' });
    store.setActiveProject(project.id);
    res.json({ activeProjectId: project.id });
  });

  app.post('/api/sync', async (req, res) => {
    const result = await syncEngine.sync();
    res.json(result);
  });

  app.use((err, req, res, next) => {
    console.error('[server]', err);
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}
