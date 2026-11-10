import Link from "next/link";
import { Suspense } from "react";
import { getProfile } from "@/lib/supabase/server";
import { unreadConversationCount } from "@/modules/messaging/queries";
import { SignOutButton } from "./sign-out-button";

async function Shell({ children }: { children: React.ReactNode }) {
  const me = await getProfile();

  if (!me) {
    // Signed in (the proxy guarantees a session) but no profile row: do not redirect, to avoid a loop.
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-4 py-10">
        <h1 className="text-xl font-semibold">We could not find your student profile</h1>
        <p role="alert">
          Your account has no profile yet. If you just signed up, confirm your email first. Otherwise
          your college may no longer be registered.
        </p>
        <div>
          <SignOutButton />
        </div>
      </main>
    );
  }

  const { count } = await me.db
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  const unread = count ?? 0;
  const unreadChats = await unreadConversationCount(me.db, me.userId);

  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <aside className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-300 px-4 py-3 md:w-56 md:flex-col md:flex-nowrap md:items-stretch md:justify-start md:border-b-0 md:border-r">
        <p className="font-semibold">CampusCircle</p>
        <nav aria-label="Main" className="flex flex-wrap gap-x-4 gap-y-1 md:flex-col md:gap-2">
          <Link href="/" className="text-sm underline">
            Home
          </Link>
          <Link href="/academics" className="text-sm underline">
            Academics
          </Link>
          <Link href="/academics/timetable" className="text-sm underline">
            Timetable
          </Link>
          <Link href="/academics/plans" className="text-sm underline">
            Study plans
          </Link>
          <Link href="/academics/notes" className="text-sm underline">
            Notes
          </Link>
          <Link href="/academics/papers" className="text-sm underline">
            Past papers
          </Link>
          <Link href="/issues" className="text-sm underline">
            Campus issues
          </Link>
          {(me.profile.role === "authority" || me.profile.role === "college_admin") && (
            <Link href="/authority" className="text-sm underline">
              Dashboard
            </Link>
          )}
          {me.profile.role === "college_admin" && (
            <Link href="/admin" className="text-sm underline">
              Admin
            </Link>
          )}
          <Link href="/announcements" className="text-sm underline">
            Announcements
          </Link>
          <Link href="/profile" className="text-sm underline">
            Profile
          </Link>
          <Link href="/feed" className="text-sm underline">
            Feed
          </Link>
          <Link href="/people" className="text-sm underline">
            People
          </Link>
          <Link href="/mentorship" className="text-sm underline">
            Mentorship
          </Link>
          <Link href="/market" className="text-sm underline">
            Marketplace
          </Link>
          <Link href="/events" className="text-sm underline">
            Events
          </Link>
          <Link href="/societies" className="text-sm underline">
            Societies
          </Link>
          <Link href="/messages" className="text-sm underline">
            {unreadChats > 0 ? `Messages (${unreadChats})` : "Messages"}
          </Link>
          <Link href="/notifications" className="text-sm underline">
            {unread > 0 ? `Notifications (${unread})` : "Notifications"}
          </Link>
        </nav>
        <div className="md:mt-auto">
          <SignOutButton />
        </div>
      </aside>
      <main className="flex-1 px-4 py-6">{children}</main>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<p className="p-4 text-sm">Loading...</p>}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}
