const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isStudioId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value.trim());
}

export function selectedStudioIdFromHeader(request: Request): string | null {
  const value = request.headers.get("x-studio-id")?.trim() || "";
  return isStudioId(value) ? value : null;
}
