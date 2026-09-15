import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class LocalScanAdapter {
  constructor({ scanDirs, ignoreBranches = [], maxDirsPerScan = 20 } = {}) {
    this.scanDirs = (scanDirs ?? []).filter(Boolean);
    this.ignoreBranches = new Set(ignoreBranches);
    this.maxDirsPerScan = maxDirsPerScan;
  }

  async #git(cwd, ...args) {
    try {
      const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], {
        maxBuffer: 10 * 1024 * 1024
      });
      return stdout;
    } catch {
      return null;
    }
  }

  async #repoDirs() {
    const dirs = [];
    for (const root of this.scanDirs) {
      let entries = [];
      try {
        entries = fs.readdirSync(root, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const full = path.join(root, entry.name);
        if (fs.existsSync(path.join(full, '.git'))) dirs.push(full);
        if (dirs.length >= this.maxDirsPerScan) return dirs;
      }
    }
    return dirs;
  }

  async #latestBranchActivity(repoDir) {
    const branches = (await this.#git(repoDir, 'for-each-ref', '--format=%(refname:short)', 'refs/heads'))?.trim();
    if (!branches) return null;
    let best = null;
    for (const branch of branches.split('\n').map((b) => b.trim()).filter(Boolean)) {
      if (this.ignoreBranches.has(branch)) continue;
      const iso = (await this.#git(
        repoDir,
        'log', '-1', '--format=%cI', branch
      ))?.trim();
      if (!iso) continue;
      if (!best || iso > best.date) best = { branch, date: iso };
    }
    return best;
  }

  async scan() {
    const results = [];
    for (const dir of await this.#repoDirs()) {
      const name = path.basename(dir);
      const branchOut = await this.#git(dir, 'rev-parse', '--abbrev-ref', 'HEAD');
      const branch = branchOut?.trim();
      const activity = await this.#latestBranchActivity(dir);
      const lastCommitTs = activity?.date ?? null;
      let lastCommitSubject = null;
      if (activity) {
        const subject = await this.#git(
          dir,
          'log', '-1', '--format=%s', activity.branch
        );
        lastCommitSubject = subject?.trim() ?? null;
      }
      results.push({
        dir,
        name,
        branch,
        lastActivityAt: lastCommitTs,
        lastCommit: lastCommitSubject
      });
    }
    return results;
  }
}
