import Link from "next/link";
import { Suspense } from "react";
import { getProfile } from "@/lib/supabase/server";
import { listSocieties } from "@/modules/societies/queries";

const STATUS = { pending: "Request pending", approved: "Member", declined: "Request declined" } as const;

async function Societies() {
  const me = await getProfile();
  if (!me) return null; // layout renders the no-profile message
  const societies = await listSocieties(me.db, me.userId);
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <h1 className="font-slab text-3xl font-bold">Societies</h1>
      {me.profile.role === "college_admin" && (
        <p>
          <Link href="/societies/new" className="text-sm underline">
            Create a society
          </Link>
        </p>
      )}
      {societies.length === 0 ? (
        <p>No societies yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {societies.map((s) => (
            <li key={s.id} className="flex flex-col gap-1 border border-zinc-300 p-3 text-sm">
              <Link href={`/societies/${s.id}`} className="font-medium underline">
                {s.name}
              </Link>
              <div>
                {s.members} {s.members === 1 ? "member" : "members"}
                {s.myStatus && ` · ${STATUS[s.myStatus]}`}
              </div>
              {s.description && <p>{s.description.length > 160 ? `${s.description.slice(0, 160)}...` : s.description}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function SocietiesPage() {
  return (
    <Suspense fallback={<p className="text-sm">Loading...</p>}>
      <Societies />
    </Suspense>
  );
}
