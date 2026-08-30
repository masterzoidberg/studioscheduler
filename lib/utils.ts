import type { RuleStrength } from "@/lib/types";

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function timeToMinutes(time: string): number {
  const match = time.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) throw new Error(`Invalid time: ${time}`);

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const period = match[3].toUpperCase();

  if (hour === 12) hour = 0;
  if (period === "PM") hour += 12;

  return hour * 60 + minute;
}

export function durationMinutes(startTime: string, endTime: string): number {
  return timeToMinutes(endTime) - timeToMinutes(startTime);
}

export const strengthLabel: Record<RuleStrength, string> = {
  HARD: "Hard",
  VERY_STRONG: "Very strong",
  MODERATE: "Moderate",
  LIGHT: "Light",
  BASELINE: "Baseline",
};
