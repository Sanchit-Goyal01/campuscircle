import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getProfile } from "@/lib/supabase/server";
import { UUID } from "@/modules/academics/http";
import { formatPrice } from "@/modules/market/queries";
import { deleteListing, markSold } from "../actions";
import { CONDITION_LABEL } from "../labels";
import { ContactForm } from "./contact-form";

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const me = await getProfile();
  if (!me) return null; // layout renders the no-profile message
  const { data } = await me.db
    .from("listings")
    .select("id, seller_id, title, description, price_inr, condition, status, photo_path, created_at, profiles(full_name)")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const l = data as any;
  const prof = Array.isArray(l.profiles) ? l.profiles[0] : l.profiles;
  const isSeller = l.seller_id === me.userId;
  let photo: string | null = null;
  if (l.photo_path) {
    const { data: signed } = await me.db.storage.from("listing-photos").createSignedUrl(l.photo_path, 300);
    photo = signed?.signedUrl ?? null;
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <h1 className="font-slab text-3xl font-bold">{l.title}</h1>
      {photo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt={l.title} className="max-h-96 w-full object-contain" />
      )}
      <p className="text-xl">{formatPrice(l.price_inr)}</p>
      <p className="text-sm">
        {CONDITION_LABEL[l.condition] ?? l.condition} · Sold by {prof?.full_name || "a student"}
        {l.status === "sold" ? " · Sold" : ""}
      </p>
      {l.description && <p className="whitespace-pre-wrap">{l.description}</p>}

      {isSeller ? (
        <div className="flex flex-wrap gap-3">
          {l.status === "available" && (
            <form action={markSold}>
              <input type="hidden" name="listing_id" value={l.id} />
              <button type="submit" className="border border-zinc-800 px-3 py-1 text-sm">
                Mark as sold
              </button>
            </form>
          )}
          <form action={deleteListing}>
            <input type="hidden" name="listing_id" value={l.id} />
            <button type="submit" className="border border-zinc-800 px-3 py-1 text-sm">
              Delete
            </button>
          </form>
        </div>
      ) : l.status === "available" && me.profile.role === "student" ? (
        <section aria-labelledby="contact" className="flex flex-col gap-2">
          <h2 id="contact" className="text-xl font-semibold">
            Contact the seller
          </h2>
          <ContactForm listingId={l.id} />
        </section>
      ) : l.status === "sold" ? (
        <p>This item has been sold.</p>
      ) : null}
      <p>
        <Link href="/market" className="text-sm underline">
          Back to the marketplace
        </Link>
      </p>
    </div>
  );
}

export default function ListingPage(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p className="text-sm">Loading...</p>}>
      <Detail params={props.params} />
    </Suspense>
  );
}
