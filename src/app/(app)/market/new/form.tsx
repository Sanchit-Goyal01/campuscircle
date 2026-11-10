"use client";

import { startTransition, useActionState, useState } from "react";
import { createListing, type MarketState } from "../actions";

const field = "border border-zinc-400 px-2 py-1";
const UPLOAD_FAILED = "Could not upload the photo. Try again.";

export function NewListingForm() {
  const [state, dispatch, pending] = useActionState<MarketState, FormData>(createListing, {});
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setUploadError(null);
    const data = new FormData(e.currentTarget);
    const file = data.get("photo");
    data.delete("photo");
    if (file instanceof File && file.size > 0) {
      setUploading(true);
      try {
        const upload = new FormData();
        upload.append("photo", file);
        const res = await fetch("/api/market/photos", { method: "POST", body: upload });
        const body = (await res.json().catch(() => null)) as { error?: string; path?: string } | null;
        if (!res.ok || !body?.path) {
          setUploadError(body?.error ?? UPLOAD_FAILED);
          return;
        }
        data.set("photo_path", body.path);
      } catch {
        setUploadError(UPLOAD_FAILED);
        return;
      } finally {
        setUploading(false);
      }
    }
    startTransition(() => dispatch(data));
  }

  const error = uploadError ?? state.error;
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <label className="flex flex-col text-sm">
        Title
        <input name="title" maxLength={120} className={field} />
      </label>
      <label className="flex flex-col text-sm">
        Description
        <textarea name="description" rows={4} maxLength={2000} className={field} />
      </label>
      <label className="flex flex-col text-sm">
        Price (₹)
        <input name="price" inputMode="numeric" className={field} />
      </label>
      <label className="flex flex-col text-sm">
        Condition
        <select name="condition" defaultValue="good" className={field}>
          <option value="new">New</option>
          <option value="like_new">Like new</option>
          <option value="good">Good</option>
          <option value="fair">Fair</option>
        </select>
      </label>
      <label className="flex flex-col text-sm">
        Photo (optional)
        <input name="photo" type="file" accept="image/jpeg,image/png,image/webp" className={field} />
      </label>
      <div>
        <button type="submit" disabled={pending || uploading} className="border border-zinc-800 px-3 py-1 text-sm">
          {uploading ? "Uploading..." : pending ? "Listing..." : "List item"}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
    </form>
  );
}
