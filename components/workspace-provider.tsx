"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import type { Assignment, CanonicalImportPackage, ClassDefinition, RuleHistoryEntry, RulePatch, RulebookVersion, Room, Scenario, SchedulePatch, ScheduleVersion, StudioRule, StudioState, Teacher, ValidationResult } from "@/lib/domain";
import { applyAssignmentChanges, validateSchedule } from "@/lib/validator";
import { beginChatGptSignIn, captureAlphaAccess, chatGptAuthAvailable, clearAlphaAccess, getBrowserSupabase } from "@/lib/supabase";

const STUDIO_ID = "11111111-1111-4111-8111-111111111111";

type MutationResult = { ok: boolean; error?: string; validation?: ValidationResult; version?: number };

interface WorkspaceContextValue {
  loading: boolean;
  error: string | null;
  session: Session | null;
  accessMode: "AUTHENTICATED" | "ALPHA" | "NONE";
  state: StudioState | null;
  currentAssignments: Assignment[];
  currentRulebookVersion: number;
  currentScheduleVersion: number;
  validation: ValidationResult;
  chatGptAuthEnabled: boolean;
  refresh: () => Promise<void>;
  signInWithEmail: (email: string) => Promise<{ ok: boolean; message: string }>;
  signOut: () => Promise<void>;
  beginChatGptSignIn: () => void;
  applyRulePatch: (patch: RulePatch) => Promise<MutationResult>;
  applySchedulePatch: (patch: SchedulePatch) => Promise<MutationResult>;
  importPackage: (pkg: CanonicalImportPackage) => Promise<MutationResult>;
  exportPackage: () => CanonicalImportPackage | null;
  updateTeacher: (teacher: Teacher, reason: string) => Promise<MutationResult>;
  updateRoom: (room: Room, reason: string) => Promise<MutationResult>;
  updateClass: (klass: ClassDefinition, reason: string) => Promise<MutationResult>;
  createScenario: (name: string, rulePatches?: RulePatch[], schedulePatches?: SchedulePatch[]) => Promise<MutationResult>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

const time = (value: string) => value.slice(0, 5);
const source = (value: unknown) => (value && typeof value === "object" ? value : { type: "IMPORT" }) as StudioRule["source"];

function mapRule(row: Record<string, unknown>): StudioRule {
  return {
    id: String(row.id), category: String(row.category), type: row.type as StudioRule["type"], title: String(row.title), description: String(row.description), strength: row.strength as StudioRule["strength"], status: row.status as StudioRule["status"], verificationStatus: row.verification_status as StudioRule["verificationStatus"], affectedEntityIds: (row.affected_entity_ids as string[]) || [], parameters: (row.parameters as Record<string, unknown>) || {}, exceptions: (row.exceptions as StudioRule["exceptions"]) || [], source: source(row.source), versionIntroduced: Number(row.version_introduced || 1), updatedAt: String(row.updated_at || ""),
  };
}

function mapAssignment(row: Record<string, unknown>): Assignment {
  return { id: String(row.id), sessionId: String(row.session_id), day: row.day as Assignment["day"], startTime: time(String(row.start_time)), endTime: time(String(row.end_time)), teacherId: String(row.teacher_id), roomId: String(row.room_id), locked: Boolean(row.locked), status: row.status as Assignment["status"] };
}

function mapHistory(row: Record<string, unknown>): RuleHistoryEntry {
  return { id: String(row.id), ruleId: String(row.rule_id), rulebookVersion: Number(row.rulebook_version), changedAt: String(row.changed_at), actor: String(row.actor_label), reason: String(row.reason), before: row.before_rule ? mapRule(row.before_rule as Record<string, unknown>) : null, after: row.after_rule ? mapRule(row.after_rule as Record<string, unknown>) : null, aiProposed: Boolean(row.ai_proposed) };
}

function fail(error: unknown): MutationResult { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [alphaKey, setAlphaKey] = useState("");
  const [state, setState] = useState<StudioState | null>(null);

  const accessMode: WorkspaceContextValue["accessMode"] = session ? "AUTHENTICATED" : alphaKey ? "ALPHA" : "NONE";

  const load = useCallback(async (key?: string, activeSession?: Session | null) => {
    const alpha = key ?? alphaKey;
    const sess = activeSession === undefined ? session : activeSession;
    if (!alpha && !sess) { setState(null); setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const supabase = getBrowserSupabase(alpha);
      const [studioQ, teachersQ, roomsQ, studentsQ, cohortsQ, classesQ, sessionsQ, rulesQ, rbvQ, historyQ, scheduleQ, scenariosQ, auditQ] = await Promise.all([
        supabase.from("studios").select("*").eq("id", STUDIO_ID).single(),
        supabase.from("teachers").select("*").eq("studio_id", STUDIO_ID).order("name"),
        supabase.from("rooms").select("*").eq("studio_id", STUDIO_ID).order("name"),
        supabase.from("students").select("*").eq("studio_id", STUDIO_ID).order("name"),
        supabase.from("cohorts").select("*").eq("studio_id", STUDIO_ID).order("name"),
        supabase.from("class_definitions").select("*").eq("studio_id", STUDIO_ID).order("name"),
        supabase.from("class_sessions").select("*").eq("studio_id", STUDIO_ID).order("id"),
        supabase.from("rules").select("*").eq("studio_id", STUDIO_ID).order("id"),
        supabase.from("rulebook_versions").select("*").eq("studio_id", STUDIO_ID).order("version", { ascending: false }),
        supabase.from("rule_history").select("*").eq("studio_id", STUDIO_ID).order("changed_at", { ascending: false }),
        supabase.from("schedule_versions").select("*").eq("studio_id", STUDIO_ID).order("version", { ascending: false }),
        supabase.from("scenarios").select("*").eq("studio_id", STUDIO_ID).order("created_at", { ascending: false }),
        supabase.from("audit_events").select("*").eq("studio_id", STUDIO_ID).order("created_at", { ascending: false }).limit(100),
      ]);
      const queryError = [studioQ, teachersQ, roomsQ, studentsQ, cohortsQ, classesQ, sessionsQ, rulesQ, rbvQ, historyQ, scheduleQ, scenariosQ, auditQ].find((q) => q.error)?.error;
      if (queryError) throw queryError;
      const currentScheduleRow = (scheduleQ.data || []).find((row) => row.is_current) || scheduleQ.data?.[0];
      const assignmentQ = currentScheduleRow ? await supabase.from("assignments").select("*").eq("schedule_version_id", currentScheduleRow.id).order("start_time") : { data: [], error: null };
      if (assignmentQ.error) throw assignmentQ.error;
      const assignments = (assignmentQ.data || []).map((row) => mapAssignment(row as Record<string, unknown>));
      const scheduleVersions: ScheduleVersion[] = (scheduleQ.data || []).map((row) => ({ id: row.id, version: row.version, rulebookVersion: row.rulebook_version, createdAt: row.created_at, actor: row.actor_label, reason: row.reason, assignments: row.id === currentScheduleRow?.id ? assignments : [] }));
      const mapped: StudioState = {
        studioId: STUDIO_ID, studioName: studioQ.data?.name || "DWDE Studio",
        teachers: (teachersQ.data || []).map((r) => ({ id: r.id, name: r.name, subjects: r.subjects || [], notes: r.notes || undefined })),
        rooms: (roomsQ.data || []).map((r) => ({ id: r.id, name: r.name, capacity: r.capacity ?? undefined, features: r.features || [] })),
        students: (studentsQ.data || []).map((r) => ({ id: r.id, name: r.name, level: r.level, cohortIds: r.cohort_ids || [] })),
        cohorts: (cohortsQ.data || []).map((r) => ({ id: r.id, name: r.name, studentIds: r.student_ids || [] })),
        classes: (classesQ.data || []).map((r) => ({ id: r.id, name: r.name, subject: r.subject, level: r.level, durationMinutes: r.duration_minutes, weeklyFrequency: r.weekly_frequency, rosterStudentIds: r.roster_student_ids || [], eligibleTeacherIds: r.eligible_teacher_ids || [], companyOnly: r.company_only })),
        sessions: (sessionsQ.data || []).map((r) => ({ id: r.id, classId: r.class_id, ordinal: r.ordinal, locked: r.locked })),
        rules: (rulesQ.data || []).map((r) => mapRule(r as Record<string, unknown>)),
        rulebookVersions: (rbvQ.data || []).map((r) => ({ id: r.id, version: r.version, name: r.name, createdAt: r.created_at, actor: r.actor_label, reason: r.reason, changedRuleIds: r.changed_rule_ids || [] } as RulebookVersion)),
        ruleHistory: (historyQ.data || []).map((r) => mapHistory(r as Record<string, unknown>)), scheduleVersions,
        scenarios: (scenariosQ.data || []).map((r) => ({ id: r.id, name: r.name, baseRulebookVersion: r.base_rulebook_version, baseScheduleVersion: r.base_schedule_version, rulePatches: (r.rule_patches || []) as unknown as RulePatch[], schedulePatches: (r.schedule_patches || []) as unknown as SchedulePatch[], createdAt: r.created_at } as Scenario)),
        auditEvents: (auditQ.data || []).map((r) => ({ id: r.id, at: r.created_at, actor: r.actor_label, action: r.action, entityType: r.entity_type, entityId: r.entity_id || undefined, detail: r.detail })),
      };
      setState(mapped);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [alphaKey, session]);

  useEffect(() => {
    const key = captureAlphaAccess();
    const supabase = getBrowserSupabase(key);
    supabase.auth.getSession().then(({ data }) => { setAlphaKey(key); setSession(data.session); void load(key, data.session); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => { setSession(next); void load(key, next); });
    return () => listener.subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentAssignments = useMemo(() => state?.scheduleVersions.find((v) => v.version === Math.max(0, ...state.scheduleVersions.map((item) => item.version)))?.assignments || [], [state]);
  const validation = useMemo(() => state ? validateSchedule(state, currentAssignments) : { valid: true, hardViolations: 0, warnings: 0, violations: [] }, [state, currentAssignments]);
  const currentRulebookVersion = Math.max(0, ...(state?.rulebookVersions.map((v) => v.version) || [0]));
  const currentScheduleVersion = Math.max(0, ...(state?.scheduleVersions.map((v) => v.version) || [0]));

  async function signInWithEmail(email: string) {
    try {
      const supabase = getBrowserSupabase(alphaKey);
      const { error: authError } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined, shouldCreateUser: true } });
      if (authError) throw authError;
      return { ok: true, message: "Check your email for the DWDE sign-in link." };
    } catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) }; }
  }

  async function signOut() {
    if (session) await getBrowserSupabase(alphaKey).auth.signOut();
    clearAlphaAccess(); setAlphaKey(""); setSession(null); setState(null);
  }

  async function applyRulePatch(patch: RulePatch): Promise<MutationResult> {
    try {
      const { data, error: rpcError } = await getBrowserSupabase(alphaKey).rpc("apply_rule_patch", { p_operation: patch.operation, p_rule_id: patch.ruleId || String(patch.changes.id || ""), p_changes: patch.changes, p_reason: patch.reason, p_ai_proposed: patch.proposedBy === "AI" });
      if (rpcError) throw rpcError; await load();
      return { ok: true, version: Number((data as Record<string, unknown>)?.version || 0) };
    } catch (e) { return fail(e); }
  }

  async function applySchedulePatch(patch: SchedulePatch): Promise<MutationResult> {
    if (!state) return { ok: false, error: "Workspace is not loaded." };
    const existing = currentAssignments.find((a) => a.id === patch.assignmentId);
    if (!existing) return { ok: false, error: "Assignment does not exist." };
    if (existing.locked) return { ok: false, error: "This assignment is locked by the Rulebook." };
    const proposed = applyAssignmentChanges(currentAssignments, patch.assignmentId, patch.changes);
    const result = validateSchedule(state, proposed);
    if (!result.valid) return { ok: false, error: "The proposed schedule change creates HARD violations.", validation: result };
    try {
      const { data, error: rpcError } = await getBrowserSupabase(alphaKey).rpc("apply_schedule_patch", { p_assignment_id: patch.assignmentId, p_changes: patch.changes, p_reason: patch.reason, p_validation: result, p_ai_proposed: patch.proposedBy === "AI" });
      if (rpcError) throw rpcError; await load();
      return { ok: true, validation: result, version: Number((data as Record<string, unknown>)?.scheduleVersion || 0) };
    } catch (e) { return fail(e); }
  }

  async function importPackage(pkg: CanonicalImportPackage): Promise<MutationResult> {
    try {
      const { data, error: rpcError } = await getBrowserSupabase(alphaKey).rpc("import_canonical_rulebook", { p_package: pkg, p_reason: `Imported ${pkg.rulebook.name}` });
      if (rpcError) throw rpcError; await load();
      return { ok: true, version: Number((data as Record<string, unknown>)?.version || 0) };
    } catch (e) { return fail(e); }
  }

  function exportPackage(): CanonicalImportPackage | null {
    if (!state) return null;
    return { format_version: "1.0", rulebook: { id: "dwde-canonical", name: "DWDE Master Rulebook", version: currentRulebookVersion }, entities: { teachers: state.teachers, rooms: state.rooms, classes: state.classes, students: state.students, cohorts: state.cohorts, sessions: state.sessions }, rules: state.rules, assignments: currentAssignments };
  }

  async function audit(action: string, entityType: string, entityId: string, detail: string) {
    await getBrowserSupabase(alphaKey).from("audit_events").insert({ studio_id: STUDIO_ID, actor_label: session?.user.email || "Alpha tester", actor_user_id: session?.user.id || null, action, entity_type: entityType, entity_id: entityId, detail });
  }

  async function updateTeacher(teacher: Teacher, reason: string): Promise<MutationResult> {
    try { const { error: qError } = await getBrowserSupabase(alphaKey).from("teachers").update({ name: teacher.name, subjects: teacher.subjects, notes: teacher.notes || null, updated_at: new Date().toISOString() }).eq("id", teacher.id); if (qError) throw qError; await audit("TEACHER_UPDATE", "TEACHER", teacher.id, reason); await load(); return { ok: true }; } catch (e) { return fail(e); }
  }
  async function updateRoom(room: Room, reason: string): Promise<MutationResult> {
    try { const { error: qError } = await getBrowserSupabase(alphaKey).from("rooms").update({ name: room.name, capacity: room.capacity ?? null, features: room.features || [], updated_at: new Date().toISOString() }).eq("id", room.id); if (qError) throw qError; await audit("ROOM_UPDATE", "ROOM", room.id, reason); await load(); return { ok: true }; } catch (e) { return fail(e); }
  }
  async function updateClass(klass: ClassDefinition, reason: string): Promise<MutationResult> {
    try { const { error: qError } = await getBrowserSupabase(alphaKey).from("class_definitions").update({ name: klass.name, subject: klass.subject, level: klass.level, duration_minutes: klass.durationMinutes, weekly_frequency: klass.weeklyFrequency, roster_student_ids: klass.rosterStudentIds, eligible_teacher_ids: klass.eligibleTeacherIds, company_only: Boolean(klass.companyOnly), updated_at: new Date().toISOString() }).eq("id", klass.id); if (qError) throw qError; await audit("CLASS_UPDATE", "CLASS", klass.id, reason); await load(); return { ok: true }; } catch (e) { return fail(e); }
  }

  async function createScenario(name: string, rulePatches: RulePatch[] = [], schedulePatches: SchedulePatch[] = []): Promise<MutationResult> {
    try { const { error: qError } = await getBrowserSupabase(alphaKey).from("scenarios").insert({ studio_id: STUDIO_ID, name, base_rulebook_version: currentRulebookVersion, base_schedule_version: currentScheduleVersion, rule_patches: rulePatches, schedule_patches: schedulePatches, created_by: session?.user.id || null }); if (qError) throw qError; await load(); return { ok: true }; } catch (e) { return fail(e); }
  }

  const value: WorkspaceContextValue = { loading, error, session, accessMode, state, currentAssignments, currentRulebookVersion, currentScheduleVersion, validation, chatGptAuthEnabled: chatGptAuthAvailable(), refresh: () => load(), signInWithEmail, signOut, beginChatGptSignIn, applyRulePatch, applySchedulePatch, importPackage, exportPackage, updateTeacher, updateRoom, updateClass, createScenario };
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return value;
}