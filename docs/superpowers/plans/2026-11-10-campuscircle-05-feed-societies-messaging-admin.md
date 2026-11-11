# CampusCircle Plan 5: Feed, Societies, Messaging and College Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Students post text and photos to a college feed, comment, like and report posts.
- Students browse societies and request to join. Society admins accept or decline requests and post announcements.
- Students chat one to one in real time. The agent gains `find_person` and `send_message`.
- College admins verify students, publish college announcements and moderate reported posts.

**Architecture:**
- Extends Plans 1-4. One migration per module and one folder per module under `src/modules/<name>/`. Tools are registered in `src/modules/index.ts`.
- These are thin modules (spec section 3): one working happy path each, real data, no advanced options.
- Writes that touch another user, or that need a rate limit, go through `security definer` RPCs. These are posting, reporting, joining, deciding, announcing to members, sending messages, verifying and moderating. Plain own-row writes use RLS with column grants. These are comments, likes and deleting your own post or comment.

**Tech Stack:**
- The Plans 1-4 stack.
- Supabase Realtime (`postgres_changes`, RLS-filtered) for messages.
- `sharp` for feed photos.

**Spec:** `docs/superpowers/specs/2026-11-06-campuscircle-design.md`, sections 3, 4 and 5.

**Builds on:** Plans 1-4 in `docs/superpowers/plans/`.

**Prerequisites:**
- Plan 4 is complete on the working branch.
- `supabase start` runs.
- No API key is needed. The real-model check of `send_message` rides on Plan 4 Task 6.

## Rulings made while writing this plan

- **Order:** feed, then societies, then messaging with its agent tools, then college admin. College admin comes last because it moderates feed reports and links to societies.
- **`profiles.verified` (Plan 1) becomes visible but does not gate anything.**
  - A college admin sets it.
  - The UI shows a "Verified" badge next to names on posts, people search, listings and chats.
  - Gating posting on verification would break every test helper and the pilot onboarding.
  - Cost if wrong: a later check constraint plus updated helpers.
- **Feed posts are created through RPC `create_post`,** capped at 20 per author per 24 hours with an advisory lock. This is the same pattern as `contact_seller`.
- **Reported posts are hidden only by a college admin.** Reports never auto-hide a post. A hidden post is visible only to its author (labelled "Hidden by a moderator") and to college admins. Its comments follow the post's visibility.
- **Reporters stay anonymous in the moderation queue.** The queue shows the report count and reasons, never reporter names.
- **Societies are created by a college admin,** who names an admin. The admin must already have the role `society_admin` in the same college. Role changes stay out of scope.
- **Join requests mirror mentorship.** There is one row per student per society. A declined request can be re-sent after 7 days; the error is P0001 `declined_recently`.
- **Society announcements are readable by everyone in the college.** Approved members get a notification.
- **College announcements do not notify anyone.** The home page shows the newest 3, and `/announcements` lists them all. This avoids bulk notification inserts.
- **`events.society_id` (nullable) arrives here.** An event created by a society admin must name a society they admin. A college admin's events may leave it null. The Plan 4 rule still holds: a society admin edits only their own events.
- **Conversations are one-to-one,** stored once per pair as `(user_low, user_high)` with `user_low < user_high`. There are no message notifications. The sidebar shows "Messages (n)" for conversations with unread messages, using per-participant `read_at` markers.
- **Messaging is open to every role in the same college.** Sending a message to yourself or to another college is refused. The cap is 60 messages per sender per hour.
- **Realtime:** `public.messages` joins the `supabase_realtime` publication. The browser client subscribes to INSERTs filtered by `conversation_id`. RLS decides delivery. After sending, the sender's view refreshes from the server, so Realtime only matters for the recipient.
- **The agent finds a recipient with `find_person({ name })`,** which returns `person_id`. The approval card shows the recipient's name and the message, never an id. This follows the Plan 4 `describeAction` pattern.
- **The scripted model gains a `message` rule.** It fires on text starting with `message <name>: <text>`, calls `find_person`, then `send_message` with the first match, and stops on no match.
- **Plan 3 still applies:** only `src/modules/issues/submit.ts` may use the service role. Plan 5 adds no service-role use.

## Global Constraints

- Every tenant table has `college_id`. RLS limits access to the signed-in user's college. `college_id` and role come from `current_college_id()` / `app_role_of_user()`, never from client input.
- Clients get the minimum grants. Column grants stop changes to ownership, college, status and moderation columns that RPCs own.
- Every `security definer` function sets `set search_path = public`, checks the role null-safely (`coalesce(..., false) is not true`), revokes execute from `public, anon`, and grants it to `authenticated` only.
- Write tools are `kind: 'write'` and run only after approval through the Plan 1 executor. Read tools are `kind: 'read'`. Approval cards show names and titles, never ids.
- Tool output reaches the model only through the loop's `<tool_data>` fence. User-written text (posts, comments, messages, society text) is untrusted.
- Id inputs in zod use the shared UUID regex from the Plan 4 tools, never `z.string().uuid()`.
- Storage paths have exactly one filename segment after `<college>/<owner>/`, and no `..`.
- Nothing on screen is fake. A sidebar link appears only when its page works. Layout must work at 375px wide.
- Notifications use the Plan 3 `notifications` table. Inserts come only from `security definer` functions. Links point at pages the recipient can open.
- Times display in IST with the shared formatter.
- Copy is plain and specific. Errors from 42501 map to a clear message. Raw database errors are logged, not shown.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Limits:

  | Field | Limit |
  | --- | --- |
  | post body | 1-2000 characters |
  | comment | 1-1000 characters |
  | report reason | 3-300 characters |
  | society name | 3-80 characters, unique per college, case-insensitive |
  | society description | up to 2000 characters |
  | announcement title | 3-120 characters |
  | announcement body | 1-4000 characters |
  | message | 1-2000 characters |
  | `find_person` name | 2-80 characters |
  | posts | 20 per author per 24 hours |
  | messages | 60 per sender per hour |
  | photos | 5 MB, re-encoded without EXIF |

- Every e2e spec creates its own users. No spec depends on seeded people other than reading them.

## Review Focus

1. A college B user must see nothing of college A's posts, comments, societies, announcements or conversations, through pages, RPCs, Realtime or agent tools.
2. A same-college student who is not in a conversation must not read its messages, through select or Realtime.
3. A hidden post must not appear to other students in the feed, by direct URL, or through its comments. Its author sees it labelled.
4. The admin of society X must not decide join requests or post announcements for society Y.
5. These messages must be refused with a clear message and no database error text:
   - a message to yourself
   - a message to another college
   - an empty message
   - a 2001-character message
   - the 61st message in an hour

---

### Task 1: Feed

**Files:**
- Create:
  - `supabase/migrations/0015_feed.sql`
  - `src/modules/feed/queries.ts`
  - `src/app/(app)/feed/page.tsx`
  - `src/app/(app)/feed/[id]/page.tsx`
  - `src/app/(app)/feed/actions.ts`
  - `src/app/(app)/feed/composer.tsx`
  - `src/app/api/feed/photos/route.ts`
  - `tests/rls/feed.test.ts`
  - `tests/e2e/feed.spec.ts`
- Modify:
  - `src/app/(app)/layout.tsx` (add a "Feed" link)
  - `playwright.config.ts` (add `feed` to the academics project testMatch)

**Interfaces:**
- **`posts`** `(id, college_id, author_id, body text 1-2000, photo_path text null, hidden_at timestamptz null, hidden_by uuid null, created_at)`.
  - `photo_path` check: `<college_id>/<author_id>/<single segment>`.
  - Select: same college, and either `hidden_at is null`, or the reader is the author, or the reader is a college_admin.
  - Delete: the author.
  - No client insert or update.
- **`create_post(p_body text, p_photo_path text default null) returns uuid`.** Any role. Capped at 20 per 24 hours. Over the cap, raises P0001 `too_many_posts`.
- **`post_comments`** `(id, post_id, college_id, author_id, body 1-1000, created_at)`.
  - Insert: `author_id = auth.uid()`, and the post is visible to the author and not hidden.
  - Select: follows the post's visibility.
  - Delete: the author.
- **`post_likes`** `(post_id, user_id, college_id, created_at)`, primary key `(post_id, user_id)`. Insert and delete own row only.
- **`post_reports`** `(id, post_id, college_id, reporter_id, reason 3-300, status text check in ('open','actioned','dismissed') default 'open', created_at)`.
  - Unique `(post_id, reporter_id)`.
  - Select: the reporter's own rows, plus college_admin.
  - No client insert or update.
- **`report_post(p_post_id uuid, p_reason text)`.** Refuses your own post and hidden posts. A duplicate report maps to "You already reported this post."
- **Bucket `post-photos`.** Select for the same college. Insert only under the uploader's own prefix.
- **`/api/feed/photos`:** a copy of the market photos route pattern (sharp, 5 MB, 20 uploads per day).
- **`listFeed(db, { before?: string, limit = 20 })`** in `src/modules/feed/queries.ts`. Returns posts newest first, with:
  - author name and `verified`
  - like count
  - whether I liked the post
  - comment count
  - a signed photo URL
- **Pages:**
  - `/feed`: composer, list, "Load more", like toggle, report form, and delete on own posts.
  - `/feed/[id]`: post, comments and a comment form.
  - A missing or invisible post shows "This post is not available."

- [ ] **Step 1: Write the failing tests.**
  - RLS:
    - `student creates a post and a college B student cannot read it`
    - `21st post in 24 hours is refused with too_many_posts`
    - `student cannot insert into posts directly or set hidden_at`
    - `hidden post is invisible to another student but visible to its author and a college admin`
    - `comments on a hidden post are invisible to other students`
    - `student cannot report own post; second report is refused`
    - `reporter sees own report; another student does not`
    - `photo_path outside the author prefix or with .. is refused`
  - E2E:
    - `student posts text with a photo, another student likes and comments`
    - `student reports a post and sees a confirmation`
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement, then run `npm run db:reset`.
- [ ] **Step 4:** Run `npx tsc --noEmit`, `npm test`, `npm run test:rls` and `npm run test:e2e`. Expected: all pass.
- [ ] **Step 5:** Commit `feat: add college feed with photos, comments, likes and reports`.

---

### Task 2: Societies

**Files:**
- Create:
  - `supabase/migrations/0016_societies.sql`
  - `src/modules/societies/queries.ts`
  - `src/app/(app)/societies/page.tsx`
  - `src/app/(app)/societies/[id]/page.tsx`
  - `src/app/(app)/societies/new/page.tsx`
  - `src/app/(app)/societies/actions.ts`
  - `tests/rls/societies.test.ts`
  - `tests/e2e/societies.spec.ts`
- Modify:
  - `supabase/migrations/0014_events.sql` (or a new migration if that is cleaner), to add `events.society_id`
  - the events create form and action
  - `src/app/(app)/layout.tsx` ("Societies")
  - `supabase/seed.sql`
  - `playwright.config.ts`

**Interfaces:**
- **`societies`** `(id, college_id, name 3-80, description up to 2000, admin_id uuid null references profiles, created_at)`.
  - Unique `(college_id, lower(name))`.
  - Select: same college.
  - Insert and update (name, description, admin_id): college_admin of the college.
  - A trigger or check function enforces that `admin_id` is a `society_admin` profile in the same college.
- **`society_members`** `(society_id, student_id, college_id, status text check in ('pending','approved','declined') default 'pending', created_at, decided_at)`.
  - Primary key `(society_id, student_id)`.
  - Select: the student themself, plus the society's admin.
  - No client writes.
  - Member count is public within the college through `society_member_count(p_society_id) returns int`.
- **`request_to_join(p_society_id uuid)`.**
  - Caller is a student in the same college.
  - A pending or approved request raises P0001 `already_requested`.
  - A decline less than 7 days ago raises P0001 `declined_recently`. Otherwise a declined row resets to pending.
  - Notifies the society admin, linking `/societies/<id>`.
- **`decide_join(p_society_id uuid, p_student_id uuid, p_accept boolean)`.** Caller is that society's admin, and the row is pending. Notifies the student.
- **`leave_society(p_society_id uuid)`.** Deletes the caller's own row.
- **`society_announcements`** `(id, society_id, college_id, author_id, title 3-120, body 1-4000, created_at)`. Select: same college. No client writes.
- **`post_society_announcement(p_society_id uuid, p_title text, p_body text) returns uuid`.** Caller is that society's admin. Notifies every approved member, linking `/societies/<id>`.
- **`events.society_id uuid null references societies`.**
  - Insert or update by a society_admin requires `society_id` to be a society they admin.
  - A college_admin may set any society of the college, or leave it null.
  - The event page shows "Hosted by <society>".
- **Pages:**
  - `/societies`: list with member counts and my status.
  - `/societies/[id]`, for everyone: description, admin name, announcements, and Join / Pending / Member / Leave.
  - `/societies/[id]`, for the society admin: pending requests with Accept and Decline, plus an announcement form.
  - `/societies/new`: college_admin only, with name, description and an admin picker listing that college's society_admin profiles.
- **Seed (a001):** a society_admin "Arjun Mehta", created like Priya, and a society "Coding Club" with Arjun as admin.

- [ ] **Step 1: Write the failing tests.**
  - RLS:
    - `college admin creates a society with a society_admin as admin; a student admin is refused`
    - `student requests to join, admin accepts, student is notified`
    - `admin of society X cannot decide requests or announce for society Y`
    - `second request while pending is refused; request within 7 days of decline is refused`
    - `announcement notifies approved members only`
    - `college B cannot see college A societies, members or announcements`
    - `society admin cannot create an event for a society they do not admin`
  - E2E:
    - `college admin creates a society; student requests to join; society admin accepts and posts an announcement; student sees it`
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement, then run `npm run db:reset`.
- [ ] **Step 4:** Run the full suite. Expected: all pass.
- [ ] **Step 5:** Commit `feat: add societies with join requests and announcements`.

---

### Task 3: Messaging and the send_message agent tool

**Files:**
- Create:
  - `supabase/migrations/0017_messaging.sql`
  - `src/modules/messaging/queries.ts`
  - `src/modules/messaging/tools.ts`
  - `src/app/(app)/messages/page.tsx`
  - `src/app/(app)/messages/[id]/page.tsx`
  - `src/app/(app)/messages/[id]/thread.tsx` (client, Realtime)
  - `src/app/(app)/messages/actions.ts`
  - `tests/rls/messaging.test.ts`
  - `tests/unit/messaging-tools.test.ts`
  - `tests/e2e/messages.spec.ts`
- Modify:
  - `src/modules/index.ts`
  - `src/agent/display.ts` (card for `send_message`)
  - `src/agent/loop.ts` (one system-prompt line)
  - `src/agent/scripted-model.ts` (`message` rule)
  - `src/app/(app)/layout.tsx` ("Messages (n)")
  - `/people` results and `/market/[id]` (a "Message" button that opens the conversation)
  - `playwright.config.ts`

**Interfaces:**
- **`conversations`** `(id, college_id, user_low, user_high, created_at, last_message_at, low_read_at, high_read_at)`.
  - Check `user_low < user_high`. Unique `(user_low, user_high)`.
  - Select: participants only.
  - No client writes.
- **`messages`** `(id, conversation_id, college_id, sender_id, body 1-2000, created_at)`.
  - Select: participants of the conversation.
  - No client writes.
  - Added to the `supabase_realtime` publication.
- **`open_conversation(p_other uuid) returns uuid`.** Find or create. The other user must be in the same college and must not be the caller.
- **`send_message(p_recipient_id uuid, p_body text) returns uuid`** (returns the conversation id).
  - Same rules as `open_conversation`, plus the body limits.
  - Capped at 60 per sender per hour, with an advisory lock. Over the cap, raises P0001 `too_many_messages`.
  - Sets `last_message_at`, and sets the sender's read marker to now.
- **`mark_conversation_read(p_conversation_id uuid)`.**
- **`unreadConversationCount(db)`.** Conversations whose `last_message_at` is later than my read marker and whose last message was not sent by me.
- **Agent tools:**
  - `find_person({ name })`: read, all roles. Returns up to 5 of `{ person_id, name, skills, verified }` from the same college, excluding self. Uses a case-insensitive substring match with `%` and `_` escaped.
  - `send_message({ recipient_id, body })`: write, all roles.
  - The approval card reads "Send a message to <name>" followed by the body. An unknown recipient shows "A person we could not find".
- **Scripted model:**
  - Text matching `/^message ([^:]{2,80}):\s*(.+)$/i` calls `find_person({ name })`.
  - Next turn: `send_message` with the first `person_id` and the text.
  - No match: final text "I could not find anyone by that name."
- **Pages:**
  - `/messages`: conversations with the other person's name, a "Verified" badge, a last-message preview, an unread marker and IST time.
  - `/messages/[id]`: thread, composer, and live updates through Realtime. Opening the page marks it read.
  - An id that is not mine shows "This conversation is not available."

- [ ] **Step 1: Write the failing tests.**
  - RLS:
    - `two students exchange messages; a third same-college student reads nothing`
    - `message to self, to college B, empty and 2001 characters are refused`
    - `61st message in an hour is refused with too_many_messages`
    - `open_conversation returns the same id for both directions`
    - `student cannot insert messages or conversations directly`
    - `send_message tool runs only after approval and the card shows the name, not the id`
  - Unit:
    - `find_person escapes % and _`
    - `scripted message rule calls find_person then send_message and stops on no match`
  - E2E:
    - `student A messages student B from People; B sees it live without reload`
    - `agent: "message <B name>: hello" shows an approval card with B's name; approving delivers the message`
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement, then run `npm run db:reset`.
- [ ] **Step 4:** Run the full suite. Expected: all pass.
- [ ] **Step 5:** Commit `feat: add one-to-one messaging with realtime and the send_message tool`.

---

### Task 4: College admin

**Files:**
- Create:
  - `supabase/migrations/0018_college_admin.sql`
  - `src/modules/admin/queries.ts`
  - `src/app/(app)/admin/page.tsx`
  - `src/app/(app)/admin/actions.ts`
  - `src/app/(app)/announcements/page.tsx`
  - `tests/rls/college-admin.test.ts`
  - `tests/e2e/college-admin.spec.ts`
- Modify:
  - `src/app/(app)/layout.tsx` ("Admin" for college_admin, "Announcements" for all)
  - `src/app/(app)/page.tsx` (newest 3 announcements for every role)
  - the people, feed, market and messages views (a "Verified" badge where not already added)
  - `supabase/seed.sql` (Priya and Arjun verified)
  - `playwright.config.ts`

**Interfaces:**
- **`set_student_verified(p_profile_id uuid, p_verified boolean)`.**
  - Caller is a college_admin of the same college.
  - The target is in the same college.
  - Clients have no update grant on `verified`. Confirm that the Plan 1 grants exclude it.
- **`college_announcements`** `(id, college_id, author_id, title 3-120, body 1-4000, created_at)`.
  - Select: same college.
  - Insert: college_admin with `author_id = auth.uid()`.
  - Delete: college_admin of the college.
- **`moderate_post(p_post_id uuid, p_action text check in ('hide','dismiss'))`.**
  - Caller is a college_admin of the post's college.
  - `hide` sets `hidden_at` and `hidden_by`, marks open reports `actioned`, and notifies the author, linking `/feed/<id>`.
  - `dismiss` marks open reports `dismissed`.
- **`reportedPosts(db)`.** Posts with open reports. Each has the body, author name, open report count and reasons. No reporter ids or names.
- **`/admin`** (college_admin only; other roles see "This page is for college admins."):
  - "Students to verify": unverified students, with Verify.
  - "Announcements": a form, plus the list with Delete.
  - "Reported posts": Hide and Dismiss.
  - "Societies": links to `/societies/new`.

- [ ] **Step 1: Write the failing tests.**
  - RLS:
    - `college admin verifies a student; a student cannot verify anyone or update verified directly`
    - `college admin of college B cannot verify or moderate college A`
    - `hide marks reports actioned, hides the post and notifies the author`
    - `dismiss leaves the post visible and clears it from the queue`
    - `reportedPosts exposes no reporter ids`
    - `student cannot insert a college announcement`
  - E2E:
    - `admin verifies a student and the badge appears in People`
    - `admin publishes an announcement and a student sees it on the home page`
    - `student reports a post; admin hides it; another student no longer sees it`
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement, then run `npm run db:reset`.
- [ ] **Step 4:** Run the full suite. Expected: all pass.
- [ ] **Step 5:** Commit `feat: add college admin verification, announcements and moderation`.
