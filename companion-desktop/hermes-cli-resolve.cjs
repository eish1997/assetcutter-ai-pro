'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

/** Windows 官方安装：%LOCALAPPDATA%\\hermes；Linux/macOS：~/.hermes */
function hermesHomeDir() {
  const fromEnv = process.env.HERMES_HOME != null ? String(process.env.HERMES_HOME).trim() : '';
  if (fromEnv) return path.resolve(fromEnv);
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(local, 'hermes');
  }
  return path.join(os.homedir(), '.hermes');
}

function hermesInstallDir() {
  return path.join(hermesHomeDir(), 'hermes-agent');
}

function hermesEnvPath() {
  return path.join(hermesHomeDir(), '.env');
}

function listHermesCliCandidates() {
  const home = hermesHomeDir();
  const installDir = hermesInstallDir();
  return [
    path.join(installDir, 'venv', 'Scripts', 'hermes.exe'),
    path.join(installDir, '.venv', 'Scripts', 'hermes.exe'),
    path.join(installDir, 'venv', 'bin', 'hermes'),
    path.join(home, 'bin', 'hermes.exe'),
    path.join(home, 'Scripts', 'hermes.exe'),
  ];
}

function walkFindHermesExe(root, depth, maxDepth) {
  if (depth > maxDepth || !root || !fs.existsSync(root)) return '';
  const base = path.basename(root).toLowerCase();
  if (base === 'node_modules' || base === '.git') return '';
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return '';
  }
  for (const ent of entries) {
    const full = path.join(root, ent.name);
    if (ent.isFile() && /^hermes\.exe?$/i.test(ent.name)) return full;
    if (ent.isDirectory()) {
      const hit = walkFindHermesExe(full, depth + 1, maxDepth);
      if (hit) return hit;
    }
  }
  return '';
}

function findHermesCli() {
  if (process.platform === 'win32') {
    try {
      const r = spawnSync('where', ['hermes'], { encoding: 'utf8', shell: true, windowsHide: true });
      if (r.status === 0) {
        for (const line of String(r.stdout || '').split(/\r?\n/)) {
          const t = line.trim();
          if (t && fs.existsSync(t) && /hermes\.exe$/i.test(t)) return t;
        }
      }
    } catch {
      /* ignore */
    }
  } else {
    const r = spawnSync('which', ['hermes'], { encoding: 'utf8' });
    if (r.status === 0) {
      const line = String(r.stdout || '').trim();
      if (line && fs.existsSync(line)) return line;
    }
  }

  for (const p of listHermesCliCandidates()) {
    if (fs.existsSync(p)) return p;
  }

  const installDir = hermesInstallDir();
  if (fs.existsSync(installDir)) {
    const hit = walkFindHermesExe(installDir, 0, 6);
    if (hit) return hit;
  }
  return '';
}

function readHermesEnvValue(key) {
  const envPath = hermesEnvPath();
  if (!fs.existsSync(envPath)) return '';
  try {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`));
      if (m) return String(m[1]).trim().replace(/^["']|["']$/g, '');
    }
  } catch {
    /* ignore */
  }
  return '';
}

module.exports = {
  hermesHomeDir,
  hermesInstallDir,
  hermesEnvPath,
  findHermesCli,
  readHermesEnvValue,
};
