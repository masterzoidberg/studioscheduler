# DWDE Studio Scheduler

A professional scheduling control room for collaboratively building, reviewing, validating, and eventually optimizing a dance studio rulebook and weekly schedule.

> Milestone 1 is a visual/product-direction prototype. Authentication, Supabase persistence, deterministic validation, real drag/drop, OpenAI tool calls, and version mutations are intentionally deferred until the visual direction is approved.

## Milestone 1 includes

- Next.js 16 + TypeScript + Tailwind CSS
- GitHub Codespaces configuration
- Responsive administrative shell with left navigation
- Dashboard with realistic DWDE health metrics
- Searchable/filterable structured Rulebook using typed seed data
- Monday multi-room visual schedule with selectable class cards
- Rule-aware class inspector and status indicators
- Persistent ChatGPT Copilot UI shell on desktop and mobile drawer
- Placeholder routes for People, Classes, Scenarios, Versions, and Settings
- CI for lint, typecheck, tests, production build, and route smoke tests

## Start in GitHub Codespaces

1. Open this repository on GitHub.
2. Tap/click **Code**.
3. Open the **Codespaces** tab.
4. Choose **Create codespace on main**.
5. Wait for the browser editor to open. The devcontainer automatically runs `npm install`.
6. Open the terminal.
7. Run:

```bash
npm run dev
```

8. When Codespaces reports port **3000**, choose **Open in Browser** or **Open Preview**.

If the preview does not open automatically, open the **Ports** panel, find port `3000`, and use the globe/open-browser button.

## Quality checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

GitHub Actions runs all four checks on pushes and pull requests and then smoke-tests every Milestone 1 route.

## Environment variables

Copy the template when later milestones need integrations:

```bash
cp .env.example .env.local
```

No secrets are required for Milestone 1.

| Variable | Purpose | Browser-safe? |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase public/anon key | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Privileged Supabase operations | **No** |
| `OPENAI_API_KEY` | OpenAI Responses API | **No** |
| `OPENAI_MODEL_REASONING` | Reasoning model selection | Server config |
| `OPENAI_MODEL_FAST` | Fast explanation model selection | Server config |
| `APP_URL` | Application base URL | Server config |

Never prefix service-role or OpenAI secrets with `NEXT_PUBLIC_`.

### Supabase setup, when Milestone 2 begins

Milestone 2 will include exact click-by-click setup. The intended flow is:

1. Create a Supabase project.
2. Copy **Project URL** to `NEXT_PUBLIC_SUPABASE_URL`.
3. Copy the project **anon/publishable key** to `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. Store the **service role key** only as `SUPABASE_SERVICE_ROLE_KEY` in server/Codespaces secrets.
5. Enable email magic-link and GitHub authentication in Supabase Auth.

### OpenAI setup, when AI integration begins

`OPENAI_API_KEY` will be read only by server-side code. The browser will never receive it. Model-generated changes will be typed proposals and will not bypass deterministic validation.

## Current architecture

- `app/` — routes and global styling
- `components/` — application shell and feature views
- `lib/types.ts` — typed domain contracts
- `lib/mock-data.ts` — representative DWDE Rulebook and Monday schedule data
- `tests/` — seed integrity tests

The UI consumes typed records instead of embedding scheduling facts in component logic. Persistence can therefore replace the mock repository in the next milestone without redesigning the core screens.

## Product invariant

**Cami and ChatGPT are looking at the same schedule and the same rules.**

AI will propose structured patches. The application, not the model, will determine technical validity. Scenarios remain isolated until explicitly adopted.
