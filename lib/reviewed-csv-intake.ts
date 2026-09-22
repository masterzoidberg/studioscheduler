import type { ClassDefinition, Student, Teacher } from "@/lib/domain";

export interface ReviewedCsvBundle {
  teachers: string;
  students: string;
  classes: string;
  roster: string;
}

export interface ReviewedCsvInventory {
  teachers: Array<Pick<Teacher, "id" | "name"> & { notes?: string }>;
  students: Array<Pick<Student, "id" | "name" | "level">>;
  classes: Array<Pick<ClassDefinition, "id" | "name" | "subject" | "level" | "durationMinutes" | "weeklyFrequency" | "rosterStudentIds"> & { companyOnly?: boolean; eligibleTeacherIds?: string[] }>;
}

export type ReviewedPlanningEntityType = "TEACHER" | "STUDENT" | "CLASS";
export type ReviewedPlanningOperation = "CREATE" | "UPDATE";

export interface ReviewedPlanningImportRow {
  entityType: ReviewedPlanningEntityType;
  operation: ReviewedPlanningOperation;
  entityId: string;
  changes: Record<string, unknown>;
}

export interface CsvImportIssue {
  level: "ERROR" | "WARNING";
  code: string;
  path: string;
  message: string;
}

export interface ReviewedCsvPreview {
  valid: boolean;
  errors: CsvImportIssue[];
  warnings: CsvImportIssue[];
  rows: ReviewedPlanningImportRow[];
  counts: { teachers: number; students: number; classes: number; rosterLinks: number };
}

const headers = {
  teachers: ["id", "name", "notes"],
  students: ["id", "name", "level"],
  classes: ["id", "name", "subject", "level", "duration_minutes", "weekly_frequency", "company_only"],
  roster: ["class_id", "student_id"],
} as const;

type CsvKind = keyof typeof headers;
type CsvRow = Record<string, string>;

function issue(level: CsvImportIssue["level"], code: string, path: string, message: string): CsvImportIssue {
  return { level, code, path, message };
}

function formulaLike(value: string) {
  return /^[\t \r]*(?:=|\+|-|@)/.test(value);
}

function parseCsvText(text: string, label: string): { rows: string[][]; issues: CsvImportIssue[] } {
  const source = text.replace(/^\uFEFF/, "");
  if (!source.trim()) return { rows: [], issues: [] };

  const rows: string[][] = [];
  const issues: CsvImportIssue[] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let justClosedQuote = false;
  let line = 1;

  const finishField = () => {
    row.push(field);
    field = "";
    justClosedQuote = false;
  };
  const finishRow = () => {
    if (row.length || field.length) {
      finishField();
      if (row.some((value) => value !== "")) rows.push(row);
    }
    row = [];
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (quoted) {
      if (character === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
        justClosedQuote = true;
      } else {
        field += character;
        if (character === "\n") line += 1;
      }
      continue;
    }
    if (justClosedQuote) {
      if (character === ",") finishField();
      else if (character === "\r" || character === "\n") {
        finishField();
        if (character === "\r" && next === "\n") index += 1;
        rows.push(row);
        row = [];
        line += 1;
      } else if (character !== " " && character !== "\t") {
        issues.push(issue("ERROR", "MALFORMED_CSV", `${label}:${line}`, "A quoted value must be followed by a comma or line break."));
        justClosedQuote = false;
        field += character;
      }
      continue;
    }
    if (character === '"' && field === "") {
      quoted = true;
    } else if (character === ",") {
      finishField();
    } else if (character === "\r" || character === "\n") {
      finishField();
      if (character === "\r" && next === "\n") index += 1;
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      line += 1;
    } else if (character === '"') {
      issues.push(issue("ERROR", "MALFORMED_CSV", `${label}:${line}`, "A quote may only start a field or escape another quote."));
      field += character;
    } else {
      field += character;
    }
  }

  if (quoted) issues.push(issue("ERROR", "MALFORMED_CSV", `${label}:${line}`, "The CSV ended inside a quoted value."));
  else if (row.length || field.length) finishRow();

  rows.forEach((values, rowIndex) => values.forEach((value, columnIndex) => {
    if (formulaLike(value)) {
      issues.push(issue("ERROR", "FORMULA_LIKE_VALUE", `${label}[${rowIndex + 1}][${columnIndex + 1}]`, "Formula-like exported values are not accepted."));
    }
  }));
  return { rows, issues };
}

function readFile(kind: CsvKind, text: string, errors: CsvImportIssue[]): CsvRow[] {
  if (!text.trim()) return [];
  const label = `${kind}.csv`;
  const parsed = parseCsvText(text, label);
  errors.push(...parsed.issues);
  if (!parsed.rows.length) return [];
  const actualHeaders = parsed.rows[0].map((value) => value.trim());
  const expectedHeaders = [...headers[kind]];
  if (actualHeaders.length !== expectedHeaders.length || actualHeaders.some((value, index) => value !== expectedHeaders[index])) {
    errors.push(issue("ERROR", "HEADERS", `${label}:1`, `Expected columns: ${expectedHeaders.join(", ")}.`));
    return [];
  }
  const rows: CsvRow[] = [];
  parsed.rows.slice(1).forEach((values, rowIndex) => {
    if (values.length !== expectedHeaders.length) {
      errors.push(issue("ERROR", "COLUMN_COUNT", `${label}:${rowIndex + 2}`, `Expected ${expectedHeaders.length} columns but found ${values.length}.`));
      return;
    }
    rows.push(Object.fromEntries(expectedHeaders.map((header, index) => [header, values[index].trim()])));
  });
  return rows;
}

function stableId(value: string) {
  return /^[a-z0-9][a-z0-9-]{0,119}$/.test(value);
}

function addIdCheck(rows: CsvRow[], kind: CsvKind, errors: CsvImportIssue[], warnings: CsvImportIssue[], existingNames: Map<string, string>) {
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const path = `${kind}[${index + 1}]`;
    const id = row.id;
    if (!id) errors.push(issue("ERROR", "STABLE_ID_REQUIRED", `${path}.id`, "Every row needs an explicit stable ID; names are never used for matching."));
    else if (!stableId(id)) errors.push(issue("ERROR", "INVALID_STABLE_ID", `${path}.id`, "Stable IDs use lowercase letters, numbers, and hyphens."));
    else if (seen.has(id)) errors.push(issue("ERROR", "DUPLICATE_ID", `${path}.id`, `Duplicate stable ID ${id}.`));
    else seen.add(id);
    const name = row.name;
    if (id && name && !existingNames.has(id) && [...existingNames.values()].some((existingName) => existingName === name)) {
      warnings.push(issue("WARNING", "NAME_NOT_USED_FOR_MATCHING", `${path}.name`, `A current record has the name ${name}, but this row will remain a new record because its stable ID is ${id}.`));
    }
  });
}

function required(row: CsvRow, key: string, path: string, errors: CsvImportIssue[]) {
  const value = row[key] || "";
  if (!value) errors.push(issue("ERROR", "REQUIRED_VALUE", `${path}.${key}`, `${key} is required.`));
  return value;
}

function positiveInteger(value: string, path: string, errors: CsvImportIssue[]) {
  if (!/^\d+$/.test(value) || Number(value) <= 0) {
    errors.push(issue("ERROR", "INVALID_NUMBER", path, "Value must be a positive whole number."));
    return null;
  }
  return Number(value);
}

function booleanValue(value: string, path: string, errors: CsvImportIssue[]) {
  if (value !== "true" && value !== "false") {
    errors.push(issue("ERROR", "INVALID_BOOLEAN", path, "Value must be true or false."));
    return null;
  }
  return value === "true";
}

export function parseReviewedCsvBundle(bundle: ReviewedCsvBundle, inventory: ReviewedCsvInventory): ReviewedCsvPreview {
  const errors: CsvImportIssue[] = [];
  const warnings: CsvImportIssue[] = [];
  const teacherRows = readFile("teachers", bundle.teachers, errors);
  const studentRows = readFile("students", bundle.students, errors);
  const classRows = readFile("classes", bundle.classes, errors);
  const rosterRows = readFile("roster", bundle.roster, errors);
  addIdCheck(teacherRows, "teachers", errors, warnings, new Map(inventory.teachers.map((item) => [item.id, item.name])));
  addIdCheck(studentRows, "students", errors, warnings, new Map(inventory.students.map((item) => [item.id, item.name])));
  addIdCheck(classRows, "classes", errors, warnings, new Map(inventory.classes.map((item) => [item.id, item.name])));

  const existingTeacherIds = new Set(inventory.teachers.map((item) => item.id));
  const existingStudentIds = new Set(inventory.students.map((item) => item.id));
  const existingClassIds = new Set(inventory.classes.map((item) => item.id));
  const importedStudentIds = new Set(studentRows.map((row) => row.id).filter(Boolean));
  const importedClassIds = new Set(classRows.map((row) => row.id).filter(Boolean));
  const classChanges = new Map<string, Record<string, unknown>>();
  const rows: ReviewedPlanningImportRow[] = [];
  const operation = (id: string, current: Set<string>): ReviewedPlanningOperation => current.has(id) ? "UPDATE" : "CREATE";

  teacherRows.forEach((row, index) => {
    const path = `teachers[${index + 1}]`;
    const id = row.id;
    const name = required(row, "name", path, errors);
    if (id) rows.push({ entityType: "TEACHER", operation: operation(id, existingTeacherIds), entityId: id, changes: { name, ...(row.notes ? { notes: row.notes } : {}) } });
  });
  studentRows.forEach((row, index) => {
    const path = `students[${index + 1}]`;
    const id = row.id;
    const name = required(row, "name", path, errors);
    const level = required(row, "level", path, errors);
    if (id) rows.push({ entityType: "STUDENT", operation: operation(id, existingStudentIds), entityId: id, changes: { name, level } });
  });
  classRows.forEach((row, index) => {
    const path = `classes[${index + 1}]`;
    const id = row.id;
    const changes: Record<string, unknown> = {
      name: required(row, "name", path, errors),
      subject: required(row, "subject", path, errors),
      level: required(row, "level", path, errors),
    };
    const durationMinutes = positiveInteger(required(row, "duration_minutes", path, errors), `${path}.duration_minutes`, errors);
    const weeklyFrequency = positiveInteger(required(row, "weekly_frequency", path, errors), `${path}.weekly_frequency`, errors);
    const companyOnly = booleanValue(required(row, "company_only", path, errors), `${path}.company_only`, errors);
    if (durationMinutes !== null) changes.durationMinutes = durationMinutes;
    if (weeklyFrequency !== null) changes.weeklyFrequency = weeklyFrequency;
    if (companyOnly !== null) changes.companyOnly = companyOnly;
    if (id) {
      classChanges.set(id, changes);
      rows.push({ entityType: "CLASS", operation: operation(id, existingClassIds), entityId: id, changes });
    }
  });

  const rosterFileProvided = Boolean(bundle.roster.trim());
  const rosterPairs = new Set<string>();
  rosterRows.forEach((row, index) => {
    const path = `roster[${index + 1}]`;
    const classId = required(row, "class_id", path, errors);
    const studentId = required(row, "student_id", path, errors);
    const pair = `${classId}\u0000${studentId}`;
    if (rosterPairs.has(pair)) errors.push(issue("ERROR", "DUPLICATE_ROSTER", path, `Duplicate roster link ${classId} → ${studentId}.`));
    rosterPairs.add(pair);
    if (classId && !existingClassIds.has(classId) && !importedClassIds.has(classId)) errors.push(issue("ERROR", "MISSING_REFERENCE", `${path}.class_id`, `Class ${classId} does not exist or appear in this import.`));
    if (studentId && !existingStudentIds.has(studentId) && !importedStudentIds.has(studentId)) errors.push(issue("ERROR", "MISSING_REFERENCE", `${path}.student_id`, `Student ${studentId} does not exist or appear in this import.`));
    if (classId && studentId) {
      const changes = classChanges.get(classId) || {};
      const roster = Array.isArray(changes.rosterStudentIds) ? changes.rosterStudentIds as string[] : [];
      roster.push(studentId);
      changes.rosterStudentIds = [...new Set(roster)].sort();
      classChanges.set(classId, changes);
    }
  });

  if (rosterFileProvided) {
    const importedClassIdsWithRoster = new Set(rosterRows.map((row) => row.class_id).filter(Boolean));
    classChanges.forEach((changes, id) => {
      changes.rosterStudentIds = changes.rosterStudentIds || [];
      if (!importedClassIdsWithRoster.has(id) && !classRows.some((row) => row.id === id)) changes.rosterStudentIds = [];
    });
    inventory.classes.forEach((klass) => {
      if (!classChanges.has(klass.id) && importedClassIdsWithRoster.has(klass.id)) {
        classChanges.set(klass.id, { rosterStudentIds: [] });
        rows.push({ entityType: "CLASS", operation: "UPDATE", entityId: klass.id, changes: classChanges.get(klass.id)! });
      }
    });
    rows.forEach((row) => {
      if (row.entityType === "CLASS" && classChanges.has(row.entityId)) row.changes = classChanges.get(row.entityId)!;
    });
  }

  rows.sort((a, b) => ({ TEACHER: 0, STUDENT: 1, CLASS: 2 }[a.entityType] - ({ TEACHER: 0, STUDENT: 1, CLASS: 2 }[b.entityType]) || a.entityId.localeCompare(b.entityId)));
  return {
    valid: errors.length === 0 && rows.length > 0,
    errors: rows.length ? errors : [...errors, issue("ERROR", "EMPTY_IMPORT", "bundle", "Add at least one teacher, student, or class row before applying.")],
    warnings,
    rows,
    counts: { teachers: teacherRows.length, students: studentRows.length, classes: classRows.length, rosterLinks: rosterRows.length },
  };
}

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(rows: string[][]) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function exportReviewedCsvBundle(inventory: ReviewedCsvInventory): ReviewedCsvBundle {
  return {
    teachers: csv([
      [...headers.teachers],
      ...inventory.teachers.map((teacher) => [teacher.id, teacher.name, teacher.notes || ""]),
    ]),
    students: csv([
      [...headers.students],
      ...inventory.students.map((student) => [student.id, student.name, student.level]),
    ]),
    classes: csv([
      [...headers.classes],
      ...inventory.classes.map((klass) => [klass.id, klass.name, klass.subject, klass.level, String(klass.durationMinutes), String(klass.weeklyFrequency), String(Boolean(klass.companyOnly))]),
    ]),
    roster: csv([
      [...headers.roster],
      ...inventory.classes.flatMap((klass) => klass.rosterStudentIds.map((studentId) => [klass.id, studentId])),
    ]),
  };
}

export const reviewedCsvTemplates = exportReviewedCsvBundle({ teachers: [], students: [], classes: [] });
