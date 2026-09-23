import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export const SOLVER_MAX_SECONDS = 30;

function issue(code, message) {
  return { code, message };
}

function isLoopbackHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function parseHttpUrl(value, label, failures, { allowLoopback }) {
  if (!value) return null;

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    failures.push(issue("CONFIG_INVALID_URL", `${label} must be a valid http:// or https:// URL.`));
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    failures.push(issue("CONFIG_INVALID_URL", `${label} must use http:// or https://.`));
  }
  if (!allowLoopback && isLoopbackHost(parsed.hostname)) {
    failures.push(issue("CONFIG_LOOPBACK_URL", `${label} may not use a loopback host for staging/deployment.`));
  }
  if (!allowLoopback && parsed.protocol !== "https:") {
    failures.push(issue("CONFIG_INSECURE_URL", `${label} must use HTTPS for staging/deployment.`));
  }
  return parsed;
}

function requiredEnvironmentValue(environment, name, failures) {
  const value = environment[name]?.trim() || "";
  if (!value) failures.push(issue("CONFIG_MISSING", `${name} is missing.`));
  return value;
}

export function validateDeploymentEnvironment(environment = process.env, options = {}) {
  const allowLoopback = options.allowLoopback === true;
  const failures = [];
  const publicUrl = requiredEnvironmentValue(environment, "NEXT_PUBLIC_SUPABASE_URL", failures);
  const publishableKey = requiredEnvironmentValue(environment, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", failures);
  const serviceRoleKey = requiredEnvironmentValue(environment, "SUPABASE_SERVICE_ROLE_KEY", failures);
  const solverUrl = requiredEnvironmentValue(environment, "SOLVER_SERVICE_URL", failures);
  const solverToken = requiredEnvironmentValue(environment, "SOLVER_INTERNAL_TOKEN", failures);
  const appUrl = requiredEnvironmentValue(environment, "APP_URL", failures);
  const maxSecondsText = requiredEnvironmentValue(environment, "SOLVER_MAX_SECONDS", failures);

  parseHttpUrl(publicUrl, "NEXT_PUBLIC_SUPABASE_URL", failures, { allowLoopback });
  parseHttpUrl(solverUrl, "SOLVER_SERVICE_URL", failures, { allowLoopback });
  parseHttpUrl(appUrl, "APP_URL", failures, { allowLoopback });

  const maxSeconds = Number(maxSecondsText);
  if (maxSecondsText && (!Number.isFinite(maxSeconds) || maxSeconds < 1 || maxSeconds > SOLVER_MAX_SECONDS)) {
    failures.push(issue("CONFIG_SOLVER_TIMEOUT", `SOLVER_MAX_SECONDS must be between 1 and ${SOLVER_MAX_SECONDS}.`));
  }
  if (solverToken && solverToken === publishableKey) {
    failures.push(issue("CONFIG_SHARED_CREDENTIAL", "SOLVER_INTERNAL_TOKEN must be separate from the browser publishable key."));
  }
  if (solverToken && solverToken === serviceRoleKey) {
    failures.push(issue("CONFIG_SHARED_CREDENTIAL", "SOLVER_INTERNAL_TOKEN must be separate from the Supabase service-role key."));
  }
  for (const [name, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    SOLVER_INTERNAL_TOKEN: solverToken,
  })) {
    if (value.includes("\r") || value.includes("\n")) {
      failures.push(issue("CONFIG_SECRET_FORMAT", `${name} must be a single-line secret.`));
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    present: [
      ["NEXT_PUBLIC_SUPABASE_URL", publicUrl],
      ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", publishableKey],
      ["SUPABASE_SERVICE_ROLE_KEY", serviceRoleKey],
      ["SOLVER_SERVICE_URL", solverUrl],
      ["SOLVER_INTERNAL_TOKEN", solverToken],
      ["APP_URL", appUrl],
      ["SOLVER_MAX_SECONDS", maxSecondsText],
    ].filter(([, value]) => Boolean(value)).map(([name]) => name),
  };
}

function versionMatch(text, expression, fallback) {
  return text.match(expression)?.[1] || fallback;
}

export function expectedRepositoryVersions(repoRoot) {
  const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const solverDockerfile = readFileSync(path.join(repoRoot, "solver", "Dockerfile"), "utf8");
  const solverService = readFileSync(path.join(repoRoot, "solver", "dwde_solver", "service.py"), "utf8");
  const solverRequirements = readFileSync(path.join(repoRoot, "solver", "requirements.txt"), "utf8");
  const ci = readFileSync(path.join(repoRoot, ".github", "workflows", "ci.yml"), "utf8");
  const migrationNames = readdirSync(path.join(repoRoot, "supabase", "migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const postgresHarness = readFileSync(path.join(repoRoot, "scripts", "test-db.mjs"), "utf8");

  return {
    app: packageJson.version,
    next: packageJson.dependencies?.next,
    node: versionMatch(ci, /node-version:\s*["']?([\d.]+)/, "unknown"),
    npm: versionMatch(ci, /npm@([\d.]+)/, "unknown"),
    solverService: versionMatch(solverService, /SERVICE_VERSION\s*=\s*["']([^"']+)/, "unknown"),
    solverPython: versionMatch(solverDockerfile, /FROM python:([\d.]+)/, "unknown"),
    ortools: versionMatch(solverRequirements, /^ortools==([^\r\n]+)/m, "unknown"),
    postgresImage: versionMatch(postgresHarness, /postgres@sha256:([a-f0-9]+)/, "unknown"),
    migrationHead: migrationNames.at(-1) || "none",
  };
}

export function validateRepositoryContracts(repoRoot) {
  const failures = [];
  const checks = [];
  const requireText = (code, file, text, message) => {
    const content = readFileSync(path.join(repoRoot, file), "utf8");
    if (!content.includes(text)) failures.push(issue(code, message));
    else checks.push(file);
  };

  let vercel;
  try {
    vercel = JSON.parse(readFileSync(path.join(repoRoot, "vercel.json"), "utf8"));
  } catch {
    failures.push(issue("REPO_VERCEL_INVALID", "vercel.json is not valid JSON."));
  }
  if (vercel) {
    const deployments = vercel.git?.deploymentEnabled;
    if (deployments?.["**"] !== false || deployments?.main !== true || deployments?.["preview/**"] !== true) {
      failures.push(issue("REPO_DEPLOYMENT_POLICY", "vercel.json must keep wildcard deployments disabled and allow only main/preview/**."));
    } else checks.push("vercel.json deployment policy");
  }

  requireText("REPO_SOLVER_NON_ROOT", "solver/Dockerfile", "USER solver", "Solver container must run as the non-root solver user.");
  requireText("REPO_SOLVER_HEALTHCHECK", "solver/Dockerfile", "/healthz", "Solver container must probe /healthz.");
  requireText("REPO_SOLVER_SINGLE_WORKER", "solver/Dockerfile", "--workers 1", "Solver container must use one predictable worker.");
  requireText("REPO_SOLVER_AUTH", "solver/README.md", "internal server-to-server credential", "Solver documentation must require server-to-server authentication.");
  requireText("REPO_SOLVER_TIMEOUT", "solver/README.md", "capped server-side at 30 seconds", "Solver documentation must state the 30-second server cap.");

  const envExample = readFileSync(path.join(repoRoot, ".env.example"), "utf8");
  for (const name of [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SOLVER_SERVICE_URL",
    "SOLVER_INTERNAL_TOKEN",
    "SOLVER_MAX_SECONDS",
    "APP_URL",
  ]) {
    if (!new RegExp(`^${name}=`, "m").test(envExample)) failures.push(issue("REPO_ENV_CONTRACT", `.env.example is missing ${name}.`));
  }
  if (/^NEXT_PUBLIC_.*(?:SERVICE_ROLE|INTERNAL_TOKEN)/m.test(envExample)) {
    failures.push(issue("REPO_SECRET_EXPOSURE", ".env.example must not expose server-only credentials with NEXT_PUBLIC_."));
  } else checks.push(".env.example server/public boundary");

  const versions = expectedRepositoryVersions(repoRoot);
  if (Object.values(versions).some((value) => !value || value === "unknown" || value === "none")) {
    failures.push(issue("REPO_VERSION_MANIFEST", "Repository version manifest is incomplete."));
  } else checks.push("repository version manifest");

  return { ok: failures.length === 0, failures, checks, versions };
}
