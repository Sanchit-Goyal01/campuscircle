import Link from "next/link";
import { Suspense } from "react";
import { getProfile } from "@/lib/supabase/server";
import { formatPrice, searchListings } from "@/modules/market/queries";
import { CONDITION_LABEL } from "./labels";

const field = "border border-zinc-400 px-2 py-1";

async function Market({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const me = await getProfile();
  if (!me) return null; // layout renders the no-profile message
  const sp = await searchParams;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim().slice(0, 100) ?? "";
  const listings = await searchListings(me.db, { query: q, limit: 30 });
  // Photos are private: sign each with the viewer's own session.
  const urls = await Promise.all(
    listings.map(async (l) => {
      if (!l.photo_path) return null;
      const { data } = await me.db.storage.from("listing-photos").createSignedUrl(l.photo_path, 300);
      return data?.signedUrl ?? null;
    }),
  );

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <h1 className="font-slab text-3xl font-bold">Marketplace</h1>
      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-sm">
          Search
          <input name="q" defaultValue={q} maxLength={100} className={field} />
        </label>
        <button type="submit" className="border border-zinc-800 px-3 py-1 text-sm">
          Search
        </button>
        {me.profile.role === "student" && (
          <Link href="/market/new" className="text-sm underline">
            List an item
          </Link>
        )}
      </form>
      {listings.length === 0 ? (
        <p>{q ? "No listings match your search." : "Nothing is for sale yet."}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {listings.map((l, i) => (
            <li key={l.id} className="flex flex-col gap-1 border border-zinc-300 p-3 text-sm">
              {urls[i] && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={urls[i]!} alt={l.title} className="h-40 w-full object-cover" />
              )}
              <Link href={`/market/${l.id}`} className="font-medium underline">
                {l.title}
              </Link>
              <div>
                {formatPrice(l.price_inr)} · {CONDITION_LABEL[l.condition] ?? l.condition}
              </div>
              <div>
                Sold by {l.seller_name}
                {l.seller_verified && <span className="ml-2 text-xs">Verified</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function MarketPage(props: { searchParams: Promise<{ q?: string | string[] }> }) {
  return (
    <Suspense fallback={<p className="text-sm">Loading...</p>}>
      <Market searchParams={props.searchParams} />
    </Suspense>
  );
}
