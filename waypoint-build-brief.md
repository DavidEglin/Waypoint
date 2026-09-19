# Waypoint — Build Brief (pre-coding)

Status: **draft v3**, 2026-09-19 (v3: Cloudflare Tunnel hosting, encrypted credentials, coding starts; unresolved product questions parked to phase 2). No code exists yet. This file is the bridge between the design work and the first commit.

**How to read it.** Every statement is one of three kinds:
- **Decided** — you confirmed it.
- **Proposed** — my recommendation, not yet confirmed. Marked `[P]`.
- **Open** — needs your answer before or during the build. Listed in section 15 with an ID (`Q1`, `Q2`…).

Sources: `Reference/app-concept-plan.md`, `Reference/waypoint-handoff.md`, `Reference/waypoint-prototype.html`, and the design canvas at https://claude.ai/artifact/7ycZDAU2JciaonxRaPHY7A (Night Study rows, dark + light).

---

## 1. What we're building

Students' study materials are scattered and they don't know what's relevant to a given assessment, so they start late. **Waypoint pulls everything relevant to one assessment into a single study folder**, based on what the assessment notification says the student is marked on.

- Users: **students only** (no teacher/instructor login, view, or dashboard).
- Context: higher education, but flexible enough for other levels (the test case was Year 8 Geography).
- Platform: **responsive web app**, laptop first, phone as a companion view.
- Stack: **React front end, SQLite database, client–server configuration**, self-hosted in Docker behind a Cloudflare Tunnel at `waypoint.yaxley.com.au` (section 5).

## 2. Decided

| Area | Decision |
|---|---|
| Users | Students only |
| Platform | Responsive web app; laptop first, phone companion |
| Stack | React client + server + **SQLite** database |
| Files | Plain folder on the server, **unencrypted for the MVP**; encryption added later |
| Hosting | Self-hosted, running in **Docker**, behind a **Cloudflare Tunnel** |
| Database | **SQLite**, kept in its own dedicated folder (a Docker volume) |
| Address | Reachable **only** at `https://waypoint.yaxley.com.au`. Not by IP address, not by any other name |
| HTTPS | Terminated by Cloudflare. The app itself serves **plain HTTP** to the tunnel (MVP) |
| Deployment | **You** write the Docker and deploy script. This repo contains the app code and configuration by environment variables, not deployment automation |
| Stored credentials | Canvas token and Claude API key are **encrypted** in the database (AES-256-GCM; key from an environment variable) |
| First admin | Created from environment variables on first start |
| Password and session rules | Minimum 12 characters; temporary passwords must be changed at first sign-in; sessions expire after 8 hours idle |
| Waypoint sign-in | **Username and password.** An **admin** user creates accounts and grants access. No self sign-up |
| First-release users | **Just you.** Other students only after the privacy and institutional-approval work (phase 2) |
| Backups | VPS provider snapshots. The app has **no** backup or restore features |
| Canvas reachability | A personal token works from outside the campus network, so a VPS can reach Canvas |
| Content sources | Canvas auto-pull **and** manual upload (photo or PDF/Word) |
| Home screen | Upcoming assessments, sorted by due date |
| Look and feel | **Night Study**: one look for everyone. Only user choice is Light / Dark / Match device, set in Settings |
| Light-mode accent | Burnt amber |
| Study folder layout | Single column with a topic index (mockup "5") |
| "Does this look right?" | Original prototype layout: one centred card, label/value rows, editable values |
| Assessment notification | Button at top right of the folder header, not a list item |
| App notifications | Bell, top right. **Only** new assessments arriving from Canvas |
| Settings contents | Appearance; Canvas address + access token; user's own **Claude API key** (no shared LLM) |
| Left out of release 1 | Skills-based rubric checklist; "Not relevant" removal of wrong matches |
| Audio/podcast | Not built in-house; export folder as text for tools like NotebookLM |

## 3. Scope

### In the first release
1. Connect Canvas (address + personal access token) and a Claude API key in Settings.
2. Assessments home: upcoming assessments with status (folder ready / needs check / no notification yet) and countdown.
3. Add a notification: pick one found in Canvas, take a photo, or upload PDF/Word.
4. Read it (extract text, then structured fields) and show **Does this look right?** with every field editable. Nothing is searched until the student confirms.
5. Search course content for matches to the confirmed topics.
6. Study folder: header (parts, due dates, weighting, AI-use policy, stats), topics with matched items, "why this is here" with the matched term highlighted, "left out" note, original-notification button.
7. Export the folder as plain text.
8. Notification bell for new assessments found in Canvas.
9. Light and dark mode.
10. Sign in with username and password; change own password.
11. Admin: create users, reset passwords, enable/disable, delete (section 5b).

### Not in the first release
Calendar / study-session scheduling; chat commands ("I have soccer on Wednesday"); in-app audio; flashcards/quizzes/summaries; auto-transcripts for uncaptioned video; OCR of scanned course files; skills checklist; removing matches; instructor features; encryption of stored files; multi-institution support (but don't hard-code one Canvas address); self sign-up; in-app backup/restore; giving accounts to anyone other than you until the phase 2 privacy work is done.

## 4. Screens

Mockup names are the canvas boards (Dark_* and Light_*).

| # | Screen | Purpose | Key details |
|---|---|---|---|
| 1 | Assessments home | Landing page | Cards by due date; status chip; countdown; courses list; "add an assessment" |
| 2 | Add a notification | Get a notification in | "From Canvas" list beside upload (photo / file); stepper 1 of 3 |
| 3 | Does this look right? | Confirm extracted fields | Fields: assessment, course, each part's due date, weighting, AI use, topics found. All editable |
| 4 | Searching | Progress while matching | Rows per content type (pages, slides, readings, captioned videos) |
| 5 | Study folder | The product | Header, topic sections, expandable items, left-out note, export |
| 5b | Study folder (phone) | Companion view | Same content, stacked; export bar fixed at bottom |
| 6 | Notifications open | Bell panel | New-assessment entries, mark all as read |
| 7 | Settings | Configuration | Appearance; Canvas; Claude access; test connection; disconnect; change password |
| 8 | Sign in | Get into the app | Username, password, error message. No sign-up link. Not drawn yet |
| 9 | Admin · Users | Grant and manage access | List of users with role and status; add user (temporary password); reset password; disable/enable; delete. Admin only. Not drawn yet |

**Flow:** Home → Add → Confirm → Searching → Folder. A Canvas-found notification skips the upload step and goes straight to Confirm.

**Still to design:** sign in; change password (forced on first login); admin Users screen; first-time empty home; first-run setup for the two keys; unclear or failed read; error states (Canvas unreachable, key rejected, nothing matched); export moment.

## 5. Architecture and hosting

**Decided:** self-hosted, Docker, SQLite in a dedicated folder, behind a Cloudflare Tunnel, reachable only at `waypoint.yaxley.com.au`. The rest is proposed `[P]`.

```
Browser ──HTTPS──► Cloudflare ──(tunnel)──► cloudflared ──HTTP──► App container
   waypoint.yaxley.com.au                    (you configure)         (Node.js + TypeScript)
                                                                      ├── serves the React build and the REST API
                                                                      ├── SQLite database  ──► /data/db      (dedicated folder)
                                                                      ├── Uploads folder   ──► /data/uploads (unencrypted, MVP)
                                                                      ├── Background jobs  (in-process; queue table in SQLite)
                                                                      ├── Canvas client    ──► the user's Canvas instance
                                                                      └── Claude client    ──► Anthropic API, using that user's own key
```

| Piece | Choice | Why |
|---|---|---|
| Language | TypeScript on both sides `[P]` | Shared types for API payloads; fewer integration bugs |
| Client | React + Vite `[P]` | Fast to set up; plain SPA fits a client–server split |
| Server | Node.js with Fastify `[P]` | Same language as the client; easy Canvas/Claude HTTP calls |
| Database | **SQLite** (decided), via better-sqlite3 `[P]`, WAL mode `[P]` | One server, one writer, no database container to run |
| Migrations | Versioned SQL migration files, run automatically at app start `[P]` | Repeatable deploys |
| Jobs | A `jobs` table in SQLite, worked by the app process `[P]` | Search takes seconds to minutes; no Redis |
| HTTPS / edge | Cloudflare Tunnel (decided) | No certificates or reverse proxy to run |
| Styling | CSS variables for tokens (section 9) | Direct fit for dark/light and the mockups |
| Repo | One repo (npm workspaces): `client/`, `server/`, `shared/` `[P]` | Simple; shared types live in `shared/` |

The server is the only thing that talks to Canvas and Claude. **The browser never sees another service's token after it's saved.**

### 5a. Hosting and deployment

- **Deployment is yours.** You'll write the Docker script. The app needs: Node (current LTS), a writable data directory, and environment variables (below). Nothing else.
- **Plain HTTP at the origin, HTTPS at Cloudflare.** The browser always sees HTTPS, so session cookies are marked `Secure`. The app is told it's behind an HTTPS proxy by configuration.
- **Host lock `[P]`:** the app rejects any request whose `Host` header isn't `waypoint.yaxley.com.au`. On the Cloudflare side, you map only that public hostname to the tunnel and don't add a catch-all rule.
- **Keep the origin private `[P]`:** ideally only the tunnel can reach the app (Docker network or localhost binding, or firewall). You said ports 80/443 are fine. If the app is reachable directly on the network, anyone who can reach it could bypass Cloudflare, and the Cloudflare IP header below could be forged.
- **Client IP behind the tunnel:** the app's login rate limiting needs the real client IP. With a setting turned on (`TRUST_CLOUDFLARE_HEADERS`), the app reads `CF-Connecting-IP`; with it off, it uses the direct connection address. Only turn it on when the origin is private.
- **Your Cloudflare configuration:** tunnel, public hostname → the app's HTTP address, and optionally Cloudflare Access as an extra login layer in front of the whole site (a good phase 2 idea). Cloudflare's upload size limit is well above our 15 MB.
- **Data folder:** one host directory mounted as `/data` with `db/` and `uploads/`. Keeping both under one directory means a provider snapshot captures them together. SQLite in WAL mode recovers cleanly from a crash-style snapshot in normal use.
- **Backups:** handled by the hosting provider; the app does nothing about them (decided).
- **Logs:** to standard output, one line per request. Never log passwords, tokens or keys.
- **Updates:** replace the container; migrations run on start.

**Environment variables the app reads:**

| Variable | Purpose |
|---|---|
| `PORT` | Port the app listens on (HTTP) |
| `DATA_DIR` | Data directory (`/data` in Docker); holds `db/` and `uploads/` |
| `ALLOWED_HOST` | The only accepted `Host` header (`waypoint.yaxley.com.au`) |
| `COOKIE_SECURE` | `true` in production |
| `TRUST_CLOUDFLARE_HEADERS` | `true` only when the origin is private behind the tunnel |
| `ENCRYPTION_KEY` | 32-byte key (base64) for encrypting stored credentials. **Losing it makes stored keys unreadable** (users re-enter them) |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | Create the first admin on first start if none exists. The admin must change the password at first sign-in |

### 5b. Sign-in and access

- **Decided:** username + password. An admin creates accounts. No self sign-up.
- **Decided:** minimum 12 characters; temporary and admin-reset passwords must be changed at first sign-in; sessions expire after 8 hours idle.
- **Roles:** `admin` and `user`. The admin is also a normal user with their own folders, Canvas token and Claude key.
- **Admin can:** create a user (username + temporary password), reset a password, disable/enable, delete a user and their data. **Admin cannot** read other users' Canvas tokens, Claude keys or study folders. `[P]`
- **Passwords:** hashed with argon2id, never stored or logged in plain text. `[P]`
- **Sessions `[P]`:** random session ID in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie; only a hash of the ID is stored in the `sessions` table. State-changing requests must be JSON and come from the allowed origin (CSRF defence).
- **Login protection `[P]`:** rate limiting per username and per IP, with a short lockout after repeated failures; the same error message whether the username or password is wrong.
- **First admin:** from `ADMIN_USERNAME` / `ADMIN_PASSWORD` environment variables on first start (decided).
- **Privacy gate:** no account is created for anyone but you until the phase 2 privacy review and institutional approval are done.

## 6. Data model (draft)

Tables and the fields that matter. Types and indexes get decided during build.

| Table | Purpose | Main fields |
|---|---|---|
| `users` | A Waypoint account | id, username (unique), password hash, role (`admin` / `user`), active flag, must-change-password flag, theme preference (`light` / `dark` / `system`), created by, created, last sign-in |
| `sessions` | Signed-in browsers | id, user, created, last seen, expires, IP and user agent |
| `audit_log` | Admin and security events | who, action (create/reset/disable/delete user, failed sign-in), target, time |
| `connections` | Canvas + Claude credentials per user | user, Canvas base URL, Canvas token (**encrypted**), Claude key (**encrypted**), last verified, status |
| `courses` | Synced from Canvas | user, Canvas course id, code, name |
| `assessments` | One per assessment; **it is the study folder's owner** | user, course, title, weighting, AI-use policy, source (`canvas` / `photo` / `document`), status (`found`, `needs_check`, `confirmed`, `searching`, `ready`, `failed`), chosen focus (optional) |
| `assessment_parts` | Part A / Part B etc. | assessment, label, description, due date/time |
| `topics` | Keywords/criteria from the notification | assessment, text, kind (`keyword`; skills criteria later), order |
| `source_files` | Uploaded original (photo/PDF/Word) | assessment, path on server, mime type, size, read method (`vision`, `parsed`) |
| `content_items` | Canvas material we've read | user, course, Canvas id, type (`page`, `slides`, `pdf`, `video`, `doc`), title, module/week, url, extracted text, has captions, fetched at |
| `matches` | Item ↔ topic, with the reason | assessment, content item, topic, score, matched excerpt (for "why this is here"), position |
| `left_out` | Items seen but not matchable | assessment, content item, reason (e.g. no captions) |
| `notifications` | Bell entries | user, kind (`new_assessment` only for now), assessment, read at, created |
| `jobs` | Background work | kind, payload, status, attempts, error, timestamps |

Notes:
- `assessments.status` drives the home-screen chips and the searching screen.
- Store the **extracted text** of course content so re-matching doesn't re-download.
- Keep every date in UTC with the student's time zone stored separately (Q9).

## 7. Core processing pipeline

1. **Ingest** the notification.
   - From Canvas: read the assignment, description and rubric through the Canvas API.
   - Document: extract text from the PDF/Word file directly.
   - Photo: `[P]` send the image to Claude (vision) and ask for the text. This avoids running a separate OCR service.
2. **Parse to structured fields** with Claude: title, course, parts (label, description, due date/time), weighting, AI-use policy, topics/keywords, and whether the student must choose their own focus. Return strict JSON, validate it, and reject anything that doesn't fit the shape.
3. **Confirm.** The student edits any field. Save the edited values as the source of truth. Do not search before this.
4. **Sync content** for the course: pages, module items, files (PDF, Word, slides), and captions for videos. Store extracted text.
5. **Match.** Compare each content item's text with the confirmed topics. `[P]` Start with keyword matching (normalise, stem, phrase matching, weight by where the term appears), record the excerpt around the hit, and group by topic and week/module. Add semantic (LLM or embedding) matching later.
6. **Build the folder:** `matches` and `left_out` rows plus stats. Videos without captions go to `left_out`; scanned images are not matched in release 1.
7. **Export:** concatenate the folder as one plain-text file, ordered by topic, each item headed with its title, source and matched terms.

Rules:
- Claude is called **with the user's own key**. The model name is a config value, not hard-coded.
- Every Claude and Canvas call must handle: bad key, rate limit, timeout, malformed response. Each maps to a visible error state (still to design).
- Log requests and status, never token or key values.

## 8. Canvas integration

- Auth: personal access token from the student (Canvas → Account → Settings → Approved Integrations → New Access Token), sent as a bearer token to the address they enter.
- Likely endpoints (verify against the institution's Canvas API docs): courses, assignments (including rubric), modules and module items, pages, files, media/caption tracks. Canvas paginates with `Link` headers.
- Don't hard-code a Canvas host.
- **Earlier problem:** a fresh token once returned "Invalid access token" with the right domain, and the suspected cause was an institutional block on API access. You've confirmed it works from outside the campus network, so **Milestone 0 is now a confirmation from the VPS**, not a blocker. If it still fails from the VPS, we stop and diagnose before building on it.
- Later: OAuth ("Log in with Canvas") or LTI replaces pasted tokens. It needs the institution's approval, so design the `connections` table so the credential type can change.

## 9. Design tokens (Night Study)

Fonts: **Fraunces** (headings, 500/600), **Instrument Sans** (body/UI, 400–600), **JetBrains Mono** (dates, numbers, labels, 500). Icons: minimal inline stroke SVG, no icon library.

| Token | Dark | Light |
|---|---|---|
| Background | `#0f131b` | `#f6f3ec` |
| Surface (cards) | `#171d28` | `#fffdf8` |
| Surface sunken | `#1e2531` | `#ece7da` |
| Ink | `#efece3` | `#1c1a15` |
| Ink soft | `#bcc0cb` | `#4b4a44` |
| Ink faint | `#939aaa` | `#66645c` |
| Line | `#2b3444` | `#ddd6c4` |
| Accent | `#e8b45f` | `#8a5a0f` |
| Text on accent | `#1b1406` | `#ffffff` |
| Accent soft | `#2b2416` | `#f6e7c8` |
| Accent border | `#5a4826` | `#e0c88f` |
| Notice (AI policy, source, notifications) | `#8fd0e4` | `#1f6a80` |
| Notice soft | `#14303a` | `#e0f1f6` |
| Notice border | `#245566` | `#a8d5e2` |
| Match highlight | `#5a4826` | `#f3d98f` |
| Dashed line | `#4a5568` | `#b9b09a` |

Component rules carried over from the mockups: card radius 12; 44 px minimum touch targets; kicker labels in small uppercase mono; pill chips for topics; expandable rows with a "Why this is here" panel; a distinct notice-coloured callout for AI-use policy; toast for confirmations.

## 10. Responsive and accessibility requirements

- Laptop layouts first (1280 design width), phone layouts at 390. Define breakpoints during build; the folder collapses from index + column to a single column with a fixed export bar.
- Theme: Light / Dark / Match device (follows `prefers-color-scheme`), the choice is saved per user, and no flash of the wrong theme on load.
- Text contrast at least 4.5:1 (3:1 for large text), checked in both modes.
- Real `button` / `a` / `input` elements with labels; full keyboard use; visible focus; `aria-label` on icon-only buttons; respect reduced motion.
- Editable fields on "Does this look right?" must work with keyboard and screen readers, not only click-to-edit.

## 11. API surface (outline)

| Area | Endpoints (REST, JSON) |
|---|---|
| Session | sign in, sign out, current user, change own password |
| Admin users | list users; create user; reset password; enable/disable; delete user (admin only) |
| Settings | get/update theme; save/test/disconnect Canvas; save/test/disconnect Claude key |
| Courses | list (synced from Canvas) |
| Assessments | list; create (from Canvas item or upload); get; update fields (confirm step); confirm → starts search; get status; delete |
| Uploads | upload photo/document; download original |
| Folder | get folder (header, topics, items, left-out); export as text |
| Notifications | list; mark read / mark all read |
| Jobs | status of search/sync (poll every few seconds; upgrade to server-sent events later) |

## 12. Uploads and storage (MVP)

- Uploaded photos/documents are saved to `/data/uploads` on the server disk, **unencrypted**, with database rows pointing at them. This is deliberate for the MVP. The SQLite database lives in `/data/db` (section 5a).
- Limits `[P]`: 15 MB per file; JPEG/PNG/HEIC/PDF/DOCX only; store under generated names, not the student's file name.
- Even for the MVP: never serve the uploads folder directly from the web server. Serve files only through an authenticated endpoint that checks ownership.
- **Credentials are different from files.** The Canvas token and Claude key are **encrypted in the database** (AES-256-GCM, random nonce per value, key from `ENCRYPTION_KEY`). The API never returns them: only "connected / not connected" and when they were last checked.

## 13. Build plan

| Milestone | Outcome | Notes |
|---|---|---|
| M0 Spike | From the VPS: Canvas token validates; one course and one assignment read; one Claude call returns JSON | You report it works from outside campus; this confirms it from the server. Timebox it |
| M1 Skeleton | Repo (npm workspaces); server with SQLite in `DATA_DIR/db`, migrations, host lock; sign-in, sessions, forced password change; admin Users; encrypted Canvas and Claude connections with "Test connection"; client shell, theme tokens, light/dark; Settings | Wrong `Host` gets refused. Keys are never returned by the API. Tests cover auth, admin permissions, encryption |
| M2 Add + read | Upload flow, Canvas-found list, text extraction, Claude parse | Sample notification (the Geography one) parses correctly |
| M3 Confirm | "Does this look right?" with editing and validation | Edits persist |
| M4 Sync + match | Course content sync, matching, searching screen with live progress | Runs as a background job |
| M5 Folder | Study folder screen, phone layout, left-out note, original-notification button | Matches the mockups |
| M6 Export + notifications | Text export; bell with new-assessment entries | |
| M7 Harden | Error states, empty states, accessibility pass, both themes verified, deploy | |

Testing: unit tests for parsing, validation and matching (with a fixtures folder of real, anonymised notifications); API tests against a test database; a few end-to-end tests of the main flow; manual check of both themes at laptop and phone widths.

## 14. Later (parked)

Calendar and study-session suggestions; chat commands tied to the calendar; skills-based criteria; removing wrong matches; encryption of stored files; OAuth/LTI login; auto-transcripts; scanned-file OCR; multiple institutions; more notification types.

## 15. Questions

### Answered

| ID | Question | Answer |
|---|---|---|
| Q1 | Does Canvas work from outside campus? | Yes. Confirm from the server in M0 |
| Q2 | Where will it run? | Self-hosted, Docker, behind a Cloudflare Tunnel |
| Q3 | Database | SQLite, in a dedicated folder |
| Q4 | How many users in release 1? | Just you |
| Q5 | How do users sign in? | Username and password; admin grants access |
| Q6 | Encrypt stored keys? | **Yes** |
| Q7 | Domain and HTTPS | `waypoint.yaxley.com.au` only; HTTPS via Cloudflare |
| Q8 | Privacy / approval | Needed; **phase 2** |
| Q10 | Backups | Provider snapshots; not the app's job |
| Q11 | Deployment | Yours; not part of this code |
| Q16 | First admin | From environment variables |
| Q17 | Password and session rules | 12+ characters, forced change of temporary passwords, 8 hours idle |
| Q18 | VPS details | Self-hosted; ports 80/443 fine; behind a Cloudflare Tunnel you configure |
| Q19 | Certificates | None at the origin; plain HTTP behind the tunnel |

### Parked to phase 2 (defaults used in release 1)

| ID | Question | Default for now |
|---|---|---|
| Q9 | Time zone | One fixed zone set in configuration `[P]`; store dates in UTC |
| Q12 | Export options | One plain-text file of the whole folder, plus a copy button |
| Q13 | First-run setup | Explore first; prompt for Canvas/Claude keys when an action needs them |
| Q14 | "Choose your own angle" tasks | An optional field on the confirm screen (as in the mockup) |
| Q15 | Past assessments | Stay on the home screen, dimmed, below upcoming ones |
