import { getProfile } from "@/lib/supabase/server";

export default async function HomePage() {
  const me = await getProfile();
  if (!me) return null; // layout renders the no-profile message
  const { data: college } = await me.db
    .from("colleges")
    .select("name")
    .eq("id", me.profile.college_id)
    .maybeSingle();

  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold">Welcome, {me.profile.full_name || "student"}</h1>
      <p>
        {college?.name ?? "Your college"} · {me.profile.role.replace("_", " ")}
      </p>
    </div>
  );
}
