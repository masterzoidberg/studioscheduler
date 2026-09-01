"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

interface ScheduleEditModeContextValue {
  editingEnabled: boolean;
  setEditingEnabled: (enabled: boolean) => void;
  toggleEditing: () => void;
}

const ScheduleEditModeContext = createContext<ScheduleEditModeContextValue | null>(null);
const STORAGE_KEY = "dwde.schedule.editing-enabled";

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

  return (
    <ScheduleEditModeContext.Provider value={{
      editingEnabled,
      setEditingEnabled,
      toggleEditing: () => setEditingEnabled(!editingEnabled),
    }}>
      {children}
    </ScheduleEditModeContext.Provider>
  );
}

export function useScheduleEditMode() {
  const value = useContext(ScheduleEditModeContext);
  if (!value) throw new Error("useScheduleEditMode must be used inside ScheduleEditModeProvider");
  return value;
}
