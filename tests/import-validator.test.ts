import { describe, expect, it } from "vitest";
import type { CanonicalImportPackage, StudioRule } from "@/lib/domain";
import { diffImportedRules, validateImportPackage } from "@/lib/import-validator";

const rule:StudioRule={id:"rule-cami-workdays",category:"TEACHER",type:"MAX_TEACHER_WORKDAYS",title:"Cami Maximum Regular Workdays",description:"Cami may teach no more than four regular days.",strength:"HARD",status:"ACTIVE",verificationStatus:"VERIFIED",affectedEntityIds:["teacher-cami"],parameters:{teacher_id:"teacher-cami",max_days:4},exceptions:[],source:{type:"IMPORT"},versionIntroduced:1,updatedAt:"2026-08-30T00:00:00Z"};
const pkg:CanonicalImportPackage={format_version:"1.0",rulebook:{id:"dwde-2026-2027",name:"DWDE 2026-2027 Master Rulebook",version:1},entities:{teachers:[{id:"teacher-cami",name:"Cami",subjects:["Jazz"]}],rooms:[{id:"room-studio-a",name:"Studio A"}],classes:[{id:"class-jazz-1",name:"Jazz 1",subject:"Jazz",level:"Level 1",durationMinutes:45,weeklyFrequency:1,rosterStudentIds:[],eligibleTeacherIds:["teacher-cami"]}],students:[],cohorts:[],sessions:[{id:"session-jazz-1-1",classId:"class-jazz-1",ordinal:1}]},rules:[rule],assignments:[{id:"assignment-jazz-1",sessionId:"session-jazz-1-1",day:"Monday",startTime:"17:00",endTime:"17:45",teacherId:"teacher-cami",roomId:"room-studio-a"}]};

describe("canonical import validator",()=>{
  it("accepts a valid package",()=>{const result=validateImportPackage(pkg);expect(result.valid).toBe(true);expect(result.summary.rules).toBe(1);});
  it("rejects duplicate stable rule IDs",()=>{const result=validateImportPackage({...pkg,rules:[rule,{...rule}]});expect(result.valid).toBe(false);expect(result.errors.some(e=>e.message.includes("Duplicate"))).toBe(true);});
  it("rejects missing entity references",()=>{const bad={...pkg,rules:[{...rule,parameters:{teacher_id:"teacher-missing",max_days:4}}]};expect(validateImportPackage(bad).valid).toBe(false);});
  it("diffs by stable IDs rather than titles",()=>{const renamed={...rule,title:"Renamed rule",parameters:{...rule.parameters,max_days:5}};const diff=diffImportedRules([rule],[renamed]);expect(diff.modified).toEqual([rule.id]);expect(diff.added).toEqual([]);});
});
