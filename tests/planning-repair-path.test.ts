import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repairsView = readFileSync(
  resolve(process.cwd(), "components/planning-repairs-view.tsx"),
  "utf8",
);
const intake = readFileSync(
  resolve(process.cwd(), "components/required-class-intake.tsx"),
  "utf8",
);

describe("planning repair path", () => {
  it("separates existing deterministic structure repairs from missing-class intake", () => {
    expect(repairsView).toContain('repair.status === "MISMATCH"');
    expect(repairsView).toContain('repair.status === "MISSING"');
    expect(repairsView).toContain('repair.status === "AMBIGUOUS"');
    expect(repairsView).toContain("can be brought to the reviewed Rulebook structure without inventing curriculum facts");
    expect(repairsView).toContain("need manager-reviewed intake for the planning facts the Rulebook does not establish");
  });

  it("routes missing classes directly to the reviewed intake section", () => {
    expect(repairsView).toContain('href="#required-class-intake"');
    expect(intake).toContain('id="required-class-intake"');
    expect(intake).toContain("Reviewed class intake");
  });
});
