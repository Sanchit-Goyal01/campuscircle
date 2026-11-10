import { AgentPanel } from "@/agent/ui/AgentPanel";
import { getProfile } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";
import { allTools } from "@/modules";
import { formatWhen, upcomingRegisteredEvents } from "@/modules/events/queries";
import { formatPrice, myAvailableListings } from "@/modules/market/queries";
import { listAnnouncements } from "@/modules/admin/queries";
import { pendingMentorshipCounts } from "@/modules/people/queries";

const link = "underline";

async function StudentShortcuts({ db, userId }: { db: SupabaseClient; userId: string }) {
  const [events, counts, listings] = await Promise.all([
    upcomingRegisteredEvents(db, userId, 3),
    pendingMentorshipCounts(db, userId),
    myAvailableListings(db, userId, 3),
  ]);
  const pending = counts.incoming + counts.outgoing;
  return (
    <section aria-label="Your shortcuts" className="grid gap-4 md:grid-cols-3">
      <div className="flex flex-col gap-2 border border-zinc-300 p-3 text-sm">
        <h2 className="text-lg font-semibold">Your events</h2>
        {events.length === 0 ? (
          <p>
            No upcoming registrations.{" "}
            <Link href="/events" className={link}>
              Browse events
            </Link>
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {events.map((e) => (
              <li key={e.id}>
                <Link href={`/events/${e.id}`} className={`${link} font-medium`}>
                  {e.title}
                </Link>
                <div>
                  {formatWhen(e.starts_at)} · {e.venue}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-col gap-2 border border-zinc-300 p-3 text-sm">
        <h2 className="text-lg font-semibold">Mentorship</h2>
        {pending === 0 ? (
          <p>
            No pending requests.{" "}
            <Link href="/people" className={link}>
              Find a mentor
            </Link>
          </p>
        ) : (
          <>
            <p>
              {pending} pending {pending === 1 ? "request" : "requests"}
            </p>
            <p>
              {counts.incoming} incoming, {counts.outgoing} outgoing
            </p>
            <Link href="/mentorship" className={link}>
              View requests
            </Link>
          </>
        )}
      </div>
      <div className="flex flex-col gap-2 border border-zinc-300 p-3 text-sm">
        <h2 className="text-lg font-semibold">Your listings</h2>
        {listings.length === 0 ? (
          <p>
            Nothing listed.{" "}
            <Link href="/market/new" className={link}>
              List an item
            </Link>
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {listings.map((l) => (
              <li key={l.id}>
                <Link href={`/market/${l.id}`} className={`${link} font-medium`}>
                  {l.title}
                </Link>
                <div>{formatPrice(l.price_inr)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

async function LatestAnnouncements({ db }: { db: SupabaseClient }) {
  const items = await listAnnouncements(db, 3);
  return (
    <section aria-label="College announcements" className="flex flex-col gap-2 border border-zinc-300 p-3 text-sm">
      <h2 className="text-lg font-semibold">College announcements</h2>
      {items.length === 0 ? (
        <p>No announcements yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((a) => (
            <li key={a.id}>
              <div className="font-medium">{a.title}</div>
              <div>{formatWhen(a.created_at)} IST</div>
            </li>
          ))}
        </ul>
      )}
      <Link href="/announcements" className={link}>
        All announcements
      </Link>
    </section>
  );
}

function StaffLinks({ role }: { role: string }) {
  const issues = role === "authority" || role === "college_admin";
  const events = role === "college_admin" || role === "society_admin";
  if (!issues && !events) return null;
  return (
    <section aria-label="Your pages" className="flex flex-wrap gap-4 text-sm">
      {issues && (
        <Link href="/authority" className={link}>
          Issue dashboard
        </Link>
      )}
      {events && (
        <Link href="/events/new" className={link}>
          Create an event
        </Link>
      )}
    </section>
  );
}

export default async function HomePage() {
  const me = await getProfile();
  if (!me) return null; // layout renders the no-profile message
  const { data: college } = await me.db
    .from("colleges")
    .select("name")
    .eq("id", me.profile.college_id)
    .maybeSingle();

  const hasTools = allTools.some((tool) => tool.roles.includes(me.profile.role));

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <header>
        <h1 className="font-slab text-3xl font-bold">Welcome, {me.profile.full_name || "student"}</h1>
        <p className="mt-1">
          {college?.name ?? "Your college"}, {me.profile.role.replace("_", " ")}
        </p>
      </header>
      {me.profile.role === "student" ? (
        <StudentShortcuts db={me.db} userId={me.userId} />
      ) : (
        <StaffLinks role={me.profile.role} />
      )}
      <LatestAnnouncements db={me.db} />
      {/* Keyed so one student's conversation can never show for another in a hidden route. */}
      {hasTools && <AgentPanel key={me.userId} />}
    </div>
  );
}
