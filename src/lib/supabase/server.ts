import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { connection } from "next/server";
import type { Role, ToolContext } from "@/agent/types";

/** Supabase client bound to the signed-in student's cookie session (anon key, RLS applies). */
export async function getServerClient(): Promise<SupabaseClient> {
  // Session lookups use Date.now(); require a real request first (Cache Components).
  await connection();
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            for (const { name, value, options } of toSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component; the proxy refreshes the session cookie.
          }
        },
      },
    },
  );
}

export type Profile = { full_name: string; college_id: string; role: Role };

/** Signed-in student's verified user and profile, or null when either is missing. */
export async function getProfile(): Promise<{ db: SupabaseClient; userId: string; profile: Profile } | null> {
  const db = await getServerClient();
  const { data: auth, error } = await db.auth.getUser();
  if (error || !auth.user) return null;
  const { data: profile } = await db
    .from("profiles")
    .select("full_name, college_id, role")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (!profile) return null;
  return { db, userId: auth.user.id, profile: profile as Profile };
}

/** Context for agent tools. Built only from the student's own session; never uses the service role. */
export async function getToolContext(): Promise<ToolContext | null> {
  const p = await getProfile();
  if (!p) return null;
  return {
    db: p.db,
    userId: p.userId,
    collegeId: p.profile.college_id,
    role: p.profile.role,
  };
}
