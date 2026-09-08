import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const python = (process.env.PYTHON_BINARY || 'python').trim();

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env,
    windowsHide: true,
    stdio: 'inherit',
  });
  if (result.error) throw new Error(`${command} could not be started: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const probe = spawnSync(python, ['-c', 'import ortools'], {
  cwd: repoRoot,
  encoding: 'utf8',
  windowsHide: true,
});
if (probe.error || probe.status !== 0) {
  process.stderr.write(
    'Parity verification requires the pinned Python solver dependencies. Create an isolated environment and install solver/requirements.txt, then rerun npm run test:parity.\n',
  );
  process.exit(1);
}

const vitestEntry = path.join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs');
run(process.execPath, [vitestEntry, 'run', 'tests/runtime-parity.test.ts'], {
  ...process.env,
  STUDIO_SCHEDULER_PARITY: '1',
  PYTHON_BINARY: python,
});
