"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { createPost, type FeedState } from "./actions";

const field = "border border-zinc-400 px-2 py-1";
const UPLOAD_FAILED = "Could not upload the photo. Try again.";

export function Composer() {
  const [state, dispatch, pending] = useActionState<FeedState, FormData>(createPost, {});
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

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
        const res = await fetch("/api/feed/photos", { method: "POST", body: upload });
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
    <form ref={formRef} onSubmit={submit} noValidate className="flex flex-col gap-2 border border-zinc-300 p-3">
      <label className="flex flex-col text-sm">
        What is happening?
        <textarea name="body" rows={3} maxLength={2000} className={field} />
      </label>
      <label className="flex flex-col text-sm">
        Photo (optional)
        <input name="photo" type="file" accept="image/jpeg,image/png,image/webp" className={field} />
      </label>
      <div>
        <button type="submit" disabled={pending || uploading} className="border border-zinc-800 px-3 py-1 text-sm">
          {uploading ? "Uploading..." : pending ? "Posting..." : "Post"}
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
