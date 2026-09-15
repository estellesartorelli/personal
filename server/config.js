import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT_DIR, 'data');

const DEFAULT_CONFIG = {
  sources: { linear: true, notion: true, localScan: true },
  localScan: { ignoreBranches: ['main', 'master', 'develop', 'staging'], maxDirsPerScan: 20 },
  staleDays: 7,
  quietDays: 21
};

export function loadConfig() {
  const file = path.join(DATA_DIR, 'config.json');
  if (fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { ...DEFAULT_CONFIG, ...parsed };
    } catch (err) {
      console.error('[config] failed to parse data/config.json, using defaults:', err.message);
    }
  }
  return { ...DEFAULT_CONFIG };
}

export function loadEnv() {
  const envFile = path.join(ROOT_DIR, '.env');
  if (!fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, value] = match;
    if (!(key in process.env)) process.env[key] = value;
  }
}
