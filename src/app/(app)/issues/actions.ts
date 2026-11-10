"use server";

import { revalidatePath } from "next/cache";
import { getModelClient } from "@/agent/model";
import { getProfile } from "@/lib/supabase/server";
import { edgeEmbedder } from "@/modules/academics/embed";
import { UUID } from "@/modules/academics/http";
import { fileIssueReport } from "@/modules/issues/intake";
import { ReportInputSchema } from "@/modules/issues/schema";

export type ReportState = {
  error?: string;
  ok?: boolean;
  merged?: boolean;
  needs_triage?: boolean;
  department?: string | null;
  reporters?: number;
};

const GENERIC = "Could not send your report. Try again.";
const RATE_LIMITED = "You have filed 5 reports in the last 24 hours. Try again later.";

export async function submitReport(_prev: ReportState, formData: FormData): Promise<ReportState> {
  const me = await getProfile();
  if (!me) return { error: GENERIC };

  const photos = String(formData.get("photo_paths") ?? "");
  const parsed = ReportInputSchema.safeParse({
    location_id: String(formData.get("location_id") ?? ""),
    body: String(formData.get("body") ?? "").trim(),
    photo_paths: photos ? photos.split(",") : [],
  });
  if (!parsed.success) {
    if (parsed.error.issues.some((i) => i.path[0] === "location_id")) {
      return { error: "Choose where the problem is." };
    }
    if (parsed.error.issues.some((i) => i.path[0] === "body")) {
      return { error: "Describe the problem in 10 to 2000 characters." };
    }
    return { error: GENERIC };
  }

  let result;
  try {
    result = await fileIssueReport({
      db: me.db,
      input: parsed.data,
      classifier: getModelClient("classifier"),
      matcher: getModelClient(),
      embedder: edgeEmbedder,
    });
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err.message === "rate_limited") return { error: RATE_LIMITED };
    if (err.code === "23514" || err.message === "invalid_report") {
      return { error: "That report could not be accepted. Check the location, text and photos." };
    }
    if (err.code === "42501") return { error: "Only students can file reports." };
    console.error("Issue report failed:", err.message ?? "unknown error");
    return { error: GENERIC };
  }

  const { data: issue } = await me.db
    .from("issues")
    .select("report_count, departments(name)")
    .eq("id", result.issue_id)
    .maybeSingle();
  const dept = (issue as unknown as { departments: { name: string } | null } | null)?.departments?.name ?? null;
  revalidatePath("/", "layout");
  return {
    ok: true,
    merged: result.merged,
    needs_triage: result.needs_triage,
    department: dept,
    reporters: (issue as { report_count?: number } | null)?.report_count,
  };
}

export type VoteState = { error?: string; voted?: boolean };

export async function voteFix(issueId: string, fixed: boolean): Promise<VoteState> {
  const FAILED = "Could not record your vote. Try again.";
  if (!UUID.test(issueId)) return { error: FAILED };
  const me = await getProfile();
  if (!me) return { error: FAILED };
  const { error } = await me.db.rpc("confirm_issue_fix", { p_issue: issueId, p_fixed: fixed });
  if (error) {
    if (error.message.includes("not_pending")) return { error: "This issue is no longer waiting for votes." };
    if (error.code === "42501") return { error: "Only students who reported this issue can vote." };
    return { error: FAILED };
  }
  // No revalidation here: the last vote can close the issue, which would remove the
  // buttons and the confirmation message. The page is dynamic, so the next visit is fresh.
  return { voted: true };
}

export async function markRead(id: string): Promise<{ error?: string }> {
  if (!UUID.test(id)) return { error: "Could not mark this as read." };
  const me = await getProfile();
  if (!me) return { error: "Could not mark this as read." };
  // RLS limits updates to the user's own rows.
  const { error } = await me.db.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
  if (error) return { error: "Could not mark this as read." };
  revalidatePath("/", "layout");
  return {};
}
