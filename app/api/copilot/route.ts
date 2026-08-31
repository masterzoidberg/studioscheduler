import { NextRequest, NextResponse } from "next/server";
import { validateCopilotProposal, type CopilotProposal } from "@/lib/copilot-contract";
import { getServerSupabase, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase";

export const runtime = "nodejs";
const STUDIO_ID = "11111111-1111-4111-8111-111111111111";
const DEFAULT_FAST_MODEL = "openai/gpt-5.6-luna";
const DEFAULT_REASONING_MODEL = "openai/gpt-5.6-sol";

type CopilotResult = { answer: string; mode: "OPENROUTER" | "LOCAL"; model?: string; proposal?: CopilotProposal | null };
type OpenRouterPayload = { model?: string; choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>; error?: { message?: string } };
const obj = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

function extractText(payload: OpenRouterPayload) {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => part.text || "").join("");
  return "";
}

function parseJson(text: string): Record<string, unknown> | null {
  try { return obj(JSON.parse(text)); } catch {}
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return obj(JSON.parse(text.slice(start, end + 1))); } catch {}
  }
  return null;
}

function classification(rule: Record<string, unknown>) {
  return String(rule.classification_raw || rule.strength || "UNCLASSIFIED").replaceAll("_", " ");
}

function relevantRules(message: string, rules: Array<Record<string, unknown>>, teachers: Array<Record<string, unknown>>) {
  const q = message.toLowerCase();
  const words = new Set(q.split(/[^a-z0-9]+/).filter((word) => word.length >= 4));
  const exactId = q.toUpperCase().match(/[A-Z0-9]+-[0-9]{3}/)?.[0];
  if (exactId) return rules.filter((rule) => rule.id === exactId);
  if (/\ball\s+hard\b|which hard|hard rules/i.test(message)) return rules.filter((rule) => classification(rule).toUpperCase() === "HARD");
  const named = teachers.filter((teacher) => q.includes(String(teacher.name).toLowerCase()));
  const scored = rules.map((rule) => {
    const hay = `${rule.id} ${rule.title} ${rule.description} ${rule.category} ${JSON.stringify(rule.review || {})}`.toLowerCase();
    let score = 0;
    for (const word of words) if (hay.includes(word)) score += 1;
    for (const teacher of named) if (hay.includes(String(teacher.name).toLowerCase())) score += 5;
    return { rule, score };
  }).filter((item) => item.score > 0).sort((a,b) => b.score - a.score).slice(0,40).map((item) => item.rule);
  return scored.length ? scored : rules.filter((rule) => classification(rule).toUpperCase() === "HARD").slice(0,20);
}

function localAnswer(
  message: string,
  rules: Array<Record<string, unknown>>,
  teachers: Array<Record<string, unknown>>,
  classes: Array<Record<string, unknown>>,
  coverage: Record<string, unknown>,
  mappingByRule: Map<string, Record<string, unknown>>,
  enforcementVersion: number,
): CopilotResult {
  const q = message.toLowerCase();
  if (q.includes("partially validated") || q.includes("coverage") || q.includes("enforcement")) {
    return {
      mode: "LOCAL",
      answer: `Rulebook review and machine enforcement are independently versioned. Enforcement v${enforcementVersion} currently maps ${coverage.implementedHardRules ?? 0} of ${coverage.applicableHardRules ?? 0} applicable HARD rules, with ${coverage.notImplementedHardRules ?? 0} still unmapped. Zero detected conflicts therefore does not mean every reviewed Rulebook rule has been deterministically checked.`,
      proposal: null,
    };
  }
  const matches = relevantRules(message,rules,teachers);
  if (matches.length) {
    return {
      mode: "LOCAL",
      answer: matches.slice(0,12).map((rule) => {
        const mapping = mappingByRule.get(String(rule.id));
        return `• ${rule.id} · ${rule.title} (${classification(rule)}, ${rule.review_status || rule.verification_status}, ${mapping ? `mapped in Enforcement v${enforcementVersion} as ${mapping.type}` : "not currently mapped"}) — ${rule.description}`;
      }).join("\n"),
      proposal: null,
    };
  }
  if (q.includes("class")) return { mode: "LOCAL", answer: `Current class catalog includes ${classes.slice(0,20).map((item) => item.name).join(", ")}. Save an OpenRouter key in Settings to activate AI reasoning and structured proposals.`, proposal: null };
  return { mode: "LOCAL", answer: "I can perform database-grounded Rulebook and Enforcement lookups without an AI key. Save an OpenRouter key in Settings for reasoning and structured proposals.", proposal: null };
}

function selectModel(message: string) {
  const fast = process.env.OPENROUTER_MODEL_FAST || DEFAULT_FAST_MODEL;
  const reasoning = process.env.OPENROUTER_MODEL_REASONING || DEFAULT_REASONING_MODEL;
  const useReasoning = /\b(propose|change|move|schedule|optimi[sz]e|repair|scenario|what[- ]?if|conflict|why can'?t|rework|reschedule|mapping|enforcement)\b/i.test(message);
  return { model: useReasoning ? reasoning : fast, effort: useReasoning ? "medium" : "low" } as const;
}

async function authorizeWorkspace(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!auth) return { supabase: null, allowed: false, auth: null, role: null, userId: null };
  const supabase = getServerSupabase(auth);
  const userResult = await supabase.auth.getUser();
  const user = userResult.data.user;
  if (userResult.error || !user) return { supabase, allowed: false, auth, role: null, userId: null };
  const membership = await supabase.from("studio_members").select("role").eq("studio_id",STUDIO_ID).eq("user_id",user.id).maybeSingle();
  return { supabase, allowed: !membership.error && Boolean(membership.data), auth, role: membership.data?.role || null, userId: user.id };
}

async function accountCredentialStatus(authHeader: string | null) {
  if (!authHeader) return { configured: false };
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/user-openrouter`, { method: "GET", headers: { Authorization: authHeader, apikey: SUPABASE_PUBLISHABLE_KEY }, cache: "no-store" });
    if (!response.ok) return { configured: false };
    return await response.json() as { configured?: boolean; keyHint?: string | null };
  } catch { return { configured: false }; }
}

async function callAccountOpenRouter(authHeader: string, body: Record<string, unknown>) {
  return fetch(`${SUPABASE_URL}/functions/v1/user-openrouter`, { method: "POST", headers: { Authorization: authHeader, apikey: SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
}

async function callServerOpenRouter(key: string, body: Record<string, unknown>) {
  return fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "HTTP-Referer": process.env.APP_URL || "https://studioscheduler-three.vercel.app", "X-Title": "DWDE Studio Scheduler" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
}

export async function GET(request: NextRequest) {
  try {
    const { allowed, auth } = await authorizeWorkspace(request);
    if (!allowed) return NextResponse.json({ error: "Workspace access denied." }, { status: 401 });
    const account = await accountCredentialStatus(auth);
    const serverConfigured = Boolean(process.env.OPENROUTER_API_KEY);
    return NextResponse.json({ openRouterConfigured: Boolean(account.configured) || serverConfigured, keySource: account.configured ? "account" : serverConfigured ? "server" : null, keyHint: account.keyHint || null, reasoningModel: process.env.OPENROUTER_MODEL_REASONING || DEFAULT_REASONING_MODEL, fastModel: process.env.OPENROUTER_MODEL_FAST || DEFAULT_FAST_MODEL });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authz = await authorizeWorkspace(request);
    if (!authz.allowed || !authz.supabase || !authz.auth) return NextResponse.json({ error: "Workspace access denied." }, { status: 401 });
    const supabase = authz.supabase;
    const auth = authz.auth;
    const body = await request.json() as { message?: string; screen?: string };
    const message = body.message?.trim();
    if (!message) return NextResponse.json({ error: "Message is required." }, { status: 400 });
    if (message.length > 5000) return NextResponse.json({ error: "Message is too long." }, { status: 400 });

    const [rulesQ,teachersQ,roomsQ,classesQ,sessionsQ,scheduleQ,rulebookQ,enforcementQ,proposalsQ] = await Promise.all([
      supabase.from("rules").select("id,category,title,description,strength,classification_raw,status,verification_status,review_status,review,source_raw").eq("studio_id",STUDIO_ID),
      supabase.from("teachers").select("id,name").eq("studio_id",STUDIO_ID),
      supabase.from("rooms").select("id,name,capacity").eq("studio_id",STUDIO_ID),
      supabase.from("class_definitions").select("id,name,subject,level,duration_minutes,weekly_frequency,roster_student_ids,company_only").eq("studio_id",STUDIO_ID),
      supabase.from("class_sessions").select("id,class_id,locked").eq("studio_id",STUDIO_ID),
      supabase.from("schedule_versions").select("id,version,rulebook_version,enforcement_version,validation_result").eq("studio_id",STUDIO_ID).eq("is_current",true).maybeSingle(),
      supabase.from("rulebook_versions").select("version,status,source_hash,rule_count,document_type").eq("studio_id",STUDIO_ID).eq("status","CURRENT").maybeSingle(),
      supabase.from("rule_enforcement_versions").select("version,rulebook_version,snapshot,status,reason").eq("studio_id",STUDIO_ID).eq("status","CURRENT").maybeSingle(),
      supabase.from("rule_enforcement_proposals").select("rule_id,proposed_mapping,rationale,proposal_source,status").eq("studio_id",STUDIO_ID).eq("status","PROPOSED"),
    ]);
    const firstError = [rulesQ,teachersQ,roomsQ,classesQ,sessionsQ,scheduleQ,rulebookQ,enforcementQ,proposalsQ].find((query) => query.error)?.error;
    if (firstError) throw firstError;

    const assignmentQ = scheduleQ.data ? await supabase.from("assignments").select("id,session_id,day,start_time,end_time,teacher_id,room_id,locked,status").eq("schedule_version_id",scheduleQ.data.id) : { data: [], error: null };
    if (assignmentQ.error) throw assignmentQ.error;

    const rules = (rulesQ.data || []) as Array<Record<string,unknown>>;
    const teachers = (teachersQ.data || []) as Array<Record<string,unknown>>;
    const rooms = (roomsQ.data || []) as Array<Record<string,unknown>>;
    const classes = (classesQ.data || []) as Array<Record<string,unknown>>;
    const assignments = (assignmentQ.data || []) as Array<Record<string,unknown>>;
    const enforcementSnapshot = (Array.isArray(enforcementQ.data?.snapshot) ? enforcementQ.data.snapshot : []) as Array<Record<string,unknown>>;
    const mappingByRule = new Map(enforcementSnapshot.map((mapping) => [String(mapping.ruleId),mapping]));
    const hardRules = rules.filter((rule) => classification(rule).toUpperCase() === "HARD" && rule.status === "ACTIVE");
    const applicableHardRules = hardRules.length;
    const implementedHardRules = hardRules.filter((rule) => mappingByRule.has(String(rule.id))).length;
    const coverage = {
      applicableHardRules,
      implementedHardRules,
      partialHardRules: 0,
      notImplementedHardRules: Math.max(applicableHardRules - implementedHardRules,0),
      uncoveredHardRuleIds: hardRules.filter((rule) => !mappingByRule.has(String(rule.id))).map((rule) => String(rule.id)),
    };
    const rulebookVersion = Number(rulebookQ.data?.version || 0);
    const enforcementVersion = Number(enforcementQ.data?.version || 0);
    const scheduleVersion = Number(scheduleQ.data?.version || 0);
    const scheduleStale = Boolean(scheduleQ.data && (
      Number(scheduleQ.data.rulebook_version) !== rulebookVersion || Number(scheduleQ.data.enforcement_version) !== enforcementVersion
    ));
    const currentRules = relevantRules(message,rules,teachers).map((rule) => ({
      ...rule,
      approved_enforcement_mapping: mappingByRule.get(String(rule.id)) || null,
      pending_enforcement_proposal: (proposalsQ.data || []).find((proposal) => proposal.rule_id === rule.id) || null,
    }));
    const account = await accountCredentialStatus(auth);
    const serverKey = process.env.OPENROUTER_API_KEY?.trim() || "";

    if (!account.configured && !serverKey) {
      const local = localAnswer(message,rules,teachers,classes,coverage,mappingByRule,enforcementVersion);
      if (authz.role !== "VIEWER") await supabase.rpc("record_ai_proposal_v21", { p_proposal_type: "QUESTION", p_request_text: message, p_response_text: local.answer, p_patch: null, p_impact: { provider: "LOCAL", rulebookVersion, enforcementVersion, scheduleVersion } });
      return NextResponse.json(local);
    }

    const context = {
      screen: body.screen || "unknown",
      userRole: authz.role,
      currentRulebook: { version: rulebookVersion, status: rulebookQ.data?.status, sourceHash: rulebookQ.data?.source_hash, ruleCount: rulebookQ.data?.rule_count },
      currentEnforcement: { version: enforcementVersion, rulebookVersion: enforcementQ.data?.rulebook_version, mappings: enforcementSnapshot, pendingProposals: proposalsQ.data || [] },
      currentSchedule: { version: scheduleVersion, rulebookVersion: scheduleQ.data?.rulebook_version, enforcementVersion: scheduleQ.data?.enforcement_version, stale: scheduleStale, storedValidation: scheduleQ.data?.validation_result },
      validatorCoverage: coverage,
      relevantRules: currentRules,
      teachers,
      rooms,
      classes,
      sessions: sessionsQ.data || [],
      assignments,
    };

    const instructions = `You are the DWDE Studio Scheduler Copilot. CURRENT_DATABASE_CONTEXT is closed-world scheduling truth. Human RulebookVersion and machine EnforcementVersion are separate authorities. The reviewed Rulebook wording is authoritative even when unmapped. Only mappings inside currentEnforcement.mappings are approved deterministic enforcement. Pending mapping proposals do not enforce. Never infer that zero detected violations means full validity unless validatorCoverage is complete. Never claim a change was applied. Return ONLY one JSON object: {"answer":"plain-language answer","proposal":null OR {"kind":"RULE_PATCH"|"SCHEDULE_PATCH","title":"short title","patch":OBJECT}}. RULE_PATCH changes human Rulebook policy only and may use CREATE|UPDATE|RETIRE|DISABLE|ENABLE. It MUST NOT contain type, parameters, affectedEntityIds, exceptions, enforcementStatus, provenance, version metadata, or audit data. If the user asks to alter machine enforcement or map an unmapped rule, explain that it requires a separate Enforcement mapping review; do not disguise it as a Rulebook edit. SCHEDULE_PATCH in V2.2 may ONLY MOVE an existing unlocked assignment and may contain only day,startTime,endTime,teacherId,roomId,status. If currentSchedule.stale is true, do not propose a schedule mutation. Rule changes use camelCase domain fields. For what-if requests recommend a Scenario rather than canonical mutation. If uncertain, answer without a proposal. Every proposal is only a preview and requires explicit Apply.`;
    const selection = selectModel(message);
    const openRouterBody = { model: selection.model, messages: [{ role: "system", content: `${instructions}\n\nCURRENT_DATABASE_CONTEXT:\n${JSON.stringify(context)}` }, { role: "user", content: message }], response_format: { type: "json_object" }, reasoning: { effort: selection.effort } };

    let apiResponse: Response;
    let keySource: "account" | "server";
    if (account.configured) {
      apiResponse = await callAccountOpenRouter(auth,openRouterBody);
      keySource = "account";
      if (!apiResponse.ok && serverKey && [401,403,409].includes(apiResponse.status)) { apiResponse = await callServerOpenRouter(serverKey,openRouterBody); keySource = "server"; }
    } else {
      apiResponse = await callServerOpenRouter(serverKey,openRouterBody);
      keySource = "server";
    }
    const payload = await apiResponse.json() as OpenRouterPayload;
    if (!apiResponse.ok) return NextResponse.json({ error: `OpenRouter error: ${payload.error?.message || apiResponse.statusText}` }, { status: 502 });

    const parsed = parseJson(extractText(payload));
    const contract = validateCopilotProposal(parsed?.proposal, {
      ruleIds: new Set(rules.map((rule) => String(rule.id))),
      assignmentIds: new Set(assignments.map((assignment) => String(assignment.id))),
      lockedAssignmentIds: new Set(assignments.filter((assignment) => assignment.locked).map((assignment) => String(assignment.id))),
      teacherIds: new Set(teachers.map((teacher) => String(teacher.id))),
      roomIds: new Set(rooms.map((room) => String(room.id))),
      rulebookVersion,
      enforcementVersion,
      scheduleVersion,
    });
    let proposal = contract.ok ? contract.proposal : null;
    let proposalProblem = parsed?.proposal && !contract.ok ? contract.message : "";
    if (proposal?.kind === "SCHEDULE_PATCH" && scheduleStale) {
      proposal = null;
      proposalProblem = "The current Schedule is stale against the Rulebook or Enforcement policy, so schedule proposals are disabled until it is revalidated.";
    }
    const answer = typeof parsed?.answer === "string" ? parsed.answer : "I received a response but could not parse it safely. No change was proposed.";
    const result: CopilotResult = { mode: "OPENROUTER", model: payload.model || selection.model, answer: proposalProblem ? `${answer}\n\nThe proposed mutation was discarded: ${proposalProblem}` : answer, proposal };

    if (authz.role !== "VIEWER") await supabase.rpc("record_ai_proposal_v21", {
      p_proposal_type: result.proposal?.kind || "QUESTION",
      p_request_text: message,
      p_response_text: result.answer,
      p_patch: result.proposal?.patch || null,
      p_impact: { provider: "OPENROUTER", model: result.model, keySource, rulebookVersion, enforcementVersion, scheduleVersion, scheduleRulebookVersion: scheduleQ.data?.rulebook_version, scheduleEnforcementVersion: scheduleQ.data?.enforcement_version, validatorCoverage: coverage, proposalSchemaValid: !proposalProblem, userRole: authz.role },
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
