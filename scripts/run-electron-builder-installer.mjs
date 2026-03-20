import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const localAppData =
  process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');

const nsisDir = path.join(
  localAppData,
  'electron-builder',
  'Cache',
  'nsis',
  'nsis-3.0.4.1-nsis-3.0.4.1'
);

if (!fs.existsSync(nsisDir)) {
  console.error(`Local NSIS cache not found: ${nsisDir}`);
  process.exit(1);
}

const child = spawn('electron-builder', ['--win', 'nsis', '--publish', 'never'], {
  cwd: rootDir,
  env: {
    ...process.env,
    ELECTRON_BUILDER_NSIS_DIR: nsisDir,
  },
  stdio: 'inherit',
  shell: true,
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
