import Link from "next/link";
import { Suspense } from "react";
import { getProfile } from "@/lib/supabase/server";
import { NewListingForm } from "./form";

async function NewListing() {
  const me = await getProfile();
  if (!me) return null; // layout renders the no-profile message
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <h1 className="font-slab text-3xl font-bold">List an item</h1>
      {me.profile.role === "student" ? (
        <NewListingForm />
      ) : (
        <p>Only students can list items.</p>
      )}
      <p>
        <Link href="/market" className="text-sm underline">
          Back to the marketplace
        </Link>
      </p>
    </div>
  );
}

export default function NewListingPage() {
  return (
    <Suspense fallback={<p className="text-sm">Loading...</p>}>
      <NewListing />
    </Suspense>
  );
}
