const $ = (sel) => document.querySelector(sel);
const state = { activeProjectId: null, projects: [] };

const HEALTH_ORDER = ['needs-attention', 'active', 'stale', 'quiet', 'completed'];
const HEALTH_LABEL = {
  'needs-attention': 'needs attention',
  active: 'active',
  stale: 'stale',
  quiet: 'quiet',
  completed: 'completed'
};

function timeAgo(iso) {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (Number.isNaN(s)) return '';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s ?? '';
  return d.innerHTML;
}

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), 2500);
}

function renderBanner(projects, activeId) {
  const banner = $('#currently-on');
  const active = projects.find((p) => p.id === activeId);
  if (!active) {
    banner.classList.add('hidden');
    return;
  }
  banner.classList.remove('hidden');
  $('#current-name').textContent = active.name;
  const noteEl = $('#current-note');
  noteEl.textContent = active.note ? `"${active.note.slice(0, 120)}"` : 'no resume note yet';
}

function projectCard(p, activeId) {
  const card = document.createElement('div');
  card.className = 'card' + (p.id === activeId ? ' active-card' : '');
  const chips = [`<span class="chip health-${p.health}">${HEALTH_LABEL[p.health] || p.health}</span>`];
  if (p.blocked_count > 0) chips.push(`<span class="chip blocked">blocked ×${p.blocked_count}</span>`);
  if (p.open_count > 0) chips.push(`<span class="chip">${p.open_count} open</span>`);
  chips.push(`<span class="chip">${p.source}</span>`);
  const items = (p.items || []).slice(0, 3).map((it) => `
    <div class="card-item">
      <span class="t">${it.url ? `<a href="${esc(it.url)}" onclick="event.stopPropagation()" target="_blank">${esc(it.title)}</a>` : esc(it.title)}</span>
      <span class="when">${timeAgo(it.updated_at)}</span>
    </div>`).join('');
  card.innerHTML = `
    <div class="card-head">
      <h3 class="card-title">${esc(p.name)}</h3>
      <span class="card-source">${p.source}</span>
    </div>
    <div class="chips">${chips.join('')}</div>
    ${items ? `<div class="card-items">${items}</div>` : ''}
    ${p.note ? `<div class="card-note">📌 ${esc(p.note.slice(0, 100))}${p.note.length > 100 ? '…' : ''}</div>` : ''}
  `;
  card.onclick = () => { location.hash = `#/project/${encodeURIComponent(p.id)}`; };
  return card;
}

function renderRadar({ projects, activeProjectId }) {
  const view = $('#view');
  view.innerHTML = '';
  renderBanner(projects, activeProjectId);

  const newForm = document.createElement('div');
  newForm.className = 'section-title';
  newForm.innerHTML = `
    <h2>Add project</h2>
    <form class="form-row" id="add-form">
      <input id="add-name" placeholder="Project name" required />
      <select id="add-status">
        <option value="active">active</option>
        <option value="paused">paused</option>
        <option value="completed">completed</option>
      </select>
      <button class="btn primary" type="submit">Add</button>
    </form>`;
  view.appendChild(newForm);
  newForm.querySelector('#add-form').onsubmit = async (e) => {
    e.preventDefault();
    const name = newForm.querySelector('#add-name').value;
    const status = newForm.querySelector('#add-status').value;
    try {
      await api('/api/projects', { method: 'POST', body: JSON.stringify({ name, status }) });
      toast(`Added ${name}`);
      await renderRoute();
    } catch (err) {
      toast(err.message, true);
    }
  };

  const visible = projects.filter((p) => p.status !== 'completed' || p.health === 'completed');
  const groups = new Map();
  for (const h of HEALTH_ORDER) groups.set(h, []);
  for (const p of visible) {
    const h = HEALTH_ORDER.includes(p.health) ? p.health : 'active';
    groups.get(h).push(p);
  }

  let any = false;
  for (const h of HEALTH_ORDER) {
    const list = groups.get(h);
    if (!list.length) continue;
    any = true;
    const section = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'section-title';
    title.innerHTML = `<h2>${HEALTH_LABEL[h]} (${list.length})</h2>`;
    const grid = document.createElement('div');
    grid.className = 'grid';
    for (const p of list) grid.appendChild(projectCard(p, activeProjectId));
    section.appendChild(title);
    section.appendChild(grid);
    view.appendChild(section);
  }
  if (!any) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No projects yet — add one above, or configure Linear/Notion in .env and hit Sync now.';
    view.appendChild(empty);
  }
}

function renderDetail(project) {
  const view = $('#view');
  view.innerHTML = '';
  renderBanner([project], project.id === state.activeProjectId ? project.id : state.activeProjectId);

  const back = document.createElement('a');
  back.href = '#/';
  back.className = 'back-link';
  back.textContent = '← all projects';
  view.appendChild(back);

  const head = document.createElement('div');
  head.className = 'detail-head';
  head.innerHTML = `
    <div>
      <h2>${esc(project.name)} <span class="chip health-${project.health}">${HEALTH_LABEL[project.health] || project.health}</span></h2>
      ${project.url ? `<a class="back-link" target="_blank" href="${esc(project.url)}">open in ${esc(project.source)} ↗</a>` : ''}
    </div>
    <div class="detail-actions">
      <select id="status-select">
        <option value="active" ${project.status === 'active' ? 'selected' : ''}>active</option>
        <option value="paused" ${project.status === 'paused' ? 'selected' : ''}>paused</option>
        <option value="completed" ${project.status === 'completed' ? 'selected' : ''}>completed</option>
      </select>
      <button id="activate-btn" class="btn primary">${project.id === state.activeProjectId ? 'Current project' : 'Switch to this'}</button>
    </div>`;
  view.appendChild(head);

  head.querySelector('#status-select').onchange = async (e) => {
    try {
      await api(`/api/projects/${encodeURIComponent(project.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: e.target.value })
      });
      toast(`Status set to ${e.target.value}`);
      await renderRoute();
    } catch (err) {
      toast(err.message, true);
    }
  };
  head.querySelector('#activate-btn').onclick = async () => {
    try {
      await api(`/api/projects/${encodeURIComponent(project.id)}/activate`, { method: 'POST' });
      toast(`Now on: ${project.name}`);
      state.activeProjectId = project.id;
      head.querySelector('#activate-btn').textContent = 'Current project';
      renderBanner([project], project.id);
    } catch (err) {
      toast(err.message, true);
    }
  };

  const noteBox = document.createElement('div');
  noteBox.className = 'note-box';
  noteBox.innerHTML = `
    <h2>Where I left off</h2>
    <textarea id="note-input" placeholder="What you were doing, next step, links…"></textarea>
    <div class="form-row">
      <button id="note-save" class="btn primary">Save note</button>
      <span class="note-meta" id="note-meta"></span>
    </div>`;
  view.appendChild(noteBox);
  const noteInput = noteBox.querySelector('#note-input');
  noteInput.value = project.note || '';
  noteBox.querySelector('#note-meta').textContent = project.note ? 'saved' : '';
  noteBox.querySelector('#note-save').onclick = async () => {
    try {
      await api(`/api/projects/${encodeURIComponent(project.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ note: noteInput.value })
      });
      noteBox.querySelector('#note-meta').textContent = `saved ${new Date().toLocaleTimeString()}`;
      toast('Resume note saved');
    } catch (err) {
      toast(err.message, true);
    }
  };

  const list = document.createElement('div');
  list.className = 'list';
  list.innerHTML = '<h2>Recent activity</h2>';
  const items = project.items || [];
  if (!items.length) {
    list.innerHTML += '<div class="muted">No recent items.</div>';
  }
  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'list-row';
    row.innerHTML = `
      <span>${it.url ? `<a target="_blank" href="${esc(it.url)}">${esc(it.title)}</a>` : esc(it.title)}</span>
      <span style="display:flex;gap:8px;align-items:center">
        <span class="state${it.blocked ? ' blocked' : ''}">${it.blocked ? 'blocked' : esc(it.state || it.kind)}</span>
        <span class="muted">${timeAgo(it.updated_at)}</span>
      </span>`;
    list.appendChild(row);
  }
  view.appendChild(list);
}

async function renderRoute() {
  const hash = location.hash || '#/';
  const detailMatch = hash.match(/^#\/project\/(.+)$/);
  if (detailMatch) {
    const id = decodeURIComponent(detailMatch[1]);
    try {
      const { project } = await api(`/api/projects/${encodeURIComponent(id)}`);
      renderDetail(project);
      return;
    } catch {
      toast('Project not found', true);
      location.hash = '#/';
      return;
    }
  }
  const data = await api('/api/projects');
  state.projects = data.projects;
  state.activeProjectId = data.activeProjectId;
  renderRadar(data);
  const last = data.lastSyncedAt ? `synced ${timeAgo(data.lastSyncedAt)}` : 'never synced';
  $('#last-synced').textContent = last;
}

$('#sync-btn').onclick = async () => {
  const btn = $('#sync-btn');
  btn.disabled = true;
  btn.textContent = 'Syncing…';
  try {
    const result = await api('/api/sync', { method: 'POST' });
    const errs = Object.entries(result).filter(([k, v]) => typeof v === 'string' && v.startsWith('error:'));
    toast(errs.length ? `Sync finished with errors (${errs.map(([k]) => k).join(', ')})` : 'Synced');
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sync now';
    await renderRoute();
  }
};

window.addEventListener('hashchange', renderRoute);
renderRoute();
setInterval(renderRoute, 60000);
