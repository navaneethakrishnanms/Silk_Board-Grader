#!/usr/bin/env node
/**
 * `npm run demo` — runs the whole app without MySQL:
 *   engine-svc (Python, :8001) + API in DATA_MODE=memory (:4000) + web dev server (:5173, LAN-visible).
 * Run it from the torch_gpu conda env (python + node). Data lives in memory and resets on restart;
 * uploaded files still go to storage/.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import concurrently from 'concurrently';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const python = process.env.PYTHON ?? 'python';
const run = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

if (!fs.existsSync(path.join(root, 'storage/demo/manifest.json'))) {
  console.log('Generating synthetic demo images (one-off, ~30 s)…');
  run(python, ['tools/make_synthetic.py', '--out', '../../storage/demo', '--cases', 'demo'], path.join(root, 'backend/engine'));
}
if (!fs.existsSync(path.join(root, 'packages/shared/dist/index.js'))) run('npm', ['run', 'build:shared'], root);

const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
console.log(`
  ┌──────────────────────────────────────────────────────────────────┐
  │  SilkGrade DEMO MODE — data is NOT saved                         │
  │  Web:     http://localhost:5173${lan ? `   phone: http://${lan}:5173`.padEnd(34) : ''.padEnd(34)}│
  │  API:     http://localhost:4000/api/v1                           │
  │  Engine:  http://127.0.0.1:8001/docs                             │
  │                                                                  │
  │  Logins:  tester@silkgrade.local   / Tester@12345                │
  │           expert@silkgrade.local   / Expert@12345  (expert A)    │
  │           expert2@silkgrade.local  / Expert@12345  (expert B)    │
  │           admin@silkgrade.local    / Admin@12345                 │
  └──────────────────────────────────────────────────────────────────┘
`);

const { result } = concurrently(
  [
    { name: 'engine', command: `${python} -m uvicorn engine_svc.main:app --host 127.0.0.1 --port 8001`, cwd: path.join(root, 'backend/engine'), prefixColor: 'magenta' },
    { name: 'api', command: 'npm run dev:memory -w @silkgrade/api', cwd: root, prefixColor: 'blue', env: { DATA_MODE: 'memory', NODE_ENV: 'development' } },
    { name: 'web', command: 'npm run dev -w @silkgrade/web -- --host', cwd: root, prefixColor: 'green' },
  ],
  { killOthers: ['failure'], restartTries: 0 },
);
result.catch(() => process.exit(1));
