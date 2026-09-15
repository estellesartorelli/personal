import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeHealth } from './sync.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const STATUS_VALUES = new Set(['active', 'paused', 'completed']);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

export function createApp({ store, syncEngine }) {
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

  const sendJson = (res, status, body) => {
    const payload = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
    res.end(payload);
  };

  const readBody = (req) =>
    new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (c) => {
        data += c;
        if (data.length > 1e6) req.destroy();
      });
      req.on('end', () => {
        if (!data) return resolve({});
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error('invalid JSON body'));
        }
      });
      req.on('error', reject);
    });

  const serveStatic = (res, urlPath) => {
    let rel = urlPath === '/' ? '/index.html' : urlPath;
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end('forbidden');
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  };

  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const route = `${req.method} ${url.pathname}`;
    try {
      if (route === 'GET /api/projects') {
        store.save();
        return sendJson(res, 200, {
          projects: store.listProjects(),
          activeProjectId: store.getActiveProjectId(),
          lastSyncedAt: store.getState('last_synced_at'),
          sources: store.listSourceStatuses()
        });
      }

      const detail = route.match(/^GET \/api\/projects\/(.+)$/);
      if (detail) {
        const project = store.getProject(decodeURIComponent(detail[1]));
        if (!project) return sendJson(res, 404, { error: 'project not found' });
        return sendJson(res, 200, { project });
      }

      if (route === 'POST /api/projects') {
        const body = await readBody(req);
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!name) return sendJson(res, 400, { error: 'name is required' });
        if (store.getProject(name)) return sendJson(res, 409, { error: 'project already exists' });
        const id = `manual:${name.toLowerCase().replace(/\s+/g, '-')}`;
        store.upsertProject({
          id,
          source: 'manual',
          name,
          status: STATUS_VALUES.has(body.status) ? body.status : 'active',
          description: body.description ?? null,
          url: null,
          lastActivityAt: new Date().toISOString()
        });
        recomputeHealthFor(id);
        store.save();
        return sendJson(res, 201, { project: store.getProject(id) });
      }

      const patch = route.match(/^PATCH \/api\/projects\/(.+)$/);
      if (patch) {
        const project = store.getProject(decodeURIComponent(patch[1]));
        if (!project) return sendJson(res, 404, { error: 'project not found' });
        const body = await readBody(req);
        if (body.status !== undefined) {
          if (!STATUS_VALUES.has(body.status)) {
            return sendJson(res, 400, { error: `status must be one of ${[...STATUS_VALUES].join(', ')}` });
          }
          store.setStatus(project.id, body.status);
        }
        if (body.note !== undefined) {
          if (typeof body.note !== 'string') return sendJson(res, 400, { error: 'note must be a string' });
          store.saveNote(project.id, body.note);
        }
        recomputeHealthFor(project.id);
        store.save();
        return sendJson(res, 200, { project: store.getProject(project.id) });
      }

      const activate = route.match(/^POST \/api\/projects\/(.+)\/activate$/);
      if (activate) {
        const project = store.getProject(decodeURIComponent(activate[1]));
        if (!project) return sendJson(res, 404, { error: 'project not found' });
        store.setActiveProject(project.id);
        store.save();
        return sendJson(res, 200, { activeProjectId: project.id });
      }

      if (route === 'POST /api/sync') {
        const result = await syncEngine.sync();
        store.save();
        return sendJson(res, 200, result);
      }

      if (req.method === 'GET' || req.method === 'HEAD') {
        return serveStatic(res, url.pathname);
      }

      return sendJson(res, 404, { error: 'not found' });
    } catch (err) {
      console.error('[server]', err.message);
      return sendJson(res, err.message === 'invalid JSON body' ? 400 : 500, { error: err.message });
    }
  };
}
