"use server";

import { revalidatePath } from "next/cache";
import { getProfile } from "@/lib/supabase/server";
import { UUID } from "@/modules/academics/http";
import { getModelClient } from "@/agent/model";
import { runRootCause } from "@/modules/issues/root-cause";
import { CATEGORIES, SEVERITIES } from "@/modules/issues/schema";

export type ActionState = { error?: string; ok?: boolean; message?: string };

const GENERIC = "Something went wrong. Try again.";
const DENIED = "You can't change this issue.";
const TRANSITIONS = ["assigned", "in_progress", "resolved_pending"];

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
  if (!(CATEGORIES as readonly string[]).includes(category)) return { error: "Choose a category." };
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
  const { error } = await me.db.rpc("update_sla_rules", { p_minutes: Object.fromEntries(values) });
  if (error) return { error: error.code === "23514" ? "Enter whole minutes of 1 or more for every severity." : mapError(error) };
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

export async function findPatterns(): Promise<ActionState> {
  const me = await getProfile();
  if (!me) return { error: GENERIC };
  if (me.profile.role !== "authority" && me.profile.role !== "college_admin") return { error: DENIED };
  try {
    const { created } = await runRootCause(me.db, getModelClient("classifier"));
    revalidatePath("/authority");
    return { ok: true, message: created === 0 ? "No new patterns found." : `Found ${created} new ${created === 1 ? "pattern" : "patterns"}.` };
  } catch (e) {
    return { error: mapError({ code: (e as { code?: string }).code, message: e instanceof Error ? e.message : "unknown" }) };
  }
}

export async function decideInsight(insightId: string, status: string): Promise<ActionState> {
  if (!UUID.test(insightId) || (status !== "accepted" && status !== "dismissed")) return { error: GENERIC };
  const me = await getProfile();
  if (!me) return { error: GENERIC };
  if (me.profile.role !== "authority" && me.profile.role !== "college_admin") return { error: DENIED };
  const { data, error } = await me.db
    .from("root_cause_insights")
    .update({ status, decided_by: me.userId })
    .eq("id", insightId)
    .eq("status", "proposed")
    .select("id");
  if (error) return { error: mapError(error) };
  if (!data || data.length === 0) return { error: "This insight was already decided." };
  revalidatePath("/authority");
  return { ok: true };
}
