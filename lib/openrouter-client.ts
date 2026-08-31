export const OPENROUTER_STORAGE_KEY = "dwde.openrouter.apiKey.v1";

export function getStoredOpenRouterKey() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(OPENROUTER_STORAGE_KEY)?.trim() || "";
}

export function setStoredOpenRouterKey(value: string) {
  if (typeof window === "undefined") return;
  const key = value.trim();
  if (key) window.localStorage.setItem(OPENROUTER_STORAGE_KEY, key);
  else window.localStorage.removeItem(OPENROUTER_STORAGE_KEY);
}

export function maskOpenRouterKey(value: string) {
  const key = value.trim();
  if (!key) return "";
  if (key.length <= 12) return `${key.slice(0, 4)}••••`;
  return `${key.slice(0, 8)}••••${key.slice(-4)}`;
}
