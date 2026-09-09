import type { ReviewedRulebookPackage, ReviewedRuleRecord, RulebookVersion, RuleStrength, StudioRule } from "@/lib/domain";

export interface ReviewedImportIssue { level: "ERROR" | "WARNING"; path: string; message: string }
export interface ReviewedImportValidation {
  valid: boolean;
  errors: ReviewedImportIssue[];
  warnings: ReviewedImportIssue[];
  summary: {
    rules: number;
    reviewed: number;
    approved: number;
    edited: number;
    classifications: Record<string, number>;
  };
}

const stableId = /^[A-Z0-9]+-[0-9]{3}$/;
const sha256 = /^[0-9a-f]{64}$/i;
export const DWDE_REVIEWED_V2_RULES_SHA256 = "5ef0a282e68b199fae94976335ede2484e80a966b2b5d2c3fa71355a26d5866b";
export const DWDE_REVIEWED_V3_RULEBOOK_ID = "dwde-2026-2027-master-rulebook";
export const DWDE_REVIEWED_V3_SOURCE_HASH = "7d03e131bd0b6a1eddafff70fd3024628215236d3d846cb156d1514329120c5b";
export const DWDE_REVIEWED_V3_RULE_COUNT = 178;

export interface ReviewedDwdePolicySupport {
  recognized: boolean;
  supported: boolean;
  ruleIds: string[];
  message: string;
}

function canonicalPolicyJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalPolicyJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalPolicyJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function comparablePolicyRule(value: unknown) {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const strength = raw.strength ?? null;
  const classification = raw.classificationRaw ?? raw.classification_raw ?? (typeof strength === "string" ? strength.replaceAll("_", " ") : "");
  const verificationStatus = raw.verificationStatus ?? raw.verification_status ?? raw.reviewStatus ?? raw.review_status ?? "UNVERIFIED";
  const source = raw.source && typeof raw.source === "object" && !Array.isArray(raw.source)
    ? { type: "IMPORT", ...(raw.source as Record<string, unknown>) }
    : { type: "IMPORT" };
  return {
    id: String(raw.id ?? ""),
    category: String(raw.category ?? ""),
    type: raw.type ?? null,
    title: String(raw.title ?? ""),
    description: String(raw.description ?? raw.text ?? ""),
    strength,
    classificationRaw: String(classification),
    status: String(raw.status ?? ""),
    verificationStatus: String(verificationStatus),
    reviewStatus: String(raw.reviewStatus ?? raw.review_status ?? verificationStatus),
    review: raw.review ?? {},
    affectedEntityIds: raw.affectedEntityIds ?? raw.affected_entity_ids ?? [],
    parameters: raw.parameters ?? {},
    exceptions: raw.exceptions ?? [],
    source,
    sourceRaw: raw.sourceRaw ?? raw.source_raw ?? {},
    enforcementStatus: raw.enforcementStatus ?? raw.enforcement_status ?? "NOT_IMPLEMENTED",
    versionIntroduced: raw.versionIntroduced ?? raw.version_introduced ?? 1,
  };
}

function snapshotMismatchIds(rules: StudioRule[], snapshot: unknown[]): string[] {
  const current = new Map(rules.map((rule) => [rule.id, comparablePolicyRule(rule)]));
  const pinned = new Map(snapshot.map((rule) => {
    const comparable = comparablePolicyRule(rule);
    return [String(comparable.id), comparable] as const;
  }));
  const ids = new Set([...current.keys(), ...pinned.keys()]);
  return [...ids].filter((id) => canonicalPolicyJson(current.get(id)) !== canonicalPolicyJson(pinned.get(id))).sort();
}

/**
 * Temporary DWDE adapter boundary. The static compiler is only authoritative
 * for the exact reviewed V3 artifact; T21/T25 must replace this with typed
 * tenant policy records before the adapter is generalized.
 */
export function reviewedDwdeV3PolicySupport(current: RulebookVersion | null, rules: StudioRule[]): ReviewedDwdePolicySupport {
  const recognized = Boolean(current && (
    current.rulebookId === DWDE_REVIEWED_V3_RULEBOOK_ID
    || current.documentType === "DWDE_SITE_RULEBOOK"
  ));
  if (!recognized) {
    return { recognized: false, supported: true, ruleIds: [], message: "No DWDE reviewed-policy provenance was supplied to the legacy adapter." };
  }

  const metadataMismatches: string[] = [];
  if (!current || current.version !== 3) metadataMismatches.push(`Rulebook version is ${current?.version ?? "missing"}, expected 3`);
  if (current?.rulebookId !== DWDE_REVIEWED_V3_RULEBOOK_ID) metadataMismatches.push("Rulebook ID does not match the reviewed DWDE artifact");
  if (current?.ruleCount !== DWDE_REVIEWED_V3_RULE_COUNT) metadataMismatches.push(`rule count is ${current?.ruleCount ?? "missing"}, expected ${DWDE_REVIEWED_V3_RULE_COUNT}`);
  if (current?.sourceHash?.toLowerCase() !== DWDE_REVIEWED_V3_SOURCE_HASH) metadataMismatches.push("source hash does not match the reviewed DWDE V3 artifact");
  if (current?.formatVersion !== "2.1") metadataMismatches.push(`format version is ${current?.formatVersion ?? "missing"}, expected 2.1`);
  if (current?.documentType !== "DWDE_SITE_RULEBOOK") metadataMismatches.push("document type is not DWDE_SITE_RULEBOOK");
  if (current?.sourceMetadata?.provenance !== "POST_REVIEW_CAMI_CONFIRMATION") metadataMismatches.push("reviewed post-confirmation provenance is missing");

  const snapshotIds = current?.snapshot && Array.isArray(current.snapshot) ? snapshotMismatchIds(rules, current.snapshot) : [];
  if (!current?.snapshot || !Array.isArray(current.snapshot)) metadataMismatches.push("immutable Rulebook snapshot is missing");
  const ruleIds = [...new Set([...current?.changedRuleIds || [], ...snapshotIds])].sort();
  const supported = metadataMismatches.length === 0 && snapshotIds.length === 0;
  return {
    recognized: true,
    supported,
    ruleIds,
    message: supported
      ? "The static DWDE adapter is pinned to reviewed Rulebook V3."
      : `The static DWDE adapter supports only reviewed Rulebook V3 (${DWDE_REVIEWED_V3_RULEBOOK_ID}, source hash ${DWDE_REVIEWED_V3_SOURCE_HASH}). ${metadataMismatches.join("; ") || `immutable snapshot differs for ${snapshotIds.join(", ")}`}. No changed policy may be treated as current executable semantics.`,
  };
}

export function normalizeReviewedClassification(value: string): RuleStrength | null {
  switch (value.trim().toUpperCase()) {
    case "HARD": return "HARD";
    case "VERY STRONG": return "VERY_STRONG";
    case "MODERATE": return "MODERATE";
    case "LIGHT": return "LIGHT";
    case "BASELINE": return "BASELINE";
    default: return null;
  }
}

export function isReviewedRulebookPackage(input: unknown): input is ReviewedRulebookPackage {
  if (!input || typeof input !== "object") return false;
  const value = input as Record<string, unknown>;
  return value.format_version === "2.0" && value.document_type === "DWDE_SITE_RULEBOOK";
}

export function validateReviewedRulebook(input: unknown): ReviewedImportValidation {
  const errors: ReviewedImportIssue[] = [];
  const warnings: ReviewedImportIssue[] = [];
  const fail = (path: string, message: string) => errors.push({ level: "ERROR", path, message });
  const warn = (path: string, message: string) => warnings.push({ level: "WARNING", path, message });
  const empty = { rules: 0, reviewed: 0, approved: 0, edited: 0, classifications: {} as Record<string, number> };
  if (!isReviewedRulebookPackage(input)) {
    fail("$", "Expected format_version 2.0 and document_type DWDE_SITE_RULEBOOK.");
    return { valid: false, errors, warnings, summary: empty };
  }

  const pkg = input;
  if (pkg.rulebook.id !== "dwde-2026-2027-master-rulebook") fail("rulebook.id", "Unexpected DWDE Rulebook ID.");
  if (pkg.rulebook.version !== 2) fail("rulebook.version", "This reviewed source must identify itself as Rulebook V2.");
  if (pkg.rulebook.status !== "REVIEWED") fail("rulebook.status", "Reviewed source status must be REVIEWED.");
  if (!sha256.test(pkg.rulebook.rules_sha256 || "")) fail("rulebook.rules_sha256", "A 64-character SHA-256 rules fingerprint is required.");
  else if (pkg.rulebook.rules_sha256.toLowerCase() !== DWDE_REVIEWED_V2_RULES_SHA256) fail("rulebook.rules_sha256", "This file does not match the authoritative reviewed DWDE Rulebook V2 fingerprint.");
  if (!Array.isArray(pkg.rules)) fail("rules", "rules must be an array.");
  const rules = Array.isArray(pkg.rules) ? pkg.rules : [];
  if (pkg.rulebook.total_rules !== rules.length) fail("rulebook.total_rules", "Metadata rule count does not match the rules array.");
  if (rules.length !== 178) fail("rules", `Reviewed V2 must contain 178 rules; found ${rules.length}.`);

  const ids = new Set<string>();
  let reviewed = 0; let approved = 0; let edited = 0;
  const classifications: Record<string, number> = {};
  rules.forEach((rule, index) => {
    const path = `rules[${index}]`;
    if (!rule || typeof rule !== "object") { fail(path, "Rule must be an object."); return; }
    if (!stableId.test(rule.id || "")) fail(`${path}.id`, `Invalid stable rule ID ${rule.id || "(missing)"}.`);
    if (ids.has(rule.id)) fail(`${path}.id`, `Duplicate stable rule ID ${rule.id}.`); else ids.add(rule.id);
    if (!rule.category) fail(`${path}.category`, "Category is required.");
    if (!rule.classification) fail(`${path}.classification`, "Raw reviewed classification is required.");
    if (!rule.title) fail(`${path}.title`, "Title is required.");
    if (typeof rule.text !== "string") fail(`${path}.text`, "Reviewed text is required.");
    if (!rule.status) fail(`${path}.status`, "Status is required.");
    if (rule.review_status === "VERIFIED" && rule.review?.verified === true) reviewed += 1;
    else fail(`${path}.review_status`, "Every V2 record must preserve its verified review state.");
    if (rule.review?.decision === "APPROVED") approved += 1;
    else if (rule.review?.decision === "EDIT") {
      edited += 1;
      if (!rule.review.original_text) fail(`${path}.review.original_text`, "Edited rules must retain original_text.");
      if (!rule.review.correction_raw) fail(`${path}.review.correction_raw`, "Edited rules must retain correction_raw.");
    } else fail(`${path}.review.decision`, "Review decision must be APPROVED or EDIT.");
    if (!rule.source || typeof rule.source !== "object") fail(`${path}.source`, "Source provenance is required.");
    classifications[rule.classification] = (classifications[rule.classification] || 0) + 1;
  });

  if (pkg.rulebook.reviewed_rules !== reviewed) fail("rulebook.reviewed_rules", "Reviewed count does not match verified records.");
  if (pkg.rulebook.approved_without_edit !== approved) fail("rulebook.approved_without_edit", "Approved count does not match review decisions.");
  if (pkg.rulebook.edited_and_approved !== edited) fail("rulebook.edited_and_approved", "Edited count does not match review decisions.");
  if (reviewed !== 178) fail("rules", `Expected 178 verified reviewed rules; found ${reviewed}.`);
  if (approved !== 162 || edited !== 16) fail("review_summary", `Expected 162 approved and 16 edited; found ${approved} approved and ${edited} edited.`);
  if (Object.keys(classifications).some((x) => normalizeReviewedClassification(x) === null)) {
    warn("rules.classification", "The reviewed vocabulary contains classifications outside the legacy normalized strength enum. Raw classifications will be preserved exactly.");
  }
  return { valid: errors.length === 0, errors, warnings, summary: { rules: rules.length, reviewed, approved, edited, classifications } };
}

function currentComparable(rule: StudioRule) {
  return JSON.stringify({
    category: rule.category,
    classification: rule.classificationRaw ?? rule.strength?.replaceAll("_", " ") ?? "",
    title: rule.title,
    text: rule.description,
    status: rule.status,
    review_status: rule.reviewStatus ?? rule.verificationStatus,
    review: rule.review ?? {},
    source: rule.sourceRaw ?? {},
  });
}

function incomingComparable(rule: ReviewedRuleRecord) {
  return JSON.stringify({
    category: rule.category,
    classification: rule.classification,
    title: rule.title,
    text: rule.text,
    status: rule.status,
    review_status: rule.review_status,
    review: rule.review ?? {},
    source: rule.source ?? {},
  });
}

export function diffReviewedRules(current: StudioRule[], imported: ReviewedRuleRecord[]) {
  const currentMap = new Map(current.map((rule) => [rule.id, rule]));
  const importedIds = new Set(imported.map((rule) => rule.id));
  const unchanged: string[] = [];
  const updated: string[] = [];
  const added: string[] = [];
  const conflicts: string[] = [];
  for (const incoming of imported) {
    const existing = currentMap.get(incoming.id);
    if (!existing) { added.push(incoming.id); continue; }
    if (currentComparable(existing) === incomingComparable(incoming)) { unchanged.push(incoming.id); continue; }
    if (existing.source.type === "USER_EDIT" || existing.source.type === "AI_PROPOSAL_APPROVED") conflicts.push(incoming.id);
    else updated.push(incoming.id);
  }
  const superseded = current.filter((rule) => !importedIds.has(rule.id)).map((rule) => rule.id);
  return { unchanged, updated, added, conflicts, superseded };
}

export function reviewedRuleToStudioShape(rule: ReviewedRuleRecord): Partial<StudioRule> {
  return {
    id: rule.id,
    category: rule.category,
    title: rule.title,
    description: rule.text,
    strength: normalizeReviewedClassification(rule.classification),
    classificationRaw: rule.classification,
    status: rule.status,
    verificationStatus: rule.review_status,
    reviewStatus: rule.review_status,
    review: structuredClone(rule.review),
    sourceRaw: structuredClone(rule.source),
  };
}

export async function sha256Hex(text: string) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
