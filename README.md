# DWDE Studio Scheduler

DWDE Studio Scheduler is a versioned scheduling control room for maintaining the studio's reviewed Rulebook, maintaining fluid planning data, editing the weekly schedule, compiling deterministic scheduling semantics, testing isolated scenarios, and collaborating with an AI Copilot without allowing the model to silently change canonical data.

Production: https://studioscheduler-three.vercel.app

## Product invariant

**Cami, ChatGPT, the validator, and the future solver must be looking at the same Schedule, Rulebook, Constraint Model, and Planning Dataset.**

Canonical truth lives in Supabase. Human policy, mutable studio facts, executable constraint meaning, and schedule history are versioned separately so a historical schedule can be explained and reproduced instead of being silently reinterpreted after the studio changes.

## Current architecture

- **RulebookVersion**: reviewed human scheduling policy with stable Rule IDs, original classifications, provenance, history, and versioned edits. Cami approves policy, not code mappings.
- **PlanningDatasetVersion**: immutable snapshots of solver-significant mutable facts such as teachers, rooms, dancers, cohorts, classes, sessions, durations, rosters, capacities, and related planning metadata. Current inventory may change freely; changes create a new dataset version instead of rewriting history.
- **ConstraintModelVersion**: fingerprinted output of the deterministic Rulebook compiler. It represents executable meaning of the Rulebook independently of mutable planning data.
- **Constraint IR runtime**: evaluates typed HARD/fixed constraint nodes and returns stable constraint IDs plus the supporting Rule IDs. Teacher qualification is default-deny when no compiled Rulebook qualification domain exists.
- **Scheduling Readiness**: blocks automatic solving when required planning structure is missing, the 178-rule Execution Registry is incomplete, the schedule is stale against current planning data, the compiler is incomplete, or other structural prerequisites fail.
- **ScheduleVersion**: immutable assignment snapshots. Current schedule writes are version-aware and preserve history. Existing legacy enforcement links remain temporarily for compatibility while the Constraint IR path is proven and promoted.
- **Scenarios**: isolated what-if branches that do not silently change canonical truth.
- **AI Copilot**: reads current versioned context and may propose changes, but legality is determined by deterministic code rather than the language model.
- **Access control**: Supabase Auth plus studio membership roles `OWNER`, `EDITOR`, and `VIEWER`.

The legacy `RuleEnforcementVersion` / five-mapping validator is now a compatibility safety net. It is **not** the target architecture and must not be interpreted as whole-Rulebook coverage.

## Authoritative Rulebook

The reviewed 2026-2027 source began as Rulebook v2:

- `format_version`: `2.0`
- `document_type`: `DWDE_SITE_RULEBOOK`
- Rulebook ID: `dwde-2026-2027-master-rulebook`
- Reviewed rules: `178 / 178`
- Approved without edit: `162`
- Edited and approved: `16`
- Reviewed v2 canonical rules SHA-256: `5ef0a282e68b199fae94976335ede2484e80a966b2b5d2c3fa71355a26d5866b`

Rulebook v2 remains immutable history. Current Rulebook v3 preserves the same 178-rule inventory and records two later human confirmations as a new version rather than altering v2 in place:

1. `OPS-002`: Level 5 is explicitly included among classes that may start at 4:30 PM when needed; 4:45 PM remains the normal preferred weekday start.
2. `ADV-004`: Kiran Landis keeps the HARD extra/lower-level Tap requirement; lower-level Jazz and Contemporary are removed; Ballet remains a priority rather than a HARD lower-level requirement.

The reviewed classification vocabulary is preserved. Runtime execution disposition is separately represented by the 178-rule Execution Registry and the compiler. A rule may become a HARD constraint, hard data precondition, fixed anchor, soft objective, data fact, exception, informational rule, or explicit no-runtime-effect assertion without rewriting the human Rulebook text.

## Scheduling truth flow

```text
Reviewed Rulebook
      |
      v
Execution Registry (178/178 accounting)
      |
      v
Deterministic Constraint Compiler
      |
      v
ConstraintModelVersion
      |
      +-------------------+
      |                   |
      v                   v
PlanningDatasetVersion   Schedule candidate
      |                   |
      +---------+---------+
                v
        Constraint IR runtime
                |
                v
       Readiness / legality findings
                |
                v
       Feasibility solver (next)
```

No LLM prose parsing occurs inside the legality path at runtime.

## Planning Dataset policy

The Planning Dataset is intentionally fluid. The studio may add, remove, or change teachers, dancers, rooms, classes, sessions, durations, rosters, or related facts. Those changes create a new `PlanningDatasetVersion`.

A historical ScheduleVersion should remain tied to the planning facts under which it was created. An external source manifest may be pinned as a comparison/provenance baseline, but it is not required to freeze current inventory forever.

Presentation-only metadata should stay outside solver-significant snapshot semantics when possible.

## Constraint Model policy

ConstraintModelVersion represents **Rulebook meaning**, not the current studio inventory. Planning data is therefore deliberately excluded from the published Constraint Model fingerprint.

Editors may publish only a complete compiler artifact through the governed publication boundary. The database validates its shape, versions it, fingerprints it, and audits publication; the database does not reinterpret Rulebook prose itself.

The Readiness page currently runs the Constraint IR evaluator as an independent diagnostic oracle. The legacy schedule mutation validator is deliberately retained until the IR runtime passes integrated golden fixtures and is safe to promote to the canonical mutation boundary.

## Safety language

Until the canonical mutation path and feasibility solver are both operating from the complete Constraint Model, the application should use language such as:

> No detected conflict under current machine coverage.

It must not claim that a schedule is fully legal merely because the legacy validator or a partial diagnostic pass reports zero findings.

## Mutation boundaries

Canonical writes are not direct browser table mutations. Governed Supabase RPCs enforce studio membership/role authorization and optimistic version checks for scheduling-significant changes. Current boundaries include:

- Rulebook changes
- Planning inventory changes
- Schedule assign / unassign / move / rebase / undo operations
- Constraint Model publication
- Scenario creation
- Studio invitations and role management
- AI proposal audit records

The whole-schedule Review/Edit UI state is only a safety affordance. Actual mutation commands must independently enforce whether editing is allowed.

## Authentication

Supported sign-in paths:

- Google OAuth through Supabase Auth
- Email magic link through Supabase Auth

Anonymous alpha access is retired.

## Local development

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

### Environment variables

Copy the template:

```bash
cp .env.example .env.local
```

| Variable | Purpose | Browser-safe? |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Yes |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key | Yes, subject to RLS/RPC authorization |
| `OPENROUTER_API_KEY` | Optional server-side Copilot fallback | **No** |
| `OPENROUTER_MODEL_FAST` | Fast Copilot model | Server config |
| `OPENROUTER_MODEL_REASONING` | Reasoning Copilot model | Server config |
| `APP_URL` | Application base URL for attribution/callback context | Server config |

Never expose service-role credentials or private provider keys through `NEXT_PUBLIC_*` variables.

## Quality gate

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

GitHub Actions runs lint, typecheck, Vitest, production build, and rendered-route smoke tests on pull requests. Constraint work additionally uses:

- compiler tests,
- Constraint IR runtime tests,
- execution-registry accounting tests,
- readiness tests,
- Planning Dataset determinism tests,
- migration reconciliation tests,
- integrated golden feasible/impossible schedule fixtures.

A new Constraint IR kind must never silently fall through the runtime. Coverage tests require every compiler-visible kind to be explicitly evaluated or deliberately delegated.

## Repository layout

- `app/` - Next.js routes and API routes
- `components/` - application shell and feature views, including Scheduling Readiness
- `lib/domain.ts` - canonical application domain contracts
- `lib/rule-execution-registry.ts` - 178-rule runtime disposition/accounting registry
- `lib/planning-dataset.ts` - canonical Planning Dataset snapshot builder
- `lib/constraint-ir.ts` - typed Constraint IR contract
- `lib/constraint-compiler-v3.ts` - current deterministic Rulebook compiler layer
- `lib/constraint-model-version.ts` - versioned compiler artifact definition
- `lib/constraint-engine.ts` / `lib/constraint-engine-v2.ts` - current independent IR runtime evaluator
- `lib/schedule-readiness.ts` - structural automatic-scheduling gate
- `lib/validator.ts` - legacy deterministic compatibility validator during migration
- `lib/copilot-contract.ts` - runtime AI proposal boundary
- `lib/reviewed-rulebook.ts` - reviewed Rulebook validation/fingerprint helpers
- `supabase/bootstrap/` - reconstructable schema/bootstrap snapshot
- `supabase/production-ledger/` - archival copies of direct production migration history where required
- `supabase/migrations/` - repository-tracked production migrations
- `supabase/functions/user-openrouter/` - authenticated account-scoped OpenRouter proxy
- `tests/` - governance, compiler, IR, Planning Dataset, schedule, migration, and golden-fixture tests

## Security notes

- Anonymous users do not have direct write privileges on canonical Rulebook, Schedule, Planning Dataset, Constraint Model, or membership data.
- `private.user_ai_credentials` is intentionally private and client-inaccessible.
- Some authenticated `SECURITY DEFINER` RPCs are intentionally exposed because they are application command boundaries. Each must perform its own authenticated membership/role authorization before privileged work; public/anonymous execution must remain revoked.
- A Supabase advisor warning about an authenticated `SECURITY DEFINER` command is therefore a review signal, not by itself proof that the command is unsafe.

## Roadmap from here

1. Keep golden feasible/impossible fixtures green and expand them as new semantics are promoted.
2. Remove remaining stale user-facing `EnforcementProposal` workflow and compatibility-language drift.
3. Promote the Constraint IR runtime into the canonical schedule mutation validation boundary only after equivalence/safety tests pass.
4. Run a HARD-feasibility-only whole-week solve before introducing preference weights.
5. Add soft optimization using the reviewed priority spine only after feasibility is proven.
6. Add candidate schedule compare/adopt workflow.
7. Build **Constraint X-Ray**: explain why a class is placed, what blocks a requested move, and the smallest conflicting set of requirements when the whole model is infeasible.
