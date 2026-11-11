import Link from "next/link";
import { formatWhen } from "@/modules/events/queries";
import type { FeedPost } from "@/modules/feed/queries";
import { deletePost, toggleLike } from "./actions";
import { ReportForm } from "./post-controls";

export function Verified({ verified }: { verified: boolean }) {
  return verified ? <span className="text-xs">(Verified)</span> : null;
}

export function PostCard({ post, viewerId, detail = false }: { post: FeedPost; viewerId: string; detail?: boolean }) {
  const mine = post.author_id === viewerId;
  return (
    <article className="flex flex-col gap-2 border border-zinc-300 p-3 text-sm">
      <header>
        <span className="font-medium">{post.author_name}</span> <Verified verified={post.verified} />
        <span className="ml-2 text-xs">{formatWhen(post.created_at)}</span>
      </header>
      {post.hidden && <p className="font-medium">Hidden by a moderator</p>}
      <p className="whitespace-pre-wrap">{post.body}</p>
      {post.photo_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={post.photo_url} alt={`Photo from ${post.author_name}`} className="max-h-96 w-full object-contain" />
      )}
      <div className="flex flex-wrap items-center gap-4">
        {!post.hidden && (
          <form action={toggleLike}>
            <input type="hidden" name="post_id" value={post.id} />
            <button type="submit" className="underline">
              {post.liked_by_me ? "Unlike" : "Like"}
            </button>
          </form>
        )}
        <span>{post.like_count === 1 ? "1 like" : `${post.like_count} likes`}</span>
        {detail ? (
          <span>{post.comment_count === 1 ? "1 comment" : `${post.comment_count} comments`}</span>
        ) : (
          <Link href={`/feed/${post.id}`} className="underline">
            Comments ({post.comment_count})
          </Link>
        )}
        {mine && (
          <form action={deletePost}>
            <input type="hidden" name="post_id" value={post.id} />
            <button type="submit" className="underline">
              Delete
            </button>
          </form>
        )}
      </div>
      {!mine && !post.hidden && <ReportForm postId={post.id} />}
    </article>
  );
}
