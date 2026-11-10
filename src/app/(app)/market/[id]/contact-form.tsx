"use client";

import { useActionState } from "react";
import { contactSeller, type MarketState } from "../actions";

export function ContactForm({ listingId }: { listingId: string }) {
  const [state, dispatch, pending] = useActionState<MarketState, FormData>(contactSeller, {});
  return (
    <form action={dispatch} className="flex flex-col gap-2">
      <input type="hidden" name="listing_id" value={listingId} />
      <label className="flex flex-col text-sm">
        Message
        <textarea name="message" rows={3} maxLength={500} className="border border-zinc-400 px-2 py-1" />
      </label>
      <div>
        <button type="submit" disabled={pending} className="border border-zinc-800 px-3 py-1 text-sm">
          {pending ? "Sending..." : "Contact seller"}
        </button>
      </div>
      {state.error && (
        <p role="alert" className="text-sm">
          {state.error}
        </p>
      )}
      {state.ok && !state.error && (
        <p role="status" className="text-sm">
          Message sent to the seller.
        </p>
      )}
    </form>
  );
}
