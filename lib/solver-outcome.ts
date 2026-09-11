export type SolverOutcomeKind =
  | "CANDIDATE"
  | "INFEASIBLE"
  | "UNKNOWN"
  | "BLOCKED"
  | "UNSUPPORTED"
  | "UNAVAILABLE"
  | "INCOMPLETE"
  | "STALE"
  | "CANCELLED";

export type SolverOutcomeLink = { href: string; label: string };

export type SolverOutcome = {
  kind: SolverOutcomeKind;
  title: string;
  message: string;
  retryable: boolean;
  links: SolverOutcomeLink[];
  diagnostic?: string;
};

type SolverPayload = {
  status?: string;
  error?: string;
  code?: string;
  candidate?: { assignments?: unknown[] } | null;
};

export function presentSolverOutcome(input: {
  payload?: SolverPayload | null;
  responseOk: boolean;
  httpStatus?: number;
  transportError?: string;
}): SolverOutcome {
  const payload = input.payload || {};
  const status = payload.status?.toUpperCase();
  const code = payload.code?.toUpperCase();

  if (code === "SOLVER_CONTEXT_CHANGED_RETRY") {
    return {
      kind: "STALE",
      title: "Setup changed while we were building the schedule",
      message: "This result was discarded because the planning, policy, schedule, or lock context changed. Build a fresh schedule from the current review.",
      retryable: true,
      links: [
        { href: "/setup", label: "Review setup" },
        { href: "/schedule", label: "Review locks" },
      ],
    };
  }

  if (status === "INFEASIBLE") {
    return {
      kind: "INFEASIBLE",
      title: "No complete schedule was proven",
      message: "The solver could not find a schedule that satisfies every Must happen rule. Your current schedule is unchanged. Review requirements or locks, then try again.",
      retryable: true,
      links: [
        { href: "/planning-repairs", label: "Review requirements" },
        { href: "/schedule", label: "Review locks" },
      ],
    };
  }

  if (status === "UNKNOWN" || code === "SOLVER_SERVICE_TIMEOUT" || input.httpStatus === 504) {
    return {
      kind: "UNKNOWN",
      title: "We could not determine whether a schedule exists",
      message: "The schedule build stopped before it could prove a result. No conclusion about whether a schedule exists was reached, and your current schedule is unchanged.",
      retryable: true,
      links: [],
      diagnostic: payload.error || payload.code,
    };
  }

  if (code === "SOLVER_CONTRACT_DRIFT" || status === "UNSUPPORTED" || status === "PRECONDITION_REQUIRED") {
    return {
      kind: "UNSUPPORTED",
      title: "A requirement is not supported for automatic scheduling",
      message: "Automatic scheduling stopped because a HARD requirement cannot be enforced safely yet. Review the requirement details before trying again; your current schedule is unchanged.",
      retryable: false,
      links: [
        { href: "/planning-repairs", label: "Review requirements" },
        { href: "/rulebook", label: "Open policy details" },
      ],
    };
  }

  if (code === "SOLVER_CANDIDATE_REJECTED") {
    return {
      kind: "INCOMPLETE",
      title: "The proposed schedule did not pass its safety checks",
      message: "No schedule was saved because the returned candidate was incomplete or inconsistent. Your current schedule is unchanged. Try again; repeated failures can be reviewed in Advanced diagnostics.",
      retryable: true,
      links: [],
      diagnostic: payload.error || payload.code,
    };
  }

  if (status === "INCOMPLETE") {
    return {
      kind: "INCOMPLETE",
      title: "The proposed schedule is incomplete",
      message: "No schedule was saved because the build did not cover every required session. Your current schedule is unchanged. Try again after reviewing the setup.",
      retryable: true,
      links: [],
      diagnostic: payload.error || payload.code,
    };
  }

  if (status === "BLOCKED" || code === "SOLVER_PREPARATION_BLOCKED" || code === "SOLVER_GATEWAY_BLOCKED") {
    return {
      kind: "BLOCKED",
      title: "Schedule building is blocked",
      message: "Resolve the current setup review before building a schedule. Nothing has been changed in the current schedule.",
      retryable: false,
      links: [
        { href: "/setup", label: "Open Setup review" },
        { href: "/planning-repairs", label: "Review requirements" },
      ],
    };
  }

  if (status === "FEASIBLE" && input.responseOk) {
    if (payload.candidate) {
      return {
        kind: "CANDIDATE",
        title: "Review a proposed schedule",
        message: "A complete schedule candidate passed the first validation checks. Review every assignment before adoption. Your current schedule is unchanged.",
        retryable: false,
        links: [],
      };
    }
    return {
      kind: "INCOMPLETE",
      title: "The proposed schedule is incomplete",
      message: "No schedule was saved because the build did not return a complete candidate. Your current schedule is unchanged. Try again after reviewing the setup.",
      retryable: true,
      links: [],
      diagnostic: payload.error || payload.code,
    };
  }

  const serviceNotConfigured = code === "SOLVER_SERVICE_NOT_CONFIGURED" || input.httpStatus === 503;
  return {
    kind: "UNAVAILABLE",
    title: "Schedule builder is temporarily unavailable",
    message: serviceNotConfigured
      ? "The private schedule builder is not ready on this workspace yet. Your current schedule is unchanged. Ask an administrator to finish the server setup."
      : "The private schedule builder did not return a usable result. Your current schedule is unchanged. Try again later.",
    retryable: !serviceNotConfigured,
    links: serviceNotConfigured ? [{ href: "/settings", label: "Open Settings" }] : [],
    diagnostic: input.transportError || payload.error || payload.code,
  };
}

export function cancelledSolverOutcome(): SolverOutcome {
  return {
    kind: "CANCELLED",
    title: "Schedule build cancelled",
    message: "No candidate was kept and your current schedule is unchanged.",
    retryable: true,
    links: [],
  };
}
