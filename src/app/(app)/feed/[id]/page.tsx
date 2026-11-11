import Link from "next/link";
import { Suspense } from "react";
import { getProfile } from "@/lib/supabase/server";
import { UUID } from "@/modules/academics/http";
import { formatWhen } from "@/modules/events/queries";
import { getPost, listComments } from "@/modules/feed/queries";
import { deleteComment } from "../actions";
import { PostCard, Verified } from "../post-card";
import { CommentForm } from "../post-controls";

const Missing = () => (
  <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
    <p>This post is not available.</p>
    <p>
      <Link href="/feed" className="text-sm underline">
        Back to the feed
      </Link>
    </p>
  </div>
);

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getProfile();
  if (!me) return null; // layout renders the no-profile message
  if (!UUID.test(id)) return <Missing />;
  const post = await getPost(me.db, id, me.userId);
  if (!post) return <Missing />;
  const comments = await listComments(me.db, id);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <h1 className="font-slab text-3xl font-bold">Post</h1>
      <PostCard post={post} viewerId={me.userId} detail />
      <section aria-labelledby="comments" className="flex flex-col gap-3">
        <h2 id="comments" className="text-xl font-semibold">
          Comments
        </h2>
        {comments.length === 0 ? (
          <p className="text-sm">No comments yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {comments.map((c) => (
              <li key={c.id} className="border border-zinc-300 p-2 text-sm">
                <span className="font-medium">{c.author_name}</span> <Verified verified={c.verified} />
                <span className="ml-2 text-xs">{formatWhen(c.created_at)}</span>
                <p className="whitespace-pre-wrap">{c.body}</p>
                {c.author_id === me.userId && (
                  <form action={deleteComment}>
                    <input type="hidden" name="comment_id" value={c.id} />
                    <input type="hidden" name="post_id" value={id} />
                    <button type="submit" className="text-xs underline">
                      Delete comment
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        {!post.hidden && <CommentForm postId={id} />}
      </section>
      <p>
        <Link href="/feed" className="text-sm underline">
          Back to the feed
        </Link>
      </p>
    </div>
  );
}

export default function PostPage(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p className="text-sm">Loading...</p>}>
      <Detail params={props.params} />
    </Suspense>
  );
}
