import { Suspense } from "react";
import { getProfile } from "@/lib/supabase/server";
import { ProfileForm } from "./form";

async function Profile() {
  const me = await getProfile();
  if (!me) return null; // layout renders the no-profile message
  const { data, error } = await me.db
    .from("profiles")
    .select("full_name, bio, skills, is_mentor")
    .eq("id", me.userId)
    .single();
  if (error) {
    console.error("Could not load profile:", error.message);
    throw new Error("Could not load your profile.");
  }
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <h1 className="font-slab text-3xl font-bold">Profile</h1>
      <ProfileForm
        fullName={data.full_name ?? ""}
        bio={data.bio ?? ""}
        skills={data.skills ?? []}
        isMentor={!!data.is_mentor}
      />
    </div>
  );
}

export default function ProfilePage() {
  return (
    <Suspense fallback={<p className="text-sm">Loading...</p>}>
      <Profile />
    </Suspense>
  );
}
