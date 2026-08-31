"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import type {
  Assignment,
  ClassDefinition,
  RuleEnforcementMapping,
  RuleEnforcementProposal,
  RuleEnforcementVersion,
  RuleHistoryEntry,
  RulePatch,
  RulebookVersion,
  Room,
  Scenario,
  SchedulePatch,
  ScheduleVersion,
  StudioInvite,
  StudioMember,
  StudioRule,
  StudioRole,
  StudioState,
  Teacher,
  ValidationResult,
} from "@/lib/domain";
import { applyAssignmentChanges, emptyValidation, validateSchedule } from "@/lib/validator";
import { scheduleRepairDecision } from "@/lib/schedule-repair";
import { getBrowserSupabase } from "@/lib/supabase";

const STUDIO_ID = "11111111-1111-4111-8111-111111111111";

type MutationResult = { ok: boolean; error?: string; validation?: ValidationResult; version?: number; details?: Record<string, unknown> };

interface WorkspaceContextValue {
  loading: boolean;
  error: string | null;
  session: Session | null;
  accessMode: "AUTHENTICATED" | "NONE";
  role: StudioRole | null;
  canEdit: boolean;
  isOwner: boolean;
  state: StudioState | null;
  members: StudioMember[];
  invites: StudioInvite[];
  currentAssignments: Assignment[];
  currentRulebookVersion: number;
  currentEnforcementVersion: number;
  currentScheduleVersion: number;
  currentScheduleRulebookVersion: number;
  currentScheduleEnforcementVersion: number;
  scheduleIsStale: boolean;
  validation: ValidationResult;
  refresh: () => Promise<void>;
  signInWithEmail: (email: string) => Promise<{ ok: boolean; message: string }>;
  signOut: () => Promise<void>;
  applyRulePatch: (patch: RulePatch) => Promise<MutationResult>;
  applySchedulePatch: (patch: SchedulePatch) => Promise<MutationResult>;
  rebaseSchedule: () => Promise<MutationResult>;
  proposeEnforcementMapping: (ruleId: string, mapping: RuleEnforcementMapping, rationale: string, proposalSource?: "USER" | "AI") => Promise<MutationResult>;
  reviewEnforcementProposal: (proposalId: string, decision: "APPROVE" | "REJECT", reason: string) => Promise<MutationResult>;
  exportPackage: () => Record<string, unknown> | null;
  updateTeacher: (teacher: Teacher, reason: string) => Promise<MutationResult>;
  updateRoom: (room: Room, reason: string) => Promise<MutationResult>;
  updateClass: (klass: ClassDefinition, reason: string) => Promise<MutationResult>;
  createScenario: (name: string, rulePatches?: RulePatch[], schedulePatches?: SchedulePatch[]) => Promise<MutationResult>;
  inviteMember: (email: string, nextRole: StudioRole) => Promise<MutationResult>;
  setMemberRole: (userId: string, nextRole: StudioRole) => Promise<MutationResult>;
  removeMember: (userId: string) => Promise<MutationResult>;
  cancelInvite: (inviteId: string) => Promise<MutationResult>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function textArray(value: unknown): string[] { return array(value).map(String); }
function fail(caught: unknown): MutationResult { return { ok: false, error: caught instanceof Error ? caught.message : String(caught) }; }
function parseTime(value: unknown): string { return String(value || "").slice(0,5); }

function mapRule(row: Record<string, unknown>): StudioRule {
  const source = object(row.source);
  return {
    id: String(row.id), category: String(row.category), type: (row.type || null) as StudioRule["type"], title: String(row.title), description: String(row.description),
    strength: (row.strength || null) as StudioRule["strength"], classificationRaw: String(row.classification_raw || row.strength || "UNCLASSIFIED").replaceAll("_", " "),
    status: row.status as StudioRule["status"], verificationStatus: row.verification_status as StudioRule["verificationStatus"], reviewStatus: row.review_status as StudioRule["reviewStatus"],
    review: object(row.review) as StudioRule["review"], affectedEntityIds: textArray(row.affected_entity_ids), parameters: object(row.parameters), exceptions: array(row.exceptions),
    source: { type: String(source.type || "IMPORT") as StudioRule["source"]["type"], file: source.file ? String(source.file) : undefined, note: source.note ? String(source.note) : undefined },
    sourceRaw: object(row.source_raw), enforcementStatus: (row.enforcement_status || undefined) as StudioRule["enforcementStatus"],
    versionIntroduced: Number(row.version_introduced || 1), updatedAt: String(row.updated_at || ""),
  };
}
function mapHistory(row: Record<string, unknown>): RuleHistoryEntry {
  return { id: String(row.id), ruleId: String(row.rule_id), rulebookVersion: Number(row.rulebook_version), changedAt: String(row.changed_at), actor: String(row.actor_label), reason: String(row.reason), before: row.before_rule ? mapRule(object(row.before_rule)) : null, after: row.after_rule ? mapRule(object(row.after_rule)) : null, aiProposed: Boolean(row.ai_proposed) };
}
function mapEnforcementMapping(value: unknown): RuleEnforcementMapping {
  const row = object(value);
  return { ruleId: String(row.ruleId || row.rule_id || ""), type: String(row.type) as RuleEnforcementMapping["type"], parameters: object(row.parameters), affectedEntityIds: textArray(row.affectedEntityIds || row.affected_entity_ids), exceptions: array(row.exceptions) };
}
function mapEnforcementVersion(row: Record<string, unknown>): RuleEnforcementVersion {
  return { id: String(row.id), version: Number(row.version), rulebookVersion: Number(row.rulebook_version), createdAt: String(row.created_at), actor: String(row.actor_label), reason: String(row.reason), changedRuleIds: textArray(row.changed_rule_ids), snapshot: array(row.snapshot).map(mapEnforcementMapping), status: row.status as RuleEnforcementVersion["status"] };
}
function mapEnforcementProposal(row: Record<string, unknown>): RuleEnforcementProposal {
  return { id: String(row.id), ruleId: String(row.rule_id), baseRulebookVersion: Number(row.base_rulebook_version), baseEnforcementVersion: Number(row.base_enforcement_version), proposedMapping: mapEnforcementMapping(row.proposed_mapping), rationale: String(row.rationale), proposalSource: row.proposal_source as RuleEnforcementProposal["proposalSource"], status: row.status as RuleEnforcementProposal["status"], proposedByUserId: row.proposed_by_user_id ? String(row.proposed_by_user_id) : null, reviewedByUserId: row.reviewed_by_user_id ? String(row.reviewed_by_user_id) : null, reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null, reviewReason: row.review_reason ? String(row.review_reason) : null, createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [session,setSession]=useState<Session|null>(null);
  const [state,setState]=useState<StudioState|null>(null);
  const [role,setRole]=useState<StudioRole|null>(null);
  const [members,setMembers]=useState<StudioMember[]>([]);
  const [invites,setInvites]=useState<StudioInvite[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const accessMode: WorkspaceContextValue["accessMode"] = session ? "AUTHENTICATED" : "NONE";
  const canEdit=role==="OWNER"||role==="EDITOR";
  const isOwner=role==="OWNER";

  const load=useCallback(async(nextSession?:Session|null)=>{
    const active=nextSession===undefined?session:nextSession;
    setLoading(true);setError(null);
    if(!active){setRole(null);setState(null);setMembers([]);setInvites([]);setLoading(false);return;}
    try{
      const supabase=getBrowserSupabase();
      const {data:membership,error:membershipError}=await supabase.from("studio_members").select("role").eq("studio_id",STUDIO_ID).eq("user_id",active.user.id).maybeSingle();
      if(membershipError)throw membershipError;
      if(!membership){setRole(null);setState(null);setMembers([]);setInvites([]);setError("This Google/email account has not been invited to the DWDE studio workspace.");return;}
      const nextRole=membership.role as StudioRole;setRole(nextRole);

      const [studioQ,teachersQ,roomsQ,studentsQ,cohortsQ,classesQ,sessionsQ,rulesQ,rbvQ,enforcementQ,proposalsQ,historyQ,scheduleQ,scenariosQ,auditQ,memberQ]=await Promise.all([
        supabase.from("studios").select("id,name").eq("id",STUDIO_ID).single(),
        supabase.from("teachers").select("*").eq("studio_id",STUDIO_ID).order("name"),
        supabase.from("rooms").select("*").eq("studio_id",STUDIO_ID).order("name"),
        supabase.from("students").select("*").eq("studio_id",STUDIO_ID).order("name"),
        supabase.from("cohorts").select("*").eq("studio_id",STUDIO_ID).order("name"),
        supabase.from("class_definitions").select("*").eq("studio_id",STUDIO_ID).order("name"),
        supabase.from("class_sessions").select("*").eq("studio_id",STUDIO_ID),
        supabase.from("rules").select("*").eq("studio_id",STUDIO_ID).order("id"),
        supabase.from("rulebook_versions").select("*").eq("studio_id",STUDIO_ID).order("version",{ascending:false}),
        supabase.from("rule_enforcement_versions").select("*").eq("studio_id",STUDIO_ID).order("version",{ascending:false}),
        supabase.from("rule_enforcement_proposals").select("*").eq("studio_id",STUDIO_ID).order("created_at",{ascending:false}),
        supabase.from("rule_history").select("*").eq("studio_id",STUDIO_ID).order("changed_at",{ascending:false}),
        supabase.from("schedule_versions").select("*").eq("studio_id",STUDIO_ID).order("version",{ascending:false}),
        supabase.from("scenarios").select("*").eq("studio_id",STUDIO_ID).order("created_at",{ascending:false}),
        supabase.from("audit_events").select("*").eq("studio_id",STUDIO_ID).order("created_at",{ascending:false}).limit(100),
        supabase.rpc("list_studio_members_v21"),
      ]);
      const queryError=[studioQ,teachersQ,roomsQ,studentsQ,cohortsQ,classesQ,sessionsQ,rulesQ,rbvQ,enforcementQ,proposalsQ,historyQ,scheduleQ,scenariosQ,auditQ,memberQ].find(q=>q.error)?.error;if(queryError)throw queryError;
      const currentScheduleRow=(scheduleQ.data||[]).find((row)=>row.is_current);
      const assignmentQ=currentScheduleRow?await supabase.from("assignments").select("*").eq("schedule_version_id",currentScheduleRow.id):{data:[],error:null};
      if(assignmentQ.error)throw assignmentQ.error;
      const assignments:Assignment[]=(assignmentQ.data||[]).map((row)=>({id:row.id,sessionId:row.session_id,day:row.day,startTime:parseTime(row.start_time),endTime:parseTime(row.end_time),teacherId:row.teacher_id,roomId:row.room_id,locked:row.locked,status:row.status}));
      const scheduleVersions:ScheduleVersion[]=(scheduleQ.data||[]).map((row)=>({id:row.id,version:row.version,rulebookVersion:row.rulebook_version,enforcementVersion:Number(row.enforcement_version||0),createdAt:row.created_at,actor:row.actor_label,reason:row.reason,assignments:row.id===currentScheduleRow?.id?assignments:[],isCurrent:Boolean(row.is_current),validationResult:row.validation_result as ValidationResult|null}));

      const mapped:StudioState={studioId:STUDIO_ID,studioName:studioQ.data?.name||"DWDE Studio",
        teachers:(teachersQ.data||[]).map(row=>({id:row.id,name:row.name,subjects:row.subjects||[],notes:row.notes||undefined})),rooms:(roomsQ.data||[]).map(row=>({id:row.id,name:row.name,capacity:row.capacity??undefined,features:row.features||[]})),students:(studentsQ.data||[]).map(row=>({id:row.id,name:row.name,level:row.level,cohortIds:row.cohort_ids||[]})),cohorts:(cohortsQ.data||[]).map(row=>({id:row.id,name:row.name,studentIds:row.student_ids||[]})),classes:(classesQ.data||[]).map(row=>({id:row.id,name:row.name,subject:row.subject,level:row.level,durationMinutes:row.duration_minutes,weeklyFrequency:row.weekly_frequency,rosterStudentIds:row.roster_student_ids||[],eligibleTeacherIds:row.eligible_teacher_ids||[],companyOnly:row.company_only})),sessions:(sessionsQ.data||[]).map(row=>({id:row.id,classId:row.class_id,ordinal:row.ordinal,locked:row.locked})),rules:(rulesQ.data||[]).map(row=>mapRule(row as Record<string,unknown>)),rulebookVersions:(rbvQ.data||[]).map(row=>({id:row.id,version:row.version,name:row.name,createdAt:row.created_at,actor:row.actor_label,reason:row.reason,changedRuleIds:row.changed_rule_ids||[],rulebookId:row.rulebook_id||undefined,status:row.status||undefined,importedAt:row.imported_at||undefined,sourceHash:row.source_hash||undefined,sourceFileHash:row.source_file_hash||undefined,ruleCount:row.rule_count??undefined,parentVersion:row.parent_version??undefined,formatVersion:row.format_version||undefined,documentType:row.document_type||undefined,sourceMetadata:object(row.source_metadata)} as RulebookVersion)),enforcementVersions:(enforcementQ.data||[]).map(row=>mapEnforcementVersion(row as Record<string,unknown>)),enforcementProposals:(proposalsQ.data||[]).map(row=>mapEnforcementProposal(row as Record<string,unknown>)),ruleHistory:(historyQ.data||[]).map(row=>mapHistory(row as Record<string,unknown>)),scheduleVersions,
        scenarios:(scenariosQ.data||[]).map(row=>({id:row.id,name:row.name,baseRulebookVersion:row.base_rulebook_version,baseScheduleVersion:row.base_schedule_version,baseEnforcementVersion:row.base_enforcement_version??undefined,rulePatches:(row.rule_patches||[]) as unknown as RulePatch[],schedulePatches:(row.schedule_patches||[]) as unknown as SchedulePatch[],createdAt:row.created_at} as Scenario)),auditEvents:(auditQ.data||[]).map(row=>({id:row.id,at:row.created_at,actor:row.actor_label,action:row.action,entityType:row.entity_type,entityId:row.entity_id||undefined,detail:row.detail}))};
      setState(mapped);setMembers((memberQ.data||[]).map((row:Record<string,unknown>)=>({userId:String(row.user_id),role:row.role as StudioRole,displayName:String(row.display_name||""),email:String(row.email||""),createdAt:String(row.created_at||"")})));
      if(nextRole==="OWNER"){const inviteQ=await supabase.from("studio_invites").select("id,email,role,created_at,accepted_at").eq("studio_id",STUDIO_ID).order("created_at",{ascending:false});if(inviteQ.error)throw inviteQ.error;setInvites((inviteQ.data||[]).map(row=>({id:row.id,email:row.email,role:row.role as StudioRole,createdAt:row.created_at,acceptedAt:row.accepted_at})));}else setInvites([]);
    }catch(caught){setError(caught instanceof Error?caught.message:String(caught));}finally{setLoading(false);}
  },[session]);

  useEffect(()=>{const supabase=getBrowserSupabase();supabase.auth.getSession().then(({data})=>{setSession(data.session);void load(data.session);});const{data:listener}=supabase.auth.onAuthStateChange((_event,next)=>{setSession(next);void load(next);});return()=>listener.subscription.unsubscribe();// eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  const currentSchedule=useMemo(()=>state?.scheduleVersions.find(version=>version.isCurrent)||null,[state]);const currentAssignments=useMemo(()=>currentSchedule?.assignments||[],[currentSchedule]);const currentRulebookVersion=state?.rulebookVersions.find(version=>version.status==="CURRENT")?.version??0;const currentEnforcementVersion=state?.enforcementVersions.find(version=>version.status==="CURRENT")?.version??0;const currentScheduleVersion=currentSchedule?.version??0;const currentScheduleRulebookVersion=currentSchedule?.rulebookVersion??0;const currentScheduleEnforcementVersion=currentSchedule?.enforcementVersion??0;const scheduleIsStale=Boolean(currentSchedule&&(currentScheduleRulebookVersion!==currentRulebookVersion||currentScheduleEnforcementVersion!==currentEnforcementVersion));const validation=useMemo(()=>state?validateSchedule(state,currentAssignments):emptyValidation(),[state,currentAssignments]);

  async function signInWithEmail(email:string){try{const{error:authError}=await getBrowserSupabase().auth.signInWithOtp({email,options:{emailRedirectTo:typeof window!=="undefined"?window.location.origin:undefined,shouldCreateUser:true}});if(authError)throw authError;return{ok:true,message:"Check your email for the DWDE sign-in link."};}catch(caught){return{ok:false,message:caught instanceof Error?caught.message:String(caught)};}}
  async function signOut(){await getBrowserSupabase().auth.signOut();setSession(null);setRole(null);setState(null);setMembers([]);setInvites([]);}
  async function applyRulePatch(patch:RulePatch):Promise<MutationResult>{if(!canEdit)return{ok:false,error:"Editor access is required."};try{const{data,error:rpcError}=await getBrowserSupabase().rpc("apply_rule_patch_v22",{p_operation:patch.operation,p_rule_id:patch.ruleId||String(patch.changes.id||""),p_changes:patch.changes,p_reason:patch.reason,p_expected_rulebook_version:currentRulebookVersion,p_ai_proposed:patch.proposedBy==="AI"});if(rpcError)throw rpcError;await load();return{ok:true,version:Number((data as Record<string,unknown>)?.version||0),details:object(data)};}catch(caught){return fail(caught);}}
  async function applySchedulePatch(patch:SchedulePatch):Promise<MutationResult>{if(!canEdit)return{ok:false,error:"Editor access is required."};if(patch.operation!=="MOVE")return{ok:false,error:"V2.2 applies moves to existing assignments. Add/unassign belongs to the later full schedule-builder workflow."};if(scheduleIsStale)return{ok:false,error:`Schedule v${currentScheduleVersion} is linked to Rulebook v${currentScheduleRulebookVersion} / Enforcement v${currentScheduleEnforcementVersion}. Revalidate it against Rulebook v${currentRulebookVersion} / Enforcement v${currentEnforcementVersion} first.`};const existing=currentAssignments.find(assignment=>assignment.id===patch.assignmentId);if(!existing)return{ok:false,error:"Assignment does not exist."};if(existing.locked)return{ok:false,error:"This assignment is locked."};const proposed=applyAssignmentChanges(currentAssignments,patch.assignmentId,patch.changes);const preview=state?validateSchedule(state,proposed):emptyValidation();const repair=scheduleRepairDecision(validation,preview);if(!repair.ok)return{ok:false,error:repair.error,validation:preview};try{const{data,error:rpcError}=await getBrowserSupabase().rpc("apply_schedule_patch_v22",{p_assignment_id:patch.assignmentId,p_changes:patch.changes,p_reason:patch.reason,p_expected_schedule_version:currentScheduleVersion,p_expected_rulebook_version:currentRulebookVersion,p_expected_enforcement_version:currentEnforcementVersion,p_ai_proposed:patch.proposedBy==="AI"});if(rpcError)throw rpcError;const details=object(data);await load();return{ok:true,validation:details.validation as unknown as ValidationResult,version:Number(details.scheduleVersion||0),details};}catch(caught){return fail(caught);}}
  async function rebaseSchedule():Promise<MutationResult>{if(!canEdit)return{ok:false,error:"Editor access is required."};try{const{data,error:rpcError}=await getBrowserSupabase().rpc("rebase_current_schedule_v22",{p_expected_schedule_version:currentScheduleVersion,p_expected_rulebook_version:currentRulebookVersion,p_expected_enforcement_version:currentEnforcementVersion,p_reason:`Revalidate unchanged assignments against Rulebook v${currentRulebookVersion} / Enforcement v${currentEnforcementVersion}`});if(rpcError)throw rpcError;const details=object(data);await load();return{ok:true,version:Number(details.scheduleVersion||0),validation:details.validation as unknown as ValidationResult,details};}catch(caught){return fail(caught);}}
  async function proposeEnforcementMapping(ruleId:string,mapping:RuleEnforcementMapping,rationale:string,proposalSource:"USER"|"AI"="USER"):Promise<MutationResult>{if(!canEdit)return{ok:false,error:"Editor access is required."};try{const{data,error:rpcError}=await getBrowserSupabase().rpc("propose_rule_enforcement_mapping_v22",{p_rule_id:ruleId,p_mapping:mapping,p_rationale:rationale,p_expected_rulebook_version:currentRulebookVersion,p_expected_enforcement_version:currentEnforcementVersion,p_source:proposalSource});if(rpcError)throw rpcError;await load();return{ok:true,details:object(data)};}catch(caught){return fail(caught);}}
  async function reviewEnforcementProposal(proposalId:string,decision:"APPROVE"|"REJECT",reason:string):Promise<MutationResult>{if(!canEdit)return{ok:false,error:"Editor access is required."};try{const{data,error:rpcError}=await getBrowserSupabase().rpc("review_rule_enforcement_mapping_v22",{p_proposal_id:proposalId,p_decision:decision,p_reason:reason,p_expected_rulebook_version:currentRulebookVersion,p_expected_enforcement_version:currentEnforcementVersion});if(rpcError)throw rpcError;await load();const details=object(data);return{ok:true,version:Number(details.enforcementVersion||currentEnforcementVersion),details};}catch(caught){return fail(caught);}}
  function exportPackage():Record<string,unknown>|null{if(!state)return null;const current=state.rulebookVersions.find(version=>version.status==="CURRENT")??state.rulebookVersions[0];const currentEnforcement=state.enforcementVersions.find(version=>version.status==="CURRENT")??state.enforcementVersions[0];const verified=state.rules.filter(rule=>(rule.reviewStatus??rule.verificationStatus)==="VERIFIED").length;const approved=state.rules.filter(rule=>rule.review?.decision==="APPROVED").length;const edited=state.rules.filter(rule=>rule.review?.decision==="EDIT").length;return{format_version:current?.formatVersion||"2.0",document_type:current?.documentType||"DWDE_CANONICAL_RULEBOOK",rulebook:{id:current?.rulebookId||"dwde-2026-2027-master-rulebook",name:"DWDE 2026-2027 Master Rulebook",version:currentRulebookVersion,status:current?.sourceHash?"REVIEWED":"CURRENT",total_rules:state.rules.length,reviewed_rules:verified,approved_without_edit:approved,edited_and_approved:edited,rules_sha256:current?.sourceHash||null},source_version:current,enforcement:currentEnforcement?{version:currentEnforcement.version,rulebook_version:currentEnforcement.rulebookVersion,mappings:currentEnforcement.snapshot}:null,rules:state.rules.map(rule=>({id:rule.id,category:rule.category,classification:rule.classificationRaw??rule.strength?.replaceAll("_"," ")??"UNCLASSIFIED",title:rule.title,text:rule.description,status:rule.status,review_status:rule.reviewStatus??rule.verificationStatus,review:rule.review??{},source:rule.sourceRaw??rule.source}))};}
  async function updateTeacher(teacher:Teacher,reason:string):Promise<MutationResult>{if(!canEdit)return{ok:false,error:"Editor access is required."};try{const{data,error:rpcError}=await getBrowserSupabase().rpc("update_studio_entity_v21",{p_entity_type:"TEACHER",p_entity_id:teacher.id,p_changes:{name:teacher.name,notes:teacher.notes||""},p_reason:reason,p_expected_rulebook_version:currentRulebookVersion,p_expected_schedule_version:currentScheduleVersion});if(rpcError)throw rpcError;await load();return{ok:true,details:object(data)};}catch(caught){return fail(caught);}}
  async function updateRoom(room:Room,reason:string):Promise<MutationResult>{if(!canEdit)return{ok:false,error:"Editor access is required."};try{const{data,error:rpcError}=await getBrowserSupabase().rpc("update_studio_entity_v21",{p_entity_type:"ROOM",p_entity_id:room.id,p_changes:{name:room.name,capacity:room.capacity??null,features:room.features||[]},p_reason:reason,p_expected_rulebook_version:currentRulebookVersion,p_expected_schedule_version:currentScheduleVersion});if(rpcError)throw rpcError;await load();return{ok:true,details:object(data)};}catch(caught){return fail(caught);}}
  async function updateClass(klass:ClassDefinition,reason:string):Promise<MutationResult>{if(!canEdit)return{ok:false,error:"Editor access is required."};try{const{data,error:rpcError}=await getBrowserSupabase().rpc("update_studio_entity_v21",{p_entity_type:"CLASS",p_entity_id:klass.id,p_changes:{name:klass.name,subject:klass.subject,level:klass.level,durationMinutes:klass.durationMinutes,weeklyFrequency:klass.weeklyFrequency,rosterStudentIds:klass.rosterStudentIds,companyOnly:Boolean(klass.companyOnly)},p_reason:reason,p_expected_rulebook_version:currentRulebookVersion,p_expected_schedule_version:currentScheduleVersion});if(rpcError)throw rpcError;await load();return{ok:true,details:object(data)};}catch(caught){return fail(caught);}}
  async function createScenario(name:string,rulePatches:RulePatch[]=[],schedulePatches:SchedulePatch[]=[]):Promise<MutationResult>{if(!canEdit)return{ok:false,error:"Editor access is required."};try{const{data,error:rpcError}=await getBrowserSupabase().rpc("create_scenario_v22",{p_name:name,p_rule_patches:rulePatches,p_schedule_patches:schedulePatches,p_expected_rulebook_version:currentRulebookVersion,p_expected_enforcement_version:currentEnforcementVersion,p_expected_schedule_version:currentScheduleVersion});if(rpcError)throw rpcError;await load();return{ok:true,details:object(data)};}catch(caught){return fail(caught);}}
  async function inviteMember(email:string,nextRole:StudioRole):Promise<MutationResult>{if(!isOwner)return{ok:false,error:"Owner access is required."};try{const{data,error:rpcError}=await getBrowserSupabase().rpc("invite_studio_member_v21",{p_email:email,p_role:nextRole});if(rpcError)throw rpcError;await load();return{ok:true,details:object(data)};}catch(caught){return fail(caught);}}
  async function setMemberRole(userId:string,nextRole:StudioRole):Promise<MutationResult>{if(!isOwner)return{ok:false,error:"Owner access is required."};try{const{data,error:rpcError}=await getBrowserSupabase().rpc("set_studio_member_role_v21",{p_user_id:userId,p_role:nextRole});if(rpcError)throw rpcError;await load();return{ok:Boolean(data)};}catch(caught){return fail(caught);}}
  async function removeMember(userId:string):Promise<MutationResult>{if(!isOwner)return{ok:false,error:"Owner access is required."};try{const{data,error:rpcError}=await getBrowserSupabase().rpc("remove_studio_member_v21",{p_user_id:userId});if(rpcError)throw rpcError;await load();return{ok:Boolean(data)};}catch(caught){return fail(caught);}}
  async function cancelInvite(inviteId:string):Promise<MutationResult>{if(!isOwner)return{ok:false,error:"Owner access is required."};try{const{data,error:rpcError}=await getBrowserSupabase().rpc("cancel_studio_invite_v21",{p_invite_id:inviteId});if(rpcError)throw rpcError;await load();return{ok:Boolean(data)};}catch(caught){return fail(caught);}}

  const value:WorkspaceContextValue={loading,error,session,accessMode,role,canEdit,isOwner,state,members,invites,currentAssignments,currentRulebookVersion,currentEnforcementVersion,currentScheduleVersion,currentScheduleRulebookVersion,currentScheduleEnforcementVersion,scheduleIsStale,validation,refresh:()=>load(),signInWithEmail,signOut,applyRulePatch,applySchedulePatch,rebaseSchedule,proposeEnforcementMapping,reviewEnforcementProposal,exportPackage,updateTeacher,updateRoom,updateClass,createScenario,inviteMember,setMemberRole,removeMember,cancelInvite};return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(){const value=useContext(WorkspaceContext);if(!value)throw new Error("useWorkspace must be used inside WorkspaceProvider");return value;}
