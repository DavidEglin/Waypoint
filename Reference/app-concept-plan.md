# App Concept Plan (Draft v1)

## The Problem
Students in higher ed struggle to prepare for assessments because:
- Their materials are scattered across too many places
- They don't know what content is actually relevant to a given assessment
- They leave study prep too late and lack structure to start

## The Core Idea
A web app that automatically pulls together everything a student needs to
study for a specific assessment, based on what that assessment is actually
marking them on — not just "everything from the course."

## Who It's For
- **Primary users:** university/college students
- **Secondary users:** instructors (who set up courses/assessments)

## The Core Workflow
1. **Input the assessment** — app pulls the official assessment
   notification/rubric/marking criteria directly from the LMS.
2. **Parse the rubric** — the app reads the marking criteria and identifies
   the key topics/keywords it's testing.
3. **Match content** — the app scans the course content (student-uploaded
   material + LMS-pulled material) and finds what matches those topics.
4. **Build the folder** — matched content gets pulled into one organized
   study folder for that assessment.
5. **Study however suits them** — students can read directly in-app, or
   export the folder's content to feed into another tool (e.g. NotebookLM)
   to generate a podcast/audio version for listening-based study.

## Content Sources
- Manual upload (notes, files, links) — by student or instructor
- Auto-pull from LMS (Canvas, Moodle, etc.)

## Platform
- Web app (browser-based)

## Confirmed Decisions So Far
| Question | Decision |
|---|---|
| Content sources | Both manual upload AND LMS auto-pull |
| Main pain point | Scattered materials + lack of clarity + late starts |
| Access | Web app |
| Matching method | Parse rubric/marking criteria, match by keyword/topic |
| Audio/podcast feature | NOT built in-house — export/package for external tools (e.g. NotebookLM) |
| Assessment input | Official assessment notification/rubric, held on the LMS (auto-pulled, not manually typed) |
| Folder contents (MVP) | Auto-tag/sort matched content by topic/week |
| Folder structure setup | Auto-generated from LMS course info |
| Assessment types (MVP) | Mix of types supported from day one (exams, essays, presentations) |
| Instructor override (MVP) | View-only — no editing matches yet, fixing bad matches is a later feature |

## MVP Feature List (First Version)
1. App pulls the official assessment notification/rubric from the LMS
2. App parses the rubric for key topics/keywords
3. App pulls in course content from LMS + manual uploads
4. App matches content to the assessment's topics/keywords (text-based content + captioned video only — see Content Matching below)
5. Matched content is organized into a folder, auto-tagged/sorted by topic/week
6. Student can export the folder's content for use in external tools (e.g. NotebookLM for audio)

## Later / "Nice to Have" Features (Not MVP)
- Summarize content automatically
- Auto-generate flashcards or quizzes
- Instructor manual override/adjustment of auto-matched content
- Built-in audio/podcast generation (instead of exporting elsewhere)
- Auto-generating transcripts for videos without existing captions

## LMS Integration Strategy
- **LMS in use:** Canvas
- **Current IT/eLearning relationship:** None yet
- **Scale ambition:** Undecided — depends on how the pilot goes

**Authentication note:** the personal access token is only for the prototype
phase (testing with your own account). Real users (students, other
instructors) would never generate or handle a token themselves — the finished
app would use either Canvas's "Log in with Canvas" (OAuth) flow, or, if built
as an LTI tool, no separate login step at all.

**Phased approach:**
1. **Prototype** — build using a personal Canvas API access token (instructor's
   own login), scoped to courses already taught. No institutional approval
   needed at this stage. *(Note: personal tokens are a developer/testing
   shortcut only — see "Real User Access" below.)*
2. **Validate** — get the prototype working well enough to demonstrate it
   actually does the job.
3. **Pilot** — bring the working demo to the institution's IT/eLearning team
   to request access for real student use (broader API access and/or LTI).
4. **Scale (maybe)** — if it proves valuable, consider building on LTI
   (Learning Tools Interoperability) for portability to other institutions
   or LMS platforms. Decide this later, not now.

**Real User Access (not personal tokens):**
Personal access tokens are only for this prototype/testing phase — real
students and instructors would never see or handle a token. The actual app
would use either:
- **OAuth login** ("Sign in with Canvas" — like "Sign in with Google") so
  users just click to log in and approve access, or
- **LTI** — the app appears as a link inside Canvas itself; clicking it hands
  over access automatically.

Both of these require the institutional approval covered in Phase 3.

**Current status:** personal access token generated, but repeatedly returns
"Invalid access token" even with a fresh token, correct domain, and careful
copying. Leading theory: institutional block on API access at the network or
Canvas-instance level. Not yet resolved — parked for now.

## Student User Flow (Draft)
1. **Log in through Canvas** — existing login, no separate account needed
2. **See their courses** — pulled automatically from Canvas
3. **See upcoming assessments** — pulled from official assessment notifications/rubrics
4. **Open a study folder for an assessment** — already matched to that rubric
5. **Browse the organized content** — auto-tagged/sorted by topic/week
6. **Export for other study styles** — e.g. feed into NotebookLM for audio

*(Still to confirm: does the folder generate automatically when an assessment
is posted, or only when the student opens/requests it?)*

## Instructor Setup Flow (Draft)
1. **Log in through Canvas** — same OAuth approach as students
2. **Choose which courses to turn it on for**
3. **App pulls in content, assessments, and rubrics automatically**
4. **Folders and matching happen automatically** — no manual setup needed
5. **Instructor sees a read-only overview** — confirms it's working, but
   can't edit/override matches in the MVP

## Reality-Check Findings (from manually reviewing a real course)
- **Rubric structure:** Clear categories/criteria with labels — good sign,
  parsing rubrics for topics/keywords is realistic.
- **Content organization:** Somewhat organized, but not consistent — this
  means matching **can't rely on folder/module names alone**. The app needs
  to look inside the actual content (file/page text) to find matching
  topics, not just trust how things are filed.
- **Content mix:** A real mix of text and video, with captions on videos
  only sometimes.

## Content Matching - How It Works
1. Pull raw content from Canvas (pages, files, slides, etc.)
2. Extract the readable text from it
3. Compare that text against the rubric's keywords/topics
4. Pull the strongest matches into the student's folder

**How well this works depends on content type:**
| Content type | Matchable? |
|---|---|
| Pages, Word docs, PDFs | Yes — text is directly readable |
| Slides (PowerPoint) | Yes, but often thin text |
| Videos WITH captions/transcripts | Yes — caption text is searchable |
| Videos WITHOUT captions | No — can't be matched (for now) |
| Scanned images/documents | No — would need OCR (not MVP) |

**MVP scoping decision:** Match against text-based content and videos that
already have captions. Videos without captions are left out of matching for
now (still visible in the course, just not auto-pulled into folders).
Auto-generating transcripts for uncaptioned videos is a "later" feature.

## Open Questions (to figure out next)
- Rubrics vary a lot in format and wording — how should the app handle
  vague or unusually-worded rubrics that don't match content well?
- What does a student's view of a "folder" actually look like (list of files?
  reading view? something else)?
- Any data privacy/institutional approval considerations for pulling student
  content and LMS data?
- Does the folder generate automatically when an assessment is posted, or
  only when the student opens/requests it?
