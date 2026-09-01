"use client";

import { createContext, useContext, useEffect, useState, type MouseEvent, type PointerEvent, type ReactNode } from "react";

interface ScheduleEditModeContextValue {
  editingEnabled: boolean;
  setEditingEnabled: (enabled: boolean) => void;
  toggleEditing: () => void;
}

const ScheduleEditModeContext = createContext<ScheduleEditModeContextValue | null>(null);
const STORAGE_KEY = "dwde.schedule.editing-enabled";
const MUTATION_LABELS = [
  "place class",
  "unassign",
  "send to unscheduled",
  "save new schedule version",
];

export function ScheduleEditModeProvider({ children }: { children: ReactNode }) {
  const [editingEnabled, setEditingEnabledState] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "true") setEditingEnabledState(true);
    } catch {
      // Local storage is only a convenience. Review mode remains the safe default.
    }
  }, []);

  function setEditingEnabled(enabled: boolean) {
    setEditingEnabledState(enabled);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(enabled));
    } catch {
      // Ignore storage failures; current-session state still works.
    }
  }

  function guardPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!editingEnabled) event.stopPropagation();
  }

  function guardMutationClick(event: MouseEvent<HTMLDivElement>) {
    if (editingEnabled) return;
    const button = (event.target as HTMLElement | null)?.closest("button");
    if (!button) return;
    const label = (button.textContent || "").trim().toLowerCase();
    if (!MUTATION_LABELS.some((item) => label.includes(item))) return;
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <ScheduleEditModeContext.Provider value={{
      editingEnabled,
      setEditingEnabled,
      toggleEditing: () => setEditingEnabled(!editingEnabled),
    }}>
      <div
        data-schedule-editing={editingEnabled ? "enabled" : "locked"}
        onPointerMoveCapture={guardPointerMove}
        onClickCapture={guardMutationClick}
      >
        {!editingEnabled ? (
          <style>{`[data-schedule-editing="locked"] button:has(.lucide-grip-vertical){touch-action:auto !important;}`}</style>
        ) : null}
        {children}
      </div>
    </ScheduleEditModeContext.Provider>
  );
}

export function useScheduleEditMode() {
  const value = useContext(ScheduleEditModeContext);
  if (!value) throw new Error("useScheduleEditMode must be used inside ScheduleEditModeProvider");
  return value;
}
