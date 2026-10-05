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

M3 (Confirm) and M4 (Sync + match, scoped down - see below) are now also built. Not yet built: M5 (the real Folder screen), M6 (Export + notifications), M7 (Harden).

---

## Next build: top priorities

1. ~~**M3 — Confirm screen ("Does this look right?")**~~ **Built** — see below.

2. **M4 — Course sync + matching (now the top priority)**
   This is the actual point of the app: crawling a course's modules/pages/files, extracting text, and matching it against the assessment's rubric/keywords. Without it, "Add an assessment" is the whole product. Needs to run as a background job with visible progress (per the brief) since a real course crawl is many sequential Canvas calls. Now unblocked — assessments can actually reach `confirmed`.

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

---

## Built: M3 — Confirm screen (2026-10-05)

The assessment report page was read-only with no way to correct or confirm anything, even though it said "comes next" at the bottom — the pipeline dead-ended at `needs_check` for every assessment. Built the actual Confirm step:

- **Server:** `POST /api/assessments/:id/confirm` (`server/src/routes/assessments.ts`) takes the full corrected set of fields (title, course, weighting, AI-use policy, own-focus prompt/choice, due-date parts, topics), validates it (`confirmAssessmentRequestSchema` in `shared/src/index.ts`), replaces the stored parts/topics, and moves the assessment from `needs_check` to `confirmed`. Can be called again later to correct something post-confirm (status stays `confirmed`); refused with `409 not_ready` while still `reading` or `failed`.
- **Client:** the report screen (`client/src/pages/AssessmentPage.tsx`) now splits in two — an editable `ConfirmForm` while `needs_check` (inline fields for every value Claude extracted, add/remove due-date parts and topics, a Confirm button) and a read-only `Confirmed` view afterwards. Due dates are edited as plain date/time inputs in the browser's own time zone, same convention the read-only display already used.
- Honest framing: once confirmed, the screen says searching your course for matching content isn't built yet (that's M4) rather than implying something happens automatically.

6 new server tests (corrections persist, re-confirm overwrites, empty title rejected, blocked while reading/failed, ownership, clearing all parts/topics) — 152 passing total, typecheck clean. Verified against the real running dev server (not just the test suite): inserted a `needs_check` row directly, confirmed it over HTTP, corrections persisted on reload. Not verified in an actual browser click-through (no GUI browser tool available in this environment) — worth a manual pass before relying on it.

**Known limitation:** editing "Course" only changes anything for a manually-uploaded assessment; for one added from Canvas, the Canvas course name always wins over the edited label when displaying `courseName`. Not fixed — low priority, Canvas's own course names are rarely wrong.

---

## Built: M4 — Course sync + matching (2026-10-05)

Scoped down from the full brief on purpose (confirmed with the user first): Pages + Files + Modules only, no video captions (the brief itself flags that as the biggest technical risk and says to check a real course's video platform before building it — not done yet); keyword-topic matching only, skill-kind topics excluded (the brief defers "a different kind of matching" for those); and a minimal results view now rather than waiting for the real Folder screen (M5), so this milestone is actually usable rather than another invisible backend step.

- **Server:**
  - `server/src/canvas.ts`: added `listPages`, `listModules`, `listFiles` to `CanvasClient`.
  - `server/src/match.ts` (new): pure keyword matcher — whole-word, case-insensitive, scores by how many distinct topics a page/file covers, returns a snippet around the first hit. Unit-tested in isolation.
  - `server/src/search.ts` (new): the `search_course` background job. Crawls a confirmed assessment's course (Pages with inline body, Files filtered to `.pdf`/`.docx` and capped at 25 downloads, Modules for topic/week labels), matches against the assessment's keyword topics, saves the results to a new `folder_items` table (migration 3). Resilient the same way the rest of the codebase already is: one failed list or file doesn't hide the others, a rate limit stops everything immediately, and a *total* failure (nothing could be read at all) still reports as a real failure rather than a silent empty result.
  - Confirming an assessment now moves it straight to `searching` (not a resting `confirmed`) and enqueues the job. `error_code`/`read_method` double as the signal for `/retry`: if `read_method` is set, a `failed` status means the *search* failed (retry re-runs `search_course`); if it's null, the original *read* failed (retry re-runs `read_notification`, unchanged from M2/M3).
- **Client:** `AssessmentPage.tsx` gained a `Searching` state (polls like `Reading` already did) and a `Folder` view for `ready` — course, due dates, then a flat list of matches with module name, matched-topic chips, a snippet, and an "Open in Canvas" link. `Failed` now reads differently for a search-stage vs. read-stage failure.

11 new server tests (5 for the matcher, 5 for the crawl/match/resilience/retry behaviour against a mocked Canvas, using the same `ctx.setFetch` pattern as the rest of the suite) — 162 passing total, typecheck clean. Verified against the real running dev server end-to-end: confirmed an assessment with no linked course, watched the background job actually pick it up and move it from `searching` to `ready` with an empty folder (the correct outcome — nothing to crawl), not just a drained test. The actual page-crawl-and-match path is covered by the mocked tests but **not yet exercised against a real Canvas course** — worth doing once there's a real confirmed assessment with a real course to search.

---

## To work on

- [ ] **Bell icon for new Canvas assessments.** Part of the original agreed design (see "Known gap vs. the original design" above) and listed under milestone M6, but never built — there is currently no background sync at all; Canvas is only checked when the student opens "Add an assessment." Now that discovery reliably finds undated and 4-week-out work (see the concluded-course fix above), this is the piece that would make the app usable without remembering to check manually: a periodic sync plus an unread count on the bell, matching the original mockups.
- [ ] Map the Claude low-credit-balance error to its own message in the UI (see "Parked" above).
- [ ] Read linked Canvas Pages and the course syllabus, not just the assignment's own description/rubric/linked files, so a notification posted as a separate Page doesn't read as "no readable text" (see "Known gap" above).
- [ ] **M5 — the real Folder screen.** Group matches by topic (not just module), always show the original notification alongside, match the agreed Night Study mockups. The current `Folder` view in `AssessmentPage.tsx` is a deliberately minimal stand-in.
- [ ] Video captions (Canvas Studio or an embedded platform — check a real course first, per the brief) and skill-kind topic matching were both explicitly cut from M4's scope; pick up if they turn out to matter.
