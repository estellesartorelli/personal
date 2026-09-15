import assert from 'node:assert/strict';
import { test } from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../store.js';
import { SyncEngine, computeHealth } from '../sync.js';

function tmpStore() {
  return new Store(path.join(os.tmpdir(), `radar-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`));
}

test('computeHealth classifies projects', () => {
  const now = Date.parse('2025-01-15T00:00:00Z');
  const base = { status: 'active' };
  assert.equal(computeHealth({ ...base, lastActivityAt: '2025-01-14T00:00:00Z', blockedCount: 0 }, { now }), 'active');
  assert.equal(computeHealth({ ...base, lastActivityAt: '2025-01-01T00:00:00Z', blockedCount: 0 }, { now }), 'stale');
  assert.equal(computeHealth({ ...base, lastActivityAt: '2024-10-01T00:00:00Z', blockedCount: 0 }, { now }), 'quiet');
  assert.equal(computeHealth({ ...base, lastActivityAt: '2025-01-14T00:00:00Z', blockedCount: 2 }, { now }), 'needs-attention');
  assert.equal(computeHealth({ ...base, status: 'completed', lastActivityAt: '2025-01-14T00:00:00Z', blockedCount: 0 }, { now }), 'completed');
  assert.equal(computeHealth({ ...base, lastActivityAt: null, blockedCount: 0 }, { now }), 'quiet');
});

test('store upserts projects, saves notes, tracks active project', () => {
  const store = tmpStore();
  try {
    store.upsertProject({ id: 'manual:alpha', source: 'manual', name: 'Alpha', status: 'active' });
    store.upsertProject({ id: 'linear:123', source: 'linear', name: 'Beta', status: 'active' });
    assert.equal(store.listProjects().length, 2);

    store.saveNote('manual:alpha', 'finish the auth refactor');
    assert.equal(store.getProject('Alpha').note, 'finish the auth refactor');

    store.setActiveProject('linear:123');
    assert.equal(store.getActiveProjectId(), 'linear:123');

    store.setStatus('manual:alpha', 'paused');
    assert.equal(store.getProject('manual:alpha').status, 'paused');
  } finally {
    store.close();
  }
});

test('store replaces items and counts blocked/open', () => {
  const store = tmpStore();
  try {
    store.upsertProject({ id: 'linear:9', source: 'linear', name: 'Gamma', status: 'active' });
    store.replaceItems('linear:9', [
      { id: 'i1', kind: 'issue', title: 'Bug A', state: 'open', blocked: true, updatedAt: '2025-01-10T00:00:00Z' },
      { id: 'i2', kind: 'issue', title: 'Task B', state: 'done', blocked: false, updatedAt: '2025-01-11T00:00:00Z' },
      { id: 'i3', kind: 'issue', title: 'Task C', state: 'in progress', blocked: false, updatedAt: '2025-01-12T00:00:00Z' }
    ]);
    const p = store.getProject('linear:9');
    assert.equal(p.items.length, 3);
    const listed = store.listProjects().find((x) => x.id === 'linear:9');
    assert.equal(listed.blocked_count, 1);
    assert.equal(listed.open_count, 2);

    store.replaceItems('linear:9', [{ id: 'i4', kind: 'issue', title: 'New', state: 'open', blocked: false, updatedAt: '2025-01-13T00:00:00Z' }]);
    assert.equal(store.getProject('linear:9').items.length, 1);
  } finally {
    store.close();
  }
});

test('sync engine with fake adapters populates projects and health', async () => {
  const store = tmpStore();
  try {
    const linear = {
      fetchProjects: async () => [
        { id: 'linear:p1', source: 'linear', name: 'Proj One', status: 'active', url: 'https://linear.app/x', lastActivityAt: new Date().toISOString() }
      ],
      fetchIssues: async () => [
        { id: 'linear:i1', kind: 'issue', title: 'Blocked thing', state: 'open', blocked: true, updatedAt: new Date().toISOString() }
      ]
    };
    const notion = {
      fetchProjects: async () => [
        { id: 'notion:page1', source: 'notion', name: 'My Notion Doc', status: 'active', url: 'https://notion.so/x', lastActivityAt: new Date().toISOString() }
      ]
    };
    const engine = new SyncEngine({
      store,
      config: { sources: { linear: true, notion: true } },
      env: {},
      adapters: { linear, notion }
    });
    const results = await engine.sync();
    assert.equal(results.linear, 'ok');
    assert.equal(results.notion, 'ok');

    const projects = store.listProjects();
    assert.equal(projects.length, 2);
    const projOne = projects.find((p) => p.name === 'Proj One');
    assert.equal(projOne.health, 'needs-attention');
    assert.equal(projOne.blocked_count, 1);
    const notionProj = projects.find((p) => p.name === 'My Notion Doc');
    assert.equal(notionProj.health, 'active');

    assert.ok(store.getState('last_synced_at'));
  } finally {
    store.close();
  }
});

test('sync engine prunes projects missing from source', async () => {
  const store = tmpStore();
  try {
    store.upsertProject({ id: 'linear:gone', source: 'linear', name: 'Gone', status: 'active' });
    store.upsertProject({ id: 'linear:kept', source: 'linear', name: 'Kept', status: 'active' });
    store.upsertProject({ id: 'manual:stay', source: 'manual', name: 'Stay', status: 'active' });
    const linear = {
      fetchProjects: async () => [{ id: 'linear:kept', source: 'linear', name: 'Kept', status: 'active', lastActivityAt: new Date().toISOString() }],
      fetchIssues: async () => []
    };
    const engine = new SyncEngine({
      store,
      config: { sources: { linear: true } },
      env: {},
      adapters: { linear }
    });
    await engine.sync();
    const names = store.listProjects().map((p) => p.name);
    assert.ok(!names.includes('Gone'));
    assert.ok(names.includes('Kept'));
    assert.ok(names.includes('Stay'));
  } finally {
    store.close();
  }
});

test('sync engine skips adapters when not configured', async () => {
  const store = tmpStore();
  try {
    const engine = new SyncEngine({ store, config: { sources: {} }, env: {} });
    const results = await engine.sync();
    assert.equal(results.linear, 'skipped');
    assert.equal(results.notion, 'skipped');
    assert.equal(results.localScan, 'skipped');
  } finally {
    store.close();
  }
});
