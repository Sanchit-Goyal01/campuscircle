"use client";

import { useState } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";

export function SignOutButton() {
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    await getBrowserClient().auth.signOut();
    // Full navigation drops all client state, including hidden Activity routes.
    window.location.assign("/sign-in");
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={pending}
      className="rounded border border-zinc-400 px-3 py-1.5 text-sm disabled:opacity-50"
    >
      Sign out
    </button>
  );
}
