"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/supabase/server";
import { UUID } from "@/modules/academics/http";

type Table = "notes" | "past_papers";
export type DeleteState = { error?: string };

const DELETE_FAILED = "Could not delete this file. Try again.";

/** Deletes the row (uploader only, by RLS), then its Storage object. */
async function removeDocument(table: Table, id: string): Promise<DeleteState> {
  if (!UUID.test(id)) return {};
  const me = await getProfile();
  if (!me) return { error: DELETE_FAILED };

  const { data, error } = await me.db.from(table).delete().eq("id", id).select("file_path");
  if (error) {
    console.error("Could not delete a document record");
    return { error: DELETE_FAILED };
  }

  // No row back means it is not the student's to delete; nothing was removed.
  for (const row of data ?? []) {
    const { error: storageError } = await me.db.storage.from("academics").remove([row.file_path as string]);
    // The row is gone, so the student is done; an orphaned file is only logged.
    if (storageError) console.error("Could not remove a stored file after deleting its record");
  }
  return {};
}

export async function deleteNote(id: string, ...[, formData]: [DeleteState, FormData]): Promise<DeleteState> {
  const result = await removeDocument("notes", id);
  if (result.error) return result;
  revalidatePath("/academics/notes");
  if (formData.get("redirect") === "list") redirect("/academics/notes");
  return {};
}

export async function deletePaper(id: string): Promise<DeleteState> {
  const result = await removeDocument("past_papers", id);
  if (!result.error) revalidatePath("/academics/papers");
  return result;
}
