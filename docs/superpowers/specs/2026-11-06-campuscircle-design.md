# CampusCircle Design Spec

Date: 2026-11-06
Status: Draft for team review

## 1. Summary

CampusCircle is a multi-college student platform with one AI agent that acts across every module using shared student context.

Pitch line: one agent that knows your campus and acts for you.

The platform keeps every student-facing module from the master feature list. Depth is concentrated in three areas: the agent, Academics, and Campus Issues. All other student-facing modules are thin but working.

## 2. Goals and constraints

**Goal:** a project that can be submitted to several hackathons and places well on problem clarity, technical depth, demo impact, and evidence of real users.

**Constraints**
- Team of 3-4 people.
- No hackathons chosen yet. The design assumes online hackathons that allow existing code. The team confirms this rule for each event before registering.
- No fixed deadline yet, so milestones are ordered, not dated.

**Success criteria**
- The 3-minute demo in section 10 runs end to end on the deployed site with no faked screens.
- A pilot of about 30 real students produces real usage numbers.
- A student of one college cannot read another college's data, directly or through the agent.
- No agent write action runs without the student's approval.

**Non-goals (roadmap slides only)**
- Super Admin dashboard.
- Subscriptions and plans.
- Business partner dashboard.
- Student Offers with real partners.
- Backup and recovery tooling beyond the Supabase defaults.
- Native mobile apps.

## 3. Scope tiers

Rule: nothing on screen is fake. A feature that does not work is not shown.

**Deep:** complete flows, tests, and agent tools.
- Unified agent.
- Academics.
- Campus Issues.

**Thin:** one working happy path with real data, and no advanced options.

| Module | Thin scope | Agent tool |
| --- | --- | --- |
| Auth and profiles | College email sign-in, profile, skills, role | `get_my_profile` |
| Feed | Text and image posts, comments, likes, reporting | None |
| Societies | Society page, announcements, join request | None |
| Events | Listing, registration, calendar view | `search_events`, `register_for_event` |
| Messaging | One-to-one chat through Supabase Realtime | `send_message` |
| Notifications | In-app notifications only | None |
| Networking and mentorship | Search by skill, mentor flag on profile, mentorship request | `find_mentor`, `find_teammates`, `request_mentorship` |
| Marketplace | Listings with images, search, contact seller | `search_listings` |
| College admin | Verify students, publish announcements, moderate reports | None |

The tools `register_for_event`, `send_message`, and `request_mentorship` are write tools. All other tools in this table are read tools.

## 4. Architecture

- **Web app:** Next.js with TypeScript, deployed on Vercel. The app is responsive, so it works on phones in the pilot.
- **Data:** Supabase provides Postgres, Auth, Storage, Realtime, and pgvector.
- **Background jobs:** `pg_cron` runs escalation checks and the root-cause job.
- **AI:** Claude API with tool use. The model is set in configuration. Defaults are `claude-opus-5-5` for the agent and `claude-haiku-5-5` for complaint classification.
- **Embeddings:** the `gte-small` model in Supabase Edge Functions, stored in pgvector. This avoids a second AI vendor.

### Repository layout

```
src/app/            Pages and API routes
src/modules/<name>/ One folder per module: queries, UI, and agent tools
src/agent/          Agent loop, tool registry, approval logic, run logging
supabase/migrations Schema and Row Level Security policies
tests/              RLS tests, agent evals, end-to-end tests
```

Each module owns its tables and registers its tools in `src/modules/<name>/tools.ts`. The agent core does not import module internals. Team members can therefore work in parallel.

### Multi-tenancy

- Every tenant table has a `college_id` column.
- Row Level Security policies limit reads and writes to the signed-in user's college.
- The `college_id` and role come from the `profiles` table through a security-definer helper function, not from client input.
- Cross-college features are out of scope for the first release.

### Roles

`student`, `society_admin`, `authority`, `college_admin`.

An `authority` user belongs to one department, such as hostel, maintenance, or IT. An `is_department_head` flag on the profile marks the head of that department.

## 5. Agent design

### Loop

1. The student sends a message from any page.
2. The server runs the Claude tool-use loop with the tools that the student's role allows.
3. Read tools run immediately.
4. A write tool does not run. It creates a row in `agent_pending_actions` and the UI shows an approval card.
5. The action runs only when the student approves it.
6. Each step is stored in `agent_steps`, and the UI shows it as a visible action trace.

The loop stops after 12 tool calls and reports what it finished and what it did not.

### Safety rules

These rules are enforced in the tool executor, not in the prompt.

- **Permissions:** tools use a Supabase client that carries the student's own JWT, so RLS applies to every agent query. The agent never uses the service role key.
- **Approval:** each tool declares `kind: "read" | "write"`. The executor refuses to run a write tool without an approved `agent_pending_actions` row. Approval requires a request from the same signed-in student.
- **Untrusted content:** notes, PDFs, listings, and messages can contain text that tries to steer the agent. Tool results are marked as data in the prompt. The approval step is the main protection, because injected text cannot approve an action.
- **Cost limit:** each student has a daily agent run limit.

### Deep tools

| Tool | Kind | Purpose |
| --- | --- | --- |
| `get_marks` | read | Semester and subject results |
| `get_weak_subjects` | read | Subjects below the student's average, with trend |
| `search_notes` | read | Vector search across notes |
| `get_past_papers` | read | Papers by subject and year |
| `get_timetable` | read | Classes and exam dates |
| `create_study_plan` | write | Saves a dated plan and reminders |
| `file_complaint` | write | Files a Campus Issue |
| `get_my_complaints` | read | Status of the student's complaints |
| `get_campus_status` | read | Open issues by location, without reporter data |

### Errors

- If a tool fails, the agent receives the error and tells the student what did not work. It does not invent a result.
- If the Claude API fails, the UI shows a retry option. All non-agent pages keep working.
- If an approved action fails, the pending action is marked `failed` and the card shows the reason.

## 6. Academics (deep)

**Data:** `subjects`, `semester_results`, `subject_results`, `notes`, `note_chunks` (with embeddings), `past_papers`, `timetable_entries`, `study_plans`, `study_plan_items`.

**Flows**
- Students enter marks manually. SGPA and CGPA are calculated from credits and grade points. Each college sets its own grade scale.
- Students upload notes and past papers as PDFs. Text is extracted, split into chunks, and embedded.
- Study help answers questions from a selected PDF and cites the page. It also generates summaries and quizzes.
- The study planner uses weak subjects, exam dates, and available notes to create a day-by-day plan. Missed items move forward when the student marks them as missed.

**Errors:** scanned PDFs with no text layer are stored but flagged as "not searchable". OCR is out of scope for the first release.

## 7. Campus Issues (deep)

**Data:** `issues`, `issue_reports`, `issue_reporters`, `issue_events`, `issue_confirmations`, `locations`, `departments`, `sla_rules`, `root_cause_insights`.

An `issue` is one real-world problem. Many `issue_reports` can merge into one issue.

### Lifecycle

`open` → `assigned` → `in_progress` → `resolved_pending` → `closed`, `closed_unverified`, or back to `in_progress`.

Every change is written to `issue_events`. This gives the timeline and audit log.

### Intake

1. The student submits text, a location from a fixed list, and optional photos.
2. The classifier returns category, severity, and department as structured output.
3. Duplicate search finds the five most similar open issues at the same location from the last 14 days, using embeddings.
4. Claude compares the report with those candidates. A match merges the report into that issue and increases its report count. Otherwise a new issue is created.
5. The issue goes to the department, and reporters get a notification.

If classification fails, the issue goes to a manual queue for the college admin. A report is never lost. The similarity threshold is tuned on pilot data.

### Deadlines and escalation

Default deadlines, editable per college in `sla_rules`:

| Severity | Deadline |
| --- | --- |
| Critical | 24 hours |
| High | 48 hours |
| Medium | 72 hours |
| Low | 7 days |

A `pg_cron` job runs every 15 minutes. A missed deadline moves the issue one level up: department authority, then department head, then college admin. Each move is an `issue_events` row and sends a notification.

### Edge 1: root-cause detection

A nightly job groups issues by location and category over the last 60 days. Groups with three or more issues go to Claude, which proposes a likely cause. Each insight links to its evidence issues and is labelled as a hypothesis, not a fact. Authorities can accept or dismiss it.

### Edge 2: student-verified closure

An authority cannot close an issue directly. Marking it resolved moves it to `resolved_pending` and asks every reporter to confirm.

- More "fixed" than "not fixed" responses: `closed`.
- Equal or more "not fixed" responses: back to `in_progress`, and the deadline restarts.
- No responses after 72 hours: `closed_unverified`, which is shown separately in analytics.

### Edge 3: verified but anonymous reporting

- Only verified students can report. Rate limits apply per student, so spam stays blocked.
- Reporter identity is stored only in `issue_reporters`. RLS lets the reporter read their own row, and no `authority` or `college_admin` can read it.
- Server-side notification jobs read `issue_reporters` with the service role, to reach reporters without exposing them. `issue_reports` holds no reporter ID.
- Anonymous is the default. Authorities see the report text and evidence only.
- Photo metadata is stripped on upload.
- Limitation: platform operators with database access can still see the link. The pitch and pilot consent text must state this honestly. It is not a guarantee against all parties.
- Free text can reveal identity, such as a room number. The form warns the student about this.

### Authority dashboard

- Issue queue with filters by status, severity, and location.
- Heatmap by location.
- Root-cause insights.
- Metrics: median resolution time, deadline misses, and verified closure rate.

## 8. Team split

| Owner | Area |
| --- | --- |
| 1 | Agent core, tool registry, approval, evals |
| 2 | Campus Issues and authority dashboard |
| 3 | Academics |
| 4 | Platform: auth, tenancy, thin modules, deployment |

With three people, owners 3 and 4 share Academics and the thin modules, and the thin modules start after Academics.

## 9. Build order

1. **Foundation:** auth, colleges, profiles, RLS, app shell, deployment.
2. **Agent walking skeleton:** `get_marks` plus one write tool, working end to end with approval and trace.
3. **Deep modules:** Academics and Campus Issues. Each module adds its tools as it lands.
4. **Thin modules:** in the table order in section 3, with the tools needed by the demo first.
5. **Pilot:** about 30 students in one hostel or department.
6. **Submission kit:** demo script, video, deck, and a pitch variant per theme.

If time runs short, cut thin modules first. Never cut the agent or the deep modules.

## 10. Demo script (3 minutes)

1. **Problem (20 seconds):** a student's campus life is spread across many apps, and none of them act for the student.
2. **Agent climax (80 seconds):** the student types "I'm weak in DBMS and my exam is in 10 days." The trace shows marks, weak subjects, past papers, notes, a mentor, and a used textbook. Approval cards appear for the study plan and mentor request. The student approves them.
3. **Campus Issues (60 seconds):** a photo of a broken water cooler merges into an existing issue, routes to the warden, and escalates after a missed deadline. A root-cause insight appears on the dashboard. A false "resolved" gets rejected by reporters.
4. **Proof (20 seconds):** real pilot numbers and the RLS and approval guarantees.

The deadline miss in the demo uses a demo college with a short deadline setting. The pitch states this openly.

## 11. Pilot

- About 30 consenting students in one hostel or department, ideally with one real warden or staff member as the authority.
- Consent text explains what is stored and the anonymity limitation in section 7.
- Metrics: complaints filed, duplicates merged, median resolution time, verified closure rate, and weekly active students.
- Pilot numbers come from real usage only. Any seeded data is labelled in the pitch.

## 12. Testing

- **RLS tests:** run against a local Supabase instance. They cover cross-college reads and writes, and they check that authorities cannot read `issue_reporters`.
- **Unit tests:** SGPA and CGPA calculation, deadline calculation, closure vote rules.
- **Agent evals:** a fixed prompt set checks tool choice. It also checks that write tools never run without approval, including with injected text in a note.
- **End-to-end tests:** Playwright runs the demo script on the deployed site before each submission.

## 13. Risks

| Risk | Response |
| --- | --- |
| Thin modules look shallow | Keep them few in the demo, and show only working paths |
| Agent fails during a live demo | Rehearse the path, and keep a recorded backup video |
| No authority joins the pilot | Use a student representative as authority, and state this in the pitch |
| A hackathon forbids existing code | Check rules first, and skip that event |
| AI cost during the pilot | Daily run limit per student, and a small model for classification |
