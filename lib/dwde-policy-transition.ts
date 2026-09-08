import type { RulebookVersion, StudioRule } from "@/lib/domain";
import {
  DWDE_REVIEWED_V3_RULEBOOK_ID,
  DWDE_REVIEWED_V3_RULE_COUNT,
  DWDE_REVIEWED_V3_SOURCE_HASH,
  reviewedDwdeV3PolicySupport,
  type ReviewedDwdePolicySupport,
} from "@/lib/reviewed-rulebook";
import { parseTypedPolicy } from "@/lib/typed-policy";

export const DWDE_TYPED_POLICY_VERSION = 4;
export const DWDE_TYPED_POLICY_FORMAT_VERSION = "2.2";
export const DWDE_TYPED_POLICY_PROVENANCE = "TYPED_POLICY_MIGRATION";
export const POL01_TYPED_RULE_IDS = ["AIM-003"] as const;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function comparableRule(value: unknown) {
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

function mapComparable(values: unknown[]) {
  return new Map(values.map((value) => {
    const comparable = comparableRule(value);
    return [comparable.id, comparable] as const;
  }));
}

function mismatchIds(current: unknown[], baseline: unknown[], excluded = new Set<string>()) {
  const left = mapComparable(current);
  const right = mapComparable(baseline);
  const ids = new Set([...left.keys(), ...right.keys()]);
  return [...ids]
    .filter((id) => !excluded.has(id) && canonical(left.get(id)) !== canonical(right.get(id)))
    .sort();
}

function machineFieldsStripped(value: unknown) {
  const humanPolicy = { ...comparableRule(value) };
  delete (humanPolicy as Partial<typeof humanPolicy>).affectedEntityIds;
  delete (humanPolicy as Partial<typeof humanPolicy>).parameters;
  return humanPolicy;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).sort() : [];
}

/**
 * Accept either the immutable reviewed V3 baseline or the single bounded POL-01
 * V4 transition. V4 is not trusted because it says "version 4": its 177 residual
 * rules must still match the historical reviewed V3 snapshot and AIM-003 may
 * differ only in machine-binding fields whose typed envelope validates.
 */
export function reviewedDwdePolicySupport(
  current: RulebookVersion | null,
  rules: StudioRule[],
  versions: RulebookVersion[] = [],
): ReviewedDwdePolicySupport {
  if (!current || current.version === 3) return reviewedDwdeV3PolicySupport(current, rules);

  const recognized = current.rulebookId === DWDE_REVIEWED_V3_RULEBOOK_ID
    || current.documentType === "DWDE_SITE_RULEBOOK";
  if (!recognized) {
    return { recognized: false, supported: true, ruleIds: [], message: "No DWDE reviewed-policy provenance was supplied to the typed transition adapter." };
  }

  const issues: string[] = [];
  const implicated = new Set<string>(current.changedRuleIds || []);
  if (current.version !== DWDE_TYPED_POLICY_VERSION) issues.push(`Rulebook version is ${current.version}, expected 3 or ${DWDE_TYPED_POLICY_VERSION}`);
  if (current.rulebookId !== DWDE_REVIEWED_V3_RULEBOOK_ID) issues.push("Rulebook ID does not match the reviewed DWDE artifact");
  if (current.ruleCount !== DWDE_REVIEWED_V3_RULE_COUNT) issues.push(`rule count is ${current.ruleCount ?? "missing"}, expected ${DWDE_REVIEWED_V3_RULE_COUNT}`);
  if (current.parentVersion !== 3) issues.push(`parent version is ${current.parentVersion ?? "missing"}, expected 3`);
  if (current.formatVersion !== DWDE_TYPED_POLICY_FORMAT_VERSION) issues.push(`format version is ${current.formatVersion ?? "missing"}, expected ${DWDE_TYPED_POLICY_FORMAT_VERSION}`);
  if (current.documentType !== "DWDE_SITE_RULEBOOK") issues.push("document type is not DWDE_SITE_RULEBOOK");
  if (current.sourceMetadata?.provenance !== DWDE_TYPED_POLICY_PROVENANCE) issues.push("typed policy migration provenance is missing");
  if (current.sourceMetadata?.residualBaselineSourceHash !== DWDE_REVIEWED_V3_SOURCE_HASH) issues.push("residual V3 source-hash pin is missing or changed");
  if (canonical(stringArray(current.sourceMetadata?.typedPolicyRuleIds)) !== canonical([...POL01_TYPED_RULE_IDS])) {
    issues.push(`typed policy rule set must be exactly ${POL01_TYPED_RULE_IDS.join(", ")}`);
  }
  if (canonical([...(current.changedRuleIds || [])].sort()) !== canonical([...POL01_TYPED_RULE_IDS])) {
    issues.push(`Rulebook V4 changedRuleIds must be exactly ${POL01_TYPED_RULE_IDS.join(", ")}`);
  }
  if (!current.sourceHash || !/^[0-9a-f]{64}$/i.test(current.sourceHash)) issues.push("Rulebook V4 source hash is missing or malformed");

  const currentSnapshot = Array.isArray(current.snapshot) ? current.snapshot : null;
  if (!currentSnapshot) issues.push("immutable Rulebook V4 snapshot is missing");
  const liveSnapshotMismatch = currentSnapshot ? mismatchIds(rules, currentSnapshot) : [];
  for (const id of liveSnapshotMismatch) implicated.add(id);
  if (liveSnapshotMismatch.length > 0) issues.push(`live Rulebook differs from immutable V4 snapshot for ${liveSnapshotMismatch.join(", ")}`);

  const baseline = versions.find((version) =>
    version.version === 3
    && version.rulebookId === DWDE_REVIEWED_V3_RULEBOOK_ID
    && version.sourceHash?.toLowerCase() === DWDE_REVIEWED_V3_SOURCE_HASH,
  );
  const baselineSnapshot = baseline && Array.isArray(baseline.snapshot) ? baseline.snapshot : null;
  if (!baselineSnapshot) issues.push("reviewed historical Rulebook V3 snapshot is unavailable for residual comparison");

  if (currentSnapshot && baselineSnapshot) {
    const excluded = new Set<string>(POL01_TYPED_RULE_IDS);
    const residualMismatch = mismatchIds(currentSnapshot, baselineSnapshot, excluded);
    for (const id of residualMismatch) implicated.add(id);
    if (residualMismatch.length > 0) issues.push(`residual reviewed V3 policy changed for ${residualMismatch.join(", ")}`);

    const currentAimee = currentSnapshot.find((value) => comparableRule(value).id === "AIM-003");
    const baselineAimee = baselineSnapshot.find((value) => comparableRule(value).id === "AIM-003");
    if (!currentAimee || !baselineAimee) {
      implicated.add("AIM-003");
      issues.push("AIM-003 is missing from the V3 or V4 snapshot");
    } else if (canonical(machineFieldsStripped(currentAimee)) !== canonical(machineFieldsStripped(baselineAimee))) {
      implicated.add("AIM-003");
      issues.push("AIM-003 human-reviewed policy fields changed during the typed transition");
    }
  }

  const typedRule = rules.find((rule) => rule.id === "AIM-003");
  if (!typedRule) {
    implicated.add("AIM-003");
    issues.push("AIM-003 current rule is missing");
  } else {
    const parsed = parseTypedPolicy(typedRule);
    if (parsed.status !== "VALID") {
      implicated.add("AIM-003");
      issues.push(parsed.status === "INVALID" ? parsed.message : "AIM-003 typed policy envelope is missing");
    } else if (!typedRule.affectedEntityIds.includes(parsed.policy.teacherId)) {
      implicated.add("AIM-003");
      issues.push("AIM-003 affectedEntityIds must include its typed teacherId");
    }
  }

  const supported = issues.length === 0;
  return {
    recognized: true,
    supported,
    ruleIds: [...implicated].sort(),
    message: supported
      ? "DWDE Rulebook V4 is a bounded typed-policy transition from the immutable reviewed V3 baseline; AIM-003 is typed and all residual policy remains pinned."
      : `DWDE typed-policy transition is unsupported: ${issues.join("; ")}. Changed or unknown HARD policy cannot be treated as current executable semantics.`,
  };
}
