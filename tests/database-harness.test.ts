import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const harness = path.resolve(process.cwd(), 'scripts', 'test-db.mjs');

function runTargetCheck(overrides: Record<string, string>, args = ['--check-target']) {
  const env = { ...process.env };
  for (const key of ['STUDIO_SCHEDULER_TEST_DB_TARGET', 'STUDIO_SCHEDULER_TEST_DB_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL']) {
    delete env[key];
  }
  Object.assign(env, overrides);
  return spawnSync(process.execPath, [harness, ...args], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
    windowsHide: true,
  });
}

describe('disposable database harness safety checks', () => {
  it('accepts only the local disposable target without opening a database', () => {
    const result = runTargetCheck({ STUDIO_SCHEDULER_TEST_DB_TARGET: 'docker-local' });

    expect(result.status).toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('no database connection was opened');
  });

  it('rejects the configured production Supabase target', () => {
    const result = runTargetCheck({
      NEXT_PUBLIC_SUPABASE_URL: 'https://kbgzrefivxqoiwumfyui.supabase.co',
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('Refusing production target');
  });

  it('rejects a production target passed on the command line', () => {
    const result = runTargetCheck({}, ['--target=production', '--check-target']);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('Only the disposable Docker target');
  });

  it('rejects an external disposable override instead of connecting to it', () => {
    const result = runTargetCheck({
      STUDIO_SCHEDULER_TEST_DB_URL: 'postgresql://staging.example.test:5432/postgres',
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('Refusing external target');
  });

  it('fails clearly when invoked without an explicit disposable opt-in', () => {
    const env = { ...process.env };
    for (const key of ['STUDIO_SCHEDULER_TEST_DB_TARGET', 'STUDIO_SCHEDULER_TEST_DB_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL', 'STUDIO_SCHEDULER_TEST_DB_ALLOW_DISPOSABLE']) {
      delete env[key];
    }
    const result = spawnSync(process.execPath, [harness], {
      cwd: process.cwd(),
      env,
      encoding: 'utf8',
      windowsHide: true,
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('explicit disposable opt-in');
  });
});
