import assert from 'node:assert/strict';
import { test } from 'node:test';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Store } from '../store.js';
import { createApp } from '../app.js';

async function setup() {
  const store = new Store(path.join(os.tmpdir(), `radar-api-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`));
  const syncEngine = { sync: async () => ({ syncedAt: new Date().toISOString() }) };
  const handler = createApp({ store, syncEngine });
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ store, server, baseUrl: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

async function req(baseUrl, method, url, body) {
  const res = await fetch(`${baseUrl}${url}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, body: await res.json() };
}

test('projects API roundtrip: create, list, note, status, activate, sync', async (t) => {
  const { store, server, baseUrl } = await setup();
  t.after(() => {
    server.close();
    store.close();
  });
  let r = await req(baseUrl, 'POST', '/api/projects', { name: 'Side Project', status: 'active' });
  assert.equal(r.status, 201);
  const id = r.body.project.id;
  assert.match(id, /^manual:/);

  r = await req(baseUrl, 'POST', '/api/projects', { name: 'Side Project' });
  assert.equal(r.status, 409);

  r = await req(baseUrl, 'POST', '/api/projects', {});
  assert.equal(r.status, 400);

  r = await req(baseUrl, 'GET', '/api/projects');
  assert.equal(r.body.projects.length, 1);
  assert.equal(r.body.projects[0].name, 'Side Project');
  assert.equal(r.body.activeProjectId, null);

  r = await req(baseUrl, 'PATCH', `/api/projects/${id}`, { note: 'left off at the auth middleware' });
  assert.equal(r.status, 200);
  assert.equal(r.body.project.note, 'left off at the auth middleware');

  r = await req(baseUrl, 'PATCH', `/api/projects/${id}`, { status: 'bogus' });
  assert.equal(r.status, 400);

  r = await req(baseUrl, 'POST', `/api/projects/${id}/activate`);
  assert.equal(r.status, 200);
  assert.equal(r.body.activeProjectId, id);

  r = await req(baseUrl, 'PATCH', '/api/projects/does-not-exist', { note: 'x' });
  assert.equal(r.status, 404);

  r = await req(baseUrl, 'POST', '/api/sync');
  assert.equal(r.status, 200);
  assert.ok(r.body.syncedAt);

  const indexRes = await fetch(`${baseUrl}/`);
  const html = await indexRes.text();
  assert.ok(html.includes('project-radar'));
});
