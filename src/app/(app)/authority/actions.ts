"use server";

import { revalidatePath } from "next/cache";
import { getProfile } from "@/lib/supabase/server";
import { UUID } from "@/modules/academics/http";

export type ActionState = { error?: string; ok?: boolean; message?: string };

const GENERIC = "Something went wrong. Try again.";
const DENIED = "You can't change this issue.";
const TRANSITIONS = ["assigned", "in_progress", "resolved_pending"];
const SEVERITIES = ["critical", "high", "medium", "low"] as const;
const CATEGORIES = ["water", "electricity", "internet", "sanitation", "furniture", "safety", "other"];

type Rpc = { code?: string; message: string };
function mapError(error: Rpc): string {
  if (error.code === "42501") return DENIED;
  console.error("Authority action failed:", error.message);
  return GENERIC;
}

export async function transitionIssue(issueId: string, to: string, note: string): Promise<ActionState> {
  if (!UUID.test(issueId) || !TRANSITIONS.includes(to)) return { error: GENERIC };
  const me = await getProfile();
  if (!me) return { error: GENERIC };
  const trimmed = note.trim().slice(0, 500);
  const { error } = await me.db.rpc("transition_issue", {
    p_issue: issueId,
    p_to: to,
    p_note: trimmed === "" ? null : trimmed,
  });
  if (error) return { error: mapError(error) };
  revalidatePath("/authority");
  revalidatePath(`/authority/${issueId}`);
  return { ok: true };
}

export async function triageIssue(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const issueId = String(formData.get("issue_id") ?? "");
  const department = String(formData.get("department_id") ?? "");
  const category = String(formData.get("category") ?? "");
  const severity = String(formData.get("severity") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  if (!UUID.test(issueId) || !UUID.test(department)) return { error: "Choose a department." };
  if (!CATEGORIES.includes(category)) return { error: "Choose a category." };
  if (!(SEVERITIES as readonly string[]).includes(severity)) return { error: "Choose a severity." };
  if (title.length < 1 || title.length > 200) return { error: "Enter a title of 1 to 200 characters." };
  const me = await getProfile();
  if (!me) return { error: GENERIC };
  const { error } = await me.db.rpc("triage_issue", {
    p_issue: issueId,
    p_department: department,
    p_category: category,
    p_severity: severity,
    p_title: title,
  });
  if (error) return { error: mapError(error) };
  revalidatePath("/authority");
  return { ok: true };
}

export async function updateSla(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values: [(typeof SEVERITIES)[number], number][] = [];
  for (const s of SEVERITIES) {
    const raw = String(formData.get(s) ?? "").trim();
    const n = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(n) || n < 1 || n > 2_000_000) {
      return { error: "Enter whole minutes of 1 or more for every severity." };
    }
    values.push([s, n]);
  }
  const me = await getProfile();
  if (!me) return { error: GENERIC };
  if (me.profile.role !== "college_admin") return { error: DENIED };
  for (const [severity, minutes] of values) {
    // RLS limits this to the admin's own college; a refused update changes no rows.
    const { data, error } = await me.db
      .from("sla_rules")
      .update({ deadline_minutes: minutes })
      .eq("college_id", me.profile.college_id)
      .eq("severity", severity)
      .select("severity");
    if (error) return { error: mapError(error) };
    if (!data || data.length === 0) return { error: DENIED };
  }
  revalidatePath("/authority");
  return { ok: true, message: "Deadlines saved." };
}

export async function runDeadlineCheck(): Promise<ActionState> {
  const me = await getProfile();
  if (!me) return { error: GENERIC };
  const { data, error } = await me.db.rpc("run_issue_jobs_for_my_college");
  if (error) return { error: mapError(error) };
  const r = (data ?? {}) as { escalated?: number; tallied?: number };
  revalidatePath("/authority");
  return { ok: true, message: `Escalated ${r.escalated ?? 0}, tallied ${r.tallied ?? 0}.` };
}
