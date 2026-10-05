## Changelog: Waypoint

This document is to help me track current features, release numbers, and future ideas.

Version 0.1 initial build - prod

---

## Current state (2026-10-05)

Built: **M0–M2** of the plan in `waypoint-build-brief.md` (`#13 Build plan`).

- **M0 Spike** — Canvas token/domain confirmed reachable; one course, one assignment, one Claude parse all verified.
- **M1 Skeleton** — npm workspaces (`shared/ server/ client/`); Fastify + SQLite server with host lock, sign-in, sessions, forced password change, admin users, encrypted Canvas/Claude connections with "Test connection"; React client shell with Night Study theme (light/dark/match device), Settings page.
- **M2 Add + read** — Two ways to start an assessment:
  - **Upload it yourself**: photo/PDF/Word notification, extracted and parsed by Claude (your own key) into parts, due dates, weighting, AI-use rules and topics.
  - **From Canvas**: on the "Add an assessment" page, Waypoint pulls your active student-enrolled courses and lists upcoming assignments; picking one re-fetches the full assignment (description, rubric, linked files, assignment-group weight) and runs it through the same Claude parse.
  - Result lands as a "needs_check" assessment — nothing downstream of that exists yet (see below).

**Fixed this session:**
- Canvas discovery was using Canvas's own `bucket=upcoming` filter, which only covers roughly the next week and silently excludes undated work. Replaced with app-side filtering: now surfaces anything undated plus anything due in the next 4 weeks (`UPCOMING_WINDOW_DAYS` in `server/src/routes/courses.ts`).
- Local dev (`npm run dev:client` + `dev:server`) was broken: Vite's string-shorthand proxy target defaults to `changeOrigin: true`, which rewrote the `Host` header and tripped the server's own host-lock on every `/api` call. Fixed in `client/vite.config.ts` with an explicit `changeOrigin: false`.

**Known gap vs. the original design:** a "bell" icon that surfaces new Canvas assessments automatically was part of the agreed design and is listed under M6, but it was never built. There is currently no background sync of any kind — Canvas is only ever queried when the Add-assessment page is opened, and even then the student must click "Add" on an item before it becomes a tracked assessment.

Not yet built: M3 (Confirm), M4 (Sync + match), M5 (Folder), M6 (Export + notifications), M7 (Harden). Full test suite: 145 passing; typecheck clean across all three workspaces.

---

## Next build: top priorities

1. **M3 — Confirm screen ("Does this look right?")**
   Every assessment Waypoint reads today dead-ends at `needs_check` with no way to edit or confirm it. This is the very next milestone in the brief and blocks everything after it (sync, matching, the folder itself) — right now the pipeline produces data nobody can act on.

2. **M4 — Course sync + matching**
   This is the actual point of the app: crawling a course's modules/pages/files, extracting text, and matching it against the assessment's rubric/keywords. Without it, "Add an assessment" is the whole product. Needs to run as a background job with visible progress (per the brief) since a real course crawl is many sequential Canvas calls.

3. **Close the bell/notification gap (part of M6)**
   Now that Canvas discovery actually finds undated and 4-week-out work reliably, the missing piece is surfacing it without the student having to remember to open "Add an assessment." A lightweight periodic sync + unread count on a bell icon would match what was originally designed and tested well in the mockups — worth pulling forward ahead of the rest of M6 (export) since it's the one feature most likely to make or break whether this gets used day-to-day.

---

## Follow-up (2026-10-05, later): live debugging against real Canvas + Claude

**Fixed:**
- Undated Canvas assignments from **concluded courses** (e.g. a finished Semester 1) were showing up in "Add an assessment" forever, since the 4-week/undated window had no idea the course itself was stale. Added `courseConcluded()` (course or term `end_at` in the past) in `server/src/canvas.ts`; concluded courses are now skipped when searching for assignments, though still cached so the manual-upload course picker can still tag something to an old course.
- Added detailed failure logging (`server/src/canvas.ts`, `parse.ts`, `read.ts`): a failed Canvas or Claude call now logs the real HTTP status/URL or the SDK's own error message to the server's warn log. Previously a `ReadError` failure logged nothing at all — the generic "Claude or Canvas answered unexpectedly" message was the only trace, with no way to tell which service failed or why.

**Diagnosed, not a bug:** that generic "answered unexpectedly" error on a real assessment (Music Sem 2) turned out to be the Claude API key's credit balance running out (`invalid_request_error`: "credit balance is too low to access the Anthropic API"), caught immediately once the new logging was deployed. Resolved by topping up credits in the Anthropic console — no code defect. This affects any read (Canvas or upload) whenever the configured Claude key runs dry.

**Known gap (new):** a Canvas assignment whose actual notification lives in a linked Page or the course syllabus, rather than in the assignment's own description field, still reads as "no readable text." Waypoint only reads the assignment description, its rubric, and files linked directly inside that description — fetching linked Pages/syllabus was scoped in the original integration plan (`Reference/canvas-integration-blueprint.md` §5) but never built. Workaround for now: upload the notification manually.

**Parked (not critical):** map the Claude "low credit balance" 400 to a dedicated `ReadErrorCode` so the UI says "your Claude API key is out of credit" directly, instead of the generic bad-response message — would save a trip to the logs next time this happens.
