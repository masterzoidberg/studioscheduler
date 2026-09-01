const fallbackPalette = [
  "#2563EB",
  "#DB2777",
  "#7C3AED",
  "#EA580C",
  "#059669",
  "#0891B2",
  "#D97706",
  "#4F46E5",
  "#DC2626",
];

export function subjectMarker(subject?: string, className?: string) {
  const value = `${subject || ""} ${className || ""}`.toLowerCase();
  if (value.includes("hip hop")) return "🎧";
  if (value.includes("pointe")) return "🩰";
  if (value.includes("ballet")) return "🩰";
  if (value.includes("tap")) return "👞";
  if (value.includes("jazz")) return "✨";
  if (value.includes("contemporary")) return "🌊";
  if (value.includes("lyrical")) return "🎵";
  if (value.includes("combo")) return "🎀";
  if (value.includes("company") || value.includes("technique")) return "⭐";
  if (value.includes("adult")) return "◉";
  return "◆";
}

export function fallbackTeacherColor(teacherId: string) {
  let hash = 0;
  for (let index = 0; index < teacherId.length; index += 1) {
    hash = ((hash << 5) - hash + teacherId.charCodeAt(index)) | 0;
  }
  return fallbackPalette[Math.abs(hash) % fallbackPalette.length];
}

export function safeTeacherColor(value: string | null | undefined, teacherId: string) {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toUpperCase() : fallbackTeacherColor(teacherId);
}

export function translucentHex(hex: string, alpha = "12") {
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? `${hex}${alpha}` : "#F8FAFC";
}
