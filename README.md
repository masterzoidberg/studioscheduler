# DWDE Studio Scheduler

DWDE Studio Scheduler is a versioned scheduling control room for maintaining the studio's reviewed Rulebook, editing the weekly schedule, running deterministic constraint checks, testing isolated scenarios, and collaborating with an AI Copilot without allowing the model to silently change canonical data.

Production: https://studioscheduler-three.vercel.app

## Product invariant

**Cami and ChatGPT are looking at the same schedule and the same rules.**

Canonical truth lives in Supabase. UI edits and AI-approved proposals pass through the same authenticated, version-aware mutation boundaries.

## Current V2.1 architecture

- **Rulebook**: reviewed human scheduling policy with stable Rule IDs, raw reviewed classifications, provenance, history, and versioned edits.
- **Schedule**: one canonical assignment model with independent ScheduleVersion history and an explicit link to the RulebookVersion used for validation.
- **Deterministic validator**: detects implemented HARD-rule violations and separately reports machine-enforcement coverage. `0` detected violations does **not** imply full validation while applicable HARD rules remain uncovered.
- **Scenarios**: isolated what-if branches based on specific Rulebook and Schedule versions. They do not change canonical truth.
- **AI Copilot**: reads current database context and may return structured proposals. Proposals are runtime-validated, bound to their base Rulebook/Schedule versions, and require explicit Apply approval. Stale proposals are rejected.
- **Access control**: Supabase Auth plus studio membership roles `OWNER`, `EDITOR`, and `VIEWER`. Owners manage invitations and member roles.
- **OpenRouter credentials**: optionally stored per signed-in account in Supabase Vault. The browser never reads the saved full key back. An authenticated Supabase Edge Function performs OpenRouter calls. A server-side `OPENROUTER_API_KEY` can remain an optional fallback.

## Authoritative reviewed Rulebook

The adopted 2026–2027 reviewed source is:

- `format_version`: `2.0`
- `document_type`: `DWDE_SITE_RULEBOOK`
- Rulebook ID: `dwde-2026-2027-master-rulebook`
- Rulebook version: `2`
- Reviewed rules: `178 / 178`
- Approved without edit: `162`
- Edited and approved: `16`
- Canonical rules SHA-256: `5ef0a282e68b199fae94976335ede2484e80a966b2b5d2c3fa71355a26d5866b`

The reviewed classification vocabulary is preserved as written. Machine typing/enforcement is a separate layer and must not rewrite or silently collapse human-reviewed policy.

## Mutation boundaries

Canonical writes are not direct browser table mutations. The application uses governed Supabase RPCs for:

- Rulebook changes
- Schedule moves and schedule revalidation/rebase
- Teacher, room, and class edits
- Scenario creation
- Studio invitations and role management
- AI proposal audit records

Mutation RPCs enforce studio membership/role authorization and optimistic version checks. Schedule moves are rejected when the schedule is stale relative to the current Rulebook, when an assignment is locked, or when the implemented deterministic HARD validator detects a violation.

## Authentication

Supported application sign-in paths:

- Google OAuth through Supabase Auth
- Email magic link through Supabase Auth

The old anonymous alpha access path is retired from the application architecture.

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

GitHub Actions runs lint, typecheck, tests, production build, and rendered-route smoke tests on pushes and pull requests.

The Supabase Edge Function under `supabase/functions/` runs in Deno and is intentionally excluded from the Next.js TypeScript/ESLint boundary. Its deployed function has JWT verification enabled and performs an additional DWDE studio-membership check.

## Repository layout

- `app/` — Next.js routes and API routes
- `components/` — application shell and feature views
- `lib/domain.ts` — canonical application domain contracts
- `lib/validator.ts` — deterministic client-side validation and coverage model
- `lib/copilot-contract.ts` — runtime AI proposal boundary
- `lib/reviewed-rulebook.ts` — reviewed V2 validation, fingerprint, diff, and conversion helpers
- `supabase/bootstrap/` — reconstructable schema/bootstrap snapshot; not historical migration provenance
- `supabase/production-ledger/` — byte-exact archival copies of successful production V2.1 migration SQL
- `supabase/migrations/` — new repository-authored migrations from this stabilization point forward
- `supabase/functions/user-openrouter/` — authenticated account-scoped OpenRouter proxy
- `tests/` — Rulebook governance, Copilot contract, deterministic validation, and import tests

## Security notes

- Anonymous users do not have direct write privileges on canonical Rulebook, Schedule, or membership tables.
- Anonymous users cannot execute the governed V2.1 mutation RPCs.
- `private.user_ai_credentials` is intentionally private and client-inaccessible; credential access is restricted to service-role RPCs used by the authenticated Edge Function.
- Authenticated `SECURITY DEFINER` RPCs are intentionally exposed to signed-in users because each function performs its own membership/role checks before privileged work.

## Future work

V2.1 establishes the trustworthy control plane. Later work can expand deterministic coverage, add richer scenario compare/adopt and rollback workflows, and introduce a whole-week optimization engine without changing the canonical Rulebook or Assignment architecture.
