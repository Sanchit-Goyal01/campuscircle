import Link from "next/link";
import { Suspense } from "react";
import { getProfile } from "@/lib/supabase/server";
import { listFeed } from "@/modules/feed/queries";
import { Composer } from "./composer";
import { PostCard } from "./post-card";

const PAGE = 20;

async function Feed({ searchParams }: { searchParams: Promise<{ before?: string | string[] }> }) {
  const me = await getProfile();
  if (!me) return null; // layout renders the no-profile message
  const sp = await searchParams;
  const raw = Array.isArray(sp.before) ? sp.before[0] : sp.before;
  // Keep the raw string (microsecond precision); accept only ISO-like timestamps.
  const before = raw && raw.length <= 40 && /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/.test(raw) && !Number.isNaN(Date.parse(raw)) ? raw : undefined;
  const rows = await listFeed(me.db, { before, limit: PAGE + 1, viewerId: me.userId });
  const posts = rows.slice(0, PAGE);
  const more = rows.length > PAGE;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <h1 className="font-slab text-3xl font-bold">Feed</h1>
      <Composer />
      {posts.length === 0 ? (
        <p>{before ? "No older posts." : "No posts yet. Be the first to post."}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {posts.map((p) => (
            <li key={p.id}>
              <PostCard post={p} viewerId={me.userId} />
            </li>
          ))}
        </ul>
      )}
      {more && (
        <p>
          <Link href={`/feed?before=${encodeURIComponent(posts[posts.length - 1].created_at)}`} className="text-sm underline">
            Load more
          </Link>
        </p>
      )}
    </div>
  );
}

export default function FeedPage(props: { searchParams: Promise<{ before?: string | string[] }> }) {
  return (
    <Suspense fallback={<p className="text-sm">Loading...</p>}>
      <Feed searchParams={props.searchParams} />
    </Suspense>
  );
}
