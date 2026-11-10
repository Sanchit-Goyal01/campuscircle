import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getProfile } from "@/lib/supabase/server";
import { NewSocietyForm } from "./form";

async function NewSociety() {
  const me = await getProfile();
  if (!me) return null; // layout renders the no-profile message
  if (me.profile.role !== "college_admin") notFound();
  // RLS limits profiles to this college.
  const { data, error } = await me.db
    .from("profiles")
    .select("id, full_name")
    .eq("role", "society_admin")
    .order("full_name", { ascending: true })
    .limit(200);
  if (error) {
    console.error("Could not load society admins:", error.message);
    throw new Error("Could not load society admins.");
  }
  const admins = (data ?? []).map((p) => ({ id: p.id as string, name: (p.full_name as string) || "Unnamed" }));
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <h1 className="font-slab text-3xl font-bold">New society</h1>
      {admins.length === 0 && <p className="text-sm">This college has no society admins yet, so a society cannot be created.</p>}
      <NewSocietyForm admins={admins} />
      <p>
        <Link href="/societies" className="text-sm underline">
          Back to societies
        </Link>
      </p>
    </div>
  );
}

export default function NewSocietyPage() {
  return (
    <Suspense fallback={<p className="text-sm">Loading...</p>}>
      <NewSociety />
    </Suspense>
  );
}
