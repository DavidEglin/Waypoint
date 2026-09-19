# Waypoint × Canvas — Integration Blueprint

*Research date: 2026-09-19. Companion to `app-concept-plan.md` and `waypoint-handoff.md`.*

**Purpose:** describe how Waypoint has to be structured and coded to integrate with Canvas — auth, the exact API calls for each stage of the app, the modules to build, and what to ask the institution for.

**Confidence key:** items marked **(verify)** come from my own background knowledge or community posts, not from the official docs I read. Everything else was taken from Instructure's developer docs (links in §12). Field-level details were read through a page summariser, so confirm exact field names against a real API response early on.

---

## 1. Headline findings

1. **Yes, Canvas has a full REST API** (`/api/v1/...`), and it covers everything the MVP needs: courses, assignments (with rubrics), modules, pages, files, and video caption tracks.
2. **A backend is mandatory.** OAuth needs a `client_secret`, tokens must be stored encrypted, and files are downloaded with short-lived signed URLs. A browser-only app can't do this safely.
3. **The concept plan is wrong about LTI in one important way.** It says LTI means "no separate login step, the launch hands over access automatically." An LTI 1.3 launch only proves *who the user is and which course they're in*. The LTI `client_credentials` token only reaches LTI services (grades, roster, deep linking). **To read pages, files and rubrics you still need a Canvas API developer key and a per-user OAuth2 token.** LTI and OAuth are separate flows. So OAuth is not a stepping stone you skip; it's the required core, and LTI is an optional convenience layer on top.
4. **Everything beyond the prototype needs an institution admin.** Developer keys are issued by a root-account admin, are only valid for that institution, and the admin chooses which API scopes the key gets. Instructure's API policy also says asking end users to hand-generate tokens is a violation. The personal-token route is prototype-only.
5. **Multi-institution scale means one developer key per institution** (global keys are created only by Instructure staff). The data model must be per-instance from day one.
6. **The token problem is very likely institutional**, not a copying error. See §3 for a diagnostic checklist that separates the causes.

---

## 2. Target architecture

```
┌──────────────────────┐        ┌───────────────────────────────────────────────┐
│  Browser (React/Vite)│  HTTPS │  Waypoint backend                             │
│  Upload → Confirm →  │◄──────►│  ┌───────────┐  ┌────────────┐  ┌──────────┐  │
│  Searching → Folder  │        │  │ Auth/     │  │ Ingest     │  │ Matcher  │  │
│  (session cookie     │        │  │ session   │  │ pipeline   │  │          │  │
│   only, no tokens)   │        │  └─────┬─────┘  └─────┬──────┘  └────┬─────┘  │
└──────────────────────┘        │        │              │              │        │
                                │  ┌─────▼──────────────▼──────┐  ┌────▼─────┐  │
                                │  │ CanvasClient              │  │ Database │  │
                                │  │ auth · paginate · throttle│  │ (tokens  │  │
                                │  │ · refresh · retry         │  │ encrypted│  │
                                │  └─────┬─────────────────────┘  └──────────┘  │
                                └────────┼──────────────────────────────────────┘
                                         │ Bearer token, per user, per instance
                                         ▼
                        https://<institution>.instructure.com/api/v1/...
```

**Rules that follow from the research:**

- The browser never sees a Canvas token. It holds a Waypoint session cookie only.
- Every Canvas call goes through one `CanvasClient` that knows the user's instance base URL and token.
- Nothing hard-codes a domain. `base_url` lives on a `canvas_instance` row.
- Suggested stack: TypeScript on both sides (React/Vite front end per the handoff doc, Node backend). This is a suggestion, not a research requirement; any backend that can do OAuth and background work is fine.

---

## 3. Phase 0 — Fix the "Invalid access token" problem first

The docs say a `401` with a `WWW-Authenticate` header means an expired or invalid token **or the wrong domain**. Work through this in order; each step narrows the cause.

```bash
# 1. The simplest possible call. Note the -i to see headers.
curl -i -H "Authorization: Bearer <TOKEN>" "https://<HOST>/api/v1/users/self"
```

| # | Check | What it tells you |
|---|---|---|
| 1 | `<HOST>` is the host you see in the browser address bar **while inside a course** (e.g. `uni.instructure.com`), not a login/SSO portal or marketing URL | Wrong-domain is the most common cause per the docs |
| 2 | Token is sent as the header `Authorization: Bearer <token>` — no quotes, no trailing space/newline (paste into a file and `cat -A` it) | Copy/paste artefacts |
| 3 | Token was generated in that same Canvas instance (Profile → Settings → Approved Integrations) | Tokens are instance-specific |
| 4 | Try the same token in a REST client (Postman/Insomnia) on a different network (phone hotspot) | If it works there, it's a network/proxy block, not Canvas |
| 5 | Read the `WWW-Authenticate` response header and the JSON `errors[]` body | Distinguishes "invalid token" from "insufficient scopes" |
| 6 | Ask the eLearning team whether personal token generation or the underlying developer key is restricted | Community reports say a token bound to a deleted/scope-stripped key returns 401 **(verify)**. Canvas also has an admin permission for generating personal access tokens **(verify)** |

**If step 4 works:** network-level block → talk to IT.
**If it fails everywhere:** account/instance-level restriction → this is the moment to open the conversation with the eLearning team, and the demo in §9 becomes the pitch.

**Fallback while blocked:** the manual-upload path already in the MVP (photo/PDF/Word notification + student-uploaded content) doesn't depend on Canvas. Build and demo that flow against sample data while access is resolved, and keep `CanvasClient` behind an interface so a `MockCanvasClient` can serve fixtures (§7).

---

## 4. Authentication — three modes behind one interface

Model auth as a strategy so the rest of the app never cares which is active.

```ts
interface CanvasCredentials {
  baseUrl: string;                 // per instance, never hard-coded
  getAccessToken(): Promise<string>; // refreshes transparently if expired
}
```

### Mode A — Personal access token (prototype only)

- User creates it under Profile → Settings → Approved Integrations.
- Store in `.env` for local dev only. Never ship, never ask other users to do this (API policy).
- `getAccessToken()` just returns the env value.

### Mode B — OAuth2 authorization code ("Log in with Canvas") — **the real target**

Requires an **API-type developer key** issued by the institution's root-account admin.

```
1. Redirect user  →  GET  https://<HOST>/login/oauth2/auth
                        ?client_id=<KEY_ID>
                        &response_type=code
                        &redirect_uri=<WAYPOINT_CALLBACK>
                        &state=<random, stored in session>
                        [&scope=<space-separated scopes>]

2. Canvas redirects back to WAYPOINT_CALLBACK?code=...&state=...
   → verify state matches the session

3. Backend exchanges code  →  POST https://<HOST>/login/oauth2/token
                        grant_type=authorization_code
                        client_id, client_secret, code, redirect_uri
   ← { access_token, refresh_token, expires_in: 3600, user: {id, name}, ... }

4. Store both tokens encrypted, keyed by (canvas_instance_id, canvas_user_id)

5. On expiry (1 hour) or a 401  →  POST /login/oauth2/token
                        grant_type=refresh_token
                        client_id, client_secret, refresh_token
   ← new access_token (the refresh token is NOT rotated; reuse it)
```

Implementation notes:

- **Tokens expire after 1 hour**, so refresh handling is not optional. Refresh proactively when `expires_at` is near and reactively on a single 401 (then retry once).
- **One "login per instance" step.** Users must first say which Canvas they use (a school picker or a `https://<school>.instructure.com` field), because step 1 goes to *their* host and each instance has its own key. Store the chosen instance on the user.
- **Scopes:** the admin restricts the key to specific endpoints. A request outside the granted scopes returns `401`. Use the list in §8.
- Don't request `replace_tokens=1` unless you want to invalidate the user's other sessions.
- Token revoked/deleted on the Canvas side → refresh fails → send the user back through step 1.

### Mode C — LTI 1.3 launch (optional, later)

LTI adds a *front door inside Canvas* (a "Waypoint" link in course or global navigation). It does **not** replace Mode B for content access.

```
Canvas ──(1) login initiation──► Waypoint  /lti/login
Waypoint ──(2) auth request──► https://sso.canvaslms.com/api/lti/authorize_redirect
Canvas ──(3) POST id_token (signed JWT)──► Waypoint /lti/launch
Waypoint: validate JWT against Canvas JWKS, read user id, course id, roles
        → open Waypoint (usually in an iframe) already scoped to that course
        → if no valid API token for this user yet → run Mode B once
```

What LTI genuinely buys: users arrive from inside Canvas already identified, with the course pre-selected, and no school-picker. What it costs: iframe cookie handling (Safari blocks third-party iframe cookies; Canvas provides the LTI Platform Storage `postMessage` mechanism), a JWKS endpoint, per-deployment records, and admin installation of an **LTI-type** developer key **in addition to** the API key.

Useful launch config (from the LTI key JSON): `oidc_initiation_url`, `target_link_uri`, `public_jwk(_url)`, `scopes` (LTI services only, and we likely need none), `placements` (`course_navigation` is the natural one), `privacy_level` (`anonymous` is enough — we take identity from the OAuth step or `sub`).

**Recommendation:** ship Mode B first. Only add Mode C if the pilot shows people want to launch from inside Canvas. Whether an LTI-launched user can skip the OAuth consent screen is a question for the institution **(verify)**.

---

## 5. Canvas endpoints, mapped to the four app stages

Base: `https://<HOST>/api/v1`. All calls use `Authorization: Bearer <token>`.

### Stage 0 — Course picker (new, precedes "Upload")

| Need | Call |
|---|---|
| List the student's courses | `GET /courses?enrollment_state=active&include[]=term&include[]=syllabus_body&per_page=100` |
| Who is the user | `GET /users/self` |

Filter to `enrollment_type=student` (the app is student-only per the handoff). `syllabus_body` is a free extra content source.

### Stage 1 — "Upload": Canvas auto-pull of the assessment

This replaces the prototype's "Use sample document" button with **Pick a course → Pick an assessment**.

| Need | Call |
|---|---|
| Upcoming assessments | `GET /courses/:course_id/assignments?bucket=upcoming&order_by=due_at&include[]=all_dates&include[]=overrides&per_page=100` |
| One assessment in full | `GET /courses/:course_id/assignments/:id` |
| Weighting | `GET /courses/:course_id/assignment_groups` → `group_weight` **(verify)** |
| Quizzes/exams as their own type | `GET /courses/:course_id/quizzes` **(verify)**; assignment has `quiz_id`, `submission_types` |

Assignment fields we use: `name`, `description` (HTML), `due_at`, `unlock_at`, `lock_at`, `points_possible`, `submission_types`, `assignment_group_id`, `rubric` (array), `rubric_settings`, `use_rubric_for_grading`, `has_overrides`, `all_dates`.

`override_assignment_dates` defaults to true, so a student's `due_at` already reflects their personal overrides.

**The "official notification" is usually not one field.** Plan for all of these and treat them as candidate sources, merged:

1. The assignment's `description` HTML (convert to text).
2. **Files linked inside that HTML.** Scan the HTML for `/courses/<id>/files/<file_id>` and `data-api-endpoint` attributes, then fetch each via the Files API. A PDF/Word notification attached this way is the most likely real-world case.
3. A linked Page (`/courses/<id>/pages/<slug>`).
4. Course syllabus (`syllabus_body`).

**Multi-part tasks** (Part A booklet / Part B test): Canvas may model these as *two assignments* or as *one assignment with parts described in the document*. Support both: detect via the notification text and via sibling assignments with matching name stems. Each part gets its own due date in the Confirm screen.

### Stage 2 — "Confirm": field mapping (what's from Canvas, what's parsed)

| Confirm-screen field | Source | Note |
|---|---|---|
| Assessment name | `assignment.name` | direct |
| Course | `course.name` | direct |
| Due date(s) per part | `due_at` / `all_dates` **and** parsed from notification text | reconcile; show conflicts to the student |
| Weighting % | `assignment_group.group_weight` if weighting is on, otherwise **parsed from the notification text** | often only in the document |
| AI-use policy | **Parsed from text only** — no Canvas field exists | flag as extracted, always editable |
| Topics / keywords | **`assignment.rubric[]`** criteria | see below |
| Student-chosen sub-topic | User input | unchanged from handoff |

**Rubric shape** (inside `assignment.rubric`, and via `GET /courses/:id/rubrics/:id`):

```
criterion { id, description, long_description, points,
            criterion_use_range, ratings[ {id, description, long_description, points} ] }
```

Keyword source priority: `criterion.description` (the label) → `criterion.long_description` → the top rating's `long_description` (usually the richest wording). Criteria that read as generic skills ("communicates using a range of examples") should be tagged `type: "skill"` and handled by the later smarter-matching step, not keyword matching (handoff §3).

If the assignment has no attached rubric, `rubric` is absent. Fall back to parsing the criteria out of the notification document, as with the manual-upload path. **Both paths should end in the same `ParsedAssessment` object** so Confirm and everything after is source-agnostic.

### Stage 3 — "Searching": pull and index course content

```
A. Structure      GET /courses/:id/modules?include[]=items&include[]=content_details&per_page=100
                  (follow pagination on modules AND on items — items can page separately)
B. Pages          GET /courses/:id/pages?include[]=body&per_page=100     (all pages, also unmoduled)
                  or GET /courses/:id/pages/:url_or_id for one
C. Files          GET /courses/:id/files?per_page=100   → metadata
                  GET /files/:id                         → fresh signed `url`, then download
D. Video captions GET /courses/:id/media_objects?exclude[]=sources
                  GET /media_objects/:media_object_id/media_tracks?include[]=content
                  GET /media_attachments/:attachment_id/media_tracks?include[]=content
```

Module item `type` decides how to handle each item:

| Item `type` | Action |
|---|---|
| `Page` | fetch by `page_url`, HTML → text |
| `File` | fetch by `content_id`; extract by mime type |
| `ExternalUrl` | keep as a link, not matched in MVP |
| `ExternalTool` | usually a video/lecture platform → link only (see risk below) |
| `Assignment` / `Quiz` / `Discussion` | skip for content matching; assignments are the assessments themselves |
| `SubHeader` | use as a **topic/week label** for the items that follow |

Module `name`, `position` and `unlock_at` give the week/topic sort for the folder. The concept plan's reality check says module names can't be trusted alone, so treat them as a *hint* that boosts the score, not a filter.

**Text extraction by type** (backend workers, not the browser):

| Type | Approach |
|---|---|
| Page/HTML, `description` | HTML → text (strip tags, keep headings) |
| PDF | text-layer extraction; no text layer → mark `needs_ocr`, skip in MVP |
| DOCX | unzip → `word/document.xml` |
| PPTX | unzip → `ppt/slides/*.xml` (expect thin text) |
| Video captions | `media_tracks` → `webvtt_content`/`content` → strip timestamps, **keep timestamps as metadata** so the folder can deep-link into the video |
| Images / scans | not MVP |

**Caption reality check (biggest technical risk):** the media endpoints cover Canvas-native media. Many institutions host lectures in Studio, Panopto, Echo360, YuJa, etc., embedded via `ExternalTool` items or iframes. Those platforms have their own APIs and Canvas won't expose their captions. **Before building the caption path, check a real course** to see which kind of video it actually uses. That determines whether the video matching is one endpoint or a per-vendor integration. Also confirm a *student* token can list `media_objects` (the docs describe the default list as media the requesting user created) **(verify)**.

### Stage 4 — "Folder": nothing new from Canvas

The folder is Waypoint's own data. Each item stores a `canvas_url` (`html_url`) so "Open in Canvas" always works. Always include the source notification (handoff §3.6).

---

## 6. `CanvasClient` — the one module that talks to Canvas

Every operational rule from the docs lives here, once.

```ts
class CanvasClient {
  constructor(creds: CanvasCredentials, opts?: { fetch?: typeof fetch })

  // core
  request<T>(path: string, init?): Promise<T>              // adds Bearer, handles 401→refresh→retry once
  paginate<T>(path: string, params?): AsyncIterable<T>     // follows Link rel="next"

  // typed helpers used by the pipeline
  listCourses(): Promise<Course[]>
  listAssignments(courseId, opts): Promise<Assignment[]>
  getAssignment(courseId, id): Promise<Assignment>
  listModules(courseId): Promise<Module[]>                 // include items, paginates both levels
  getPage(courseId, urlOrId): Promise<Page>
  listPages(courseId): Promise<Page[]>
  getFile(fileId): Promise<CanvasFile>
  downloadFile(file): Promise<Buffer>                      // uses file.url immediately; never persisted
  listMediaObjects(courseId): Promise<MediaObject[]>
  getMediaTracks(mediaObjectId): Promise<MediaTrack[]>
}
```

Behaviours it must implement (all from the docs):

- **Pagination:** default page size is **10**. Always pass `per_page=100` (there is an unspecified cap) and follow the `Link` header's `rel="next"`. Treat the URLs as opaque and don't build them by hand. Header names are case-insensitive.
- **Rate limiting:** a leaky-bucket quota. Each request has a cost (`X-Request-Cost`); `X-Rate-Limit-Remaining` reports what's left; exhaustion returns a rate-limit error. **Prefer sequential requests** (parallel ones take a pre-flight penalty). Use a small concurrency limit (2–3) for file downloads, back off with jitter on rate-limit responses, and note that **each user's token has its own quota**, so one heavy user doesn't starve others.
- **Auth retry:** on `401`, refresh once and retry; if it still fails, surface `NEEDS_REAUTH` to the UI.
- **Signed URLs:** the `url` on a File is pre-signed and expires. Fetch `GET /files/:id` right before downloading; never store the URL.
- **`locked_for_user`:** files, pages and module items can be locked or unpublished. A student token only sees what the student can see. Respect `locked_for_user` and skip cleanly; show these under the "not matched / unavailable" note.
- **Typed errors:** `NEEDS_REAUTH`, `FORBIDDEN_SCOPE`, `RATE_LIMITED`, `NOT_FOUND`, `LOCKED`, `NETWORK`. The UI turns these into human messages.

`MockCanvasClient` implements the same interface from JSON fixtures (a saved real course, with names anonymised). It keeps the whole UI/matcher developable while API access is blocked and gives you a deterministic test suite.

---

## 7. Backend module layout

```
server/
  canvas/
    client.ts            CanvasClient (above)
    mockClient.ts        fixture-backed implementation
    auth/
      personalToken.ts   Mode A (dev only)
      oauth.ts           Mode B  (/auth/canvas/start, /auth/canvas/callback, refresh)
      lti.ts             Mode C  (later)
    types.ts             Course, Assignment, Rubric, Module, ModuleItem, Page, File, MediaTrack
  ingest/
    notification.ts      assemble the notification from description + linked files/pages
    rubric.ts            rubric[] → Criterion[] (keyword vs skill)
    course.ts            crawl a course → ContentItem[] (incremental; see §7 caching)
    extract/             html.ts · pdf.ts · docx.ts · pptx.ts · vtt.ts
  parse/
    assessment.ts        text → ParsedAssessment (parts, dates, weighting, AI policy)
  match/
    keyword.ts           criterion terms × content text → scored matches + "why" spans
    (skill.ts later)
  folder/
    build.ts             matches → topic/week sections, always + the notification item
    export.ts            folder → plain-text bundle for NotebookLM
  api/                   routes the front end calls (sessions, courses, assessments, folders)
  db/                    schema + migrations
  jobs/                  background queue for crawl/extract (these take time)
```

The front end keeps the four-stage state machine (**Upload → Confirm → Searching → Folder**) from the prototype. Stage 3 becomes a **polled or streamed job** because a crawl of a real course is many sequential API calls plus file extraction.

### Data model (sketch)

```
canvas_instance   id, base_url, client_id, client_secret_enc, name
user              id, canvas_instance_id, canvas_user_id, display_name
canvas_token      user_id, access_token_enc, refresh_token_enc, expires_at
course            id, canvas_instance_id, canvas_course_id, name, term
assessment        id, course_id, canvas_assignment_id NULL, source ('canvas'|'photo'|'document'),
                  parsed_json, confirmed_at
content_item      id, course_id, canvas_type, canvas_id, title, html_url, module_name, position,
                  canvas_updated_at, text, text_hash, status ('ok'|'locked'|'no_text'|'needs_ocr'|'no_captions')
folder            id, assessment_id, user_id
folder_item       folder_id, content_item_id, topic, score, why_json   -- why = matched term + span
```

Canvas IDs are only unique **within an instance**, hence `canvas_instance_id` on everything. That is what keeps the multi-institution option open.

### Caching / incremental crawl

- Key extracted text by `(instance, type, canvas_id, updated_at)`. Re-crawl only when `updated_at` changed (Pages and Files both carry `updated_at`).
- Extracted text is shared across users of the same course **only if** the item is visible to all students. Content restricted per section or per user must be stored per user. Default to per-user until you've decided the privacy model (§10).

---

## 8. Scopes and setup to request from the institution

For the pilot request (Phase 3). Canvas scopes take the form `url:GET|/api/v1/...`. All **read-only**. Match these against the developer-key scope picker, which groups them by resource **(verify)**:

```
url:GET|/api/v1/users/:id                        (users/self)
url:GET|/api/v1/courses
url:GET|/api/v1/courses/:id
url:GET|/api/v1/courses/:course_id/assignments
url:GET|/api/v1/courses/:course_id/assignments/:id
url:GET|/api/v1/courses/:course_id/assignment_groups
url:GET|/api/v1/courses/:course_id/rubrics
url:GET|/api/v1/courses/:course_id/rubrics/:id
url:GET|/api/v1/courses/:course_id/modules
url:GET|/api/v1/courses/:course_id/modules/:module_id/items
url:GET|/api/v1/courses/:course_id/pages
url:GET|/api/v1/courses/:course_id/pages/:url_or_id
url:GET|/api/v1/courses/:course_id/files
url:GET|/api/v1/files/:id
url:GET|/api/v1/courses/:course_id/folders
url:GET|/api/v1/courses/:course_id/media_objects
url:GET|/api/v1/media_objects/:media_object_id/media_tracks
url:GET|/api/v1/media_attachments/:attachment_id/media_tracks
```

Caveat on the file-download URL: downloading uses the signed `url`, which comes from `GET /files/:id`. Confirm on a real key that this download works with only the scopes above.

**What the pitch to eLearning/IT should contain:**

1. A working demo on sample data (the prototype plus the mock-client version).
2. The scope list above — **read-only, student-visible data only, no write scopes, no grades/submissions**. That last point matters for the privacy conversation.
3. Redirect URI(s) for the OAuth callback.
4. Where data is stored, who can see it, retention, and deletion on request (they'll ask about FERPA-style obligations **(verify the specific law for your jurisdiction)**).
5. Whether they'd rather install it as an LTI tool for pilot governance reasons.

---

## 9. Phased build plan

| Phase | Goal | Done when |
|---|---|---|
| **0** | Diagnose the token (§3) | `GET /users/self` returns your profile, **or** you know exactly who to ask |
| **1** | `CanvasClient` + `MockClient`; read-only CLI script that prints, for one of your own courses: assignments with rubrics, modules, pages, files, captions | The script runs against real data (via personal token) *or* fixtures |
| **2** | Ingest + parse + match, still against Mode A / fixtures. Wire the four-stage UI to it | Pick course → assessment → confirm → folder works end to end |
| **3** | Institutional request (§8); implement Mode B OAuth, encrypted token store, refresh | A second person can log in with Canvas and see *their* courses |
| **4** | Pilot hardening: incremental crawl, background jobs, error states, data-retention/delete-my-data | Survives a real term of use |
| **5 (maybe)** | LTI 1.3 launch layer (Mode C) | Only if the pilot wants launch-from-Canvas |

Phase 1 doubles as your **reality check on the two biggest unknowns**: which video platform the course uses, and whether the notification is a description, a linked file, or both.

---

## 10. Privacy & policy points that affect the code

- **Least privilege:** read-only scopes, student role only. Never request or store grades, submissions, or other students' data.
- **Encrypt tokens at rest**; never log them; never put them in URLs (the docs say query-string tokens are discouraged).
- **Store the minimum:** extracted text is derived from course materials and may be copyrighted or restricted. Decide retention up front (e.g. delete a folder's text N days after the assessment closes) and provide a "delete my data / disconnect Canvas" action that revokes the token and purges rows.
- **Respect the student's own visibility:** content a student can't see in Canvas must never appear in Waypoint. Using each student's own token (not an instructor or service token) enforces this for free, which is a strong argument for Mode B.
- **The export feature** (text for NotebookLM) sends course material to a third party under the *student's* action. Worth a one-line notice in the UI, and worth mentioning to the institution.
- **Never ask users to paste a token.** The API policy calls that a violation.

---

## 11. Open questions

1. **Why is the token invalid?** (§3: network vs. instance vs. key restriction.)
2. **Which video platform do your courses use,** and do students' tokens see its captions via Canvas at all?
3. **Where does the notification live in practice** (description, attached PDF, page)? Check 3–4 real assessments from different courses.
4. **How are multi-part tasks modelled** in your Canvas courses (two assignments or one)?
5. **Is weighting in Canvas** (assignment-group weights) **or only in the document?**
6. **Will the institution issue an API developer key,** or push toward LTI? And can an LTI-launched user skip the OAuth consent screen?
7. **Shared vs. per-user extracted text** (§7 caching): depends on how much per-section restricted content exists.
8. **Do you want a Canvas GraphQL path later?** Canvas also exposes GraphQL, which can cut round trips for the crawl. I haven't researched it; REST is enough for the MVP.

---

## 12. Sources

Official Instructure documentation:

- [OAuth2 Overview](https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth) — auth-code flow, token endpoint, 1-hour expiry, refresh, manual-token policy
- [Developer Keys](https://developerdocs.instructure.com/services/canvas/oauth2/file.developer_keys) — who issues keys, scope enforcement, per-account validity
- [Throttling](https://developerdocs.instructure.com/services/canvas/basics/file.throttling) — quota model and headers
- [Pagination](https://developerdocs.instructure.com/services/canvas/basics/file.pagination) — `Link` header, `per_page`
- [LTI introduction](https://developerdocs.instructure.com/services/canvas/external-tools/lti/file.tools_intro) — LTI 1.3, LTI Advantage, placements
- [LTI 1.3 launch overview](https://developerdocs.instructure.com/services/canvas/external-tools/lti/file.lti_launch_overview) — OIDC flow, platform storage
- [LTI developer key configuration](https://developerdocs.instructure.com/services/canvas/external-tools/lti/file.lti_dev_key_config) — key JSON, privacy levels
- [Courses](https://developerdocs.instructure.com/services/canvas/resources/courses) · [Assignments](https://developerdocs.instructure.com/services/canvas/resources/assignments) · [Rubrics](https://developerdocs.instructure.com/services/canvas/resources/rubrics) · [Modules](https://developerdocs.instructure.com/services/canvas/resources/modules) · [Pages](https://developerdocs.instructure.com/services/canvas/resources/pages) · [Files](https://developerdocs.instructure.com/services/canvas/resources/files) · [Media objects](https://developerdocs.instructure.com/services/canvas/resources/media_objects)
- [Instructure Canvas API Policy](https://www.instructure.com/policies/canvas-api-policy) — I could only reach this via search results, not read it in full; read it directly before the pilot request.

Other:

- [Community thread: "Canvas API 401 Error Using a new Access Token"](https://community.canvaslms.com/t5/Canvas-Question-Forum/Canvas-API-401-Error-Using-a-new-Access-Token/m-p/549889) — the source for the deleted-key / expiry causes in §3 (community reports, unverified)
- [University of Missouri system's "Canvas API Developer Key policy"](https://tdx.umsystem.edu/TDClient/66/MOOnline/KB/ArticleDet?ID=1852) — an example of how an institution gates developer keys, useful for anticipating your IT team's questions
