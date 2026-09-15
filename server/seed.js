import fs from 'node:fs';
import path from 'node:path';
import { computeHealth } from './sync.js';
import { DATA_DIR } from './config.js';

export function importSeed(store, { seedFile = path.join(DATA_DIR, 'seed.json'), force = false } = {}) {
  if (!fs.existsSync(seedFile)) return { imported: 0, skipped: true };
  let seed;
  try {
    seed = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
  } catch (err) {
    return { imported: 0, error: `invalid seed.json: ${err.message}` };
  }
  if (!force && store.getState('seed_imported_at')) {
    return { imported: 0, skipped: true, reason: 'already imported' };
  }
  let imported = 0;
  for (const p of seed.projects ?? []) {
    if (!p.id || !p.name) continue;
    store.upsertProject({
      id: p.id,
      source: p.source ?? 'seed',
      name: p.name,
      status: p.status ?? 'active',
      description: p.description ?? null,
      url: p.url ?? null,
      lastActivityAt: p.lastActivityAt ?? null
    });
    if (Array.isArray(p.items)) {
      store.replaceItems(p.id, p.items);
    }
    if (typeof p.note === 'string' && p.note) {
      if (!store.getProject(p.id)?.note) store.saveNote(p.id, p.note);
    }
    const proj = store.getProject(p.id);
    store.setHealth(p.id, computeHealth(
      { status: proj.status, lastActivityAt: proj.last_activity_at, blockedCount: proj.blocked_count },
      { now: Date.now() }
    ));
    imported += 1;
  }
  store.setState('seed_imported_at', new Date().toISOString());
  store.save();
  return { imported };
}
