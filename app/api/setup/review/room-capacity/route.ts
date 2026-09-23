import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AuthorizedWorkspace = {
  supabase: SupabaseClient;
  role: "OWNER" | "EDITOR" | "VIEWER";
  userId: string;
};

type RoomCapacityReviewRequest = {
  studioId?: string;
  roomId?: string;
  expectedPlanningDatasetVersion?: number;
  expectedFingerprint?: string;
  outcome?: string;
  note?: string | null;
};

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? error);
  }
  return String(error);
}

async function authorizeWorkspace(
  request: NextRequest,
  studioId: string,
): Promise<AuthorizedWorkspace | null> {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;
  const supabase = getServerSupabase(authorization);
  const userResult = await supabase.auth.getUser();
  const user = userResult.data.user;
  if (userResult.error || !user) return null;

  const membership = await supabase
    .from("studio_members")
    .select("role,studio_id")
    .eq("studio_id", studioId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (membership.error || !membership.data || membership.data.studio_id !== studioId) return null;
  return {
    supabase,
    role: membership.data.role as AuthorizedWorkspace["role"],
    userId: user.id,
  };
}

function blocked(code: string, error: string, status = 409) {
  return NextResponse.json({ status: "BLOCKED", code, error }, { status });
}

function knownReviewBlock(error: unknown) {
  const message = errorMessage(error);
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code || "")
    : "";

  if (code === "42501" || message.includes("Editor membership required")) {
    return blocked("SETUP_REVIEW_EDITOR_REQUIRED", "Editor access is required to review room capacity.", 403);
  }
  if (message.includes("STALE_ROOM_CAPACITY_REVIEW_VERSION")) {
    return blocked(
      "ROOM_CAPACITY_REVIEW_VERSION_CHANGED",
      "Setup changed before this review could be saved. Refresh the room and review its current capacity again.",
    );
  }
  if (message.includes("STALE_ROOM_CAPACITY_REVIEW_FINGERPRINT")) {
    return blocked(
      "ROOM_CAPACITY_REVIEW_VALUE_CHANGED",
      "This room capacity changed before the review could be saved. Refresh and review the current value.",
    );
  }
  if (message.includes("ROOM_CAPACITY_REVIEW_MISSING")) {
    return blocked(
      "ROOM_CAPACITY_REQUIRED",
      "Enter a positive room capacity before marking it reviewed.",
    );
  }
  if (message.includes("ROOM_CAPACITY_REVIEW_ROOM_NOT_ACTIVE")) {
    return blocked(
      "ROOM_CAPACITY_REVIEW_ROOM_NOT_ACTIVE",
      "This room is no longer in the active setup. Refresh before reviewing it.",
    );
  }
  if (message.includes("ROOM_CAPACITY_REVIEW_OUTCOME_INVALID")) {
    return blocked(
      "ROOM_CAPACITY_REVIEW_OUTCOME_INVALID",
      "Room capacity is a required value and cannot be marked as having no restriction.",
    );
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as RoomCapacityReviewRequest;
    const studioId = typeof body.studioId === "string" ? body.studioId.trim() : "";
    const roomId = typeof body.roomId === "string" ? body.roomId.trim() : "";
    const expectedPlanningDatasetVersion = Number(body.expectedPlanningDatasetVersion);
    const expectedFingerprint = typeof body.expectedFingerprint === "string"
      ? body.expectedFingerprint.trim().toLowerCase()
      : "";
    const outcome = body.outcome || "REVIEWED_VALUE";
    const note = typeof body.note === "string" ? body.note.trim() : null;

    if (!studioId || !roomId) {
      return NextResponse.json({ error: "studioId and roomId are required." }, { status: 400 });
    }
    if (!Number.isInteger(expectedPlanningDatasetVersion) || expectedPlanningDatasetVersion <= 0) {
      return NextResponse.json({ error: "A valid expected PlanningDatasetVersion is required." }, { status: 400 });
    }
    if (!/^[0-9a-f]{64}$/.test(expectedFingerprint)) {
      return NextResponse.json({ error: "A valid room-capacity review fingerprint is required." }, { status: 400 });
    }
    if (outcome !== "REVIEWED_VALUE") {
      return blocked(
        "ROOM_CAPACITY_REVIEW_OUTCOME_INVALID",
        "Room capacity is a required value and cannot be marked as having no restriction.",
      );
    }
    if (note && note.length > 500) {
      return NextResponse.json({ error: "Review note is limited to 500 characters." }, { status: 400 });
    }

    const authorized = await authorizeWorkspace(request, studioId);
    if (!authorized) return NextResponse.json({ error: "Workspace access denied." }, { status: 401 });
    if (authorized.role === "VIEWER") {
      return blocked("SETUP_REVIEW_EDITOR_REQUIRED", "Editor access is required to review room capacity.", 403);
    }

    const result = await authorized.supabase.rpc("attest_room_capacity_review_v51", {
      p_studio_id: studioId,
      p_room_id: roomId,
      p_expected_planning_dataset_version: expectedPlanningDatasetVersion,
      p_expected_fingerprint: expectedFingerprint,
      p_outcome: "REVIEWED_VALUE",
      p_note: note || null,
    });
    if (result.error) {
      const known = knownReviewBlock(result.error);
      if (known) return known;
      throw result.error;
    }

    const mutation = result.data && typeof result.data === "object"
      ? result.data as Record<string, unknown>
      : {};
    return NextResponse.json({
      status: "REVIEWED",
      reviewId: mutation.reviewId ?? null,
      roomId: mutation.roomId ?? roomId,
      planningDatasetVersion: Number(mutation.planningDatasetVersion || expectedPlanningDatasetVersion),
    });
  } catch (error) {
    const known = knownReviewBlock(error);
    if (known) return known;
    return NextResponse.json({
      error: errorMessage(error),
      code: "SETUP_REVIEW_ERROR",
    }, { status: 500 });
  }
}
