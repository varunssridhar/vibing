# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`vibing` is an npm workspaces monorepo for experimenting with AI tech — a personal/fun project, not production infra. Structure:

- `apps/*` – application packages (currently `apps/good-morning`, a Next.js app)
- `packages/*` – shared libraries/tooling (referenced in workspaces config, none created yet)
- `scripts/*` – standalone TypeScript scripts run directly via `tsx`, outside the workspaces build

## Commands

Root (scripts):
- `npm run distill` – run `scripts/distill.ts` directly via `tsx`

`apps/good-morning` (run from within that directory, or `npm run <script> -w good-morning` from root):
- `npm run dev` – start Next.js dev server
- `npm run build` – production build
- `npm run start` – run production build
- `npm run lint` – `next lint`

There is no root-level test suite (`npm test` at the root is a placeholder that exits with an error) and no configured lint/typecheck command for the `scripts/` directory beyond `tsconfig.json` (`noEmit: true`, `strict: true`) — type-check scripts with `npx tsc --noEmit` from the repo root if needed.

## Architecture: the "Good Morning" pipeline

The core data flow spans `scripts/` and `apps/good-morning/` and runs as two sequential, independent steps rather than at request time:

1. **`scripts/fetch_morning_data.ts`** — pulls raw data from external sources (Gmail via OAuth2 refresh token, Google Calendar iCal feeds, sports RSS feeds) and writes it verbatim to `apps/good-morning/data/raw_dump.json`. Each data source (`gmail`, `calendarIcal`, `sports`) fails independently — errors are collected into an `errors[]` array rather than aborting the whole run, so partial data is still written.
2. **`scripts/distill.ts`** — reads `raw_dump.json`, sends newsletter/important-email content to the Anthropic API (model pinned in `CLAUDE_MODEL` constant) to summarize newsletters into bullets, flag emails needing a 1:1 reply, and generate a one-line "morning vibe check" — then writes the distilled result to `apps/good-morning/data/good-morning.json`.
3. The Next.js app (`apps/good-morning`) is expected to read `good-morning.json` as its data source (the app itself is currently a placeholder page and doesn't yet do this).

Both scripts are meant to run independently (e.g. as separate cron/CI steps) and communicate only through the JSON files in `apps/good-morning/data/` — not via shared imports. Files under any `data/` directory are gitignored (`**/data/**/*.json`), so these intermediate files are never committed.

Required environment variables:
- `fetch_morning_data.ts`: `GMAIL_USER`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GOOGLE_CALENDAR_ICAL_URLS` (comma-separated)
- `distill.ts`: `ANTHROPIC_API_KEY`

## apps/good-morning notes

- Uses shadcn/ui (`components.json`, style `new-york`, base color `slate`) with the `@/*` → `src/*` path alias — add generated components under `src/components/ui`.
- Tailwind + `tailwind-merge`/`clsx` via the `cn()` helper in `src/lib/utils.ts`.
