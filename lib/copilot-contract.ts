import type { Day, RulePatch, SchedulePatch } from "@/lib/domain";

const RULE_ID=/^[A-Z0-9]+-[0-9]{3}$/;
const TIME=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
const DAYS=new Set<Day>(["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"]);
const RULE_OPS=new Set(["CREATE","UPDATE","RETIRE","DISABLE","ENABLE"]);
// Human Rulebook proposals may change human policy only. Machine mappings are governed separately.
const RULE_FIELDS=new Set(["id","category","title","description","strength","classificationRaw","status","verificationStatus","reviewStatus","review","sourceRaw"]);
const SCHEDULE_FIELDS=new Set(["day","startTime","endTime","teacherId","roomId","status"]);

export interface CopilotProposalContext {
  ruleIds:Set<string>;
  assignmentIds:Set<string>;
  lockedAssignmentIds:Set<string>;
  teacherIds:Set<string>;
  roomIds:Set<string>;
  rulebookVersion:number;
  enforcementVersion:number;
  scheduleVersion:number;
}

export type CopilotProposal={kind:"RULE_PATCH"|"SCHEDULE_PATCH";title?:string;patch:RulePatch|SchedulePatch};

export function validateCopilotProposal(input:unknown,ctx:CopilotProposalContext):{ok:true;proposal:CopilotProposal}|{ok:false;message:string}{
  if(!input||typeof input!=="object"||Array.isArray(input))return{ok:false,message:"Proposal is not an object."};
  const proposal=input as Record<string,unknown>;
  if(proposal.kind!=="RULE_PATCH"&&proposal.kind!=="SCHEDULE_PATCH")return{ok:false,message:"Unknown proposal kind."};
  if(!proposal.patch||typeof proposal.patch!=="object"||Array.isArray(proposal.patch))return{ok:false,message:"Proposal patch is missing."};
  const rawPatch=proposal.patch as Record<string,unknown>;
  const patch:Record<string,unknown>={...rawPatch,baseRulebookVersion:ctx.rulebookVersion,baseEnforcementVersion:ctx.enforcementVersion,baseScheduleVersion:ctx.scheduleVersion};

  if(proposal.kind==="RULE_PATCH"){
    const operation=String(patch.operation||"");
    if(!RULE_OPS.has(operation))return{ok:false,message:"Invalid Rulebook operation."};
    if(!patch.changes||typeof patch.changes!=="object"||Array.isArray(patch.changes))return{ok:false,message:"Rule changes must be an object."};
    const changes=patch.changes as Record<string,unknown>;
    for(const key of Object.keys(changes))if(!RULE_FIELDS.has(key))return{ok:false,message:`AI Rulebook proposal contains unsupported or machine-enforcement field ${key}.`};
    const ruleId=String(patch.ruleId||changes.id||"");
    if(!RULE_ID.test(ruleId))return{ok:false,message:"AI proposal did not provide a valid stable Rule ID."};
    if(operation!=="CREATE"&&!ctx.ruleIds.has(ruleId))return{ok:false,message:`Rule ${ruleId} does not exist in the current Rulebook.`};
    if(operation==="CREATE"&&ctx.ruleIds.has(ruleId))return{ok:false,message:`Rule ${ruleId} already exists.`};
    patch.proposedBy="AI";
    patch.reason=String(patch.reason||"AI-proposed human Rulebook change");
    patch.id=String(patch.id||`patch-ai-${Date.now()}`);
    if(operation!=="CREATE")patch.ruleId=ruleId;
    return{ok:true,proposal:{kind:"RULE_PATCH",title:typeof proposal.title==="string"?proposal.title:undefined,patch:patch as unknown as RulePatch}};
  }

  if(patch.operation!=="MOVE")return{ok:false,message:"V2.2 AI schedule proposals may only move an existing assignment."};
  const assignmentId=String(patch.assignmentId||"");
  if(!ctx.assignmentIds.has(assignmentId))return{ok:false,message:`Assignment ${assignmentId||"(missing)"} does not exist in the current schedule.`};
  if(ctx.lockedAssignmentIds.has(assignmentId))return{ok:false,message:`Assignment ${assignmentId} is locked.`};
  if(!patch.changes||typeof patch.changes!=="object"||Array.isArray(patch.changes))return{ok:false,message:"Schedule changes must be an object."};
  const changes=patch.changes as Record<string,unknown>;
  for(const key of Object.keys(changes))if(!SCHEDULE_FIELDS.has(key))return{ok:false,message:`AI schedule proposal contains unsupported field ${key}.`};
  if(changes.day!==undefined&&!DAYS.has(changes.day as Day))return{ok:false,message:"AI schedule proposal contains an invalid day."};
  for(const key of ["startTime","endTime"] as const)if(changes[key]!==undefined&&!TIME.test(String(changes[key])))return{ok:false,message:`AI schedule proposal contains an invalid ${key}.`};
  if(changes.teacherId!==undefined&&!ctx.teacherIds.has(String(changes.teacherId)))return{ok:false,message:"AI schedule proposal references an unknown teacher."};
  if(changes.roomId!==undefined&&!ctx.roomIds.has(String(changes.roomId)))return{ok:false,message:"AI schedule proposal references an unknown room."};
  if(changes.status!==undefined&&!new Set(["NORMAL","WARNING","AI_PROPOSED"]).has(String(changes.status)))return{ok:false,message:"AI schedule proposal contains an invalid status."};
  patch.proposedBy="AI";
  patch.reason=String(patch.reason||"AI-proposed schedule change");
  patch.id=String(patch.id||`patch-ai-${Date.now()}`);
  return{ok:true,proposal:{kind:"SCHEDULE_PATCH",title:typeof proposal.title==="string"?proposal.title:undefined,patch:patch as unknown as SchedulePatch}};
}
