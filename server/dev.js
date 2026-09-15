import http from 'node:http';
import path from 'node:path';
import { DATA_DIR, loadConfig, loadEnv } from './config.js';
import { Store } from './store.js';
import { SyncEngine } from './sync.js';
import { createApp } from './app.js';

loadEnv();

const config = loadConfig();
const store = new Store(path.join(DATA_DIR, 'radar.json'));
const syncEngine = new SyncEngine({ store, config, env: process.env });

const handler = createApp({ store, syncEngine });

const port = Number(process.env.PORT || 3131);
http.createServer(handler).listen(port, () => {
  console.log(`[project-radar] dashboard at http://localhost:${port}`);
});

const intervalMinutes = Number(process.env.SYNC_INTERVAL_MINUTES || 15);
const runSync = async () => {
  const results = await syncEngine.sync();
  store.save();
  console.log('[project-radar] sync:', JSON.stringify(results));
};
runSync();
setInterval(runSync, intervalMinutes * 60 * 1000);
