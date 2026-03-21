import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(rootDir, '.env');
const ENV_KEY = 'PROVIDER_MINIMAX_KEY';

function stripQuotes(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readEnvKeyFromFile(filePath, key) {
  if (!fs.existsSync(filePath)) {
    return '';
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    if (!trimmed.startsWith(`${key}=`)) {
      continue;
    }
    const rawValue = trimmed.slice(key.length + 1);
    return stripQuotes(rawValue);
  }
  return '';
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: 'inherit',
      ...options,
    });

    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

async function main() {
  const minimaxKey = process.env[ENV_KEY] || readEnvKeyFromFile(envPath, ENV_KEY);
  if (!minimaxKey || minimaxKey.length < 10) {
    console.error(
      `[minimax-ui-regression] Missing ${ENV_KEY}. Please set it in shell env or .env.`,
    );
    process.exit(1);
  }

  const env = { ...process.env, [ENV_KEY]: minimaxKey };
  const tests = ['browser-task-ui-minimax.test.ts', 'electron-task-ui-minimax.test.ts'];
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  console.log('[minimax-ui-regression] Starting MiniMax UI regression tests...');
  for (const testFile of tests) {
    console.log(`[minimax-ui-regression] Running ${testFile}`);
    const code = await runCommand(npmCommand, ['run', '--prefix', 'server', 'test', '--', testFile], {
      env,
    });
    if (code !== 0) {
      console.error(`[minimax-ui-regression] ${testFile} failed with exit code ${code}`);
      process.exit(code);
    }
  }

  console.log('[minimax-ui-regression] All MiniMax UI regression tests passed.');
}

main().catch((error) => {
  console.error('[minimax-ui-regression] Unexpected error:', error);
  process.exit(1);
});
