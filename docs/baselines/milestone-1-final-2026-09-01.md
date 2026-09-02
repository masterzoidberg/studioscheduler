# Milestone 1 final baseline

Date recorded: 2026-09-02

This document pins the last known-good Milestone 1 state before the scheduling-knowledge and solver architecture work begins.

## Git baseline

- Repository: `masterzoidberg/studioscheduler`
- Baseline commit: `1dce1d62aa62d8b2dd6d31174b9d6eccd8fbc5cd`
- Baseline commit message: `fix: default schedule to review mode without effect state`
- Durable baseline ref: `baseline/milestone-1-final-2026-09-01`
- Default branch at capture: `main`

## CI baseline

- Workflow: `.github/workflows/ci.yml`
- GitHub Actions run: `33555554213`
- Run number: `109`
- Event: `push`
- Result: `success`
- Head SHA: `1dce1d62aa62d8b2dd6d31174b9d6eccd8fbc5cd`

The CI gate at this baseline runs lint, TypeScript typecheck, Vitest, a production build, and rendered-route smoke checks for `/`, `/rulebook`, `/schedule`, `/people`, `/classes`, `/scenarios`, `/versions`, and `/settings`.

## Vercel production baseline

- Project: `studioscheduler`
- Project ID: `prj_Fp6GrAQzFIHMSdjDOXnDB7M8EeFk`
- Production deployment: `dpl_2bPmbe9ayPLuAC2iHubcyVGgu3pb`
- Deployment state: `READY`
- Deployment Git SHA: `1dce1d62aa62d8b2dd6d31174b9d6eccd8fbc5cd`
- Primary domain: `https://studioscheduler-three.vercel.app`
- Production-domain availability check on 2026-09-02: HTTP 200

The production deployment and the Git baseline therefore point to the same commit.

## Supabase production baseline

- Project: `DWDE Studio Scheduler`
- Project ref: `kbgzrefivxqoiwumfyui`
- Region: `us-east-2`
- Project status: `ACTIVE_HEALTHY`
- Postgres: `17.6.1.166`
- Applied migration count: `38`
- Production migration head: `20260901202548_add_schedule_undo_v23`

### Current planning versions

- Rulebook: v2, `CURRENT`, 178 rules
- Rulebook source hash: `5ef0a282e68b199fae94976335ede2484e80a966b2b5d2c3fa71355a26d5866b`
- Enforcement: v1, `CURRENT`, 5 mappings, bound to Rulebook v2
- Schedule: v2, current, bound to Rulebook v2 and Enforcement v1

The current Schedule v2 validation snapshot reports 0 detected HARD violations under current machine coverage, 119 applicable exact-`HARD` rules, 5 implemented HARD mappings, 114 not implemented HARD rules, and `fullyValidated: false`. This baseline must never be described as full Rulebook validation.

### Current production data shape

- Teachers: 9
- Rooms: 3
- Students: 15
- Class definitions: 12
- Class sessions: 12
- Rules: 178
- Rulebook versions: 2
- Schedule versions: 2
- Enforcement versions: 1

## Migration reconciliation note

Production migration `20260901041429_fix_list_studio_members_v21_return_types` existed in the Supabase migration ledger but was missing from repository provenance at baseline capture. Milestone 0 archives its exact production SQL under `supabase/production-ledger/` and adds it to the byte-integrity manifest without placing it in `supabase/migrations/`, which would incorrectly imply that an already-applied direct-production hotfix should be replayed.

## Protected behavior

Milestone 1 established the manual scheduling workstation: schedule viewing, review/edit mode, drag/move, assign/unassign, proportional class duration, teacher colors, unscheduled placement, versioned saving, and one-step compatible undo. Subsequent architecture work must preserve the manual scheduler while new rule, validation, and solver infrastructure is introduced underneath it.

This baseline is a rollback/reference point, not a claim that every authenticated interaction was re-run manually during capture. The capture verifies the exact production Git SHA, successful CI, production deployment health, Supabase project health, and canonical database/version state.
