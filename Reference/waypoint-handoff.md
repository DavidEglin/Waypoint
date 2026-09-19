# Waypoint — Study Folder App: Project Handoff

This doc has everything we've worked out so far for **Waypoint**, so you can pick it up straight away in Claude Code / VS Code. It covers the problem, how the app should work, the design system, and all the little decisions and ideas we talked through.

---

## 1. The Problem

Students' study materials are scattered everywhere. They don't know what's actually relevant to a specific assessment, and they end up leaving prep too late because they can't quickly figure out what to study.

**Waypoint's job:** automatically pull together everything relevant to one assessment into a single study folder, so the student doesn't have to go hunting.

---

## 2. Who Uses It

- **Students only.** No teacher/instructor login, setup, or dashboard. This was an early idea (instructor view-only access) but it's been dropped — the whole product is built around the student experience.
- Built for a higher-ed context, but the reference example we used to test it was a Year 8 Geography assessment — so it needs to be flexible enough for different education levels.

---

## 3. Core Workflow (MVP)

This is the main loop the app needs to support:

1. **Get the assessment notification into the app** (two ways, side by side — neither replaces the other):
   - **Canvas auto-pull** — pulls the official assessment notification/rubric straight from the LMS.
   - **Manual upload by the student** — either:
     - a **photo** of the notification (OCR'd), or
     - a **document** upload (PDF/Word) — parsed directly, no OCR needed.
2. **Show the student what was read, and get confirmation.** Before searching for anything, the app must display what it extracted (assessment name, course, due dates, weighting, AI-use policy, topics/keywords) and let the student **edit/correct any field** if it got something wrong. It should not start searching until the student confirms.
3. **Parse the notification for topics/keywords.** Some rubric criteria are simple keyword matches (e.g. "atmospheric circulation"), but some are **skill-based/generic** (e.g. "communicates using a range of examples and geographical concepts") — these are harder to match on keywords alone and need a smarter approach eventually.
4. **Match course content to those topics.** Content comes from two sources:
   - Manual upload
   - LMS auto-pull (Canvas)
5. **Auto-generate the study folder**, organised by topic/week, built from the LMS course structure. Content is auto-tagged and sorted — no manual filing by the student needed.
6. **Always include a copy of the original assessment notification itself** in the folder (as a reference/fallback item, alongside the matched content) — this is what the due dates/weighting/AI-policy info on the folder's header actually gets pulled from, and the student can double check the source at any time.

### Handling messier real-world cases
From testing against a real assessment notification, a few things came up that the app needs to account for:

- **Multiple due dates** — a task can have more than one part (e.g. Part A: research booklet, Part B: in-class test), each with its own due date. The folder needs to show all of them, not just one.
- **Task weighting %** — needs to be shown (e.g. "30% of course grade").
- **AI-usage policy** — schools/courses often have specific rules about AI use for a task (e.g. "idea generation only, before Part A — none during Part B"). This needs to be extracted and shown clearly, since it can differ by part of the task.
- **Student-chosen sub-topics** — some tasks let the student pick their own angle before research starts (e.g. "choose coffee OR chocolate"). This affects what content should even be searched for, so the flow may need a step where the student states their chosen sub-topic before matching runs.

### MVP scope
- Supports a mix of assessment types from day one: exams, essays, presentations (not just one type).
- Folder structure auto-generated from the course info pulled from the LMS.
- Content matched and auto-sorted — no manual tagging needed by the student.

---

## 4. Later / Future Features (not MVP — just capture the idea for now)

These are on the roadmap but we've deliberately parked the detailed design for when building in Claude Code:

- **Calendar feature:** take the due date from the notification, drop it into a calendar, and have the app work backwards to suggest a few study session dates.
- **Chat interface (tied to the calendar):** student can type simple commands like *"I have soccer on Wednesday"* and the app avoids booking study sessions on that day.
- **Audio/podcast study option:** not being built in-house. Instead, the app should let the student **export/package the study folder content as text**, ready to hand off to an external tool like NotebookLM to generate audio from. (This is reflected in the prototype's "Export folder" button.)

---

## 5. LMS / Integration Notes

- Institution's LMS is **Canvas**.
- A personal Canvas API access token has been generated and prototyping has started, but **it isn't validating yet** — this needs a proper coding environment (rather than the chat-based prototype) to debug and connect properly.
- No existing relationship yet with the institution's IT/eLearning team.
- Scale ambition (single institution vs. multiple institutions) is still undecided — don't lock in assumptions that only work for one Canvas instance.

**Build order decided:** start with a **clickable prototype of the student view using sample/made-up data** (this is what the design below is from) — then connect it to live Canvas data once in Claude Code.

---

## 6. Design Language / Visual System

The prototype (built as an HTML/CSS/JS mockup, nicknamed **"Waypoint"**) establishes the visual language. Full code for reference is attached alongside this doc — here's the system distilled:

### Look & feel
Calm, earthy, "trail guide" aesthetic — greens and warm ochre accents, soft rounded cards, generous whitespace. Feels more like a nature journal / field notebook than a typical SaaS dashboard.

### Fonts
- **Headings:** `Spectral` (serif, weight 500/600) — used for the app name, page titles, section titles.
- **Body/UI text:** `IBM Plex Sans` (400/500/600).
- **Numbers, labels, metadata, "kicker" text:** `IBM Plex Mono` (500) — gives a nice technical/precise feel to stats and tags.
- Loaded via Google Fonts.

### Color system (CSS custom properties, with full dark mode support)

**Light mode:**
| Token | Value | Use |
|---|---|---|
| `--bg` | `#eef2ee` | page background |
| `--surface` | `#ffffff` | cards |
| `--surface-sunken` | `#e4e9e3` | recessed panels (dropzones, part boxes) |
| `--ink` | `#17241d` | primary text |
| `--ink-soft` | `#46564c` | secondary text |
| `--ink-faint` | `#74857a` | tertiary/meta text |
| `--line` | `#cdd6c9` | borders |
| `--accent` | `#2f6b53` | primary green — buttons, links, highlights |
| `--accent-ink` | `#ffffff` | text on accent |
| `--accent-soft` | `#e2ede6` | light green backgrounds (icon chips, matched-topic highlight) |
| `--ochre` | `#a86a2a` | warm accent — used for notifications/documents/AI-policy callouts |
| `--ochre-soft` | `#f3e6d3` | light ochre background |

**Dark mode** mirrors this with a deep green-black background (`#131b16`) and mint accent (`#6fbb9a`) — fully defined, both via `prefers-color-scheme` and a manual `data-theme="dark"` override.

### Key UI patterns
- **Cards** everywhere: white/dark surface, 1px border, soft shadow, rounded corners (~11–14px radius).
- **Kicker labels** (small uppercase mono text in accent green) above headings — e.g. "STEP 1 OF 3", "STUDY FOLDER · AUTO-BUILT".
- **Chips** (pill-shaped tags) for topics/keywords matched from the rubric.
- **Expandable list items** — each matched content item is a collapsible row with an icon, title, and metadata line; expanding it reveals a "Why this is here" explanation showing which rubric term/keyword it matched on, with the matched term `<mark>`highlighted`</mark>`.
- **Icons** are minimal inline SVGs (document, video, captions, etc.) — no icon library, kept lightweight.
- **Stat row** at the top of the folder view — quick numbers (items matched, topics, items left out, weighting %) in mono font.
- **"Parts" row** — shows each part of a multi-part task (e.g. Part A / Part B) as its own small card with due date.
- **AI-use policy callout** — a distinct ochre-tinted banner, separate from the general rubric info, so it stands out.
- **"Not matched" note** — content that couldn't be auto-matched (e.g. a video with no captions) is still mentioned at the bottom, so the student knows it exists even though it wasn't pulled in.
- **Toast notifications** for confirmations (e.g. "Exported 8 items as text").

### The 4-stage flow (as built in the prototype)
The prototype models the whole workflow as four screens/stages the student moves through:

1. **`panelUpload`** — "Add an assessment notification" — two buttons side by side: "Use sample photo" / "Use sample document" (in the real app: take a photo / upload a file).
2. **`panelConfirm`** — "Does this look right?" — shows every extracted field (assessment name, course, each part's due date, weighting, AI-use policy, topics found) as **editable** fields the student can click to correct, before confirming.
3. **`panelSearching`** — a simple loading state while the app searches the course for matching content.
4. **`panelFolder`** — the finished study folder: header with assessment info/stats/AI-policy, then content grouped into topic sections (including the always-present "Assessment Notification" section), then a footer with the export-to-text action.

This stage structure (**Upload → Confirm → Searching → Folder**) is a good scaffold to carry into the real app's navigation/state machine.

---

## 7. Open Questions / Things Still Undecided

- Single institution vs. multi-institution scale.
- How to handle skill-based (non-keyword) rubric criteria in matching.
- Exact mechanics of the calendar + chat scheduling features (deliberately left for later).
- Why the Canvas API token isn't validating yet — needs debugging in a proper dev environment.

---

## 8. Suggested Next Steps in Claude Code

1. Set up the project (frontend framework of your choice — the prototype is plain HTML/CSS/JS, so a lightweight framework like React/Vite would translate it easily).
2. Port the prototype's design system (fonts, colors, components) into your chosen framework/styling approach — the reference HTML file has all of this working already, including dark mode.
3. Debug the Canvas API token/connection.
4. Wire up the Upload → Confirm → Searching → Folder flow to real data instead of the sample photo/document buttons.
5. Build out the keyword-matching logic (starting simple, then handling the skill-based criteria case).
