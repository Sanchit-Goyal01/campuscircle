import Link from "next/link";
import { Suspense } from "react";
import { getProfile } from "@/lib/supabase/server";
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

  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <aside className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-300 px-4 py-3 md:w-56 md:flex-col md:flex-nowrap md:items-stretch md:justify-start md:border-b-0 md:border-r">
        <p className="font-semibold">CampusCircle</p>
        <nav aria-label="Main" className="flex gap-4 md:flex-col md:gap-2">
          <Link href="/" className="text-sm underline">
            Home
          </Link>
          <Link href="/academics" className="text-sm underline">
            Academics
          </Link>
          <Link href="/academics/timetable" className="text-sm underline">
            Timetable
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
