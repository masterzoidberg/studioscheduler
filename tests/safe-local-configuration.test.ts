import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSupabasePublicConfiguration } from "@/lib/supabase-config";

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn((_url: string, _key: string, _options?: unknown) => ({ kind: "mock-supabase" })),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: createClientMock }));

const productionHost = "kbgzrefivxqoiwumfyui.supabase.co";

async function importSupabase() {
  vi.resetModules();
  return import("@/lib/supabase");
}

describe("SAFE-02 Supabase configuration", () => {
  beforeEach(() => {
    createClientMock.mockClear();
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports missing and partial configuration without inventing a target", () => {
    const missing = resolveSupabasePublicConfiguration({});
    expect(missing.configured).toBe(false);
    expect(missing.url).toBe("");
    expect(missing.missing).toEqual(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]);
    expect(missing.message).toContain("No Supabase request was attempted");

    const partial = resolveSupabasePublicConfiguration({ url: "http://127.0.0.1:54321" });
    expect(partial.configured).toBe(false);
    expect(partial.missing).toEqual(["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]);
  });

  it("rejects invalid URLs and accepts an explicitly configured loopback target", () => {
    expect(resolveSupabasePublicConfiguration({ url: "not-a-url", publishableKey: "local-key" }).configured).toBe(false);
    const loopback = resolveSupabasePublicConfiguration({ url: "http://127.0.0.1:54321", publishableKey: "local-key" });
    expect(loopback.configured).toBe(true);
    expect(loopback.url).toBe("http://127.0.0.1:54321");
  });

  it("fails before constructing a browser or server client when configuration is missing", async () => {
    const supabase = await importSupabase();
    expect(() => supabase.getBrowserSupabase()).toThrow(/not configured for this environment/i);
    expect(() => supabase.getServerSupabase()).toThrow(/not configured for this environment/i);
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("constructs a client only for an explicit loopback configuration", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "local-publishable-key");
    const supabase = await importSupabase();
    supabase.getServerSupabase("Bearer test-token");
    expect(createClientMock).toHaveBeenCalledTimes(1);
    expect(createClientMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:54321");
    expect(createClientMock.mock.calls[0]?.[1]).toBe("local-publishable-key");
  });

  it("keeps the repository example and client helper free of the former production fallback", () => {
    const helper = readFileSync("lib/supabase.ts", "utf8");
    const example = readFileSync(".env.example", "utf8");
    expect(helper).not.toContain(productionHost);
    expect(example).not.toContain(productionHost);
    expect(example).toContain("http://127.0.0.1:54321");
  });

  it("renders configuration-required state before mounting the workspace provider", () => {
    const layout = readFileSync("app/layout.tsx", "utf8");
    expect(layout).toContain("configuration.configured");
    expect(layout).toContain("ConfigurationRequired");
    expect(layout.indexOf("configuration.configured")).toBeLessThan(layout.lastIndexOf("<WorkspaceProvider>"));
    expect(layout).toContain("No implicit production database");
  });

  it("expands solver CI to shared compiler/gateway/fixture changes", () => {
    const workflow = readFileSync(".github/workflows/solver-ci.yml", "utf8");
    expect(workflow).toContain('"lib/constraint-*.ts"');
    expect(workflow).toContain('"lib/solver-*.ts"');
    expect(workflow).toContain('"tests/fixtures/**"');
  });

  it("contains legacy AI/scenario affordances from primary manager navigation", () => {
    const shell = readFileSync("components/app-shell.tsx", "utf8");
    const nav = readFileSync("components/sidebar-nav.tsx", "utf8");
    const scenarios = readFileSync("components/scenarios-view.tsx", "utf8");
    expect(shell).not.toContain("<CopilotPanel");
    expect(nav).not.toContain('href: "/scenarios"');
    expect(scenarios).toContain("Legacy scenarios are read-only");
    expect(scenarios).not.toContain("createScenario");
  });
});
