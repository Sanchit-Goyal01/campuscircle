# CampusCircle Plan 4: Profiles, Mentorship, Marketplace and Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Students edit a profile with skills and a mentor flag, search people by skill, and request mentorship.
- Students list used items with a photo, search listings, and contact a seller.
- Admins publish events; students browse a list and a month calendar and register.
- The agent gains `get_my_profile`, `find_mentor`, `find_teammates`, `request_mentorship`, `search_listings`, `search_events` and `register_for_event`.
- The agent demo (spec section 10, step 2) runs end to end under the scripted model: marks, weak subjects, past papers, notes, a mentor, a used textbook, then approval cards for the study plan and the mentor request.

**Architecture:**
- Extends Plans 1-3. One migration per module, one folder per module under `src/modules/<name>/`, tools registered in `src/modules/index.ts`.
- These are thin modules (spec section 3): one working happy path each, real data, no advanced options.
- Writes that touch another user (mentorship request, contact seller, event registration) go through `security definer` RPCs, so notifications and capacity checks are atomic. Plain own-row writes (profile, own listing) use RLS with column grants.

**Tech Stack:** the Plans 1-3 stack. `sharp` (Plan 3) for listing photos.

**Spec:** `docs/superpowers/specs/2026-11-06-campuscircle-design.md`, sections 3, 5, 9 and 10.

**Builds on:** Plans 1-3 in `docs/superpowers/plans/`.

**Prerequisites:** Plan 3 complete on the working branch; `supabase start` runs. `ANTHROPIC_API_KEY` only for the manual check in Task 6.

## Rulings made while writing this plan

- **Order follows the demo (spec section 9):** profiles and mentorship, then marketplace, then events, then the demo flow. Feed, societies, messaging and college admin move to Plan 5.
- **Mentor flag is `profiles.is_mentor boolean default false`,** editable by the student. Mentor search matches a subject against `skills` case-insensitively. Cost if wrong: a separate mentor_subjects column later.
- **People search shows name, bio, skills and mentor flag only.** Never email, role details or ids in UI text. Agent tools return a profile id only where a write tool needs it (`request_mentorship.mentor_id`).
- **"Contact seller" sends an in-app notification** to the seller with the buyer's name and message, through RPC `contact_seller`. Real chat arrives with Plan 5 messaging. Rate limit: 10 contacts per buyer per 24 hours.
- **Events are created by `college_admin` and `society_admin`.** `events.society_id` is added by Plan 5; Plan 4 events belong to the college.
- **Event capacity is enforced in `register_for_event`** with a row lock on the event. Past events refuse registration. Cancelling is a delete of the student's own registration row.
- **Listing search and event search use Postgres full-text search** (`websearch_to_tsquery('simple', ...)` over a generated `tsvector`). No embeddings for thin modules.
- **The scripted model gains a multi-step "demo" script** keyed on `weak in` + `exam in`. It calls one tool per turn, in a fixed order, by counting tool results already in the conversation. Cost if wrong: only test-double code.
- **Plan 3 changed one global constraint:** `src/modules/issues/submit.ts` is the only app code allowed to use the service role. Plan 4 adds no service-role use.

## Global Constraints

- Every tenant table has `college_id`; RLS limits access to the signed-in user's college. `college_id` and role come from `current_college_id()` / `app_role_of_user()`, never from client input.
- Clients get the minimum grants; column grants stop changes to ownership, college or status columns that RPCs own.
- Write tools are `kind: 'write'` and run only after approval through the Plan 1 executor. Read tools are `kind: 'read'`.
- Tool output reaches the model only through the loop's `<tool_data>` fence. User-written text (bios, listing descriptions, event descriptions) is untrusted.
- Nothing on screen is fake. A sidebar link appears only when its page works. Layout must work at 375px wide.
- Notifications use the Plan 3 `notifications` table; inserts only from `security definer` functions. Links point at pages the recipient can open.
- Copy is plain and specific. Errors from 42501 map to a clear message; raw database errors are logged, not shown.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Limits: skills at most 20 items of 1-40 characters; bio at most 500 characters; mentorship message 10-500; listing title 3-120, description up to 2000, price 0-1,000,000 whole rupees; contact message 10-500; event title 3-120, description up to 4000, capacity 1-10000 or null.

## Review Focus

1. A student of college B searches people, listings or events and must see nothing of college A, including through every agent tool.
2. Two students register for the last seat of an event at the same moment: exactly one succeeds.
3. A student requests mentorship from themselves, from a non-mentor, or twice while a request is pending: refused with a clear message.
4. A listing photo is uploaded by someone other than the listing's seller, or a listing is edited by a non-seller: refused.
5. Free-text search with quotes, `&`, `:` or an empty string must not raise a database error.

---

### Task 1: Profiles, people search and mentorship

**Files:**
- Create: `supabase/migrations/0012_people.sql`, `src/modules/people/tools.ts`, `src/modules/people/queries.ts`, `src/app/(app)/profile/{page,actions,form}.tsx|ts`, `src/app/(app)/people/{page,actions}.tsx|ts`, `src/app/(app)/mentorship/{page,actions}.tsx|ts`, `tests/rls/people.test.ts`, `tests/e2e/people.spec.ts`
- Modify: `src/modules/index.ts`, `src/app/(app)/layout.tsx`, `supabase/seed.sql`, `playwright.config.ts` (only if the spec is not matched)

**Interfaces:**
- `profiles.is_mentor boolean not null default false`; update grant on `(full_name, bio, skills, is_mentor)`. Check constraints for the skills and bio limits.
- Table `mentorship_requests(id, college_id, student_id, mentor_id, subject text 1-80, message text 10-500, status text check in ('pending','accepted','declined') default 'pending', created_at, decided_at)`. Unique pending pair `(student_id, mentor_id) where status = 'pending'`. Select: the student or the mentor. No client insert/update grants.
- RPC `request_mentorship(p_mentor_id uuid, p_subject text, p_message text) returns uuid`: caller is a student; mentor is same college, `is_mentor`, not the caller; one pending request per pair (23505 mapped); inserts a notification for the mentor linking `/mentorship`.
- RPC `decide_mentorship(p_request_id uuid, p_accept boolean)`: caller is the mentor of a pending request; notifies the student linking `/mentorship`.
- `findPeople(db, { skill?: string, mentorsOnly?: boolean, limit?: number })` in `queries.ts`, case-insensitive skill match, excludes the caller.
- Tools: `get_my_profile` (read, all roles: name, bio, skills, is_mentor, role, department name); `find_mentor({ subject })` (read, student: up to 5 of `{ mentor_id, name, skills, bio }`); `find_teammates({ skills: string[] 1-5 })` (read, student: up to 10 of `{ name, skills, matched }` sorted by matches); `request_mentorship({ mentor_id, subject, message })` (write, student).
- Pages: `/profile` (edit form); `/people` (search by skill, mentor filter, "Request mentorship" form per mentor); `/mentorship` (incoming with Accept/Decline, outgoing with status). Sidebar: "Profile", "People", "Mentorship".
- Seed (demo college a001): a mentor student "Priya Sharma" with skills `DBMS`, `SQL`, `Operating Systems` and `is_mentor = true`, created like the other seeded users.

- [ ] **Step 1: Write the failing tests:**
  - RLS: `student updates own skills and is_mentor; cannot update role or another profile`; `skills over 20 items or 41 characters are refused`; `request_mentorship refuses self, non-mentor and other-college mentor`; `second pending request to the same mentor is refused`; `mentor accepts and the student is notified`; `college B cannot see college A mentorship requests or find A mentors`; `find_mentor returns DBMS mentors and no email field`; `request_mentorship tool runs only after approval`.
  - E2E: `student adds skills and turns on mentor flag`; `student finds a DBMS mentor, sends a request, mentor accepts`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement, then `npm run db:reset`.
- [ ] **Step 4:** Run `npx tsc --noEmit`, `npm test`, `npm run test:rls`, `npm run test:e2e`. Expected: all pass.
- [ ] **Step 5:** Commit `feat: add profiles, people search and mentorship`.

---

### Task 2: Marketplace

**Files:**
- Create: `supabase/migrations/0013_marketplace.sql`, `src/modules/market/{tools,queries}.ts`, `src/app/(app)/market/page.tsx`, `src/app/(app)/market/new/{page,form}.tsx`, `src/app/(app)/market/[id]/{page,contact-form}.tsx`, `src/app/(app)/market/actions.ts`, `src/app/api/market/photos/route.ts`, `tests/rls/market.test.ts`, `tests/unit/market-search.test.ts`, `tests/e2e/market.spec.ts`
- Modify: `src/modules/index.ts`, `src/app/(app)/layout.tsx`, `supabase/seed.sql`

**Interfaces:**
- Table `listings(id, college_id default current_college_id(), seller_id default auth.uid(), title, description, price_inr int, condition text check in ('new','like_new','good','fair'), status text check in ('available','sold') default 'available', photo_path text null, search tsvector generated from title and description, created_at)`. GIN index on `search`.
- RLS: select same college; insert by students only with `seller_id = auth.uid()`; update of `(title, description, price_inr, condition, status, photo_path)` and delete by the seller only. `photo_path` must start with `<college_id>/<seller_id>/`.
- Bucket `listing-photos`: private, 5 MB, jpeg only (re-encoded). Insert to `<college_id>/<auth.uid()>/...` only; select by same college.
- Photo route `POST /api/market/photos`: students only, reuses `stripAndEncode` from `src/modules/issues/photos.ts`, returns `{ path }`.
- RPC `contact_seller(p_listing_id uuid, p_message text)`: caller same college, not the seller, listing available, 10 per caller per 24 hours (`P0001` with message "You have contacted sellers too many times today. Try again tomorrow."); notifies the seller with the buyer's full name and the message, link `/market/<id>`.
- `searchListings(db, { query?: string, limit?: number })`: available listings; empty query returns newest; uses `websearch_to_tsquery('simple', query)`.
- Tool `search_listings({ query })` (read, all roles): up to 10 of `{ id, title, price_inr, condition, seller_name, created_at }`.
- Pages: `/market` (search box, cards with photo via signed URL, price as `₹1,200`), `/market/new` (form + photo), `/market/[id]` (details, contact form for non-sellers, "Mark as sold" and "Delete" for the seller). Sidebar: "Marketplace".
- Seed: a listing by a seeded student in a001, title "Database System Concepts (Korth), used", price 450, condition good, no photo.

- [ ] **Step 1: Write the failing tests:**
  - Unit: `search query with quotes, & and : does not throw and is passed as websearch text`.
  - RLS: `seller creates, edits and marks sold; another student cannot edit or delete`; `photo_path outside the seller folder is refused`; `contact_seller notifies the seller and refuses the seller themself`; `eleventh contact in 24 hours is refused`; `college B cannot see college A listings or photos`; `search_listings finds the Korth listing for "DBMS textbook" or "database"`.
  - E2E: `student lists an item with a photo, another student finds it and contacts the seller, seller sees a notification`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement, then `npm run db:reset`.
- [ ] **Step 4:** Full suite. Expected: all pass.
- [ ] **Step 5:** Commit `feat: add marketplace listings, search and contact seller`.

---

### Task 3: Events

**Files:**
- Create: `supabase/migrations/0014_events.sql`, `src/modules/events/{tools,queries,calendar}.ts`, `src/app/(app)/events/page.tsx`, `src/app/(app)/events/new/{page,form}.tsx`, `src/app/(app)/events/[id]/{page,register-button}.tsx`, `src/app/(app)/events/actions.ts`, `tests/unit/calendar.test.ts`, `tests/rls/events.test.ts`, `tests/e2e/events.spec.ts`
- Modify: `src/modules/index.ts`, `src/app/(app)/layout.tsx`, `supabase/seed.sql`

**Interfaces:**
- Table `events(id, college_id default current_college_id(), title, description, venue text 1-120, starts_at, ends_at check ends_at > starts_at, capacity int null, created_by default auth.uid(), search tsvector generated, created_at)`. Insert/update/delete by `college_admin` or `society_admin` of the college. Select same college.
- Table `event_registrations(event_id, student_id, college_id, created_at, primary key (event_id, student_id))`. Select own rows; staff of the college (`college_admin`, `society_admin`) see all for their college. Delete own row. No client insert.
- RPC `register_for_event(p_event_id uuid) returns text` ('registered' | 'already_registered'): caller is a student of the event's college; `starts_at > now()` else "This event has already started."; locks the event row; full → "This event is full."
- Event detail shows `registered_count`, from RPC `event_registration_count(p_event_id)` (security definer, same college).
- `monthGrid(year: number, month: number, events: {starts_at: string}[], tz = 'Asia/Kolkata')` in `calendar.ts`: returns weeks of days starting Monday with events per day. Pure function.
- Tools: `search_events({ query?, from?, to? })` (read, all roles; dates `YYYY-MM-DD`, default from today for 30 days; up to 10 of `{ id, title, venue, starts_at, seats_left }`); `register_for_event({ event_id })` (write, student).
- Pages: `/events` (upcoming list; `?view=calendar&month=YYYY-MM` month grid with prev/next links), `/events/[id]` (details, Register / Cancel registration), `/events/new` (staff only; others get `notFound()`). Sidebar: "Events".
- Seed: two upcoming a001 events relative to `now()` (e.g. "DBMS revision workshop" in 3 days, capacity 40; "Hostel sports night" in 10 days, no capacity).

- [ ] **Step 1: Write the failing tests:**
  - Unit: `monthGrid starts weeks on Monday and places an event on its local date`; `monthGrid handles a month starting on Sunday and February in a leap year`.
  - RLS: `student cannot insert an event; college_admin can`; `register twice returns already_registered`; `two concurrent registrations for the last seat: one succeeds, one gets "This event is full."`; `registration for a started event is refused`; `student sees only own registrations`; `college B cannot see or register for college A events`; `register_for_event tool runs only after approval`.
  - E2E: `admin creates an event, student sees it in the calendar and registers, seat count goes up`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement, then `npm run db:reset`.
- [ ] **Step 4:** Full suite. Expected: all pass.
- [ ] **Step 5:** Commit `feat: add events with calendar and registration`.

---

### Task 4: Agent demo flow

**Files:**
- Modify: `src/agent/scripted-model.ts`, `tests/unit/scripted-model.test.ts`, the agent system prompt (wherever Plan 1 defines it) so the real model knows the new tools, `supabase/seed.sql` (demo student marks/exam data if missing)
- Create: `tests/e2e/demo-agent.spec.ts`

**Interfaces:**
- Scripted "demo" script, matched before all other keyword rules when the first user message contains both `weak in` and `exam in` (case-insensitive). Each turn calls the next tool whose result is not yet in the conversation, in this order: `get_marks`, `get_weak_subjects`, `get_past_papers` `{ subject: 'DBMS' }`, `search_notes` `{ query: 'DBMS normalization' }`, `find_mentor` `{ subject: 'DBMS' }`, `search_listings` `{ query: 'database' }`, then `create_study_plan` (input built the way the existing `plan` rule builds it, 10 days out) and `request_mentorship` with the `mentor_id` taken from the `find_mentor` result and message "I am weak in DBMS and my exam is in 10 days. Could you help me revise?". Then a final text: "I found your weak subjects, papers, notes, a mentor and a used textbook. Approve the study plan and the mentor request to go ahead."
  - Check the existing input shapes of the academics tools and match them exactly.
- The e2e signs in as the seeded demo student, types "I'm weak in DBMS and my exam is in 10 days.", sees each tool in the trace, sees two approval cards, approves both, and then sees the plan on `/academics/plans` and the request on `/mentorship`.

- [ ] **Step 1: Write the failing tests:** unit `demo script calls tools in order and stops after two write proposals`; unit `demo script takes mentor_id from the find_mentor result`; the e2e above.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Full suite. Expected: all pass.
- [ ] **Step 5:** Commit `feat: script the agent demo across academics, mentors and marketplace`.

---

### Task 5: Home page shortcuts

**Files:**
- Modify: `src/app/(app)/page.tsx`
- Test: `tests/e2e/home.spec.ts` (create)

**Interfaces:** the home page shows, for a student, up to 3 upcoming registered events, the count of pending mentorship requests (incoming and outgoing), and the student's newest 3 available listings, each linking to its page. Empty states say what to do next ("Browse events", "Find a mentor", "List an item"). Staff see links to their pages only.

- [ ] **Step 1:** Write the failing e2e `home shows registered events, mentorship and listings with empty states`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Full suite. Expected: all pass.
- [ ] **Step 5:** Commit `feat: add home page shortcuts for events, mentorship and listings`.

---

### Task 6: Real-model check (manual, needs `ANTHROPIC_API_KEY`)

- [ ] Run `npm run dev` with the key and without `AGENT_TEST_MODEL`. Type the demo sentence as the seeded demo student. Confirm the agent calls the expected tools, proposes the study plan and the mentor request, and that nothing writes before approval. Record the trace summary in the ledger.
