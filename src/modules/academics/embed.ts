import type { SupabaseClient } from '@supabase/supabase-js';

export type Embedder = (db: SupabaseClient, texts: string[]) => Promise<number[][]>;

const BATCH = 32;

/**
 * Embeds texts through the `embed` Edge Function with the caller's own JWT
 * (the student's client), 32 texts per request.
 */
export const edgeEmbedder: Embedder = async (db, texts) => {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const { data, error } = await db.functions.invoke('embed', { body: { texts: batch } });
    if (error) throw new Error(`Embedding failed: ${error.message}`);
    const embeddings = (data as { embeddings?: number[][] } | null)?.embeddings;
    if (!Array.isArray(embeddings) || embeddings.length !== batch.length) {
      throw new Error('Embedding failed: unexpected response');
    }
    out.push(...embeddings);
  }
  return out;
};
