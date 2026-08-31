import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
const STUDIO_ID = "11111111-1111-4111-8111-111111111111";

type Proposal = { kind: "RULE_PATCH" | "SCHEDULE_PATCH"; patch: Record<string, unknown>; title?: string };
type CopilotResult = { answer: string; mode: "OPENAI" | "LOCAL"; proposal?: Proposal | null };

function extractText(payload: Record<string, unknown>) {
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output as Array<Record<string, unknown>>) {
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content as Array<Record<string, unknown>>) if (part.type === "output_text" && typeof part.text === "string") return part.text;
  }
  return "";
}

function parseJson(text: string): { answer?: string; proposal?: Proposal | null } | null {
  try { return JSON.parse(text); } catch {}
  const start = text.indexOf("{"); const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) { try { return JSON.parse(text.slice(start, end + 1)); } catch {} }
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
  if (q.includes("class")) return { mode: "LOCAL", answer: `Current class catalog includes ${classes.slice(0, 20).map((c) => c.name).join(", ")}. Configure OPENAI_API_KEY for reasoning and structured edit proposals.`, proposal: null };
  return { mode: "LOCAL", answer: "I can still perform database-grounded rule lookups, but the OpenAI Responses API key is not configured on this deployment yet. Structured ChatGPT reasoning and edit proposals activate when the server-side OPENAI_API_KEY is added.", proposal: null };
}

export async function POST(request: NextRequest) {
  try {
    const auth = request.headers.get("authorization"); const alpha = request.headers.get("x-dwde-alpha-key");
    const supabase = getServerSupabase(auth, alpha);
    const studioCheck = await supabase.from("studios").select("id,name").eq("id", STUDIO_ID).maybeSingle();
    if (studioCheck.error || !studioCheck.data) return NextResponse.json({ error: "Workspace access denied." }, { status: 401 });
    const body = await request.json() as { message?: string; screen?: string };
    const message = body.message?.trim(); if (!message) return NextResponse.json({ error: "Message is required." }, { status: 400 });
    const [rulesQ, teachersQ, roomsQ, classesQ, sessionsQ, scheduleQ] = await Promise.all([
      supabase.from("rules").select("id,category,type,title,description,strength,status,verification_status,affected_entity_ids,parameters,exceptions").eq("studio_id", STUDIO_ID),
      supabase.from("teachers").select("id,name,subjects").eq("studio_id", STUDIO_ID),
      supabase.from("rooms").select("id,name,capacity").eq("studio_id", STUDIO_ID),
      supabase.from("class_definitions").select("id,name,subject,level,duration_minutes,eligible_teacher_ids").eq("studio_id", STUDIO_ID),
      supabase.from("class_sessions").select("id,class_id,locked").eq("studio_id", STUDIO_ID),
      supabase.from("schedule_versions").select("id,version,rulebook_version").eq("studio_id", STUDIO_ID).eq("is_current", true).maybeSingle(),
    ]);
    const firstError = [rulesQ,teachersQ,roomsQ,classesQ,sessionsQ,scheduleQ].find(q=>q.error)?.error; if(firstError) throw firstError;
    const assignmentQ = scheduleQ.data ? await supabase.from("assignments").select("id,session_id,day,start_time,end_time,teacher_id,room_id,locked").eq("schedule_version_id", scheduleQ.data.id) : { data: [], error: null };
    if(assignmentQ.error) throw assignmentQ.error;

    const rules = rulesQ.data || []; const teachers = teachersQ.data || []; const classes = classesQ.data || [];
    const key = process.env.OPENAI_API_KEY;
    if (!key) return NextResponse.json(localAnswer(message, rules, teachers, classes));

    const context = { screen: body.screen || "unknown", rulebookVersion: scheduleQ.data?.rulebook_version, scheduleVersion: scheduleQ.data?.version, rules, teachers, rooms: roomsQ.data || [], classes, sessions: sessionsQ.data || [], assignments: assignmentQ.data || [] };
    const instructions = `You are the DWDE Studio Scheduler Copilot. The supplied CURRENT_DATABASE_CONTEXT is closed-world truth for this request. Do not invent scheduling facts. Explain current rules and assignments clearly. You may propose a change but NEVER claim you applied it. All changes require preview and explicit user approval. Return ONLY one JSON object with this exact outer shape: {"answer":"plain-language answer","proposal":null OR {"kind":"RULE_PATCH"|"SCHEDULE_PATCH","title":"short preview title","patch":OBJECT}}. For RULE_PATCH, patch must match {"id":"patch-ai-...","ruleId":"stable rule id or omit for CREATE","operation":"CREATE|UPDATE|RETIRE|DISABLE|ENABLE","changes":OBJECT,"reason":"reason","proposedBy":"AI"}. For SCHEDULE_PATCH, patch must match {"id":"patch-ai-...","operation":"MOVE|ASSIGN|UNASSIGN","assignmentId":"stable assignment id","changes":OBJECT,"reason":"reason","proposedBy":"AI"}. Use camelCase domain field names inside changes, such as startTime, endTime, teacherId, roomId, verificationStatus, affectedEntityIds. If the user says what-if, recommend a Scenario rather than changing canonical truth. If the request is ambiguous, answer with what is known and do not create a patch.`;
    const apiResponse = await fetch("https://api.openai.com/v1/responses", { method:"POST", headers:{"Content-Type":"application/json",Authorization:`Bearer ${key}`}, body:JSON.stringify({ model: process.env.OPENAI_MODEL_REASONING || "gpt-5.6", instructions: `${instructions}\n\nCURRENT_DATABASE_CONTEXT:\n${JSON.stringify(context)}`, input: message, reasoning: { effort: "medium" } }) });
    const payload = await apiResponse.json() as Record<string, unknown>;
    if(!apiResponse.ok) return NextResponse.json({ error: `OpenAI Responses API error: ${String((payload.error as Record<string,unknown>|undefined)?.message || apiResponse.statusText)}` },{status:502});
    const parsed = parseJson(extractText(payload));
    const result: CopilotResult = { mode:"OPENAI", answer: parsed?.answer || "I received a response but could not parse its structured result safely. No change was proposed.", proposal: parsed?.proposal || null };
    await supabase.from("ai_proposals").insert({ studio_id:STUDIO_ID, proposal_type:result.proposal?.kind || "QUESTION", request_text:message, response_text:result.answer, patch:result.proposal?.patch || null, impact:null, status:"PROPOSED" });
    return NextResponse.json(result);
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 }); }
}
