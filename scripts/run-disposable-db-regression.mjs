import { spawnSync } from 'node:child_process';

const [script, ...args] = process.argv.slice(2);
if (!script) {
  process.stderr.write('Usage: node scripts/run-disposable-db-regression.mjs <script> [...args]\n');
  process.exit(2);
}

const transientStartup = /connection to server on socket[\s\S]*No such file or directory[\s\S]*Is the server running locally/i;

for (let attempt = 1; attempt <= 2; attempt += 1) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';

  if (result.status === 0) {
    process.stdout.write(stdout);
    process.stderr.write(stderr);
    process.exit(0);
  }

  const combined = `${stdout}\n${stderr}`;
  if (attempt === 1 && transientStartup.test(combined)) {
    process.stderr.write(`Disposable PostgreSQL startup socket disappeared; retrying ${script} once with a fresh container.\n`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    continue;
  }

  process.stdout.write(stdout);
  process.stderr.write(stderr);
  process.exit(result.status || 1);
}
