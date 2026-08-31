import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface LedgerEntry {
  version: string;
  name: string;
  file: string;
  bytes: number;
  git_blob_sha1: string;
}

interface LedgerManifest {
  source: string;
  verified_at: string;
  entries: LedgerEntry[];
}

const ledgerDir = resolve(process.cwd(), "supabase/production-ledger");
const manifest = JSON.parse(readFileSync(resolve(ledgerDir, "manifest.json"), "utf8")) as LedgerManifest;

function gitBlobSha1(content: Buffer) {
  return createHash("sha1")
    .update(Buffer.from(`blob ${content.length}\0`, "utf8"))
    .update(content)
    .digest("hex");
}

describe("production Supabase migration ledger archive", () => {
  it("pins all verified V2.1 production migrations", () => {
    expect(manifest.source).toBe("production supabase_migrations.schema_migrations");
    expect(manifest.entries).toHaveLength(11);
    expect(new Set(manifest.entries.map((entry) => entry.version)).size).toBe(11);
    expect(new Set(manifest.entries.map((entry) => entry.file)).size).toBe(11);
  });

  it.each(manifest.entries)("keeps $version $name byte-exact", (entry) => {
    const content = readFileSync(resolve(ledgerDir, entry.file));
    expect(content.length).toBe(entry.bytes);
    expect(gitBlobSha1(content)).toBe(entry.git_blob_sha1);
  });
});
