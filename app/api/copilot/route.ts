import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase";

export const runtime = "nodejs";
const STUDIO_ID="11111111-1111-4111-8111-111111111111";
const DEFAULT_FAST_MODEL="openai/gpt-5.6-luna";
const DEFAULT_REASONING_MODEL="openai/gpt-5.6-sol";
const RULE_ID=/^[A-Z0-9]+-[0-9]{3}$/;
const TIME=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
const DAYS=new Set(["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"]);
const RULE_OPS=new Set(["CREATE","UPDATE","RETIRE","DISABLE","ENABLE"]);
const RULE_CHANGE_KEYS=new Set(["id","category","type","title","description","classificationRaw","strength","status","verificationStatus","reviewStatus","review","affectedEntityIds","parameters","exceptions","enforcementStatus","sourceRaw"]);
const SCHEDULE_CHANGE_KEYS=new Set(["day","startTime","endTime","teacherId","roomId","status"]);

type Proposal={kind:"RULE_PATCH"|"SCHEDULE_PATCH";patch:Record<string,unknown>;title?:string};
type CopilotResult={answer:string;mode:"OPENROUTER"|"LOCAL";model?:string;proposal?:Proposal|null};
type OpenRouterPayload={model?:string;choices?:Array<{message?:{content?:string|Array<{type?:string;text?:string}>}}> ;error?:{message?:string}};

const obj=(value:unknown):Record<string,unknown>|null=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:null;
const keysAllowed=(value:Record<string,unknown>,allowed:Set<string>)=>Object.keys(value).every(k=>allowed.has(k));

function extractText(payload:OpenRouterPayload){const content=payload.choices?.[0]?.message?.content;if(typeof content==="string")return content;if(Array.isArray(content))return content.map(p=>p.text||"").join("");return "";}
function parseJson(text:string):Record<string,unknown>|null{try{return obj(JSON.parse(text));}catch{}const start=text.indexOf("{");const end=text.lastIndexOf("}");if(start>=0&&end>start){try{return obj(JSON.parse(text.slice(start,end+1)));}catch{}}return null;}
function classification(rule:Record<string,unknown>){return String(rule.classification_raw||rule.strength||"UNCLASSIFIED").replaceAll("_"," ");}

function relevantRules(message:string,rules:Array<Record<string,unknown>>,teachers:Array<Record<string,unknown>>){
  const q=message.toLowerCase();
  const words=new Set(q.split(/[^a-z0-9]+/).filter(w=>w.length>=4));
  const exactId=q.toUpperCase().match(/[A-Z0-9]+-[0-9]{3}/)?.[0];
  if(exactId)return rules.filter(r=>r.id===exactId);
  if(/\ball\s+hard\b|which hard|hard rules/i.test(message))return rules.filter(r=>classification(r).toUpperCase()==="HARD");
  const named=teachers.filter(t=>q.includes(String(t.name).toLowerCase()));
  const scored=rules.map(rule=>{
    const hay=`${rule.id} ${rule.title} ${rule.description} ${rule.category} ${JSON.stringify(rule.review||{})}`.toLowerCase();
    let score=0;for(const w of words)if(hay.includes(w))score+=1;
    for(const t of named)if(hay.includes(String(t.name).toLowerCase())||(rule.affected_entity_ids as string[]||[]).includes(String(t.id)))score+=5;
    return {rule,score};
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,40).map(x=>x.rule);
  return scored.length?scored:rules.filter(r=>classification(r).toUpperCase()==="HARD").slice(0,20);
}

function localAnswer(message:string,rules:Array<Record<string,unknown>>,teachers:Array<Record<string,unknown>>,classes:Array<Record<string,unknown>>,coverage:Record<string,unknown>):CopilotResult{
  const q=message.toLowerCase();
  if(q.includes("partially validated")||q.includes("coverage"))return {mode:"LOCAL",answer:`The current reviewed Rulebook and deterministic validator are separate layers. ${coverage.implementedHardRules??0} of ${coverage.applicableHardRules??0} applicable HARD rules are implemented, with ${coverage.notImplementedHardRules??0} still awaiting deterministic enforcement. Zero detected conflicts therefore does not mean the entire Rulebook has been machine-validated.`,proposal:null};
  const matches=relevantRules(message,rules,teachers);
  if(matches.length)return {mode:"LOCAL",answer:matches.slice(0,12).map(r=>`• ${r.id} · ${r.title} (${classification(r)}, ${r.review_status||r.verification_status}, enforcement ${r.enforcement_status||"NOT_IMPLEMENTED"}) — ${r.description}`).join("\n"),proposal:null};
  if(q.includes("class"))return {mode:"LOCAL",answer:`Current class catalog includes ${classes.slice(0,20).map(c=>c.name).join(", ")}. Save an OpenRouter key in Settings to activate AI reasoning and structured proposals.`,proposal:null};
  return {mode:"LOCAL",answer:"I can perform current database-grounded Rulebook lookups without an AI key. Save an OpenRouter key in Settings for reasoning and structured proposals.",proposal:null};
}

function selectModel(message:string){const fast=process.env.OPENROUTER_MODEL_FAST||DEFAULT_FAST_MODEL;const reasoning=process.env.OPENROUTER_MODEL_REASONING||DEFAULT_REASONING_MODEL;const useReasoning=/\b(propose|change|move|schedule|optimi[sz]e|repair|scenario|what[- ]?if|conflict|why can'?t|rework|reschedule)\b/i.test(message);return {model:useReasoning?reasoning:fast,effort:useReasoning?"medium":"low",fast,reasoning} as const;}

async function authorizeWorkspace(request:NextRequest){const auth=request.headers.get("authorization");if(!auth)return {supabase:null,allowed:false,auth:null,role:null};const supabase=getServerSupabase(auth);const membership=await supabase.from("studio_members").select("role").eq("studio_id",STUDIO_ID).maybeSingle();return {supabase,allowed:!membership.error&&Boolean(membership.data),auth,role:membership.data?.role||null};}
async function accountCredentialStatus(authHeader:string|null){if(!authHeader)return {configured:false};try{const response=await fetch(`${SUPABASE_URL}/functions/v1/user-openrouter`,{method:"GET",headers:{Authorization:authHeader,apikey:SUPABASE_PUBLISHABLE_KEY},cache:"no-store"});if(!response.ok)return {configured:false};return await response.json() as {configured?:boolean;keyHint?:string|null};}catch{return {configured:false};}}
async function callAccountOpenRouter(authHeader:string,body:Record<string,unknown>){return fetch(`${SUPABASE_URL}/functions/v1/user-openrouter`,{method:"POST",headers:{Authorization:authHeader,apikey:SUPABASE_PUBLISHABLE_KEY,"Content-Type":"application/json"},body:JSON.stringify(body),cache:"no-store"});}
async function callServerOpenRouter(key:string,body:Record<string,unknown>){return fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${key}`,"HTTP-Referer":process.env.APP_URL||"https://studioscheduler-three.vercel.app","X-Title":"DWDE Studio Scheduler"},body:JSON.stringify(body),signal:AbortSignal.timeout(90_000)});}

function validateProposal(raw:unknown,ctx:{rules:Array<Record<string,unknown>>;assignments:Array<Record<string,unknown>>;teachers:Array<Record<string,unknown>>;rooms:Array<Record<string,unknown>>}):Proposal|null{
  if(raw===null||raw===undefined)return null;const proposal=obj(raw);if(!proposal)return null;
  if(proposal.kind!=="RULE_PATCH"&&proposal.kind!=="SCHEDULE_PATCH")return null;
  const patch=obj(proposal.patch);if(!patch)return null;
  if(typeof patch.id!=="string"||!patch.id.startsWith("patch-ai-"))return null;
  if(patch.proposedBy!=="AI"||typeof patch.reason!=="string"||!patch.reason.trim())return null;

  if(proposal.kind==="RULE_PATCH"){
    if(!keysAllowed(patch,new Set(["id","ruleId","operation","changes","reason","proposedBy"])))return null;
    if(typeof patch.operation!=="string"||!RULE_OPS.has(patch.operation))return null;
    const changes=obj(patch.changes);if(!changes||!keysAllowed(changes,RULE_CHANGE_KEYS))return null;
    if(patch.operation==="CREATE"){
      if(typeof changes.id!=="string"||!RULE_ID.test(changes.id)||ctx.rules.some(r=>r.id===changes.id))return null;
    }else{
      if(typeof patch.ruleId!=="string"||!RULE_ID.test(patch.ruleId)||!ctx.rules.some(r=>r.id===patch.ruleId))return null;
    }
    return {kind:"RULE_PATCH",title:typeof proposal.title==="string"?proposal.title:undefined,patch};
  }

  if(!keysAllowed(patch,new Set(["id","operation","assignmentId","changes","reason","proposedBy"])))return null;
  if(patch.operation!=="MOVE"||typeof patch.assignmentId!=="string")return null;
  const assignment=ctx.assignments.find(a=>a.id===patch.assignmentId);if(!assignment||assignment.locked)return null;
  const changes=obj(patch.changes);if(!changes||!keysAllowed(changes,SCHEDULE_CHANGE_KEYS))return null;
  if(changes.day!==undefined&&(!DAYS.has(String(changes.day))))return null;
  if(changes.startTime!==undefined&&(!TIME.test(String(changes.startTime))))return null;
  if(changes.endTime!==undefined&&(!TIME.test(String(changes.endTime))))return null;
  if(changes.teacherId!==undefined&&!ctx.teachers.some(t=>t.id===changes.teacherId))return null;
  if(changes.roomId!==undefined&&!ctx.rooms.some(r=>r.id===changes.roomId))return null;
  if(changes.status!==undefined&&!new Set(["NORMAL","WARNING","AI_PROPOSED"]).has(String(changes.status)))return null;
  return {kind:"SCHEDULE_PATCH",title:typeof proposal.title==="string"?proposal.title:undefined,patch};
}

export async function GET(request:NextRequest){try{const {allowed,auth}=await authorizeWorkspace(request);if(!allowed)return NextResponse.json({error:"Workspace access denied."},{status:401});const account=await accountCredentialStatus(auth);const serverConfigured=Boolean(process.env.OPENROUTER_API_KEY);return NextResponse.json({openRouterConfigured:Boolean(account.configured)||serverConfigured,keySource:account.configured?"account":serverConfigured?"server":null,keyHint:account.keyHint||null,reasoningModel:process.env.OPENROUTER_MODEL_REASONING||DEFAULT_REASONING_MODEL,fastModel:process.env.OPENROUTER_MODEL_FAST||DEFAULT_FAST_MODEL});}catch(error){return NextResponse.json({error:error instanceof Error?error.message:String(error)},{status:500});}}

export async function POST(request:NextRequest){
  try{
    const authz=await authorizeWorkspace(request);if(!authz.allowed||!authz.supabase||!authz.auth)return NextResponse.json({error:"Workspace access denied."},{status:401});
    const supabase=authz.supabase;const auth=authz.auth;
    const body=await request.json() as {message?:string;screen?:string};const message=body.message?.trim();if(!message)return NextResponse.json({error:"Message is required."},{status:400});if(message.length>5000)return NextResponse.json({error:"Message is too long."},{status:400});

    const [rulesQ,teachersQ,roomsQ,classesQ,sessionsQ,scheduleQ,rulebookQ]=await Promise.all([
      supabase.from("rules").select("id,category,type,title,description,strength,classification_raw,status,verification_status,review_status,review,source_raw,enforcement_status,affected_entity_ids,parameters,exceptions").eq("studio_id",STUDIO_ID),
      supabase.from("teachers").select("id,name").eq("studio_id",STUDIO_ID),
      supabase.from("rooms").select("id,name,capacity").eq("studio_id",STUDIO_ID),
      supabase.from("class_definitions").select("id,name,subject,level,duration_minutes,roster_student_ids,company_only").eq("studio_id",STUDIO_ID),
      supabase.from("class_sessions").select("id,class_id,locked").eq("studio_id",STUDIO_ID),
      supabase.from("schedule_versions").select("id,version,rulebook_version,validation_result").eq("studio_id",STUDIO_ID).eq("is_current",true).maybeSingle(),
      supabase.from("rulebook_versions").select("version,status,source_hash,rule_count,document_type").eq("studio_id",STUDIO_ID).eq("status","CURRENT").maybeSingle(),
    ]);
    const firstError=[rulesQ,teachersQ,roomsQ,classesQ,sessionsQ,scheduleQ,rulebookQ].find(q=>q.error)?.error;if(firstError)throw firstError;
    const assignmentQ=scheduleQ.data?await supabase.from("assignments").select("id,session_id,day,start_time,end_time,teacher_id,room_id,locked,status").eq("schedule_version_id",scheduleQ.data.id):{data:[],error:null};if(assignmentQ.error)throw assignmentQ.error;

    const rules=(rulesQ.data||[]) as Array<Record<string,unknown>>;const teachers=(teachersQ.data||[]) as Array<Record<string,unknown>>;const rooms=(roomsQ.data||[]) as Array<Record<string,unknown>>;const classes=(classesQ.data||[]) as Array<Record<string,unknown>>;const assignments=(assignmentQ.data||[]) as Array<Record<string,unknown>>;
    const hardRules=rules.filter(r=>classification(r).toUpperCase()==="HARD"&&r.status==="ACTIVE");
    const coverage={applicableHardRules:hardRules.filter(r=>r.enforcement_status!=="NOT_APPLICABLE").length,implementedHardRules:hardRules.filter(r=>r.enforcement_status==="IMPLEMENTED").length,partialHardRules:hardRules.filter(r=>r.enforcement_status==="PARTIAL").length,notImplementedHardRules:hardRules.filter(r=>r.enforcement_status==="NOT_IMPLEMENTED").length};
    const currentRules=relevantRules(message,rules,teachers);
    const account=await accountCredentialStatus(auth);const serverKey=process.env.OPENROUTER_API_KEY?.trim()||"";
    if(!account.configured&&!serverKey){const local=localAnswer(message,rules,teachers,classes,coverage);await supabase.rpc("record_ai_proposal_v21",{p_proposal_type:"QUESTION",p_request_text:message,p_response_text:local.answer,p_patch:null,p_impact:{provider:"LOCAL",rulebookVersion:rulebookQ.data?.version,scheduleVersion:scheduleQ.data?.version}});return NextResponse.json(local);}

    const context={screen:body.screen||"unknown",currentRulebook:{version:rulebookQ.data?.version,status:rulebookQ.data?.status,sourceHash:rulebookQ.data?.source_hash,ruleCount:rulebookQ.data?.rule_count},currentSchedule:{version:scheduleQ.data?.version,rulebookVersion:scheduleQ.data?.rulebook_version,stale:Boolean(scheduleQ.data&&rulebookQ.data&&scheduleQ.data.rulebook_version!==rulebookQ.data.version),storedValidation:scheduleQ.data?.validation_result},validatorCoverage:coverage,relevantRules:currentRules,teachers,rooms,classes,sessions:sessionsQ.data||[],assignments};
    const instructions=`You are the DWDE Studio Scheduler Copilot. CURRENT_DATABASE_CONTEXT is closed-world scheduling truth. The current human Rulebook is authoritative even when a rule is not yet machine-enforced. Preserve classification_raw, review_status and enforcement_status as separate concepts. Never infer that zero detected violations means full validity unless validatorCoverage is complete. Never claim a change was applied. Return ONLY one JSON object: {"answer":"plain-language answer","proposal":null OR {"kind":"RULE_PATCH"|"SCHEDULE_PATCH","title":"short title","patch":OBJECT}}. RULE_PATCH must be {"id":"patch-ai-...","ruleId":"stable id unless CREATE","operation":"CREATE|UPDATE|RETIRE|DISABLE|ENABLE","changes":OBJECT,"reason":"reason","proposedBy":"AI"}. SCHEDULE_PATCH in V2.1 may ONLY be {"id":"patch-ai-...","operation":"MOVE","assignmentId":"existing unlocked assignment id","changes":OBJECT,"reason":"reason","proposedBy":"AI"}. Schedule changes may contain only day,startTime,endTime,teacherId,roomId,status. Rule changes use camelCase domain fields. For what-if requests recommend a Scenario rather than canonical mutation. If uncertain, answer without a proposal.`;
    const selection=selectModel(message);const openRouterBody={model:selection.model,messages:[{role:"system",content:`${instructions}\n\nCURRENT_DATABASE_CONTEXT:\n${JSON.stringify(context)}`},{role:"user",content:message}],response_format:{type:"json_object"},reasoning:{effort:selection.effort}};

    let apiResponse:Response;let keySource:"account"|"server";
    if(account.configured){apiResponse=await callAccountOpenRouter(auth,openRouterBody);keySource="account";if(!apiResponse.ok&&serverKey&&[401,403,409].includes(apiResponse.status)){apiResponse=await callServerOpenRouter(serverKey,openRouterBody);keySource="server";}}
    else{apiResponse=await callServerOpenRouter(serverKey,openRouterBody);keySource="server";}
    const payload=await apiResponse.json() as OpenRouterPayload;if(!apiResponse.ok)return NextResponse.json({error:`OpenRouter error: ${payload.error?.message||apiResponse.statusText}`},{status:502});
    const parsed=parseJson(extractText(payload));const proposal=validateProposal(parsed?.proposal,{rules,assignments,teachers,rooms});
    const malformed=Boolean(parsed?.proposal&&!proposal);const answer=typeof parsed?.answer==="string"?parsed.answer:"I received a response but could not parse it safely. No change was proposed.";
    const result:CopilotResult={mode:"OPENROUTER",model:payload.model||selection.model,answer:malformed?`${answer}\n\nThe proposed mutation was discarded because it did not pass DWDE's runtime proposal schema.`:answer,proposal};
    await supabase.rpc("record_ai_proposal_v21",{p_proposal_type:result.proposal?.kind||"QUESTION",p_request_text:message,p_response_text:result.answer,p_patch:result.proposal?.patch||null,p_impact:{provider:"OPENROUTER",model:result.model,keySource,rulebookVersion:rulebookQ.data?.version,scheduleVersion:scheduleQ.data?.version,scheduleRulebookVersion:scheduleQ.data?.rulebook_version,validatorCoverage:coverage,proposalSchemaValid:!malformed,userRole:authz.role}});
    return NextResponse.json(result);
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:String(error)},{status:500});}
}
