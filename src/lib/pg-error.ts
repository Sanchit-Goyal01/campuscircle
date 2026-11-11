/**
 * The known token of a P0001 (raise exception) error, or null for any other
 * error. Callers map tokens they know to friendly text and never show a raw
 * database message.
 */
export function p0001Token(error: { code?: string; message?: string } | null | undefined): string | null {
  return error && error.code === 'P0001' && typeof error.message === 'string' ? error.message : null;
}
