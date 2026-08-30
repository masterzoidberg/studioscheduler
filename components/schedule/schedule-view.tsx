"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Bot, CalendarDays, ChevronDown, CircleCheckBig, Clock3, LockKeyhole, Move, ShieldCheck, Sparkles, UsersRound, X } from "lucide-react";
import { mondayAssignments, rules } from "@/lib/mock-data";
import type { ScheduleAssignment } from "@/lib/types";
import { cn, durationMinutes, timeToMinutes } from "@/lib/utils";

const rooms: ScheduleAssignment["room"][] = ["Studio A", "Studio B", "Studio C"];
const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const START_MINUTES = timeToMinutes("4:30 PM");
const END_MINUTES = timeToMinutes("9:15 PM");
const PX_PER_MINUTE = 1.35;
const GRID_HEIGHT = (END_MINUTES - START_MINUTES) * PX_PER_MINUTE;

const roomAccent: Record<ScheduleAssignment["room"], string> = {
  "Studio A": "border-l-indigo-500 bg-indigo-50/95",
  "Studio B": "border-l-cyan-600 bg-cyan-50/95",
  "Studio C": "border-l-violet-500 bg-violet-50/95",
};

function formatGridTime(minutes: number) {
  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour = hour24 % 12 || 12;
  return `${hour}:${minute.toString().padStart(2, "0")} ${suffix}`;
}

function AssignmentCard({ assignment, selected, onSelect }: { assignment: ScheduleAssignment; selected: boolean; onSelect: () => void }) {
  const top = (timeToMinutes(assignment.startTime) - START_MINUTES) * PX_PER_MINUTE;
  const height = durationMinutes(assignment.startTime, assignment.endTime) * PX_PER_MINUTE;
  const locked = assignment.status.includes("LOCKED");
  const warning = assignment.status.includes("WARNING");
  const proposed = assignment.status.includes("AI_PROPOSED");

  return (
    <button type="button" onClick={onSelect} style={{ top, height: Math.max(height - 4, 34) }} className={cn("absolute inset-x-2 overflow-hidden rounded-xl border border-slate-200 border-l-4 p-2.5 text-left shadow-[0_2px_6px_rgba(15,23,42,0.06)] transition hover:z-10 hover:-translate-y-px hover:shadow-md", roomAccent[assignment.room], selected && "z-20 ring-2 ring-slate-950 ring-offset-2", proposed && "border-dashed border-emerald-500 bg-emerald-50")}>
      <div className="flex items-start justify-between gap-2"><p className="truncate text-xs font-bold text-slate-950 sm:text-sm">{assignment.className}</p><div className="flex shrink-0 items-center gap-1">{locked ? <LockKeyhole className="size-3.5 text-slate-600" aria-label="Locked" /> : null}{warning ? <AlertTriangle className="size-3.5 text-amber-600" aria-label="Warning" /> : null}{proposed ? <Sparkles className="size-3.5 text-emerald-700" aria-label="AI proposed" /> : null}</div></div>
      {height >= 58 ? <><p className="mt-1 truncate text-[11px] font-medium text-slate-600">{assignment.teacher}</p><p className="mt-0.5 text-[10px] text-slate-500">{assignment.startTime}–{assignment.endTime.replace(" PM", "")}</p></> : null}
    </button>
  );
}

function ClassInspector({ assignment, onClose }: { assignment: ScheduleAssignment; onClose?: () => void }) {
  const affectedRules = rules.filter((rule) => assignment.rules.includes(rule.id));
  return (
    <aside className="rounded-2xl border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5"><div><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Class inspector</p><h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">{assignment.className}</h2><p className="mt-1 text-sm text-slate-500">{assignment.level}</p></div>{onClose ? <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close inspector"><X className="size-4.5" /></button> : null}</div>
      <div className="p-5">
        <div className="grid grid-cols-2 gap-3 text-sm"><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Current</p><p className="mt-1 font-semibold text-slate-900">{assignment.day}</p><p className="mt-0.5 text-xs text-slate-600">{assignment.startTime}–{assignment.endTime}</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Room</p><p className="mt-1 font-semibold text-slate-900">{assignment.room}</p><p className="mt-0.5 text-xs text-slate-600">{assignment.teacher}</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Duration</p><p className="mt-1 font-semibold text-slate-900">{durationMinutes(assignment.startTime, assignment.endTime)} min</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Enrollment</p><p className="mt-1 font-semibold text-slate-900">{assignment.enrollment} dancers</p></div></div>
        <div className="mt-6"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Rules affecting this class</p><div className="mt-3 space-y-2.5">{affectedRules.map((rule) => <div key={rule.id} className="rounded-xl border border-slate-200 p-3"><div className="flex items-center gap-2"><span className={cn("rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide", rule.strength === "HARD" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700")}>{rule.strength === "VERY_STRONG" ? "Very strong" : rule.strength}</span><span className="text-[10px] font-semibold text-slate-400">{rule.id}</span></div><p className="mt-2 text-xs font-semibold leading-5 text-slate-800">{rule.title}</p></div>)}</div></div>
        <div className="mt-6 grid grid-cols-2 gap-2"><button type="button" className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-950 px-3 py-2.5 text-xs font-semibold text-white"><Bot className="size-3.5" />Ask ChatGPT</button><button type="button" className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Move className="size-3.5" />Move</button><button type="button" className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"><UsersRound className="size-3.5" />Students</button><button type="button" className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Clock3 className="size-3.5" />History</button></div>
      </div>
    </aside>
  );
}

export function ScheduleView() {
  const [selectedDay, setSelectedDay] = useState<(typeof days)[number]>("Monday");
  const [selectedId, setSelectedId] = useState("A-MON-003");
  const selected = useMemo(() => mondayAssignments.find((item) => item.id === selectedId) ?? mondayAssignments[0], [selectedId]);
  const assignments = selectedDay === "Monday" ? mondayAssignments : [];
  const timeLabels = [];
  for (let minutes = START_MINUTES; minutes <= END_MINUTES; minutes += 30) timeLabels.push(minutes);

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:p-5"><div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between"><div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200"><ShieldCheck className="size-5" /></div><div><div className="flex items-center gap-2"><p className="text-sm font-semibold text-slate-950">Hard constraints: PASS</p><span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">0 violations</span></div><p className="mt-0.5 text-xs text-slate-500">Visual preview uses Schedule v7 · Rulebook v3</p></div></div><div className="flex flex-wrap items-center gap-2"><button type="button" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700"><CalendarDays className="size-4" />Day by room <ChevronDown className="size-3.5" /></button><button type="button" className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-3 py-2 text-xs font-semibold text-white"><CircleCheckBig className="size-4" />Validate schedule</button></div></div></section>
      <div className="flex gap-2 overflow-x-auto pb-1">{days.map((day) => <button key={day} type="button" onClick={() => setSelectedDay(day)} className={cn("shrink-0 rounded-xl px-4 py-2.5 text-sm font-semibold transition", selectedDay === day ? "bg-slate-950 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50")}>{day}</button>)}</div>
      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-4 py-3 sm:px-5"><div><p className="text-sm font-semibold text-slate-950">{selectedDay}</p><p className="mt-0.5 text-xs text-slate-500">15-minute scheduling grid · click any class to inspect its rules</p></div><div className="hidden flex-wrap items-center gap-3 text-[10px] font-semibold text-slate-500 md:flex"><span className="inline-flex items-center gap-1"><LockKeyhole className="size-3" />Locked</span><span className="inline-flex items-center gap-1"><AlertTriangle className="size-3 text-amber-600" />Warning</span><span className="inline-flex items-center gap-1"><Sparkles className="size-3 text-emerald-700" />AI proposal</span></div></div>
          {selectedDay === "Monday" ? <div className="overflow-x-auto"><div className="min-w-[760px]"><div className="grid grid-cols-[84px_repeat(3,minmax(210px,1fr))] border-b border-slate-200 bg-slate-50"><div className="border-r border-slate-200 px-3 py-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Time</div>{rooms.map((room) => <div key={room} className="border-r border-slate-200 px-4 py-3 last:border-r-0"><p className="text-xs font-bold uppercase tracking-[0.1em] text-slate-700">{room}</p><p className="mt-0.5 text-[10px] text-slate-400">Monday</p></div>)}</div><div className="grid grid-cols-[84px_repeat(3,minmax(210px,1fr))]"><div className="relative border-r border-slate-200 bg-slate-50/60" style={{ height: GRID_HEIGHT }}>{timeLabels.map((minutes) => <div key={minutes} className="absolute inset-x-0 -translate-y-2 pr-3 text-right text-[10px] font-medium text-slate-400" style={{ top: (minutes - START_MINUTES) * PX_PER_MINUTE }}>{formatGridTime(minutes)}</div>)}</div>{rooms.map((room) => <div key={room} className="relative border-r border-slate-200 last:border-r-0" style={{ height: GRID_HEIGHT }}>{Array.from({ length: Math.floor((END_MINUTES - START_MINUTES) / 15) + 1 }).map((_, index) => <div key={index} className={cn("absolute inset-x-0 border-t", index % 2 === 0 ? "border-slate-200" : "border-slate-100")} style={{ top: index * 15 * PX_PER_MINUTE }} />)}{assignments.filter((assignment) => assignment.room === room).map((assignment) => <AssignmentCard key={assignment.id} assignment={assignment} selected={selectedId === assignment.id} onSelect={() => setSelectedId(assignment.id)} />)}</div>)}</div></div></div> : <div className="grid min-h-[480px] place-items-center p-8 text-center"><div className="max-w-sm"><CalendarDays className="mx-auto size-8 text-slate-300" /><p className="mt-4 text-sm font-semibold text-slate-800">{selectedDay} is wired for navigation</p><p className="mt-1.5 text-sm leading-6 text-slate-500">Milestone 1 intentionally seeds the detailed visual schedule for Monday only. Full-week assignment data arrives after visual review.</p></div></div>}
        </section>
        <div className="2xl:sticky 2xl:top-[92px] 2xl:self-start"><ClassInspector assignment={selected} /></div>
      </div>
      <section className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 sm:p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-3"><Move className="mt-0.5 size-5 shrink-0 text-slate-500" /><div><p className="text-sm font-semibold text-slate-800">Drag-and-drop interaction is intentionally staged next</p><p className="mt-1 text-sm leading-6 text-slate-500">Milestone 2 will add 15-minute snapping and deterministic pre-commit validation. Invalid drops will return the card and show the exact blocking rule.</p></div></div><span className="shrink-0 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-500 ring-1 ring-inset ring-slate-200">Not active yet</span></div></section>
    </div>
  );
}
