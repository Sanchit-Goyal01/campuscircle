"use client";

import { useActionState } from "react";
import { deleteListing, markSold, type MarketState } from "../actions";

const btn = "border border-zinc-800 px-3 py-1 text-sm";

export function SellerActions({ listingId, available }: { listingId: string; available: boolean }) {
  const [soldState, sold, soldPending] = useActionState<MarketState, FormData>(markSold, {});
  const [delState, del, delPending] = useActionState<MarketState, FormData>(deleteListing, {});
  const error = soldState.error ?? delState.error;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-3">
        {available && (
          <form action={sold}>
            <input type="hidden" name="listing_id" value={listingId} />
            <button type="submit" disabled={soldPending} className={btn}>
              Mark as sold
            </button>
          </form>
        )}
        <form action={del}>
          <input type="hidden" name="listing_id" value={listingId} />
          <button type="submit" disabled={delPending} className={btn}>
            Delete
          </button>
        </form>
      </div>
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
