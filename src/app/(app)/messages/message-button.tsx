import { openConversation } from "./actions";

/** Opens (or creates) the conversation with another person, then goes to it. Render it only for someone other than the signed-in user. */
export function MessageButton({ personId }: { personId: string }) {
  return (
    <form action={openConversation}>
      <input type="hidden" name="other_id" value={personId} />
      <button type="submit" className="border border-zinc-800 px-3 py-1 text-sm">
        Message
      </button>
    </form>
  );
}
