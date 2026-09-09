import type { RulebookVersion, StudioRule } from "@/lib/domain";
import {
  DWDE_REVIEWED_V3_RULEBOOK_ID,
  DWDE_REVIEWED_V3_RULE_COUNT,
  DWDE_REVIEWED_V3_SOURCE_HASH,
  reviewedDwdeV3PolicySupport,
  type ReviewedDwdePolicySupport,
} from "@/lib/reviewed-rulebook";
import { RULE_EXECUTION_BY_ID } from "@/lib/rule-execution-registry";
import { isTeacherDayWindowPolicy, parseTypedPolicy, type TypedPolicyV1 } from "@/lib/typed-policy";

export const DWDE_TYPED_POLICY_VERSION = 4;
export const DWDE_TYPED_POLICY_FORMAT_VERSION = "2.2";
export const DWDE_TYPED_POLICY_PROVENANCE = "TYPED_POLICY_MIGRATION";
export const POL01_TYPED_RULE_IDS = ["AIM-003"] as const;

export const DWDE_TYPED_POLICY_BUNDLE_VERSION = 5;
export const DWDE_TYPED_POLICY_BUNDLE_FORMAT_VERSION = "2.3";
export const DWDE_TYPED_POLICY_BUNDLE_PROVENANCE = "TYPED_POLICY_BUNDLE_MIGRATION";

export interface TypedPolicyBundleDeclaration {
  ownerRuleId: string;
  consumedRuleIds: string[];
}

export interface TypedPolicyBundleManifest {
  ownerRuleIds: string[];
  introducedOwnerRuleIds: string[];
  consumedRuleIds: string[];
  bundles: TypedPolicyBundleDeclaration[];
}

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

function canonicalStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) return null;
  const raw = value.map((item) => String(item).trim());
  const canonicalValue = [...new Set(raw)].sort();
  return canonical(raw) === canonical(canonicalValue) ? canonicalValue : null;
}

function stableIdsInPolicy(policy: TypedPolicyV1) {
  const record = policy as unknown as Record<string, unknown>;
  const ids = new Set<string>();
  for (const [key, value] of Object.entries(record)) {
    if (key === "schemaVersion" || key === "kind") continue;
    if (key.endsWith("Id") && typeof value === "string" && value.trim()) ids.add(value.trim());
    if (key.endsWith("Ids") && Array.isArray(value)) {
      for (const item of value) if (typeof item === "string" && item.trim()) ids.add(item.trim());
    }
  }
  return [...ids].sort();
}

function isSoftTypedPolicy(policy: TypedPolicyV1) {
  return ["PREFERRED_TEACHER", "PREFERRED_ROOM", "PREFERRED_DAY", "AVOID_DAY"].includes(policy.kind);
}

function findReviewedV3(versions: RulebookVersion[]) {
  return versions.find((version) =>
    version.version === 3
    && version.rulebookId === DWDE_REVIEWED_V3_RULEBOOK_ID
    && version.sourceHash?.toLowerCase() === DWDE_REVIEWED_V3_SOURCE_HASH,
  ) ?? null;
}

function v4Support(
  current: RulebookVersion,
  rules: StudioRule[],
  versions: RulebookVersion[],
): ReviewedDwdePolicySupport {
  const issues: string[] = [];
  const implicated = new Set<string>(current.changedRuleIds || []);
  if (current.version !== DWDE_TYPED_POLICY_VERSION) issues.push(`Rulebook version is ${current.version}, expected ${DWDE_TYPED_POLICY_VERSION}`);
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

  const baseline = findReviewedV3(versions);
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
    } else if (!isTeacherDayWindowPolicy(parsed.policy)) {
      implicated.add("AIM-003");
      issues.push("AIM-003 must remain a TEACHER_DAY_WINDOW typed policy");
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

export function typedPolicyBundleManifest(current: RulebookVersion | null): TypedPolicyBundleManifest | null {
  if (!current || current.version !== DWDE_TYPED_POLICY_BUNDLE_VERSION) return null;
  const ownerRuleIds = canonicalStringArray(current.sourceMetadata?.typedPolicyRuleIds);
  const introducedOwnerRuleIds = canonicalStringArray(current.sourceMetadata?.introducedTypedPolicyRuleIds);
  const rawBundles = current.sourceMetadata?.typedPolicyBundles;
  if (!ownerRuleIds || !introducedOwnerRuleIds || !Array.isArray(rawBundles)) return null;

  const bundles: TypedPolicyBundleDeclaration[] = [];
  for (const raw of rawBundles) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    if (canonical(Object.keys(record).sort()) !== canonical(["consumedRuleIds", "ownerRuleId"])) return null;
    if (typeof record.ownerRuleId !== "string" || !record.ownerRuleId.trim()) return null;
    const consumedRuleIds = canonicalStringArray(record.consumedRuleIds);
    if (!consumedRuleIds?.length) return null;
    bundles.push({ ownerRuleId: record.ownerRuleId.trim(), consumedRuleIds });
  }

  const canonicalBundles = [...bundles].sort((a, b) => a.ownerRuleId.localeCompare(b.ownerRuleId));
  if (canonical(bundles) !== canonical(canonicalBundles)) return null;
  return {
    ownerRuleIds,
    introducedOwnerRuleIds,
    consumedRuleIds: [...new Set(bundles.flatMap((bundle) => bundle.consumedRuleIds))].sort(),
    bundles,
  };
}

function v5Support(
  current: RulebookVersion,
  rules: StudioRule[],
  versions: RulebookVersion[],
): ReviewedDwdePolicySupport {
  const issues: string[] = [];
  const implicated = new Set<string>();
  const issue = (message: string, ruleIds: string[] = []) => {
    issues.push(message);
    for (const ruleId of ruleIds) implicated.add(ruleId);
  };

  if (current.rulebookId !== DWDE_REVIEWED_V3_RULEBOOK_ID) issue("Rulebook ID does not match the reviewed DWDE artifact");
  if (current.ruleCount !== DWDE_REVIEWED_V3_RULE_COUNT) issue(`rule count is ${current.ruleCount ?? "missing"}, expected ${DWDE_REVIEWED_V3_RULE_COUNT}`);
  if (current.parentVersion !== DWDE_TYPED_POLICY_VERSION) issue(`parent version is ${current.parentVersion ?? "missing"}, expected ${DWDE_TYPED_POLICY_VERSION}`);
  if (current.formatVersion !== DWDE_TYPED_POLICY_BUNDLE_FORMAT_VERSION) issue(`format version is ${current.formatVersion ?? "missing"}, expected ${DWDE_TYPED_POLICY_BUNDLE_FORMAT_VERSION}`);
  if (current.documentType !== "DWDE_SITE_RULEBOOK") issue("document type is not DWDE_SITE_RULEBOOK");
  if (current.sourceMetadata?.provenance !== DWDE_TYPED_POLICY_BUNDLE_PROVENANCE) issue("typed policy bundle migration provenance is missing");
  if (current.sourceMetadata?.residualBaselineSourceHash !== DWDE_REVIEWED_V3_SOURCE_HASH) issue("residual V3 source-hash pin is missing or changed");
  if (current.sourceMetadata?.previousTypedPolicyVersion !== DWDE_TYPED_POLICY_VERSION) issue(`previous typed policy version must be ${DWDE_TYPED_POLICY_VERSION}`);
  if (!current.sourceHash || !/^[0-9a-f]{64}$/i.test(current.sourceHash)) issue("Rulebook V5 source hash is missing or malformed");

  const manifest = typedPolicyBundleManifest(current);
  if (!manifest) {
    issue("typed policy bundle manifest is missing, malformed, duplicated, or not canonically sorted");
  }

  const currentSnapshot = Array.isArray(current.snapshot) ? current.snapshot : null;
  if (!currentSnapshot) issue("immutable Rulebook V5 snapshot is missing");
  const liveSnapshotMismatch = currentSnapshot ? mismatchIds(rules, currentSnapshot) : [];
  if (liveSnapshotMismatch.length) issue(`live Rulebook differs from immutable V5 snapshot for ${liveSnapshotMismatch.join(", ")}`, liveSnapshotMismatch);

  const baseline = findReviewedV3(versions);
  const baselineSnapshot = baseline && Array.isArray(baseline.snapshot) ? baseline.snapshot : null;
  if (!baselineSnapshot) issue("reviewed historical Rulebook V3 snapshot is unavailable for residual comparison");

  const historicalV4 = versions.find((version) => version.version === DWDE_TYPED_POLICY_VERSION && version.rulebookId === DWDE_REVIEWED_V3_RULEBOOK_ID) ?? null;
  const historicalV4Snapshot = historicalV4 && Array.isArray(historicalV4.snapshot) ? historicalV4.snapshot as StudioRule[] : null;
  if (!historicalV4 || !historicalV4Snapshot) {
    issue("historical bounded Rulebook V4 transition is unavailable");
  } else {
    const priorSupport = v4Support(historicalV4, historicalV4Snapshot, versions);
    if (!priorSupport.supported) issue(`historical Rulebook V4 transition is not certified: ${priorSupport.message}`, priorSupport.ruleIds);
  }

  if (manifest) {
    const ownerSet = new Set(manifest.ownerRuleIds);
    const introducedSet = new Set(manifest.introducedOwnerRuleIds);
    const ownership = new Map<string, string[]>();

    for (const bundle of manifest.bundles) {
      if (!bundle.consumedRuleIds.includes(bundle.ownerRuleId)) {
        issue(`typed policy bundle owner ${bundle.ownerRuleId} must consume itself`, [bundle.ownerRuleId]);
      }
      const owners = ownership.get(bundle.ownerRuleId) ?? [];
      if (owners.length) issue(`typed policy owner ${bundle.ownerRuleId} must appear exactly once`, [bundle.ownerRuleId]);
      for (const consumedRuleId of bundle.consumedRuleIds) {
        const currentOwners = ownership.get(consumedRuleId) ?? [];
        ownership.set(consumedRuleId, [...currentOwners, bundle.ownerRuleId]);
      }
    }

    const bundleOwners = manifest.bundles.map((bundle) => bundle.ownerRuleId).sort();
    if (canonical(bundleOwners) !== canonical(manifest.ownerRuleIds)) {
      issue("typedPolicyRuleIds must equal the bundle owner set exactly", [...new Set([...bundleOwners, ...manifest.ownerRuleIds])]);
    }
    for (const [consumedRuleId, owners] of ownership) {
      if (owners.length !== 1) issue(`consumed rule ${consumedRuleId} must have exactly one typed semantic owner`, [consumedRuleId, ...owners]);
    }
    for (const introduced of introducedSet) {
      if (!ownerSet.has(introduced)) issue(`introduced typed owner ${introduced} is not present in typedPolicyRuleIds`, [introduced]);
    }
    if (canonical([...(current.changedRuleIds || [])].sort()) !== canonical(manifest.introducedOwnerRuleIds)) {
      issue("Rulebook V5 changedRuleIds must equal introducedTypedPolicyRuleIds exactly", [...new Set([...(current.changedRuleIds || []), ...manifest.introducedOwnerRuleIds])]);
    }

    const aimBundle = manifest.bundles.find((bundle) => bundle.ownerRuleId === "AIM-003");
    if (!aimBundle || canonical(aimBundle.consumedRuleIds) !== canonical(["AIM-003"])) {
      issue("POL-01 AIM-003 ownership must carry forward unchanged as its own one-rule bundle", ["AIM-003"]);
    }

    if (currentSnapshot && baselineSnapshot) {
      const consumed = new Set(manifest.consumedRuleIds);
      const residualMismatch = mismatchIds(currentSnapshot, baselineSnapshot, consumed);
      if (residualMismatch.length) issue(`residual reviewed V3 policy changed for ${residualMismatch.join(", ")}`, residualMismatch);

      for (const bundle of manifest.bundles) {
        const currentOwner = currentSnapshot.find((value) => comparableRule(value).id === bundle.ownerRuleId);
        const baselineOwner = baselineSnapshot.find((value) => comparableRule(value).id === bundle.ownerRuleId);
        if (!currentOwner || !baselineOwner) {
          issue(`typed policy owner ${bundle.ownerRuleId} is missing from the V3 or V5 snapshot`, [bundle.ownerRuleId]);
        } else if (canonical(machineFieldsStripped(currentOwner)) !== canonical(machineFieldsStripped(baselineOwner))) {
          issue(`typed policy owner ${bundle.ownerRuleId} changed human-reviewed policy fields`, [bundle.ownerRuleId]);
        }

        for (const consumedRuleId of bundle.consumedRuleIds.filter((ruleId) => ruleId !== bundle.ownerRuleId)) {
          const currentConsumed = currentSnapshot.find((value) => comparableRule(value).id === consumedRuleId);
          const baselineConsumed = baselineSnapshot.find((value) => comparableRule(value).id === consumedRuleId);
          if (!currentConsumed || !baselineConsumed || canonical(comparableRule(currentConsumed)) !== canonical(comparableRule(baselineConsumed))) {
            issue(`consumed non-owner rule ${consumedRuleId} must remain byte-semantic-equivalent to reviewed V3`, [consumedRuleId]);
          }
        }
      }
    }

    for (const rule of rules) {
      const parsed = parseTypedPolicy(rule);
      if (parsed.status === "NONE") continue;
      if (!ownerSet.has(rule.id)) {
        issue(`rule ${rule.id} has a typed policy envelope but is not a declared bundle owner`, [rule.id]);
        continue;
      }
      if (parsed.status !== "VALID") {
        issue(parsed.message, [rule.id]);
        continue;
      }

      const expectedIds = stableIdsInPolicy(parsed.policy);
      const missingAffectedIds = expectedIds.filter((id) => !rule.affectedEntityIds.includes(id));
      if (missingAffectedIds.length) {
        issue(`${rule.id} affectedEntityIds must include every stable ID owned by its typed policy`, [rule.id]);
      }

      const execution = RULE_EXECUTION_BY_ID.get(rule.id);
      const softPolicy = isSoftTypedPolicy(parsed.policy);
      if (softPolicy && execution?.disposition !== "SOFT_OBJECTIVE") {
        issue(`${rule.id} uses a soft typed policy kind but is not a SOFT_OBJECTIVE rule`, [rule.id]);
      }
      if (!softPolicy && execution?.disposition === "SOFT_OBJECTIVE") {
        issue(`${rule.id} uses a HARD typed policy kind but is registered as SOFT_OBJECTIVE`, [rule.id]);
      }
    }

    for (const ownerRuleId of ownerSet) {
      const ownerRule = rules.find((rule) => rule.id === ownerRuleId);
      if (!ownerRule) {
        issue(`typed policy owner ${ownerRuleId} is missing from the live Rulebook`, [ownerRuleId]);
        continue;
      }
      const parsed = parseTypedPolicy(ownerRule);
      if (parsed.status !== "VALID") {
        issue(parsed.status === "INVALID" ? parsed.message : `${ownerRuleId} typed policy envelope is missing`, [ownerRuleId]);
      }
    }
  }

  const supported = issues.length === 0;
  return {
    recognized: true,
    supported,
    ruleIds: [...implicated].sort(),
    message: supported
      ? "DWDE Rulebook V5 is a dependency-closed typed-policy bundle transition from the immutable reviewed V3 baseline with certified V4 carry-forward."
      : `DWDE typed-policy bundle transition is unsupported: ${issues.join("; ")}. Changed, multiply-owned, or unknown policy cannot be treated as current executable semantics.`,
  };
}

/**
 * Accept the immutable reviewed V3 baseline, the bounded POL-01 V4 transition,
 * or the dependency-closed POL-02 V5 bundle transition. Each newer version is
 * trusted only after proving its residual semantics against the immutable V3
 * baseline and validating the exact machine-policy ownership it introduces.
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

  if (current.version === DWDE_TYPED_POLICY_VERSION) return v4Support(current, rules, versions);
  if (current.version === DWDE_TYPED_POLICY_BUNDLE_VERSION) return v5Support(current, rules, versions);

  return {
    recognized: true,
    supported: false,
    ruleIds: [...new Set(current.changedRuleIds || [])].sort(),
    message: `DWDE typed-policy transition is unsupported: Rulebook version is ${current.version}, expected 3, ${DWDE_TYPED_POLICY_VERSION}, or ${DWDE_TYPED_POLICY_BUNDLE_VERSION}. Changed or unknown HARD policy cannot be treated as current executable semantics.`,
  };
}
