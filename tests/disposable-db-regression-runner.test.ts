import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const runner = path.resolve(process.cwd(), 'scripts', 'run-disposable-db-regression.mjs');

function fixture(root: string) {
  const script = path.join(root, 'fixture.mjs');
  writeFileSync(script, `
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const [counterPath, mode] = process.argv.slice(2);
const count = existsSync(counterPath) ? Number(readFileSync(counterPath, 'utf8')) + 1 : 1;
writeFileSync(counterPath, String(count));
if (mode === 'transient' && count < 3) {
  process.stderr.write('psql: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed: No such file or directory\\nIs the server running locally and accepting connections on that socket?\\n');
  process.exit(1);
}
if (mode === 'hard') {
  process.stderr.write('SQL assertion failed: deterministic witness mismatch\\n');
  process.exit(1);
}
process.stdout.write('fixture pass\\n');
`, 'utf8');
  return script;
}

describe('disposable DB regression transport retry', () => {
  it('recovers from repeated recognized startup-socket loss with fresh bounded attempts', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'studio-db-runner-'));
    try {
      const child = fixture(root);
      const counter = path.join(root, 'counter.txt');
      const result = spawnSync(process.execPath, [runner, child, counter, 'transient'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        windowsHide: true,
      });

      expect(result.status).toBe(0);
      expect(readFileSync(counter, 'utf8')).toBe('3');
      expect(result.stderr).toContain('attempt 2/4');
      expect(result.stderr).toContain('attempt 3/4');
      expect(result.stdout).toContain('fixture pass');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('never retries SQL or assertion failures', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'studio-db-runner-'));
    try {
      const child = fixture(root);
      const counter = path.join(root, 'counter.txt');
      const result = spawnSync(process.execPath, [runner, child, counter, 'hard'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        windowsHide: true,
      });

      expect(result.status).not.toBe(0);
      expect(readFileSync(counter, 'utf8')).toBe('1');
      expect(`${result.stdout}${result.stderr}`).toContain('deterministic witness mismatch');
      expect(result.stderr).not.toContain('retrying');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
