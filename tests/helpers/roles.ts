import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "../../src/agent/types";
import { adminClient, createStudent } from "./supabase";

/** Signs up a user, then promotes them through the service role. */
export async function createUserWithRole(
  email: string,
  role: Role,
  opts: { departmentName?: string; head?: boolean } = {},
): Promise<{ id: string; client: SupabaseClient }> {
  const user = await createStudent(email);
  const admin = adminClient();
  const patch: Record<string, unknown> = { role };
  if (opts.departmentName) {
    const { data: prof, error: pe } = await admin
      .from("profiles")
      .select("college_id")
      .eq("id", user.id)
      .single();
    if (pe) throw pe;
    const { data: dept, error: de } = await admin
      .from("departments")
      .select("id")
      .eq("college_id", prof.college_id)
      .eq("name", opts.departmentName)
      .single();
    if (de) throw de;
    patch.department_id = dept.id;
  }
  if (opts.head !== undefined) patch.is_department_head = opts.head;
  const { error } = await admin.from("profiles").update(patch).eq("id", user.id);
  if (error) throw error;
  return user;
}
