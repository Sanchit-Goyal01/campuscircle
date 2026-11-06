import { AgentPanel } from "@/agent/ui/AgentPanel";
import { getProfile } from "@/lib/supabase/server";
import { allTools } from "@/modules";

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
      {/* Keyed so one student's conversation can never show for another in a hidden route. */}
      {hasTools && <AgentPanel key={me.userId} />}
    </div>
  );
}
