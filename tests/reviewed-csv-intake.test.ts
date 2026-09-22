import { describe, expect, it } from "vitest";
import {
  exportReviewedCsvBundle,
  parseReviewedCsvBundle,
  type ReviewedCsvBundle,
  type ReviewedCsvInventory,
} from "@/lib/reviewed-csv-intake";

const emptyInventory: ReviewedCsvInventory = {
  teachers: [],
  students: [],
  classes: [],
};

const bundle = (overrides: Partial<ReviewedCsvBundle> = {}): ReviewedCsvBundle => ({
  teachers: "id,name,notes\nteacher-a,Alex,\n",
  students: "id,name,level\nstudent-a,Jordan,Level 1\n",
  classes: "id,name,subject,level,duration_minutes,weekly_frequency,company_only\nclass-a,Beginner Jazz,Jazz,1,45,1,false\n",
  roster: "class_id,student_id\nclass-a,student-a\n",
  ...overrides,
});

describe("reviewed CSV intake", () => {
  it("parses explicit IDs and produces canonical planning rows", () => {
    const result = parseReviewedCsvBundle(bundle(), emptyInventory);

    expect(result.valid).toBe(true);
    expect(result.rows).toEqual([
      { entityType: "TEACHER", operation: "CREATE", entityId: "teacher-a", changes: { name: "Alex" } },
      { entityType: "STUDENT", operation: "CREATE", entityId: "student-a", changes: { name: "Jordan", level: "Level 1" } },
      {
        entityType: "CLASS",
        operation: "CREATE",
        entityId: "class-a",
        changes: {
          name: "Beginner Jazz", subject: "Jazz", level: "1", durationMinutes: 45,
          weeklyFrequency: 1, companyOnly: false, rosterStudentIds: ["student-a"],
        },
      },
    ]);
  });

  it("rejects malformed rows and formula-like exported strings", () => {
    const result = parseReviewedCsvBundle(bundle({
      students: "id,name,level\nstudent-a,=HYPERLINK(\"https://evil.test\"),Level 1\n",
      classes: "id,name,subject,level,duration_minutes,weekly_frequency,company_only\nclass-a,Class,Jazz,1,45\n",
    }), emptyInventory);

    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.code === "FORMULA_LIKE_VALUE")).toBe(true);
    expect(result.errors.some((issue) => issue.code === "COLUMN_COUNT")).toBe(true);
  });

  it("rejects duplicate IDs and unresolved roster references without name matching", () => {
    const result = parseReviewedCsvBundle(bundle({
      students: "id,name,level\nstudent-a,Jordan,Level 1\nstudent-a,Jordan Renamed,Level 1\n",
      roster: "class_id,student_id\nclass-a,student-missing\nclass-missing,student-a\n",
    }), {
      teachers: [{ id: "teacher-existing", name: "Alex" }],
      students: [{ id: "student-existing", name: "Jordan", level: "Level 1" }],
      classes: [{ id: "class-existing", name: "Beginner Jazz", subject: "Jazz", level: "1", durationMinutes: 45, weeklyFrequency: 1, rosterStudentIds: [], eligibleTeacherIds: [] }],
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.code === "DUPLICATE_ID")).toBe(true);
    expect(result.errors.some((issue) => issue.code === "MISSING_REFERENCE")).toBe(true);
    expect(result.errors.some((issue) => issue.code === "STABLE_ID_REQUIRED")).toBe(false);
  });

  it("does not merge a renamed row by name", () => {
    const result = parseReviewedCsvBundle(bundle({
      teachers: "id,name,notes\nteacher-new,Alex,\n",
    }), { ...emptyInventory, teachers: [{ id: "teacher-existing", name: "Alex" }] });

    expect(result.valid).toBe(true);
    expect(result.rows[0]).toMatchObject({ operation: "CREATE", entityId: "teacher-new" });
    expect(result.warnings.some((issue) => issue.code === "NAME_NOT_USED_FOR_MATCHING")).toBe(true);
  });

  it("round-trips deidentified IDs and roster structure", () => {
    const source = {
      teachers: [{ id: "teacher-a", name: "Teacher A", notes: "" }],
      students: [{ id: "student-a", name: "Student A", level: "Level 1" }],
      classes: [{ id: "class-a", name: "Class A", subject: "Jazz", level: "1", durationMinutes: 45, weeklyFrequency: 1, rosterStudentIds: ["student-a"], companyOnly: false }],
    };
    const exported = exportReviewedCsvBundle(source);
    const parsed = parseReviewedCsvBundle(exported, emptyInventory);

    expect(parsed.valid).toBe(true);
    expect(parsed.rows.map((row) => row.entityId)).toEqual(["teacher-a", "student-a", "class-a"]);
    expect(parsed.rows[2]?.changes.rosterStudentIds).toEqual(["student-a"]);
  });
});
