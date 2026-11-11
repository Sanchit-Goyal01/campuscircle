"use client";

import { useSearchParams } from "next/navigation";

/** Shown after a confirmation link. The text is fixed; only the flag comes from the URL. */
export function ConfirmedNotice() {
  if (useSearchParams().get("confirmed") !== "1") return null;
  return (
    <p role="status" className="text-sm text-green-700">
      Your email is confirmed. Sign in to continue.
    </p>
  );
}
