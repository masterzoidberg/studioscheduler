import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateDeploymentEnvironment,
  validateRepositoryContracts,
} from "./ops01-config.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));

function printFailures(label, failures) {
  process.stderr.write(`${label}\n`);
  for (const failure of failures) process.stderr.write(`- ${failure.code}: ${failure.message}\n`);
}

function checkRepository() {
  const report = validateRepositoryContracts(repoRoot);
  if (!report.ok) printFailures("OPS-01 repository contract check failed:", report.failures);
  else {
    process.stdout.write(`OPS-01 repository contract PASS: ${report.checks.length} checks; `
      + `app ${report.versions.app}, Next ${report.versions.next}, solver ${report.versions.solverService}, `
      + `migration head ${report.versions.migrationHead}.\n`);
  }
  return report.ok;
}

function checkConfiguration() {
  const report = validateDeploymentEnvironment(process.env, { allowLoopback: args.has("--allow-loopback") });
  if (!report.ok) {
    printFailures("OPS-01 configuration check failed; no secret values were printed:", report.failures);
    process.stderr.write(`Present variables: ${report.present.join(", ") || "none"}.\n`);
  } else {
    process.stdout.write(`OPS-01 configuration PASS: ${report.present.join(", ")}; secret values omitted.\n`);
  }
  return report.ok;
}

function runRestore() {
  if (!args.has("--allow-disposable")) {
    printFailures("OPS-01 restore refused:", [{
      code: "DISPOSABLE_OPT_IN_REQUIRED",
      message: "Pass --allow-disposable; the rehearsal never connects to a shared or production database.",
    }]);
    return false;
  }

  const result = spawnSync(process.execPath, [
    path.join(repoRoot, "scripts", "test-db.mjs"),
    "--target=docker-local",
    "--allow-disposable",
    "--only-ops01",
  ], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    windowsHide: true,
  });
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  if (result.status !== 0) {
    process.stderr.write("OPS-01 restore rehearsal failed; no deployment or external target was attempted.\n");
    return false;
  }
  process.stdout.write("OPS-01 restore rehearsal PASS: disposable backup, isolated restore, reconciliation and migration rollback completed.\n");
  return true;
}

function usage() {
  process.stdout.write([
    "Usage:",
    "  node scripts/ops01-rehearsal.mjs --check-repo",
    "  node scripts/ops01-rehearsal.mjs --check-repo --check-config [--allow-loopback]",
    "  node scripts/ops01-rehearsal.mjs --check-repo --restore --allow-disposable",
  ].join("\n") + "\n");
}

if (!args.has("--check-repo") && !args.has("--check-config") && !args.has("--restore")) {
  usage();
  process.exitCode = 2;
} else {
  const repositoryOk = args.has("--check-repo") ? checkRepository() : true;
  const configurationOk = args.has("--check-config") ? checkConfiguration() : true;
  const restoreOk = args.has("--restore") ? runRestore() : true;
  process.exitCode = repositoryOk && configurationOk && restoreOk ? 0 : 1;
}
