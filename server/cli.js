import path from 'node:path';
import { DATA_DIR, loadConfig, loadEnv } from './config.js';
import { Store } from './store.js';
import { SyncEngine } from './sync.js';

loadEnv();

const command = process.argv[2];
const arg = process.argv[3];

const store = new Store(path.join(DATA_DIR, 'radar.db'));
const syncEngine = new SyncEngine({ store, config: loadConfig(), env: process.env });

const commands = {
  async sync() {
    const results = await syncEngine.sync();
    console.log(JSON.stringify(results, null, 2));
  },
  async switch() {
    if (!arg) {
      const activeId = store.getActiveProjectId();
      const project = activeId ? store.getProject(activeId) : null;
      if (!project) {
        console.log('No active project. Usage: npm run switch -- <project name>');
        return;
      }
      console.log(`Active: ${project.name}`);
      if (project.note) console.log(`\nResume note:\n${project.note}`);
    } else {
      const project = store.getProject(arg);
      if (!project) {
        console.error(`Project not found: ${arg}`);
        process.exitCode = 1;
        return;
      }
      store.setActiveProject(project.id);
      console.log(`Switched to: ${project.name}`);
      if (project.note) console.log(`\nResume note:\n${project.note}`);
    }
  },
  async list() {
    for (const p of store.listProjects()) {
      const marker = p.id === store.getActiveProjectId() ? '*' : ' ';
      console.log(`${marker} ${p.name.padEnd(30)} [${p.health}] open:${p.open_count} blocked:${p.blocked_count}`);
    }
  }
};

const fn = commands[command];
if (!fn) {
  console.error('Usage: node server/cli.js <sync|switch|list> [project name]');
  process.exitCode = 1;
} else {
  await fn();
}
store.close();
