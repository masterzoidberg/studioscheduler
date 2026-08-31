import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase";

export const runtime = "nodejs";
const STUDIO_ID = "11111111-1111-4111-8111-111111111111";
const DEFAULT_FAST_MODEL = "openai/gpt-5.6-luna";
const DEFAULT_REASONING_MODEL = "openai/gpt-5.6-sol";

type Proposal = { kind: "RULE_PATCH" | "SCHEDULE_PATCH"; patch: Record<string, unknown>; title?: string };
type CopilotResult = { answer: string; mode: "OPENROUTER" | "LOCAL"; model?: string; proposal?: Proposal | null };
type OpenRouterPayload = {
  model?: string;
  choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
  error?: { message?: string };
};

function extractText(payload: OpenRouterPayload) {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => part.text || "").join("");
  return "";
}

function parseJson(text: string): { answer?: string; proposal?: Proposal | null } | null {
  try { return JSON.parse(text); } catch {}
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch {}
  }
  return null;
}

function localAnswer(message: string, rules: Array<Record<string, unknown>>, teachers: Array<Record<string, unknown>>, classes: Array<Record<string, unknown>>): CopilotResult {
  const q = message.toLowerCase();
  const namedTeacher = teachers.find((t) => q.includes(String(t.name).toLowerCase()));
  let matches = rules.filter((r) => `${r.title} ${r.description}`.toLowerCase().split(/\s+/).some((word) => word.length > 4 && q.includes(word)));
  if (namedTeacher) matches = rules.filter((r) => (r.affected_entity_ids as string[] || []).includes(String(namedTeacher.id)) || String(JSON.stringify(r.parameters)).includes(String(namedTeacher.id)));
  if (q.includes("hard")) matches = matches.filter((r) => r.strength === "HARD");
  if (q.includes("studio a")) matches = rules.filter((r) => String(JSON.stringify(r.parameters)).includes("room-studio-a"));
  if (matches.length) return { mode: "LOCAL", answer: matches.slice(0, 12).map((r) => `• ${r.title} (${r.strength}, ${r.status}) — ${r.description}`).join("\n"), proposal: null };
  if (q.includes("class")) return { mode: "LOCAL", answer: `Current class catalog includes ${classes.slice(0, 20).map((c) => c.name).join(", ")}. Sign in and save an OpenRouter key in Settings to activate AI reasoning and structured edit proposals.`, proposal: null };
  return { mode: "LOCAL", answer: "I can still perform database-grounded rule lookups. For AI reasoning and structured proposals, sign in and save an OpenRouter API key in Settings.", proposal: null };
}

function selectModel(message: string) {
  const fast = process.env.OPENROUTER_MODEL_FAST || DEFAULT_FAST_MODEL;
  const reasoning = process.env.OPENROUTER_MODEL_REASONING || DEFAULT_REASONING_MODEL;
  const requiresReasoning = /\b(propose|change|move|assign|unassign|schedule|optimi[sz]e|repair|scenario|what[- ]?if|conflict|why can'?t|rework|reschedule)\b/i.test(message);
  return { model: requiresReasoning ? reasoning : fast, effort: requiresReasoning ? "medium" : "low", fast, reasoning } as const;
}

async function authorizeWorkspace(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const alpha = request.headers.get("x-dwde-alpha-key");
  const supabase = getServerSupabase(auth, alpha);
  const studioCheck = await supabase.from("studios").select("id,name").eq("id", STUDIO_ID).maybeSingle();
  return { supabase, allowed: !studioCheck.error && Boolean(studioCheck.data), auth };
}

async function accountCredentialStatus(authHeader: string | null) {
  if (!authHeader) return { configured: false };
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/user-openrouter`, {
      method: "GET",
      headers: { Authorization: authHeader, apikey: SUPABASE_PUBLISHABLE_KEY },
      cache: "no-store",
    });
    if (!response.ok) return { configured: false };
    return await response.json() as { configured?: boolean; keyHint?: string | null };
  } catch {
    return { configured: false };
  }
}

async function callAccountOpenRouter(authHeader: string, body: Record<string, unknown>) {
  return fetch(`${SUPABASE_URL}/functions/v1/user-openrouter`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      apikey: SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
}

async function callServerOpenRouter(key: string, body: Record<string, unknown>) {
  return fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "HTTP-Referer": process.env.APP_URL || "https://studioscheduler-three.vercel.app",
      "X-Title": "DWDE Studio Scheduler",
    },
    body: JSON.stringify(body),
  });
}

export async function GET(request: NextRequest) {
  try {
    const { allowed, auth } = await authorizeWorkspace(request);
    if (!allowed) return NextResponse.json({ error: "Workspace access denied." }, { status: 401 });
    const account = await accountCredentialStatus(auth);
    const serverConfigured = Boolean(process.env.OPENROUTER_API_KEY);
    return NextResponse.json({
      openRouterConfigured: Boolean(account.configured) || serverConfigured,
      keySource: account.configured ? "account" : serverConfigured ? "server" : null,
      keyHint: account.keyHint || null,
      reasoningModel: process.env.OPENROUTER_MODEL_REASONING || DEFAULT_REASONING_MODEL,
      fastModel: process.env.OPENROUTER_MODEL_FAST || DEFAULT_FAST_MODEL,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, allowed, auth } = await authorizeWorkspace(request);
    if (!allowed) return NextResponse.json({ error: "Workspace access denied." }, { status: 401 });
    const body = await request.json() as { message?: string; screen?: string };
    const message = body.message?.trim();
    if (!message) return NextResponse.json({ error: "Message is required." }, { status: 400 });

    const [rulesQ, teachersQ, roomsQ, classesQ, sessionsQ, scheduleQ] = await Promise.all([
      supabase.from("rules").select("id,category,type,title,description,strength,status,verification_status,affected_entity_ids,parameters,exceptions").eq("studio_id", STUDIO_ID),
      supabase.from("teachers").select("id,name,subjects").eq("studio_id", STUDIO_ID),
      supabase.from("rooms").select("id,name,capacity").eq("studio_id", STUDIO_ID),
      supabase.from("class_definitions").select("id,name,subject,level,duration_minutes,eligible_teacher_ids").eq("studio_id", STUDIO_ID),
      supabase.from("class_sessions").select("id,class_id,locked").eq("studio_id", STUDIO_ID),
      supabase.from("schedule_versions").select("id,version,rulebook_version").eq("studio_id", STUDIO_ID).eq("is_current", true).maybeSingle(),
    ]);
    const firstError = [rulesQ, teachersQ, roomsQ, classesQ, sessionsQ, scheduleQ].find((q) => q.error)?.error;
    if (firstError) throw firstError;

    const assignmentQ = scheduleQ.data
      ? await supabase.from("assignments").select("id,session_id,day,start_time,end_time,teacher_id,room_id,locked").eq("schedule_version_id", scheduleQ.data.id)
      : { data: [], error: null };
    if (assignmentQ.error) throw assignmentQ.error;

    const rules = rulesQ.data || [];
    const teachers = teachersQ.data || [];
    const classes = classesQ.data || [];
    const account = await accountCredentialStatus(auth);
    const serverKey = process.env.OPENROUTER_API_KEY?.trim() || "";
    if (!account.configured && !serverKey) return NextResponse.json(localAnswer(message, rules, teachers, classes));

    const context = {
      screen: body.screen || "unknown",
      rulebookVersion: scheduleQ.data?.rulebook_version,
      scheduleVersion: scheduleQ.data?.version,
      rules,
      teachers,
      rooms: roomsQ.data || [],
      classes,
      sessions: sessionsQ.data || [],
      assignments: assignmentQ.data || [],
    };
    const instructions = `You are the DWDE Studio Scheduler Copilot. The supplied CURRENT_DATABASE_CONTEXT is closed-world truth for this request. Do not invent scheduling facts. Explain current rules and assignments clearly. You may propose a change but NEVER claim you applied it. All changes require preview and explicit user approval. Return ONLY one JSON object with this exact outer shape: {"answer":"plain-language answer","proposal":null OR {"kind":"RULE_PATCH"|"SCHEDULE_PATCH","title":"short preview title","patch":OBJECT}}. For RULE_PATCH, patch must match {"id":"patch-ai-...","ruleId":"stable rule id or omit for CREATE","operation":"CREATE|UPDATE|RETIRE|DISABLE|ENABLE","changes":OBJECT,"reason":"reason","proposedBy":"AI"}. For SCHEDULE_PATCH, patch must match {"id":"patch-ai-...","operation":"MOVE|ASSIGN|UNASSIGN","assignmentId":"stable assignment id","changes":OBJECT,"reason":"reason","proposedBy":"AI"}. Use camelCase domain field names inside changes, such as startTime, endTime, teacherId, roomId, verificationStatus, affectedEntityIds. If the user says what-if, recommend a Scenario rather than changing canonical truth. If the request is ambiguous, answer with what is known and do not create a patch.`;
    const selection = selectModel(message);
    const openRouterBody = {
      model: selection.model,
      messages: [
        { role: "system", content: `${instructions}\n\nCURRENT_DATABASE_CONTEXT:\n${JSON.stringify(context)}` },
        { role: "user", content: message },
      ],
      response_format: { type: "json_object" },
      reasoning: { effort: selection.effort },
    };

    let apiResponse: Response;
    let keySource: "account" | "server";
    if (account.configured && auth) {
      apiResponse = await callAccountOpenRouter(auth, openRouterBody);
      keySource = "account";
      if (!apiResponse.ok && serverKey && [401, 403, 409].includes(apiResponse.status)) {
        apiResponse = await callServerOpenRouter(serverKey, openRouterBody);
        keySource = "server";
      }
    } else {
      apiResponse = await callServerOpenRouter(serverKey, openRouterBody);
      keySource = "server";
    }

    const payload = await apiResponse.json() as OpenRouterPayload;
    if (!apiResponse.ok) return NextResponse.json({ error: `OpenRouter error: ${payload.error?.message || apiResponse.statusText}` }, { status: 502 });

    const parsed = parseJson(extractText(payload));
    const result: CopilotResult = {
      mode: "OPENROUTER",
      model: payload.model || selection.model,
      answer: parsed?.answer || "I received a response but could not parse its structured result safely. No change was proposed.",
      proposal: parsed?.proposal || null,
    };
    await supabase.from("ai_proposals").insert({
      studio_id: STUDIO_ID,
      proposal_type: result.proposal?.kind || "QUESTION",
      request_text: message,
      response_text: result.answer,
      patch: result.proposal?.patch || null,
      impact: { provider: "OPENROUTER", model: result.model, keySource },
      status: "PROPOSED",
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
