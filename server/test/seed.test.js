import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../store.js';
import { importSeed } from '../seed.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-seed-'));
const seedFile = path.join(tmpDir, 'seed.json');
const storeFile = path.join(tmpDir, 'radar.json');

fs.writeFileSync(seedFile, JSON.stringify({
  projects: [
    {
      id: 'seed:alpha',
      name: 'Alpha',
      lastActivityAt: new Date().toISOString(),
      items: [
        { id: 'a1', kind: 'issue', title: 'Do a thing', state: 'open', updatedAt: new Date().toISOString() },
        { id: 'a2', kind: 'issue', title: 'Blocked thing', state: 'open', blocked: true, updatedAt: new Date().toISOString() }
      ],
      note: 'Resume here'
    },
    {
      id: 'seed:beta',
      name: 'Beta',
      lastActivityAt: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
      items: []
    }
  ]
}));

test('importSeed imports projects, items, notes, and computes health', () => {
  const store = new Store(storeFile);
  const result = importSeed(store, { seedFile });
  assert.equal(result.imported, 2);
  const projects = store.listProjects();
  assert.equal(projects.length, 2);
  const alpha = store.getProject('seed:alpha');
  assert.equal(alpha.note, 'Resume here');
  assert.equal(alpha.item_total, 2);
  assert.equal(alpha.open_count, 2);
  assert.equal(alpha.blocked_count, 1);
  assert.equal(alpha.health, 'needs-attention');
  const beta = store.getProject('seed:beta');
  assert.equal(beta.health, 'quiet');
  assert.ok(store.getState('seed_imported_at'));
  store.close();
});

test('importSeed skips when already imported unless forced', () => {
  const store = new Store(storeFile);
  assert.equal(store.listProjects().length, 2);
  const skipped = importSeed(store, { seedFile });
  assert.equal(skipped.imported, 0);
  assert.equal(skipped.skipped, true);
  assert.equal(store.listProjects().length, 2);
  store.saveNote('seed:alpha', 'User edited note');
  const forced = importSeed(store, { seedFile, force: true });
  assert.equal(forced.imported, 2);
  assert.equal(store.getProject('seed:alpha').note, 'User edited note');
  store.close();
});

test('importSeed tolerates a missing seed file', () => {
  const store = new Store(path.join(tmpDir, 'other.json'));
  const result = importSeed(store, { seedFile: path.join(tmpDir, 'nope.json') });
  assert.equal(result.imported, 0);
  assert.equal(result.skipped, true);
  assert.equal(store.listProjects().length, 0);
  store.close();
});
