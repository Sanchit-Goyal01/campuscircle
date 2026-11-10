"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/supabase/server";
import { UUID } from "@/modules/academics/http";

type Table = "notes" | "past_papers";

/** Deletes the row (uploader only, by RLS), then its Storage object. */
async function removeDocument(table: Table, id: string): Promise<void> {
  if (!UUID.test(id)) return;
  const me = await getProfile();
  if (!me) return;

  const { data, error } = await me.db.from(table).delete().eq("id", id).select("file_path");
  if (error) throw new Error("Could not delete this file.");

  // No row back means it is not the student's to delete; nothing was removed.
  for (const row of data ?? []) {
    const { error: storageError } = await me.db.storage.from("academics").remove([row.file_path as string]);
    // The row is gone, so the student is done; an orphaned file is only logged.
    if (storageError) console.error("Could not remove a stored file after deleting its record");
  }
}

export async function deleteNote(id: string, formData?: FormData): Promise<void> {
  await removeDocument("notes", id);
  revalidatePath("/academics/notes");
  if (formData?.get("redirect") === "list") redirect("/academics/notes");
}

export async function deletePaper(id: string): Promise<void> {
  await removeDocument("past_papers", id);
  revalidatePath("/academics/papers");
}
