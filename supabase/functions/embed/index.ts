// Embeds texts with gte-small (384 dims, mean-pooled, normalised).
// JWT verification stays on (see supabase/config.toml); callers use the
// signed-in student's token, never the service role.
const session = new Supabase.ai.Session('gte-small');

const MAX_TEXTS = 32;
const MAX_CHARS = 2000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid JSON' }, 400);
  }
  const texts = (body as { texts?: unknown })?.texts;
  if (
    !Array.isArray(texts) ||
    texts.length < 1 ||
    texts.length > MAX_TEXTS ||
    !texts.every((t) => typeof t === 'string' && t.length <= MAX_CHARS)
  ) {
    return json({ error: `texts must be 1-${MAX_TEXTS} strings of at most ${MAX_CHARS} characters` }, 400);
  }
  try {
    const embeddings: number[][] = [];
    for (const t of texts as string[]) {
      const e = await session.run(t, { mean_pool: true, normalize: true });
      embeddings.push(Array.from(e as ArrayLike<number>));
    }
    return json({ embeddings });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'embedding failed' }, 500);
  }
});
